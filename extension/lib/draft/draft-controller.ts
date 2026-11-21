import type { PanelStateStore } from '../capture/panel-state-store';
import { DraftRequestSchema, type DraftRequest, type DraftResponse } from '../../schemas/draft';
import type { ErrorCode } from '../../schemas/error';
import type { PanelState } from '../../schemas/internal-message';
import type { NativeCall } from '../native/native-client';
import type { TargetStore } from '../targeting/target-store';

/** Default answer length for a first draft (PRD 15.1). */
export const DEFAULT_MAX_WORDS = 150;

export interface DraftControllerDeps {
  native: { generateDraft(request: DraftRequest): NativeCall<DraftResponse> };
  panel: PanelStateStore;
  targets: TargetStore;
  now(): Date;
}

export interface DraftStartInput {
  tabId: number;
  captureId: string;
  question: string;
}

export interface DraftController {
  /** Starts a draft for a tab, cancelling that tab's earlier one. */
  start(input: DraftStartInput): void;
  /** The user's Cancel: stops the tab's request and returns to the captured state. */
  cancel(tabId: number): void;
  /** Navigation or tab close: stops the request without touching panel state. */
  abandon(tabId: number): void;
  /** The side panel closed: stops every request and returns those tabs to captured. */
  cancelAll(): void;
}

type Base = Pick<Extract<PanelState, { kind: 'captured' }>, 'source' | 'captureId' | 'field'>;

interface InFlight {
  seq: number;
  call: NativeCall<DraftResponse>;
}

/**
 * Runs at most one draft request per tab. Every result is checked against the
 * request that is current for its tab, so a late response for an old request, a
 * cancelled one, or another tab can never overwrite what the panel shows. It
 * only produces panel state: it never inserts anything and never touches pages.
 */
export function createDraftController(deps: DraftControllerDeps): DraftController {
  const inFlight = new Map<number, InFlight>();
  let nextSeq = 0;

  /**
   * What the panel is showing for this tab. If the worker has no state for it
   * (restarted, or the state was reset) the panel's own captureId is trusted
   * and the field is reported as not found, which is true: the worker's field
   * target is gone too. Other states (unsupported domain, error) never draft,
   * and a captureId that does not match the worker's current capture is stale.
   */
  function baseFor(tabId: number, captureId: string): Base | undefined {
    const state = deps.panel.get(tabId);
    switch (state.kind) {
      case 'captured':
      case 'generating':
      case 'generated':
        return state.captureId === captureId
          ? { source: state.source, captureId, field: state.field }
          : undefined;
      case 'empty':
        return { source: 'menu-selection', captureId, field: { status: 'not-found' } };
      default:
        return undefined;
    }
  }

  function maxChars(tabId: number): number | undefined {
    const tracked = deps.targets.get(tabId);
    if (tracked === undefined || tracked.target.state === 'invalidated') return undefined;
    const limit = tracked.target.fingerprint.maxLength;
    return limit !== undefined && limit > 0 ? limit : undefined;
  }

  function stop(tabId: number): boolean {
    const current = inFlight.get(tabId);
    if (current === undefined) return false;
    inFlight.delete(tabId);
    current.call.cancel();
    return true;
  }

  function backToCaptured(tabId: number, error?: ErrorCode): void {
    const state = deps.panel.get(tabId);
    if (state.kind !== 'generating') return;
    const { question, source, captureId, field } = state;
    deps.panel.set(
      tabId,
      error === undefined
        ? { kind: 'captured', question, source, captureId, field }
        : { kind: 'captured', question, source, captureId, field, error },
    );
  }

  return {
    start({ tabId, captureId, question }) {
      const base = baseFor(tabId, captureId);
      if (base === undefined) return;
      stop(tabId);
      const limit = maxChars(tabId);
      const request = DraftRequestSchema.safeParse({
        question: question.trim(),
        constraints:
          limit === undefined
            ? { maxWords: DEFAULT_MAX_WORDS }
            : { maxWords: DEFAULT_MAX_WORDS, maxChars: limit },
        requestedAt: deps.now().toISOString(),
      });
      const shown = { question, ...base };
      if (!request.success) {
        deps.panel.set(tabId, { kind: 'captured', ...shown, error: 'INVALID_REQUEST' });
        return;
      }
      deps.panel.set(tabId, { kind: 'generating', ...shown });
      const seq = ++nextSeq;
      const call = deps.native.generateDraft(request.data);
      inFlight.set(tabId, { seq, call });
      void call.result.then((outcome) => {
        if (inFlight.get(tabId)?.seq !== seq) return; // stale: replaced, cancelled, or abandoned
        inFlight.delete(tabId);
        const state = deps.panel.get(tabId);
        if (state.kind !== 'generating' || state.captureId !== base.captureId) return;
        if (!outcome.ok) return backToCaptured(tabId, outcome.error.code);
        const { answer, warnings, evidence } = outcome.value;
        deps.panel.set(tabId, {
          kind: 'generated',
          ...shown,
          answer,
          evidence: evidence.map(({ source, quote }) => ({ source, quote })),
          warnings,
          draftId: seq,
          maxWords: DEFAULT_MAX_WORDS,
          ...(limit === undefined ? {} : { maxChars: limit }),
        });
      });
    },
    cancel(tabId) {
      if (stop(tabId)) backToCaptured(tabId);
    },
    abandon(tabId) {
      stop(tabId);
    },
    cancelAll() {
      for (const tabId of [...inFlight.keys()]) {
        stop(tabId);
        backToCaptured(tabId);
      }
    },
  };
}
