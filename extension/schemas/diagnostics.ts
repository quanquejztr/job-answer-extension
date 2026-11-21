import { z } from 'zod';
import { ErrorCodeSchema } from './error';

// diagnostics.run (PRD 17.2): payload `{}`; result is one row per check.
// A passing row carries no code; a failing row carries a catalog code and, when
// the catalog has one, its single user action. Rows never carry provider text.

export const DiagnosticsPayloadSchema = z.strictObject({});

export const CHECK_NAMES = ['helper', 'providerExecutable', 'providerSignIn'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const DiagnosticCheckSchema = z
  .strictObject({
    name: z.enum(CHECK_NAMES),
    ok: z.boolean(),
    code: ErrorCodeSchema.optional(),
    userAction: z.string().max(200).optional(),
  })
  .refine((c) => c.ok === (c.code === undefined), { message: 'ok and code disagree' })
  .refine((c) => !c.ok || c.userAction === undefined, { message: 'a passing check has no action' });
export type DiagnosticCheck = z.infer<typeof DiagnosticCheckSchema>;

export const DiagnosticsResultSchema = z.strictObject({
  checks: z.array(DiagnosticCheckSchema).min(1).max(CHECK_NAMES.length),
});
export type DiagnosticsResult = z.infer<typeof DiagnosticsResultSchema>;
