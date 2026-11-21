import { browser } from 'wxt/browser';
import {
  DraftCancelSchema,
  DraftStartSchema,
  EMPTY_PANEL_STATE,
  InsertStartSchema,
  PanelStateGetSchema,
  type PanelState,
} from '../../schemas/internal-message';
import {
  ProfileStatusGetSchema,
  ProfileStatusReplySchema,
  type ProfileStatus,
} from '../../schemas/profile-status-message';
import { newRequestId } from '../native/request-id';
import { parseStateMessage, type Sender } from './panel-messages';

/** Name of the long-lived port the side panel holds open while it is showing. */
export const SESSION_PORT_NAME = 'panel-session';

/** What the side panel needs from the browser; components only see this interface. */
export interface PanelClient {
  getActiveTabId(): Promise<number | undefined>;
  /** Pulls the worker's latest state for a tab; Empty if the worker has none or replies badly. */
  fetchState(tabId: number): Promise<PanelState>;
  /** Pushes from the worker. Returns an unsubscribe function. */
  onState(listener: (tabId: number, state: PanelState) => void): () => void;
  /** Asks the worker to draft from the (possibly edited) question. Results arrive as state pushes. */
  startDraft(tabId: number, captureId: string, question: string): Promise<void>;
  /** Asks the worker to cancel the tab's draft. */
  cancelDraft(tabId: number): Promise<void>;
  /** The explicit Insert action with the reviewed (possibly edited) answer. Outcome arrives as state pushes. */
  startInsert(tabId: number, captureId: string, answer: string): Promise<void>;
  /**
   * Whether a résumé is saved and how many stories exist, or undefined when
   * unknown (the helper or worker did not answer). Never the profile itself.
   */
  getProfileStatus(): Promise<ProfileStatus | undefined>;
  /** Opens the settings page (the browser's own options page). */
  openSettings(): Promise<void>;
  /** Fires when the active tab (or the focused window's active tab) changes. */
  onActiveTabChange(listener: () => void): () => void;
}

export interface PanelApi {
  runtimeId: string;
  queryActiveTabId(): Promise<number | undefined>;
  sendMessage(message: unknown): Promise<unknown>;
  addMessageListener(listener: (message: unknown, sender: Sender) => void): () => void;
  addActiveTabListener(listener: () => void): () => void;
  /** Holds a port open for the panel's lifetime; the worker cancels drafts when it closes. */
  openSessionPort?(): void;
  /** Opens the extension's options page. */
  openOptionsPage(): Promise<void>;
}

export function createPanelClient(api: PanelApi): PanelClient {
  api.openSessionPort?.();
  // The worker's reply (if any) carries nothing; a missing worker is not an error here.
  const send = async (message: unknown): Promise<void> => {
    try {
      await api.sendMessage(message);
    } catch {
      // Worker unreachable or restarting: the next state pull shows what happened.
    }
  };
  return {
    startDraft(tabId, captureId, question) {
      const message = DraftStartSchema.safeParse({
        v: 1,
        requestId: newRequestId(),
        type: 'draft.start',
        payload: { tabId, captureId, question },
      });
      // An out-of-range question never leaves the panel (the button is disabled for it).
      return message.success ? send(message.data) : Promise.resolve();
    },
    startInsert(tabId, captureId, answer) {
      const message = InsertStartSchema.safeParse({
        v: 1,
        requestId: newRequestId(),
        type: 'insert.start',
        payload: { tabId, captureId, answer },
      });
      // An empty or oversized answer never leaves the panel (the button is disabled for it).
      return message.success ? send(message.data) : Promise.resolve();
    },
    cancelDraft(tabId) {
      const message = DraftCancelSchema.safeParse({
        v: 1,
        requestId: newRequestId(),
        type: 'draft.cancel',
        payload: { tabId },
      });
      return message.success ? send(message.data) : Promise.resolve();
    },
    async getProfileStatus() {
      const request = ProfileStatusGetSchema.parse({
        v: 1,
        requestId: newRequestId(),
        type: 'panel.profileStatus.get',
        payload: {},
      });
      try {
        const reply = ProfileStatusReplySchema.safeParse(await api.sendMessage(request));
        if (!reply.success || reply.data.requestId !== request.requestId || !reply.data.ok)
          return undefined;
        return reply.data.result;
      } catch {
        return undefined;
      }
    },
    async openSettings() {
      try {
        await api.openOptionsPage();
      } catch {
        // The browser refused to open the page; the hint text still names settings.
      }
    },
    getActiveTabId: () => api.queryActiveTabId(),
    async fetchState(tabId) {
      const request = PanelStateGetSchema.parse({
        v: 1,
        requestId: newRequestId(),
        type: 'panel.state.get',
        payload: { tabId },
      });
      try {
        const reply = parseStateMessage(await api.sendMessage(request), undefined, api.runtimeId);
        // A reply for another tab or request is never shown.
        if (
          reply === undefined ||
          reply.requestId !== request.requestId ||
          reply.payload.tabId !== tabId
        )
          return EMPTY_PANEL_STATE;
        return reply.payload.state;
      } catch {
        // Worker unreachable or restarting: fall back to Empty.
        return EMPTY_PANEL_STATE;
      }
    },
    onState(listener) {
      return api.addMessageListener((message, sender) => {
        const parsed = parseStateMessage(message, sender, api.runtimeId);
        if (parsed !== undefined) listener(parsed.payload.tabId, parsed.payload.state);
      });
    },
    onActiveTabChange: (listener) => api.addActiveTabListener(listener),
  };
}

/** The real client, for the side panel entrypoint. */
export function createBrowserPanelClient(): PanelClient {
  return createPanelClient({
    runtimeId: browser.runtime.id,
    async queryActiveTabId() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    },
    sendMessage: (message) => browser.runtime.sendMessage(message),
    addMessageListener(listener) {
      const wrapped = (message: unknown, sender: Sender) => {
        listener(message, sender);
        return false;
      };
      browser.runtime.onMessage.addListener(wrapped);
      return () => browser.runtime.onMessage.removeListener(wrapped);
    },
    openSessionPort() {
      browser.runtime.connect({ name: SESSION_PORT_NAME });
    },
    openOptionsPage: () => browser.runtime.openOptionsPage(),
    addActiveTabListener(listener) {
      browser.tabs.onActivated.addListener(listener);
      browser.windows.onFocusChanged.addListener(listener);
      return () => {
        browser.tabs.onActivated.removeListener(listener);
        browser.windows.onFocusChanged.removeListener(listener);
      };
    },
  });
}
