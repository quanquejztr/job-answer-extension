import { EMPTY_PANEL_STATE, type PanelState } from '../../schemas/internal-message';

/**
 * Latest side-panel state per tab, kept only in service-worker memory. Nothing
 * is written to disk (no `storage` permission). A worker restart loses this
 * state; the side panel then falls back to Empty, which is the intended
 * behavior (PRD 19: all targets and drafts are lost by design).
 */
export interface PanelStateStore {
  get(tabId: number): PanelState;
  set(tabId: number, state: PanelState): void;
  /** Forgets a tab; pushes Empty if it had other state (navigation or reload). */
  reset(tabId: number): void;
  /** Forgets a closed tab without a push. */
  remove(tabId: number): void;
}

export function createPanelStateStore(
  onChange: (tabId: number, state: PanelState) => void,
): PanelStateStore {
  const states = new Map<number, PanelState>();
  return {
    get: (tabId) => states.get(tabId) ?? EMPTY_PANEL_STATE,
    set(tabId, state) {
      states.set(tabId, state);
      onChange(tabId, state);
    },
    reset(tabId) {
      if (states.delete(tabId)) onChange(tabId, EMPTY_PANEL_STATE);
    },
    remove(tabId) {
      states.delete(tabId);
    },
  };
}
