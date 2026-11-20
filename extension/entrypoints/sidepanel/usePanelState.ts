import { useEffect, useRef, useState } from 'react';
import type { PanelClient } from '../../lib/messaging/panel-client';
import { EMPTY_PANEL_STATE, type PanelState } from '../../schemas/internal-message';

/**
 * State for the active tab only. Pushes are stored per tab so a push that
 * arrives before the active tab is known is not lost; a pull result is dropped
 * if a push for the same tab arrived while it was in flight.
 */
export function usePanelState(client: PanelClient): {
  tabId: number | undefined;
  state: PanelState;
} {
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [states, setStates] = useState<ReadonlyMap<number, PanelState>>(new Map());
  const pushCount = useRef(new Map<number, number>());

  useEffect(() => {
    let active = true;
    const refreshActiveTab = () => {
      void client.getActiveTabId().then((id) => {
        if (!active || id === undefined) return;
        setTabId(id);
        const before = pushCount.current.get(id) ?? 0;
        void client.fetchState(id).then((state) => {
          if (!active || (pushCount.current.get(id) ?? 0) !== before) return;
          setStates((prev) => new Map(prev).set(id, state));
        });
      });
    };
    const offState = client.onState((id, state) => {
      pushCount.current.set(id, (pushCount.current.get(id) ?? 0) + 1);
      setStates((prev) => new Map(prev).set(id, state));
    });
    const offTab = client.onActiveTabChange(refreshActiveTab);
    refreshActiveTab();
    return () => {
      active = false;
      offState();
      offTab();
    };
  }, [client]);

  return { tabId, state: (tabId !== undefined && states.get(tabId)) || EMPTY_PANEL_STATE };
}
