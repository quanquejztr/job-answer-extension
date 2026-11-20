import { ResponseEnvelopeSchema } from '../../schemas/envelope';
import type { AppError } from '../../schemas/error';

export type ParsedResponse =
  | { kind: 'success'; requestId: string; result: unknown }
  | { kind: 'failure'; requestId: string; error: AppError }
  | { kind: 'invalid' };

// Validates a raw response from the native helper. Never throws and never
// echoes the input.
export function parseResponse(raw: unknown): ParsedResponse {
  const parsed = ResponseEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'invalid' };
  const r = parsed.data;
  if (r.ok) return { kind: 'success', requestId: r.requestId, result: r.result };
  if (r.error === undefined) return { kind: 'invalid' };
  return { kind: 'failure', requestId: r.requestId, error: r.error };
}
