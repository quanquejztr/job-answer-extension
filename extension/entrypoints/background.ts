import { DRAFT_MENU_ID, registerDraftMenu } from '../lib/capture/menu';
import { handleMenuClick, type CaptureDeps } from '../lib/capture/handle-click';
import { createTabLifecycle } from '../lib/capture/tab-lifecycle';
import { createPanelStateStore } from '../lib/capture/panel-state-store';
import { createDraftController } from '../lib/draft/draft-controller';
import { handleDraftMessage } from '../lib/draft/draft-messages';
import { createInsertFlow, handleInsertMessage } from '../lib/insertion/insert-flow';
import { SESSION_PORT_NAME } from '../lib/messaging/panel-client';
import {
  handleWorkerMessage,
  isTrustedExtensionPage,
  stateMessage,
} from '../lib/messaging/panel-messages';
import { createNativeClient, type NativePort } from '../lib/native/native-client';
import { newRequestId } from '../lib/native/request-id';
import type { Clock } from '../lib/targeting/target';
import { createTargetStore } from '../lib/targeting/target-store';

// Built path of the runtime-registered content script (see content.ts).
// Typed against WXT's generated list of built script paths, so a rename fails to compile.
const CONTENT_SCRIPT_FILE: ScriptPublicPath = '/content-scripts/content.js';

// Thin wiring only: behavior lives in extension/lib/capture and lib/messaging.
export default defineBackground(() => {
  const store = createPanelStateStore((tabId, state) => {
    // Push to any open side panel; no panel open is not an error.
    browser.runtime.sendMessage(stateMessage(newRequestId(), tabId, state)).catch(() => undefined);
  });

  // Expiry uses the monotonic clock (PRD 19); wall time only labels expiresAt.
  const clock: Clock = { monotonicMs: () => performance.now(), wallMs: () => Date.now() };
  const targets = createTargetStore(clock);
  // Only the worker talks to the native helper, one port per request.
  const native = createNativeClient((hostName) =>
    adaptPort(browser.runtime.connectNative(hostName)),
  );
  const drafts = createDraftController({ native, panel: store, targets, now: () => new Date() });

  const inserts = createInsertFlow({
    panel: store,
    targets,
    sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options),
    newRequestId,
  });

  const deps: CaptureDeps = {
    openSidePanel: (options) => browser.sidePanel.open(options),
    executeScript: (options) =>
      browser.scripting.executeScript({ target: options.target, files: [CONTENT_SCRIPT_FILE] }),
    sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options),
    setState: (tabId, state) => store.set(tabId, state),
    newRequestId,
    targets,
    clock,
    contentScriptFile: CONTENT_SCRIPT_FILE,
  };

  browser.runtime.onInstalled.addListener(() => {
    registerDraftMenu({
      create: (item, callback) => browser.contextMenus.create(item, callback),
      clearLastError: () => void browser.runtime.lastError,
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== DRAFT_MENU_ID) return;
    // Must stay synchronous up to handleMenuClick (user-gesture rule).
    void handleMenuClick(deps, info, tab);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Panel -> worker draft commands: accepted only from the extension's own pages.
    if (
      handleDraftMessage({ runtimeId: browser.runtime.id, controller: drafts }, message, sender)
    ) {
      return false;
    }
    // Panel -> worker insert command: the explicit Insert action, same sender rule.
    if (handleInsertMessage({ runtimeId: browser.runtime.id, flow: inserts }, message, sender)) {
      return false;
    }
    const reply = handleWorkerMessage(
      { runtimeId: browser.runtime.id, getState: (tabId) => store.get(tabId) },
      message,
      sender,
    );
    if (reply === undefined) return false;
    sendResponse(reply);
    return false;
  });

  // The side panel holds a port open while it is showing; when it closes, its
  // drafts are cancelled (PRD 19) and nothing is inserted.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== SESSION_PORT_NAME) return;
    if (
      !isTrustedExtensionPage(
        { id: port.sender?.id, tab: port.sender?.tab, url: port.sender?.url },
        browser.runtime.id,
      )
    ) {
      port.disconnect();
      return;
    }
    port.onDisconnect.addListener(() => drafts.cancelAll());
  });
  // A reload or navigation invalidates what was captured for that tab.
  const lifecycle = createTabLifecycle({ panel: store, targets, draft: drafts });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') lifecycle.onNavigated(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => lifecycle.onClosed(tabId));
});

/** Wraps a Chrome port in the narrow interface the native client uses. */
function adaptPort(port: ReturnType<typeof browser.runtime.connectNative>): NativePort {
  const messageListeners = new Map<(m: unknown) => void, (m: unknown) => void>();
  const disconnectListeners = new Map<() => void, () => void>();
  return {
    postMessage: (message) => port.postMessage(message),
    disconnect: () => port.disconnect(),
    onMessage: {
      addListener(listener) {
        const wrapped = (m: unknown) => listener(m);
        messageListeners.set(listener, wrapped);
        port.onMessage.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = messageListeners.get(listener);
        if (wrapped !== undefined) port.onMessage.removeListener(wrapped);
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        const wrapped = () => {
          // Reading lastError marks it handled (a missing host reports through it).
          void browser.runtime.lastError;
          listener();
        };
        disconnectListeners.set(listener, wrapped);
        port.onDisconnect.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = disconnectListeners.get(listener);
        if (wrapped !== undefined) port.onDisconnect.removeListener(wrapped);
        disconnectListeners.delete(listener);
      },
    },
  };
}
