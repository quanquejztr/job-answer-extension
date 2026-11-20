import type { PanelStateStore } from '../capture/panel-state-store';
import { checkAnswer } from '../draft/answer-limits';
import {
  InsertResultSchema,
  InsertStartSchema,
  InternalMessageSchema,
  type FieldRevalidateRequest,
  type InsertErrorCode,
  type InsertRequest,
  type PanelState,
} from '../../schemas/internal-message';
import { isTrustedExtensionPage, type Sender } from '../messaging/panel-messages';
import { revalidateTarget } from '../targeting/revalidate-target';
import { advance } from '../targeting/target';
import type { TargetStore } from '../targeting/target-store';

export interface InsertFlowDeps {
  panel: PanelStateStore;
  targets: TargetStore;
  sendTabMessage(
    tabId: number,
    message: FieldRevalidateRequest | InsertRequest,
    options: { frameId: number },
  ): Promise<unknown>;
  newRequestId(): string;
}

export interface InsertStartInput {
  tabId: number;
  captureId: string;
  answer: string;
}

export interface InsertFlow {
  /** The panel's explicit Insert action. Silently ignored unless it is valid right now. */
  start(input: InsertStartInput): Promise<void>;
}

type Reviewed = Extract<PanelState, { kind: 'generated' }>;

/**
 * Worker side of "Insert answer" (PRD 17.1, specs/05 invariants 1-5).
 *
 * Accepted only when the tab's panel shows a finished draft (so never while a
 * draft is generating, and never twice: `inserting` and `inserted` are not
 * `generated`) for the capture the field target was made with, and the answer
 * is within the draft's limits. Then, in order:
 *   1. revalidate the target in its frame (captured -> validated);
 *   2. mark it approved: the click is the explicit approval;
 *   3. send `insert.request` to that frame only (answer, target id, locator,
 *      fingerprint, nothing else);
 *   4. on success mark it inserted (terminal); on any failure invalidate it.
 * Nothing is retried and no other element is addressed. The content script
 * refuses a nonempty field itself (confirmation arrives in Slice 4.3).
 */
export function createInsertFlow(deps: InsertFlowDeps): InsertFlow {
  const busy = new Set<number>();

  async function run(tabId: number, reviewed: Reviewed, answer: string): Promise<void> {
    const { captureId } = reviewed;
    // The panel keeps the generated text and shows the user's reviewed text.
    const keepDraft = {
      question: reviewed.question,
      source: reviewed.source,
      captureId,
      field: reviewed.field,
      draftId: reviewed.draftId,
      answer: reviewed.answer,
      usedFactCount: reviewed.usedFactCount,
      warnings: reviewed.warnings,
      maxWords: reviewed.maxWords,
      ...(reviewed.maxChars === undefined ? {} : { maxChars: reviewed.maxChars }),
      editedAnswer: answer,
    };
    deps.panel.set(tabId, { ...keepDraft, kind: 'inserting' });

    /** Still the insert this call started? A navigation or tab close resets the panel. */
    const current = (): boolean => {
      const state = deps.panel.get(tabId);
      return state.kind === 'inserting' && state.captureId === captureId;
    };
    const fail = (error: InsertErrorCode): void => {
      if (!current()) return;
      const tracked = deps.targets.get(tabId);
      if (tracked?.target.id === captureId) deps.targets.invalidate(tabId, 'insert-failed');
      deps.panel.set(tabId, { ...keepDraft, kind: 'generated', insertError: error });
    };

    const tracked = deps.targets.get(tabId); // applies expiry
    if (tracked === undefined || tracked.target.id !== captureId) return fail('FIELD_STALE');

    const revalidation = await revalidateTarget(
      {
        targets: deps.targets,
        sendTabMessage: deps.sendTabMessage,
        newRequestId: deps.newRequestId,
      },
      tabId,
    );
    if (!revalidation.ok) {
      // revalidateTarget already invalidated the target with its own reason.
      if (current())
        deps.panel.set(tabId, { ...keepDraft, kind: 'generated', insertError: 'FIELD_STALE' });
      return;
    }
    if (!current()) return;

    const validated = deps.targets.get(tabId);
    const approved =
      validated?.target.id === captureId ? advance(validated, 'approved') : undefined;
    if (approved === undefined) return fail('FIELD_STALE');
    deps.targets.update(tabId, approved);

    const requestId = deps.newRequestId();
    const { target } = approved;
    const request: InsertRequest = {
      v: 1,
      requestId,
      type: 'insert.request',
      payload: {
        targetId: target.id,
        answer,
        confirmReplace: false,
        locator: target.locator,
        fingerprint: target.fingerprint,
      },
    };
    let reply: unknown;
    try {
      reply = await deps.sendTabMessage(tabId, request, { frameId: target.frameId });
    } catch {
      return fail('FIELD_STALE'); // the frame is gone
    }
    const parsed = InsertResultSchema.safeParse(reply);
    if (!current()) return;
    if (!parsed.success || parsed.data.requestId !== requestId) return fail('FIELD_UNSUPPORTED');
    const result = parsed.data.payload;
    if (!result.ok) return fail(result.error);

    const live = deps.targets.get(tabId);
    const inserted = live?.target.id === captureId ? advance(live, 'inserted') : undefined;
    if (inserted === undefined) return fail('FIELD_STALE');
    deps.targets.update(tabId, inserted);
    const { question, source, field } = reviewed;
    deps.panel.set(tabId, { kind: 'inserted', question, source, captureId, field });
  }

  return {
    async start({ tabId, captureId, answer }) {
      if (busy.has(tabId)) return; // double-click guard
      const state = deps.panel.get(tabId);
      if (state.kind !== 'generated' || state.captureId !== captureId) return;
      if (state.insertError !== undefined || state.field.status !== 'found') return;
      const text = answer.trim();
      if (checkAnswer(text, state) !== 'ok') return;
      busy.add(tabId);
      try {
        await run(tabId, state, text);
      } finally {
        busy.delete(tabId);
      }
    },
  };
}

/**
 * Worker-side handler for `insert.start`. Only the extension's own pages may
 * send it (a content script has `sender.tab` and is ignored). Returns true when
 * the message was an accepted `insert.start`.
 */
export function handleInsertMessage(
  deps: { runtimeId: string; flow: InsertFlow },
  message: unknown,
  sender: Sender,
): boolean {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return false;
  const parsed = InternalMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  const start = InsertStartSchema.safeParse(parsed.data);
  if (!start.success) return false;
  void deps.flow.start(start.data.payload);
  return true;
}
