import {
  FieldRevalidateRequestSchema,
  FieldRevalidateResultSchema,
} from '../../schemas/internal-message';
import type {
  FieldFingerprint,
  FieldLocator,
  RevalidationFailure,
} from '../../schemas/field-target';
import type { Sender } from '../messaging/panel-messages';
import { resolveDomPath } from './dom-path';
import { inspectUsability } from './field-state';
import { buildFingerprint, compareFingerprints } from './fingerprint';

export type RevalidationOutcome = { ok: true } | { ok: false; reason: RevalidationFailure };

/**
 * Re-resolves a stored locator and decides whether it is still the field that
 * was captured. Decision order (first match wins):
 * 1. missing: the path no longer reaches an element.
 * 2. changed: it reaches an element that is not a textarea (type changed).
 * 3. hidden: not visible (hidden attribute, display:none, visibility, zero size).
 * 4. disabled: disabled, readonly, or inert.
 * 5. changed: the fingerprint recomputed now differs materially from the stored one.
 * Visibility is checked before the fingerprint so a field hidden by the page
 * reports "hidden", not "changed" (its size bucket would collapse to zero).
 * Reads no field value.
 */
export function revalidateField(
  doc: Document,
  locator: FieldLocator,
  fingerprint: FieldFingerprint,
): RevalidationOutcome {
  const element = resolveDomPath(doc.body, locator.domPath);
  if (element === null) return { ok: false, reason: 'missing' };
  if (!(element instanceof HTMLTextAreaElement)) return { ok: false, reason: 'changed' };
  const usability = inspectUsability(element);
  if (usability !== 'ok') return { ok: false, reason: usability };
  const current = buildFingerprint(element);
  if (current === undefined || !compareFingerprints(fingerprint, current)) {
    return { ok: false, reason: 'changed' };
  }
  return { ok: true };
}

/**
 * Content-script side of `field.revalidate.request`. Replies with the outcome,
 * or undefined to stay silent for a foreign sender or a malformed message.
 */
export function createRevalidateListener(deps: { runtimeId: string; document: Document }) {
  return (message: unknown, sender: Sender): unknown => {
    if (sender.id !== deps.runtimeId) return undefined;
    const request = FieldRevalidateRequestSchema.safeParse(message);
    if (!request.success) return undefined;
    const { locator, fingerprint } = request.data.payload;
    return FieldRevalidateResultSchema.parse({
      v: 1,
      requestId: request.data.requestId,
      type: 'field.revalidate.result',
      payload: revalidateField(deps.document, locator, fingerprint),
    });
  };
}
