import { useEffect, useMemo, useState } from 'react';
import { PanelStateView, type PanelActions } from '../../components/PanelStateView';
import type { ProfileStatus } from '../../schemas/profile-status-message';
import type { PanelClient } from '../../lib/messaging/panel-client';
import { usePanelState } from './usePanelState';

export function App({ client }: { client: PanelClient }) {
  const { tabId, state } = usePanelState(client);
  // Kept for every state of a capture, so the generating text can name the provider.
  const profileStatus = useProfileStatus(
    client,
    state.kind === 'captured' ||
      state.kind === 'generating' ||
      state.kind === 'generated' ||
      state.kind === 'inserting'
      ? state.captureId
      : undefined,
  );
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
      openSettings: () => void client.openSettings(),
    }),
    [client, tabId],
  );
  return (
    <main className="bg-background text-text min-h-screen p-4">
      <h1 className="text-lg font-semibold">Job Answer Drafter</h1>
      <PanelStateView key={tabId} state={state} actions={actions} profileStatus={profileStatus} />
    </main>
  );
}

/**
 * The profile status (provider chosen, disclosure accepted, résumé saved, story
 * count), asked of the worker when a question is captured and again when the
 * panel regains focus (the user may have changed settings). Undefined while unknown or when the
 * helper cannot answer; the panel then leaves Generate enabled and the helper's
 * own error handles it.
 */
function useProfileStatus(
  client: PanelClient,
  captureId: string | undefined,
): ProfileStatus | undefined {
  const [status, setStatus] = useState<ProfileStatus | undefined>(undefined);
  useEffect(() => {
    if (captureId === undefined) return;
    let active = true;
    const refresh = () => {
      void client.getProfileStatus().then((next) => {
        if (active) setStatus(next);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [client, captureId]);
  return captureId === undefined ? undefined : status;
}
