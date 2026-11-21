import type { AppError } from '../../schemas/error';
import { appErrorFor } from '../../schemas/error';
import type { ProfileMessage } from '../../schemas/profile-message';
import type { NativeClient, NativeResult } from '../native/native-client';

/** Client-side limit for one profile round trip. The helper's own deadline is 5 s. */
export const PROFILE_TIMEOUT_MS = 15_000;

export type ProfileReply =
  | { v: 1; requestId: string; ok: true; result: unknown }
  | { v: 1; requestId: string; ok: false; error: AppError };

export interface ProfileService {
  handle(message: ProfileMessage): Promise<ProfileReply>;
}

type ProfileNative = Pick<
  NativeClient,
  | 'getProfile'
  | 'upsertProfileItem'
  | 'setResume'
  | 'importDocument'
  | 'deleteProfileItem'
  | 'exportProfile'
  | 'deleteAllProfile'
  | 'setProvider'
  | 'acceptDisclosure'
>;

/**
 * Worker-side profile operations. Each message becomes exactly one native
 * request (one port per request, same error mapping as drafting); the helper's
 * validated result is returned unchanged and a helper AppError passes through
 * as its own code. A client-side timeout means the helper never answered, which
 * the settings page reports as a storage problem rather than a provider one.
 */
export function createProfileService(native: ProfileNative): ProfileService {
  function toReply<T>(requestId: string, r: NativeResult<T>, pick: (value: T) => unknown) {
    if (r.ok) return { v: 1, requestId, ok: true, result: pick(r.value) } satisfies ProfileReply;
    const error = r.error.code === 'PROVIDER_TIMEOUT' ? appErrorFor('STORAGE_ERROR') : r.error;
    return { v: 1, requestId, ok: false, error } satisfies ProfileReply;
  }
  return {
    async handle(message) {
      switch (message.type) {
        case 'settings.profile.get':
          return toReply(message.requestId, await native.getProfile().result, (p) => p);
        case 'settings.profile.item.upsert':
          return toReply(
            message.requestId,
            await native.upsertProfileItem(message.payload).result,
            (stored) => ({ item: stored.item }),
          );
        case 'settings.profile.resume.set':
          return toReply(
            message.requestId,
            await native.setResume(message.payload).result,
            (resume) => ({ resume }),
          );
        case 'settings.profile.import.document':
          return toReply(
            message.requestId,
            await native.importDocument(message.payload).result,
            (r) => r,
          );
        case 'settings.profile.item.delete':
          return toReply(
            message.requestId,
            await native.deleteProfileItem(message.payload).result,
            (d) => d,
          );
        case 'settings.profile.export':
          return toReply(message.requestId, await native.exportProfile().result, (e) => e);
        case 'settings.profile.deleteAll':
          return toReply(message.requestId, await native.deleteAllProfile().result, (d) => d);
        case 'settings.provider.set':
          return toReply(
            message.requestId,
            await native.setProvider(message.payload.provider).result,
            (provider) => ({ provider }),
          );
        case 'settings.disclosure.accept':
          return toReply(message.requestId, await native.acceptDisclosure().result, (d) => d);
      }
    },
  };
}
