import { appErrorFor } from '../../schemas/error';
import { ProfileMessageSchema } from '../../schemas/profile-message';
import { RequestIdSchema } from '../../schemas/request-id';
import { isTrustedExtensionPage, type Sender } from '../messaging/panel-messages';
import type { ProfileService } from './profile-service';

const TYPES: ReadonlySet<unknown> = new Set([
  'settings.profile.get',
  'settings.profile.item.upsert',
  'settings.profile.item.delete',
  'settings.profile.resume.set',
  'settings.profile.export',
  'settings.profile.deleteAll',
  'settings.profile.import.document',
  'settings.provider.set',
  'settings.disclosure.accept',
]);

/**
 * Worker-side handler for the settings page's profile messages. Returns true
 * when it took the message and will answer through `sendResponse` (the caller
 * must then return true from the listener to keep the channel open). Only the
 * extension's own pages are trusted: a content script has `sender.tab` and the
 * web page's URL, a foreign extension has another id, and a missing id fails.
 * Anything else, including a message that is not one of the nine types, is
 * left unanswered so other handlers can look at it.
 */
export function handleProfileMessage(
  deps: { runtimeId: string; service: ProfileService },
  message: unknown,
  sender: Sender,
  sendResponse: (reply: unknown) => void,
): boolean {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return false;
  if (typeof message !== 'object' || message === null) return false;
  const type: unknown = Reflect.get(message, 'type');
  if (!TYPES.has(type)) return false;
  const parsed = ProfileMessageSchema.safeParse(message);
  if (!parsed.success) {
    // A malformed request from our own page still gets a typed answer, as long
    // as there is a requestId to bind it to. Nothing from the payload is echoed.
    const id = RequestIdSchema.safeParse(Reflect.get(message, 'requestId'));
    if (!id.success) return false;
    sendResponse({ v: 1, requestId: id.data, ok: false, error: appErrorFor('INVALID_REQUEST') });
    return true;
  }
  deps.service.handle(parsed.data).then(sendResponse, () => {
    sendResponse({
      v: 1,
      requestId: parsed.data.requestId,
      ok: false,
      error: appErrorFor('INTERNAL_ERROR'),
    });
  });
  return true;
}
