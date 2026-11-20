import type { DraftController } from '../draft/draft-controller';
import type { TargetStore } from '../targeting/target-store';
import type { PanelStateStore } from './panel-state-store';

/**
 * What a tab's navigation, reload, or close does to the worker's per-tab
 * memory. Kept out of the entrypoint so it can be tested with fakes.
 */
export function createTabLifecycle(deps: {
  panel: PanelStateStore;
  targets: TargetStore;
  draft: Pick<DraftController, 'abandon'>;
}) {
  return {
    /** `tabs.onUpdated` with status "loading": a navigation or reload. */
    onNavigated(tabId: number): void {
      // Stop any helper request first so a late result cannot repaint the tab.
      deps.draft.abandon(tabId);
      deps.targets.invalidate(tabId, 'navigation');
      deps.panel.reset(tabId);
    },
    /** `tabs.onRemoved`. */
    onClosed(tabId: number): void {
      deps.draft.abandon(tabId);
      deps.targets.remove(tabId);
      deps.panel.remove(tabId);
    },
  };
}
