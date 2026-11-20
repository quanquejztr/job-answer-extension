import { z } from 'zod';
import { AppErrorSchema } from './error';
import { PROTOCOL_VERSION } from './messages';
import { RequestIdSchema, ResponseRequestIdSchema } from './request-id';

// Success has a non-null result and no error; failure has an error and no
// result key at all. A success needs a real requestId; a failure may use "".
export const ResponseEnvelopeSchema = z
  .strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: ResponseRequestIdSchema,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: AppErrorSchema.optional(),
  })
  .superRefine((r, ctx) => {
    const bad = r.ok
      ? r.result === undefined ||
        r.result === null ||
        r.error !== undefined ||
        !RequestIdSchema.safeParse(r.requestId).success
      : r.result !== undefined || r.error === undefined;
    if (bad) ctx.addIssue({ code: 'custom', message: 'invalid success/failure shape' });
  });
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
