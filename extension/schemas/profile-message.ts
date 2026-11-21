import { z } from 'zod';
import { AppErrorSchema } from './error';
import { INTERNAL_PROTOCOL_VERSION } from './internal-message';
import {
  AcceptDisclosurePayloadSchema,
  DeleteAllPayloadSchema,
  DeleteResultSchema,
  DisclosureResultSchema,
  ExportResultSchema,
  ImportDocumentPayloadSchema,
  ImportResultSchema,
  ItemDeletePayloadSchema,
  ItemUpsertPayloadSchema,
  ProfileExportPayloadSchema,
  ProfileGetPayloadSchema,
  ProfileSchema,
  ProviderResultSchema,
  ResumeResultSchema,
  ResumeSetPayloadSchema,
  SetProviderPayloadSchema,
  UPSERT_RESULT_SCHEMAS,
} from './profile';
import { RequestIdSchema } from './request-id';

// Settings -> worker messages for the profile (PRD 17.1 additions, Step 2.2).
// They are prefixed `settings.` so they never clash with the native types of
// the same names, and they live in their own file on purpose: the content
// script's schemas (internal-message.ts) must never import profile modules
// (AC-050). Only extension pages may send them; the worker ignores any sender
// with a tab that is not an extension page.

function envelope<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    type: z.literal(type),
    payload,
  });
}

export const ProfileGetMessageSchema = envelope('settings.profile.get', ProfileGetPayloadSchema);
export const ProfileUpsertMessageSchema = envelope(
  'settings.profile.item.upsert',
  ItemUpsertPayloadSchema,
);
export const ProfileDeleteMessageSchema = envelope(
  'settings.profile.item.delete',
  ItemDeletePayloadSchema,
);

export const ProfileResumeSetMessageSchema = envelope(
  'settings.profile.resume.set',
  ResumeSetPayloadSchema,
);

export const ProfileImportDocumentMessageSchema = envelope(
  'settings.profile.import.document',
  ImportDocumentPayloadSchema,
);

export const ProfileExportMessageSchema = envelope(
  'settings.profile.export',
  ProfileExportPayloadSchema,
);
export const ProfileDeleteAllMessageSchema = envelope(
  'settings.profile.deleteAll',
  DeleteAllPayloadSchema,
);

// Provider choice and first-use disclosure (Slice 3.5). Settings page only.
export const SetProviderMessageSchema = envelope('settings.provider.set', SetProviderPayloadSchema);
export const AcceptDisclosureMessageSchema = envelope(
  'settings.disclosure.accept',
  AcceptDisclosurePayloadSchema,
);

export const ProfileMessageSchema = z.discriminatedUnion('type', [
  ProfileGetMessageSchema,
  ProfileUpsertMessageSchema,
  ProfileDeleteMessageSchema,
  ProfileResumeSetMessageSchema,
  ProfileExportMessageSchema,
  ProfileDeleteAllMessageSchema,
  ProfileImportDocumentMessageSchema,
  SetProviderMessageSchema,
  AcceptDisclosureMessageSchema,
]);
export type ProfileMessage = z.infer<typeof ProfileMessageSchema>;

/**
 * The worker's reply: the request's id, then either the validated helper result
 * or the AppError (a helper AppError passes through as its own code).
 */
function reply<R extends z.ZodType>(result: R) {
  return z.discriminatedUnion('ok', [
    z.strictObject({
      v: z.literal(INTERNAL_PROTOCOL_VERSION),
      requestId: RequestIdSchema,
      ok: z.literal(true),
      result,
    }),
    z.strictObject({
      v: z.literal(INTERNAL_PROTOCOL_VERSION),
      requestId: RequestIdSchema,
      ok: z.literal(false),
      error: AppErrorSchema,
    }),
  ]);
}

export const ProfileGetReplySchema = reply(ProfileSchema);
export const ProfileDeleteReplySchema = reply(DeleteResultSchema);
export const ProfileExportReplySchema = reply(ExportResultSchema);
export const ProfileImportDocumentReplySchema = reply(ImportResultSchema);
export const ProfileResumeSetReplySchema = reply(ResumeResultSchema);
export const ProfileUpsertReplySchemas = {
  story: reply(UPSERT_RESULT_SCHEMAS.story),
  sample: reply(UPSERT_RESULT_SCHEMAS.sample),
  rule: reply(UPSERT_RESULT_SCHEMAS.rule),
} as const;
export const SetProviderReplySchema = reply(ProviderResultSchema);
export const AcceptDisclosureReplySchema = reply(DisclosureResultSchema);
