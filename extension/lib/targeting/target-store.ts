import {
  invalidate,
  isExpired,
  type Clock,
  type InvalidationReason,
  type TrackedTarget,
} from './target';

/**
 * The service worker's field targets: at most one per tab, in memory only
 * (never persisted, never sent to the side panel or the helper). A worker
 * restart loses them by design (PRD 19).
 */
export interface TargetStore {
  /** Replaces the tab's previous target, if any. */
  set(tabId: number, tracked: TrackedTarget): void;
  /** The tab's target; an overdue one is invalidated ('expired') before it is returned. */
  get(tabId: number): TrackedTarget | undefined;
  /** Replaces the stored target with its updated copy (state change). Ignored if absent. */
  update(tabId: number, tracked: TrackedTarget): void;
  invalidate(tabId: number, reason: InvalidationReason): void;
  /** Forgets the tab's target entirely (a new capture, or the tab closed). */
  remove(tabId: number): void;
}

export function createTargetStore(clock: Clock): TargetStore {
  const targets = new Map<number, TrackedTarget>();
  return {
    set: (tabId, tracked) => void targets.set(tabId, tracked),
    get(tabId) {
      const tracked = targets.get(tabId);
      if (tracked === undefined) return undefined;
      if (isExpired(tracked, clock)) {
        const expired = invalidate(tracked, 'expired');
        targets.set(tabId, expired);
        return expired;
      }
      return tracked;
    },
    update(tabId, tracked) {
      if (targets.has(tabId)) targets.set(tabId, tracked);
    },
    invalidate(tabId, reason) {
      const tracked = targets.get(tabId);
      if (tracked !== undefined) targets.set(tabId, invalidate(tracked, reason));
    },
    remove: (tabId) => void targets.delete(tabId),
  };
}
