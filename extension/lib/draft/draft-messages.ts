import {
  DraftCancelSchema,
  DraftStartSchema,
  InternalMessageSchema,
} from '../../schemas/internal-message';
import { isTrustedExtensionPage, type Sender } from '../messaging/panel-messages';
import type { DraftController } from './draft-controller';

/**
 * Worker-side handler for `draft.start` and `draft.cancel` from the side panel.
 * Returns true when the message was one of these and was accepted. Only the
 * extension's own pages may send them (a content script has `sender.tab` set and
 * is ignored); anything malformed or unknown is ignored.
 */
export function handleDraftMessage(
  deps: { runtimeId: string; controller: DraftController },
  message: unknown,
  sender: Sender,
): boolean {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return false;
  const parsed = InternalMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  const start = DraftStartSchema.safeParse(parsed.data);
  if (start.success) {
    deps.controller.start(start.data.payload);
    return true;
  }
  const cancel = DraftCancelSchema.safeParse(parsed.data);
  if (cancel.success) {
    deps.controller.cancel(cancel.data.payload.tabId);
    return true;
  }
  return false;
}
