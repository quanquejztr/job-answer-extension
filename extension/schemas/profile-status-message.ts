import { z } from 'zod';
import { MAX_STORIES } from '../lib/constants/limits';
import { AppErrorSchema } from './error';
import { PROVIDERS } from './profile';
import { INTERNAL_PROTOCOL_VERSION } from './internal-message';
import { RequestIdSchema } from './request-id';

// Panel -> worker: "may the panel draft?" The reply is only
// `{ hasResume, storyCount, provider?, disclosureAccepted }`: whether a résumé is
// saved, how many stories exist, which provider was chosen (absent until the
// owner chooses), and whether the first-use disclosure was accepted. The panel
// learns nothing else about the profile.
// It lives in its own file, outside the shared internal union, so the content
// script's schemas stay free of anything profile-related (AC-050).

export const ProfileStatusGetSchema = z.strictObject({
  v: z.literal(INTERNAL_PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  type: z.literal('panel.profileStatus.get'),
  payload: z.strictObject({}),
});
export type ProfileStatusGet = z.infer<typeof ProfileStatusGetSchema>;

export const ProfileStatusSchema = z.strictObject({
  hasResume: z.boolean(),
  storyCount: z.number().int().min(0).max(MAX_STORIES),
  provider: z.enum(PROVIDERS).optional(),
  disclosureAccepted: z.boolean(),
});
export type ProfileStatus = z.infer<typeof ProfileStatusSchema>;

export const ProfileStatusReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    ok: z.literal(true),
    result: ProfileStatusSchema,
  }),
  z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    ok: z.literal(false),
    error: AppErrorSchema,
  }),
]);
export type ProfileStatusReply = z.infer<typeof ProfileStatusReplySchema>;
