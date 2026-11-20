import { TARGET_LIFETIME_SECONDS } from '../constants/limits';
import type { FieldCandidate, FieldState, FieldTarget } from '../../schemas/field-target';

/**
 * Clock injected into the lifecycle so tests control time. `monotonicMs` decides
 * expiry (PRD 19: expiry uses a monotonic clock, so wall-clock changes cannot
 * extend or cut a target's life); `wallMs` only fills the informational
 * `expiresAt` timestamp.
 */
export interface Clock {
  monotonicMs(): number;
  wallMs(): number;
}

export type InvalidationReason =
  'navigation' | 'tab-closed' | 'expired' | 'revalidation-failed' | 'replaced' | 'insert-failed';

/** A target plus the private bookkeeping the worker needs. Never leaves the worker. */
export interface TrackedTarget {
  target: FieldTarget;
  /** Monotonic deadline in ms; the target is expired at or after it. */
  deadlineMs: number;
  invalidatedBy?: InvalidationReason;
}

export interface NewTargetInput {
  id: string;
  tabId: number;
  frameId: number;
  pageOrigin: string;
  candidate: FieldCandidate;
}

const LIFETIME_MS = TARGET_LIFETIME_SECONDS * 1000;

/** Builds a `captured` target that expires 10 minutes from now. */
export function createTarget(input: NewTargetInput, clock: Clock): TrackedTarget {
  return {
    deadlineMs: clock.monotonicMs() + LIFETIME_MS,
    target: {
      id: input.id,
      tabId: input.tabId,
      frameId: input.frameId,
      pageOrigin: input.pageOrigin,
      labelText: input.candidate.labelText,
      locator: { frameId: input.frameId, domPath: input.candidate.fingerprint.domPath },
      fingerprint: input.candidate.fingerprint,
      state: 'captured',
      expiresAt: new Date(clock.wallMs() + LIFETIME_MS).toISOString(),
    },
  };
}

/** True at exactly 10 minutes and after; one millisecond earlier it is still valid. */
export function isExpired(tracked: TrackedTarget, clock: Clock): boolean {
  return clock.monotonicMs() >= tracked.deadlineMs;
}

const NEXT_STATE: Readonly<Record<FieldState, FieldState | undefined>> = {
  captured: 'validated',
  validated: 'approved',
  approved: 'inserted',
  inserted: undefined,
  invalidated: undefined,
};

/**
 * Moves one step forward (captured -> validated -> approved -> inserted).
 * Returns undefined for any other move, including skipping a step and any move
 * out of `inserted` or `invalidated`. Use `invalidate` to invalidate.
 */
export function advance(tracked: TrackedTarget, to: FieldState): TrackedTarget | undefined {
  if (NEXT_STATE[tracked.target.state] !== to) return undefined;
  return { ...tracked, target: { ...tracked.target, state: to } };
}

/**
 * Invalidates a live target (captured, validated, or approved), recording why.
 * `inserted` is final and `invalidated` keeps its first reason, so both come
 * back unchanged.
 */
export function invalidate(tracked: TrackedTarget, reason: InvalidationReason): TrackedTarget {
  if (tracked.target.state === 'inserted' || tracked.target.state === 'invalidated') return tracked;
  return {
    ...tracked,
    target: { ...tracked.target, state: 'invalidated' },
    invalidatedBy: reason,
  };
}
