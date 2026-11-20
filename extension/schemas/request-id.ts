import { z } from 'zod';

// 1-64 characters from [A-Za-z0-9_-]. Mirrors helper/internal/protocol/requestid.go.
export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// A failure response for an unparseable request uses requestId "".
export const ResponseRequestIdSchema = z.union([RequestIdSchema, z.literal('')]);
