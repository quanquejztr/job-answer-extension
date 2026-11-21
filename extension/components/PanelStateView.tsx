import { useEffect, useId, useState } from 'react';
import { MAX_QUESTION_CHARS, MIN_QUESTION_CHARS } from '../lib/constants/limits';
import { checkAnswer, countWords, type AnswerCheck } from '../lib/draft/answer-limits';
import { appErrorFor } from '../schemas/error';
import type { DraftWarning } from '../schemas/draft';
import type { ProfileStatus } from '../schemas/profile-status-message';
import type { EvidenceQuote } from '../schemas/draft';
import type { CaptureSource, PanelField, PanelState } from '../schemas/internal-message';

/** What the panel can ask for; implemented by the app through the typed panel client. */
export interface PanelActions {
  /** Draft from the question as currently edited. */
  generate(captureId: string, question: string): void;
  /** Insert the reviewed answer as currently edited. Only the explicit button calls this. */
  insert(captureId: string, answer: string): void;
  cancel(): void;
  /** Opens the settings page (provider choice, disclosure, résumé). */
  openSettings(): void;
}

type ReviewState = Extract<PanelState, { kind: 'generated' | 'inserting' }>;
type DraftingState = Extract<PanelState, { kind: 'captured' | 'generating' }> | ReviewState;

// Everything below renders as React text nodes only: question text and error
// strings are never interpreted as HTML.

/** Shown, with Generate disabled, when no provider is chosen (PRD 18). */
export const NO_PROVIDER_HINT = 'Choose Claude Code or Codex in settings before drafting.';

/** Shown, with Generate disabled, until the first-use disclosure is accepted (PRD 18.1). */
export const NO_DISCLOSURE_HINT =
  'Read and accept the first-use disclosure in settings before drafting.';

/** Shown, with Generate disabled, when no résumé is saved. */
export const NO_RESUME_HINT = "Add your résumé in the extension's settings before drafting.";

type Blocker = 'provider' | 'disclosure' | 'resume';

const BLOCKER_HINT: Record<Blocker, string> = {
  provider: NO_PROVIDER_HINT,
  disclosure: NO_DISCLOSURE_HINT,
  resume: NO_RESUME_HINT,
};

/**
 * What stops a draft before it starts, in the order the owner must fix it, or
 * undefined when nothing is known to stop it (including when the status is
 * unknown: the helper then answers the request itself).
 */
function blockerFor(status: ProfileStatus | undefined): Blocker | undefined {
  if (status === undefined) return undefined;
  if (status.provider === undefined) return 'provider';
  if (!status.disclosureAccepted) return 'disclosure';
  if (!status.hasResume) return 'resume';
  return undefined;
}

const PROVIDER_NAME = { claude: 'Claude Code', codex: 'Codex' } as const;

/** Whole seconds since mount while `active`; 0 otherwise. */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [active]);
  return seconds;
}

const SOURCE_TEXT: Record<CaptureSource, string> = {
  'content-script': 'Source: the selection read from the page.',
  'menu-selection':
    'Source: the selection passed by the context menu (the page could not be read).',
};

function fieldLine(field: PanelField): string {
  switch (field.status) {
    case 'found':
      return field.label === undefined
        ? 'Answer field: found'
        : `Answer field: found (${field.label})`;
    case 'not-found':
      return 'Answer field: not found';
    case 'ambiguous':
      return 'Answer field: several fields match';
  }
}

function ErrorNotice({ code }: { code: Parameters<typeof appErrorFor>[0] }) {
  const error = appErrorFor(code);
  return (
    <div role="alert" className="state state-error mt-3">
      <p className="font-medium">{error.message}</p>
      {error.userAction !== undefined && <p>Next step: {error.userAction}.</p>}
    </div>
  );
}

/** Where a quote came from, in words. The story id stays out of the label. */
function sourceLabel(source: string): string {
  return source === 'resume' ? 'Résumé' : 'Story';
}

/** The verified quotes the draft rests on, collapsed by default. Plain text only. */
function EvidenceList({ evidence }: { evidence: readonly EvidenceQuote[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer font-medium">Evidence</summary>
      <ul className="mt-1 list-disc ps-5">
        {evidence.map((e, i) => (
          <li key={`${e.source}-${i}`}>
            <span className="text-muted">{sourceLabel(e.source)}</span>: &ldquo;{e.quote}&rdquo;
          </li>
        ))}
      </ul>
    </details>
  );
}

function WarningList({ warnings }: { warnings: readonly DraftWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-2 list-disc ps-5">
      {warnings.map((w, i) => (
        <li key={i} className={w.severity === 'warn' ? 'text-warning' : 'text-muted'}>
          {w.severity === 'warn' ? 'Warning: ' : 'Note: '}
          {w.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * The question editor and everything that follows it for the captured,
 * generating, and generated states. One component serves all three, so the
 * user's edits survive each transition (the key is the captureId).
 */
function DraftPanel({
  state,
  actions,
  profileStatus,
}: {
  state: DraftingState;
  actions: PanelActions;
  profileStatus: ProfileStatus | undefined;
}) {
  const id = useId();
  const [text, setText] = useState(state.question);
  const generating = state.kind === 'generating';
  const long = Array.from(text.trim()).length;
  const questionOk = long >= MIN_QUESTION_CHARS;
  const blocker = blockerFor(profileStatus);
  const elapsed = useElapsedSeconds(generating);
  const providerName =
    profileStatus?.provider === undefined ? 'your provider' : PROVIDER_NAME[profileStatus.provider];
  return (
    <section aria-labelledby={`${id}-label`} className="mt-3">
      <label id={`${id}-label`} htmlFor={`${id}-field`} className="block font-medium">
        Question
      </label>
      <textarea
        id={`${id}-field`}
        aria-describedby={`${id}-note`}
        className="bg-surface text-text border-border mt-1 block w-full rounded-md border p-2"
        rows={6}
        maxLength={MAX_QUESTION_CHARS}
        value={text}
        readOnly={generating || state.kind === 'inserting'}
        onChange={(event) => setText(event.target.value)}
      />
      <div id={`${id}-note`} role="status" aria-live="polite" className="mt-2">
        <p className="text-muted">Captured from the page.</p>
        <p className="text-muted">{SOURCE_TEXT[state.source]}</p>
        <p className="text-muted">{fieldLine(state.field)}</p>
        {!generating && !questionOk && (
          <p className="text-warning">
            Enter at least {MIN_QUESTION_CHARS} characters to generate a draft.
          </p>
        )}
      </div>
      {state.kind === 'captured' && state.error !== undefined && <ErrorNotice code={state.error} />}
      {state.kind === 'captured' && blocker !== undefined && (
        <div role="status" className="state state-warning mt-3">
          <p>{BLOCKER_HINT[blocker]}</p>
          <button
            type="button"
            className="border-border bg-surface text-text mt-2 rounded-md border px-3 py-2 font-medium"
            onClick={() => actions.openSettings()}
          >
            Open settings
          </button>
        </div>
      )}
      {state.kind === 'captured' && (
        <div className="mt-3">
          <button
            type="button"
            className="bg-accent text-on-accent rounded-md px-3 py-2 font-medium disabled:opacity-60"
            disabled={!questionOk || blocker !== undefined}
            onClick={() => actions.generate(state.captureId, text)}
          >
            Generate draft
          </button>
        </div>
      )}
      {generating && (
        <div className="mt-3">
          <p role="status" className="state state-loading mb-2">
            Generating with {providerName}… {elapsed} s elapsed. This can take up to a minute and a
            half.
          </p>
          <button
            type="button"
            className="border-border bg-surface text-text rounded-md border px-3 py-2 font-medium"
            onClick={() => actions.cancel()}
          >
            Cancel
          </button>
        </div>
      )}
      {(state.kind === 'generated' || state.kind === 'inserting') && (
        <ReviewSection
          key={state.draftId}
          state={state}
          actions={actions}
          regenerateDisabled={!questionOk || state.kind === 'inserting'}
          question={text}
        />
      )}
    </section>
  );
}

const INSERT_HINT: Record<Exclude<AnswerCheck, 'ok'>, (s: ReviewState) => string> = {
  empty: () => 'Insert needs a draft answer. Write one, or generate again.',
  'too-many-words': (s) =>
    `Insert needs a draft of ${s.maxWords} words or fewer. Shorten it first.`,
  'too-many-chars': (s) =>
    `Insert needs a draft within the field's ${s.maxChars ?? 0} character limit. Shorten it first.`,
};

/**
 * The draft editor, evidence and warnings, then the secondary and primary
 * actions, in the order fixed by UX-001: Insert comes last and only a click on
 * it ever inserts. Nothing here is a form, so Enter never submits anything.
 * The draft text is local state, initialised once per mount; a regenerated
 * draft mounts a fresh section because the generating state unmounts this one.
 */
function ReviewSection({
  state,
  actions,
  regenerateDisabled,
  question,
}: {
  state: ReviewState;
  actions: PanelActions;
  regenerateDisabled: boolean;
  question: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(state.editedAnswer ?? state.answer);
  const inserting = state.kind === 'inserting';
  const edited = draft !== state.answer;
  const words = countWords(draft);
  const chars = draft.trim().length;
  const check = checkAnswer(draft, state);
  const insertError = state.kind === 'generated' ? state.insertError : undefined;
  const hint = inserting
    ? undefined
    : insertError !== undefined
      ? 'Select the question on the page again to insert this answer.'
      : state.field.status !== 'found'
        ? 'Insert needs exactly one detected answer field.'
        : check === 'ok'
          ? undefined
          : INSERT_HINT[check](state);
  const canInsert = !inserting && hint === undefined;
  return (
    <>
      <section aria-labelledby={`${id}-draft`} className="mt-4">
        <label id={`${id}-draft`} htmlFor={`${id}-field`} className="block font-medium">
          Draft answer
        </label>
        <textarea
          id={`${id}-field`}
          aria-describedby={`${id}-count ${id}-origin`}
          className="bg-surface text-text border-border mt-1 block w-full rounded-md border p-2"
          rows={10}
          value={draft}
          readOnly={inserting}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p
          id={`${id}-count`}
          className={check === 'too-many-words' ? 'text-warning' : 'text-muted'}
        >
          {words} of {state.maxWords} words
          {state.maxChars !== undefined && ` (${chars} of ${state.maxChars} characters)`}
        </p>
        <p id={`${id}-origin`} className="text-muted mt-2">
          {edited ? 'Edited by you.' : 'Generated draft.'} Evidence: {state.evidence.length}{' '}
          {state.evidence.length === 1 ? 'quote' : 'quotes'}. Nothing has been inserted into the
          page.
        </p>
        <EvidenceList evidence={state.evidence} />
        <WarningList warnings={state.warnings} />
      </section>
      {insertError !== undefined && <ErrorNotice code={insertError} />}
      <div className="mt-4">
        <button
          type="button"
          className="border-border bg-surface text-text rounded-md border px-3 py-2 font-medium disabled:opacity-60"
          disabled={regenerateDisabled}
          onClick={() => actions.generate(state.captureId, question)}
        >
          Generate again
        </button>
      </div>
      <div className="mt-4">
        <button
          type="button"
          aria-describedby={`${id}-insert-note`}
          className="bg-accent text-on-accent rounded-md px-3 py-2 font-medium disabled:opacity-60"
          disabled={!canInsert}
          onClick={() => actions.insert(state.captureId, draft)}
        >
          Insert answer
        </button>
        <p id={`${id}-insert-note`} role="status" aria-live="polite" className="text-muted mt-2">
          {inserting
            ? 'Inserting into the answer field…'
            : (hint ??
              'Insert writes the draft above into the one answer field shown above. It never submits the form.')}
        </p>
      </div>
    </>
  );
}

export function PanelStateView({
  state,
  actions,
  profileStatus,
}: {
  state: PanelState;
  actions: PanelActions;
  /** Whether a résumé is saved; undefined when unknown (the helper answers on Generate). */
  profileStatus?: ProfileStatus | undefined;
}) {
  switch (state.kind) {
    case 'empty':
      return (
        <div role="status" aria-live="polite" className="mt-3">
          <p className="text-muted">Select a question on the page, then choose Draft answer.</p>
        </div>
      );
    case 'unsupported-domain':
      return (
        <div role="status" aria-live="polite" className="state state-warning mt-3">
          <p className="font-medium">This site is not supported.</p>
          <p>
            Drafting is turned off on LinkedIn, Indeed, and pages that are not regular web pages.
            Nothing was captured from this page.
          </p>
        </div>
      );
    case 'captured':
    case 'generating':
    case 'generated':
    case 'inserting':
      // The key resets local edits when the same tab captures again.
      return (
        <DraftPanel
          key={state.captureId}
          state={state}
          actions={actions}
          profileStatus={profileStatus}
        />
      );
    case 'inserted':
      return (
        <div role="status" aria-live="polite" className="state state-success mt-3">
          <p className="font-medium">Inserted into: {state.field.label ?? 'the answer field'}</p>
          <p>
            Select the question on the page again to insert another answer. Nothing was submitted;
            review the page yourself.
          </p>
        </div>
      );
    case 'error':
      return <ErrorNotice code={state.code} />;
  }
}
