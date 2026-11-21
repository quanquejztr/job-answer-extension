import { appErrorFor } from '../../schemas/error';
import {
  ProfileStatusGetSchema,
  type ProfileStatusReply,
} from '../../schemas/profile-status-message';
import { RequestIdSchema } from '../../schemas/request-id';
import { isTrustedExtensionPage, type Sender } from '../messaging/panel-messages';
import type { NativeClient } from '../native/native-client';

export interface ProfileStatusService {
  status(requestId: string): Promise<ProfileStatusReply>;
}

/**
 * Reports `{ hasResume, storyCount, provider?, disclosureAccepted }` through the existing
 * profile.get path. Only those values leave this function: the profile itself is dropped
 * here, so nothing downstream (the panel) can receive it. A helper error passes through as its
 * own AppError; a client timeout means the helper never answered.
 */
export function createProfileStatusService(
  native: Pick<NativeClient, 'getProfile'>,
): ProfileStatusService {
  return {
    async status(requestId) {
      const r = await native.getProfile().result;
      if (!r.ok) {
        const error = r.error.code === 'PROVIDER_TIMEOUT' ? appErrorFor('STORAGE_ERROR') : r.error;
        return { v: 1, requestId, ok: false, error };
      }
      const { provider, disclosureAcceptedAt } = r.value.settings;
      const result = {
        hasResume: r.value.resume !== null,
        storyCount: r.value.stories.length,
        ...(provider === undefined ? {} : { provider }),
        disclosureAccepted: disclosureAcceptedAt !== undefined,
      };
      return { v: 1, requestId, ok: true, result };
    },
  };
}

/**
 * Worker-side handler for `panel.profileStatus.get`. Returns true when it took the
 * message and will answer through `sendResponse`. Only the extension's own
 * pages are trusted (a content script has `sender.tab` and the web page's URL;
 * a foreign extension has another id); everything else is left unanswered.
 */
export function handleProfileStatusMessage(
  deps: { runtimeId: string; service: ProfileStatusService },
  message: unknown,
  sender: Sender,
  sendResponse: (reply: unknown) => void,
): boolean {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return false;
  if (typeof message !== 'object' || message === null) return false;
  if (Reflect.get(message, 'type') !== 'panel.profileStatus.get') return false;
  const parsed = ProfileStatusGetSchema.safeParse(message);
  if (!parsed.success) {
    const id = RequestIdSchema.safeParse(Reflect.get(message, 'requestId'));
    if (!id.success) return false;
    sendResponse({ v: 1, requestId: id.data, ok: false, error: appErrorFor('INVALID_REQUEST') });
    return true;
  }
  const { requestId } = parsed.data;
  deps.service.status(requestId).then(sendResponse, () => {
    sendResponse({ v: 1, requestId, ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });
  return true;
}
