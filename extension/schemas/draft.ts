import { z } from 'zod';
import {
  MAX_CURRENT_DRAFT_CHARS,
  MAX_JOB_CONTEXT_CHARS,
  MAX_MAX_WORDS,
  MAX_QUESTION_CHARS,
  MAX_WARNING_MESSAGE_CHARS,
  MIN_MAX_WORDS,
  MIN_QUESTION_CHARS,
} from '../lib/constants/limits';

// Length in Unicode code points, matching Go's utf8.RuneCountInString.
const chars = (s: string): number => Array.from(s).length;

const REQUESTED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

export function isIsoUtc(s: string): boolean {
  const m = REQUESTED_AT.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number);
  if (y === undefined || mo === undefined || d === undefined) return false;
  if (h === undefined || mi === undefined || sec === undefined) return false;
  if (h > 23 || mi > 59 || sec > 59) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const DraftConstraintsSchema = z
  .strictObject({
    maxWords: z.number().int().min(MIN_MAX_WORDS).max(MAX_MAX_WORDS),
    maxChars: z.number().int().min(1).optional(),
    refinement: z.enum(['regenerate', 'shorter', 'direct']).optional(),
    currentDraft: z
      .string()
      .refine((s) => chars(s) >= 1 && chars(s) <= MAX_CURRENT_DRAFT_CHARS)
      .optional(),
  })
  .refine(
    (c) =>
      (c.refinement === 'shorter' || c.refinement === 'direct') === (c.currentDraft !== undefined),
  );
export type DraftConstraints = z.infer<typeof DraftConstraintsSchema>;

export const DraftRequestSchema = z.strictObject({
  question: z.string().refine((s) => {
    const n = chars(s.trim());
    return n >= MIN_QUESTION_CHARS && n <= MAX_QUESTION_CHARS;
  }),
  jobContext: z
    .string()
    .refine((s) => chars(s) <= MAX_JOB_CONTEXT_CHARS)
    .optional(),
  constraints: DraftConstraintsSchema,
  requestedAt: z.string().refine(isIsoUtc),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

export const DraftWarningSchema = z.strictObject({
  code: z.enum(['UNSUPPORTED_CLAIM', 'TRUNCATED_CONTEXT', 'MODEL_NOTE']),
  severity: z.enum(['info', 'warn']),
  message: z.string().refine((s) => chars(s) <= MAX_WARNING_MESSAGE_CHARS),
});
export type DraftWarning = z.infer<typeof DraftWarningSchema>;

// One quote the draft rests on. The helper has already verified it as an exact
// excerpt of the cited source (PRD 15.2); `source` is 'resume' or 'story:<id>'.
// Bounds from PRD 15.2: a quote is 12 to 300 code points; a draft carries at
// most 10. They are local to the schemas, like the helper's validator constants.
export const MIN_QUOTE_CHARS = 12;
export const MAX_QUOTE_CHARS = 300;
export const MAX_EVIDENCE = 10;

export const EvidenceQuoteSchema = z.strictObject({
  source: z.string().regex(/^(resume|story:[^\s:]{1,40})$/),
  quote: z.string().refine((s) => {
    const n = chars(s);
    return n >= MIN_QUOTE_CHARS && n <= MAX_QUOTE_CHARS;
  }),
});
export type EvidenceQuote = z.infer<typeof EvidenceQuoteSchema>;

export const DraftResponseSchema = z.strictObject({
  answer: z.string().min(1),
  evidence: z.array(EvidenceQuoteSchema).max(MAX_EVIDENCE),
  warnings: z.array(DraftWarningSchema),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;
