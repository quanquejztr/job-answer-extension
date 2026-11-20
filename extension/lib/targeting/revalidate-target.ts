import {
  FieldRevalidateResultSchema,
  type FieldRevalidateRequest,
} from '../../schemas/internal-message';
import type { ErrorCode } from '../../schemas/error';
import type { RevalidationFailure } from '../../schemas/field-target';
import { advance, invalidate } from './target';
import type { TargetStore } from './target-store';

export interface RevalidateDeps {
  targets: TargetStore;
  sendTabMessage(
    tabId: number,
    message: FieldRevalidateRequest,
    options: { frameId: number },
  ): Promise<unknown>;
  newRequestId(): string;
}

export type TargetRevalidation =
  | { ok: true }
  | { ok: false; code: ErrorCode; reason: RevalidationFailure | 'no-target' | 'unreachable' };

/**
 * Worker side of revalidation (for step 1.4's Insert). Asks the target's own
 * frame whether the field is still the same, visible, and editable. On success
 * the target moves captured -> validated (a target already validated stays so);
 * any failure, including a frame that does not answer, invalidates it. Every
 * failure is FIELD_STALE: the user must select the question again.
 */
export async function revalidateTarget(
  deps: RevalidateDeps,
  tabId: number,
): Promise<TargetRevalidation> {
  const tracked = deps.targets.get(tabId); // also applies expiry
  const state = tracked?.target.state;
  if (tracked === undefined || (state !== 'captured' && state !== 'validated')) {
    return { ok: false, code: 'FIELD_STALE', reason: 'no-target' };
  }

  const requestId = deps.newRequestId();
  const request: FieldRevalidateRequest = {
    v: 1,
    requestId,
    type: 'field.revalidate.request',
    payload: { locator: tracked.target.locator, fingerprint: tracked.target.fingerprint },
  };
  let reason: RevalidationFailure | 'unreachable' = 'unreachable';
  try {
    const reply = await deps.sendTabMessage(tabId, request, { frameId: tracked.target.frameId });
    const parsed = FieldRevalidateResultSchema.safeParse(reply);
    if (parsed.success && parsed.data.requestId === requestId) {
      const result = parsed.data.payload;
      if (result.ok) {
        // The tab may have navigated or captured again while we waited.
        const current = deps.targets.get(tabId);
        if (current?.target.id !== tracked.target.id) {
          return { ok: false, code: 'FIELD_STALE', reason: 'no-target' };
        }
        const next = current.target.state === 'captured' ? advance(current, 'validated') : current;
        if (next !== undefined) deps.targets.update(tabId, next);
        return { ok: true };
      }
      reason = result.reason;
    }
  } catch {
    // Frame gone or not reachable: treated as a failed revalidation.
  }
  const current = deps.targets.get(tabId);
  if (current?.target.id === tracked.target.id) {
    deps.targets.update(tabId, invalidate(current, 'revalidation-failed'));
  }
  return { ok: false, code: 'FIELD_STALE', reason };
}
