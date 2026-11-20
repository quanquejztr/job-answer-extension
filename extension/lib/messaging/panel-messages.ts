import {
  InternalMessageSchema,
  PanelStateGetSchema,
  PanelStateMessageSchema,
  type PanelState,
  type PanelStateMessage,
} from '../../schemas/internal-message';

/** The subset of `runtime.MessageSender` used for sender checks. */
export interface Sender {
  id?: string | undefined;
  tab?: unknown;
  url?: string | undefined;
}

/**
 * Only the extension's own pages (side panel, settings, worker) may talk on the
 * panel channel. The id must match, and a sender with a `tab` is accepted only
 * if its URL is one of this extension's own pages: a content script always has
 * a `sender.tab` and carries the same extension id, but its URL is the web
 * page's, so it is rejected. (The side panel itself has no tab; an extension
 * page opened in a tab, as the browser tests do, has one.)
 */
export function isTrustedExtensionPage(sender: Sender, runtimeId: string): boolean {
  if (sender.id !== runtimeId) return false;
  if (sender.tab === undefined) return true;
  // A string prefix (with the trailing slash) rather than `new URL(...).origin`,
  // which is "null" for this scheme outside Chrome.
  return sender.url?.startsWith(`chrome-extension://${runtimeId}/`) === true;
}

export function stateMessage(
  requestId: string,
  tabId: number,
  state: PanelState,
): PanelStateMessage {
  return { v: 1, requestId, type: 'panel.state', payload: { tabId, state } };
}

/**
 * Worker-side handler for messages from extension pages. Returns the reply, or
 * undefined to ignore the message (wrong sender, malformed, or unknown type).
 */
export function handleWorkerMessage(
  deps: { runtimeId: string; getState(tabId: number): PanelState },
  message: unknown,
  sender: Sender,
): PanelStateMessage | undefined {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return undefined;
  const parsed = InternalMessageSchema.safeParse(message);
  if (!parsed.success) return undefined;
  const get = PanelStateGetSchema.safeParse(parsed.data);
  if (!get.success) return undefined;
  const { tabId } = get.data.payload;
  return stateMessage(get.data.requestId, tabId, deps.getState(tabId));
}

/** Panel-side parse of a pushed or replied state message; undefined if untrusted. */
export function parseStateMessage(
  message: unknown,
  sender: Sender | undefined,
  runtimeId: string,
): PanelStateMessage | undefined {
  if (sender !== undefined && !isTrustedExtensionPage(sender, runtimeId)) return undefined;
  const parsed = PanelStateMessageSchema.safeParse(message);
  return parsed.success ? parsed.data : undefined;
}
