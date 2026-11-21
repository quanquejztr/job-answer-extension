import { z } from 'zod';
import { AppErrorSchema } from './error';
import { DiagnosticsResultSchema } from './diagnostics';
import { INTERNAL_PROTOCOL_VERSION } from './internal-message';
import { RequestIdSchema } from './request-id';

// Settings -> worker: "run the provider diagnostics". Prefixed `settings.` like
// the profile messages and kept out of internal-message.ts so the content
// script's schemas stay free of provider and profile concerns.

export const DiagnosticsRunMessageSchema = z.strictObject({
  v: z.literal(INTERNAL_PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  type: z.literal('settings.diagnostics.run'),
  payload: z.strictObject({}),
});
export type DiagnosticsRunMessage = z.infer<typeof DiagnosticsRunMessageSchema>;

export const DiagnosticsReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    ok: z.literal(true),
    result: DiagnosticsResultSchema,
  }),
  z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    ok: z.literal(false),
    error: AppErrorSchema,
  }),
]);
export type DiagnosticsReply = z.infer<typeof DiagnosticsReplySchema>;
