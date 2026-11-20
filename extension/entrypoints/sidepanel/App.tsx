import { useMemo } from 'react';
import { PanelStateView, type PanelActions } from '../../components/PanelStateView';
import type { PanelClient } from '../../lib/messaging/panel-client';
import { usePanelState } from './usePanelState';

export function App({ client }: { client: PanelClient }) {
  const { tabId, state } = usePanelState(client);
  const actions = useMemo<PanelActions>(
    () => ({
      generate: (captureId, question) => {
        if (tabId !== undefined) void client.startDraft(tabId, captureId, question);
      },
      insert: (captureId, answer) => {
        if (tabId !== undefined) void client.startInsert(tabId, captureId, answer);
      },
      cancel: () => {
        if (tabId !== undefined) void client.cancelDraft(tabId);
      },
    }),
    [client, tabId],
  );
  return (
    <main className="bg-background text-text min-h-screen p-4">
      <h1 className="text-lg font-semibold">Job Answer Drafter</h1>
      <PanelStateView key={tabId} state={state} actions={actions} />
    </main>
  );
}
