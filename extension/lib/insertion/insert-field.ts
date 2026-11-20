import type { FieldFingerprint, FieldLocator } from '../../schemas/field-target';
import type { InsertErrorCode } from '../../schemas/internal-message';
import { resolveDomPath } from '../targeting/dom-path';
import { revalidateField } from '../targeting/revalidate-field';

export type InsertOutcome = { ok: true } | { ok: false; error: InsertErrorCode };

/** PRD 15.1: the verification window ends after at most 1,000 ms. */
export const VERIFY_TIMEOUT_MS = 1000;

/** Scheduling hooks, injected so tests control frames; defaults come from the page's window. */
export interface InsertEnv {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

function envFor(view: Window): InsertEnv {
  return {
    requestFrame: (cb) => view.requestAnimationFrame(() => cb()),
    cancelFrame: (h) => view.cancelAnimationFrame(h),
    setTimer: (cb, ms) => view.setTimeout(cb, ms),
    clearTimer: (h) => view.clearTimeout(h),
  };
}

const lf = (s: string): string => s.replaceAll('\r\n', '\n');

/**
 * Resolves after the next animation frame plus one microtask turn, or after
 * the timeout if frames do not run (a background tab pauses them). Either
 * event ends the wait; there is no fixed sleep.
 */
function nextFrameAndMicrotask(env: InsertEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let frame = 0;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      env.cancelFrame(frame);
      env.clearTimer(timer);
      // One microtask turn lets promise-based framework updates settle first.
      void Promise.resolve().then(resolve);
    };
    frame = env.requestFrame(finish);
    timer = env.setTimer(finish, timeoutMs);
  });
}

/**
 * Inserts one approved answer into the one textarea the locator names.
 *
 * Order: re-resolve and revalidate the field (the same checks as step 1.2:
 * present, a textarea, visible, enabled and writable, same fingerprint), refuse
 * a nonempty field, write through the textarea's native value setter, dispatch
 * bubbling `input` then `change` on that element only, then verify the value
 * after the next frame and a microtask turn. A mismatch is reported and the
 * value is never written again.
 *
 * It touches exactly one element. It never focuses, clicks, submits, or sends
 * an event to any other node, and it never retries.
 */
export async function insertAnswer(
  doc: Document,
  locator: FieldLocator,
  fingerprint: FieldFingerprint,
  answer: string,
  env?: InsertEnv,
): Promise<InsertOutcome> {
  const view = doc.defaultView;
  if (view === null) return { ok: false, error: 'FIELD_STALE' };

  const check = revalidateField(doc, locator, fingerprint);
  if (!check.ok) return { ok: false, error: 'FIELD_STALE' };
  const element = resolveDomPath(doc.body, locator.domPath);
  if (!(element instanceof HTMLTextAreaElement)) return { ok: false, error: 'FIELD_STALE' };

  // The native accessors, not the instance's own `value`, which a page can shadow.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  const read = descriptor?.get;
  const write = descriptor?.set;
  if (read === undefined || write === undefined) return { ok: false, error: 'FIELD_UNSUPPORTED' };

  // Never replace existing text; the confirmation flow arrives in Slice 4.3.
  if (String(read.call(element)).trim() !== '') return { ok: false, error: 'FIELD_NONEMPTY' };
  // A programmatic write ignores maxlength, so an over-long answer is refused here.
  if (element.maxLength >= 0 && answer.length > element.maxLength) {
    return { ok: false, error: 'FIELD_UNSUPPORTED' };
  }

  write.call(element, answer);
  element.dispatchEvent(new view.Event('input', { bubbles: true }));
  element.dispatchEvent(new view.Event('change', { bubbles: true }));

  await nextFrameAndMicrotask(env ?? envFor(view), VERIFY_TIMEOUT_MS);
  // Only CRLF -> LF is normalized (a textarea stores line breaks as LF).
  return lf(String(read.call(element))) === lf(answer)
    ? { ok: true }
    : { ok: false, error: 'FIELD_UNSUPPORTED' };
}
