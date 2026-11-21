import { z } from 'zod';
import { DiagnosticsPayloadSchema } from './diagnostics';
import { DraftRequestSchema } from './draft';
import {
  AcceptDisclosurePayloadSchema,
  SetProviderPayloadSchema,
  ItemDeletePayloadSchema,
  ItemUpsertPayloadSchema,
  ProfileGetPayloadSchema,
  ProfileExportPayloadSchema,
  ResumeSetPayloadSchema,
  DeleteAllPayloadSchema,
  ImportDocumentPayloadSchema,
} from './profile';
import { RequestIdSchema } from './request-id';
import type { ErrorCode } from './error';

export const PROTOCOL_VERSION = 1;

export const HelloPayloadSchema = z.strictObject({
  extensionVersion: z
    .string()
    .refine((s) => Array.from(s).length >= 1 && Array.from(s).length <= 32),
});
export type HelloPayload = z.infer<typeof HelloPayloadSchema>;

export const HelloResultSchema = z.strictObject({
  helperVersion: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});
export type HelloResult = z.infer<typeof HelloResultSchema>;

export const CancelResultSchema = z.strictObject({ cancelled: z.boolean() });
export type CancelResult = z.infer<typeof CancelResultSchema>;

export const CancelPayloadSchema = z.strictObject({ targetRequestId: RequestIdSchema });
export type CancelPayload = z.infer<typeof CancelPayloadSchema>;

function request<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    type: z.literal(type),
    payload,
  });
}

// Message-type registry. Mirrors helper/internal/protocol/messages.go: only
// types implemented now; every other PRD 17.2 name is rejected as unknown.
export const MESSAGE_TYPES = [
  'helper.hello',
  'draft.generate',
  'draft.cancel',
  'profile.get',
  'profile.item.upsert',
  'profile.item.delete',
  'profile.resume.set',
  'profile.export',
  'profile.deleteAll',
  'profile.import.document',
  'diagnostics.run',
  'settings.setProvider',
  'settings.acceptDisclosure',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const RequestEnvelopeSchema = z.discriminatedUnion('type', [
  request('helper.hello', HelloPayloadSchema),
  request('draft.generate', DraftRequestSchema),
  request('draft.cancel', CancelPayloadSchema),
  request('profile.get', ProfileGetPayloadSchema),
  request('profile.item.upsert', ItemUpsertPayloadSchema),
  request('profile.item.delete', ItemDeletePayloadSchema),
  request('profile.resume.set', ResumeSetPayloadSchema),
  request('profile.export', ProfileExportPayloadSchema),
  request('profile.deleteAll', DeleteAllPayloadSchema),
  request('profile.import.document', ImportDocumentPayloadSchema),
  request('diagnostics.run', DiagnosticsPayloadSchema),
  request('settings.setProvider', SetProviderPayloadSchema),
  request('settings.acceptDisclosure', AcceptDisclosurePayloadSchema),
]);
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

export type ParseRequestResult =
  { ok: true; request: RequestEnvelope } | { ok: false; code: ErrorCode };

// Validates an already JSON-parsed request and reports the AppError code a
// rejection maps to (same mapping as Go ToAppError). Duplicate keys cannot be
// seen after JSON.parse; the Go helper rejects them on the raw bytes.
export function parseRequest(raw: unknown): ParseRequestResult {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const version: unknown = Reflect.get(raw, 'protocolVersion');
    if (typeof version === 'number' && version !== PROTOCOL_VERSION) {
      return { ok: false, code: 'PROTOCOL_VERSION_UNSUPPORTED' };
    }
  }
  const parsed = RequestEnvelopeSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, code: 'INVALID_REQUEST' };
}
