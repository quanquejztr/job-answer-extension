import { z } from 'zod';
import {
  MAX_MAX_WORDS,
  MAX_QUESTION_CHARS,
  MIN_MAX_WORDS,
  MIN_QUESTION_CHARS,
} from '../lib/constants/limits';
import { DraftWarningSchema } from './draft';
import { ErrorCodeSchema } from './error';
import {
  FieldCandidateSchema,
  FieldFingerprintSchema,
  FieldLocatorSchema,
  FieldStatusSchema,
  MAX_FIELD_LABEL_CHARS,
  RevalidationFailureSchema,
} from './field-target';
import { RequestIdSchema } from './request-id';

// Extension-internal envelope (PRD 17.1): { v: 1, requestId, type, payload }.
// Every internal message is parsed with these strict schemas before use.
export const INTERNAL_PROTOCOL_VERSION = 1;

function envelope<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    v: z.literal(INTERNAL_PROTOCOL_VERSION),
    requestId: RequestIdSchema,
    type: z.literal(type),
    payload,
  });
}

/** Generic envelope shape, used to build messages whose payload is already typed. */
export const InternalEnvelopeSchema = z.strictObject({
  v: z.literal(INTERNAL_PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  type: z.string(),
  payload: z.unknown(),
});

export const CaptureQuestionSchema = z.string().min(MIN_QUESTION_CHARS).max(MAX_QUESTION_CHARS);

export const CaptureRequestSchema = envelope('capture.request', z.strictObject({}));
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

// The content script reports only what it can observe: a field candidate (label
// and fingerprint) or none. The worker builds the FieldTarget (tab, frame,
// origin, id, state, expiry); the page side never invents those.
// `candidates` is 0 (not-found), 1 (found), or 2-5 (ambiguous; capped at 5), and
// `field` is set only when exactly one field was found.
export const CaptureResultSchema = envelope(
  'capture.result',
  z
    .strictObject({
      question: CaptureQuestionSchema,
      labelHint: z.string().max(MAX_QUESTION_CHARS).optional(),
      // Job context arrives in a later slice; it must be absent for now.
      jobContext: z.undefined().optional(),
      fieldStatus: FieldStatusSchema,
      field: FieldCandidateSchema.nullable(),
      candidates: z.number().int().min(0).max(5),
    })
    .refine(
      (p) =>
        (p.fieldStatus === 'found' && p.field !== null && p.candidates === 1) ||
        (p.fieldStatus === 'not-found' && p.field === null && p.candidates === 0) ||
        (p.fieldStatus === 'ambiguous' && p.field === null && p.candidates >= 2),
      { message: 'fieldStatus, field, and candidates disagree' },
    ),
);
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

// The content script re-resolves the locator, compares the fingerprint, and
// reports whether the field is still the same, visible, and editable. The
// locator's frameId is informational: the message is already addressed to the
// frame, and the content script cannot know its own frame id.
export const FieldRevalidateRequestSchema = envelope(
  'field.revalidate.request',
  z.strictObject({ locator: FieldLocatorSchema, fingerprint: FieldFingerprintSchema }),
);
export type FieldRevalidateRequest = z.infer<typeof FieldRevalidateRequestSchema>;

export const FieldRevalidateResultSchema = envelope(
  'field.revalidate.result',
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true) }),
    z.strictObject({ ok: z.literal(false), reason: RevalidationFailureSchema }),
  ]),
);
export type FieldRevalidateResult = z.infer<typeof FieldRevalidateResultSchema>;

/**
 * Upper bound on an answer crossing a message boundary. A 400-word answer is
 * about 2,500 characters; this leaves room for long words and nothing more.
 */
export const MAX_ANSWER_CHARS = 8000;

/** Failures an insert attempt can end in (PRD 17.3). */
export const INSERT_ERROR_CODES = ['FIELD_STALE', 'FIELD_NONEMPTY', 'FIELD_UNSUPPORTED'] as const;
export const InsertErrorCodeSchema = z.enum(INSERT_ERROR_CODES);
export type InsertErrorCode = z.infer<typeof InsertErrorCodeSchema>;

// Worker -> content script: ONLY the approved answer, the target id, and the
// locator/fingerprint needed to re-find the field. No question, fact, prompt,
// or provider output (SEC-001, AC-050). `confirmReplace` is always false until
// the replacement dialog exists (Slice 4.3); a nonempty field is never replaced.
export const InsertRequestSchema = envelope(
  'insert.request',
  z.strictObject({
    targetId: RequestIdSchema,
    answer: z.string().min(1).max(MAX_ANSWER_CHARS),
    confirmReplace: z.literal(false),
    locator: FieldLocatorSchema,
    fingerprint: FieldFingerprintSchema,
  }),
);
export type InsertRequest = z.infer<typeof InsertRequestSchema>;

export const InsertResultSchema = envelope(
  'insert.result',
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true) }),
    z.strictObject({ ok: z.literal(false), error: InsertErrorCodeSchema }),
  ]),
);
export type InsertResult = z.infer<typeof InsertResultSchema>;

export const CAPTURE_SOURCES = ['content-script', 'menu-selection'] as const;
export const CaptureSourceSchema = z.enum(CAPTURE_SOURCES);
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

// What the panel may know about the answer field: a status and the label (text
// only). Never the locator or fingerprint.
export const PanelFieldSchema = z.strictObject({
  status: FieldStatusSchema,
  label: z.string().min(1).max(MAX_FIELD_LABEL_CHARS).optional(),
});
export type PanelField = z.infer<typeof PanelFieldSchema>;

// Side-panel state for one tab. `captureId` is the capture's requestId; it lets
// the panel discard local question edits when the same text is captured again.
// A draft failure or cancellation returns to `captured` with the question the
// user sent preserved (PRD 15.2, FR-054); `error` on a captured state is the
// typed draft failure, shown beside the editable question.
const CapturedBase = {
  question: CaptureQuestionSchema,
  source: CaptureSourceSchema,
  captureId: RequestIdSchema,
  field: PanelFieldSchema,
};

// The reviewed draft. `answer` is what the provider returned; `editedAnswer` is
// the user's text, kept only when an insert attempt failed or is running so the
// edit survives. `maxWords` and `maxChars` are the limits the draft was made
// under (the field's maxlength wins); the worker re-checks them on Insert.
const GeneratedBase = {
  ...CapturedBase,
  // Which generation this draft belongs to. A regenerated draft has a new id, so
  // the panel starts a fresh editor even if the generating state was never rendered.
  draftId: z.number().int().nonnegative(),
  answer: z.string().min(1),
  usedFactCount: z.number().int().nonnegative(),
  warnings: z.array(DraftWarningSchema),
  maxWords: z.number().int().min(MIN_MAX_WORDS).max(MAX_MAX_WORDS),
  maxChars: z.number().int().min(1).optional(),
  editedAnswer: z.string().max(MAX_ANSWER_CHARS).optional(),
};
export const PanelStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('unsupported-domain') }),
  z.strictObject({
    kind: z.literal('captured'),
    ...CapturedBase,
    error: ErrorCodeSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('generating'), ...CapturedBase }),
  // `insertError` is the typed failure of the last Insert; the target is gone
  // after any failure, so the user must capture the question again.
  z.strictObject({
    kind: z.literal('generated'),
    ...GeneratedBase,
    insertError: InsertErrorCodeSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('inserting'), ...GeneratedBase }),
  z.strictObject({ kind: z.literal('inserted'), ...CapturedBase }),
  z.strictObject({ kind: z.literal('error'), code: ErrorCodeSchema }),
]);
export type PanelState = z.infer<typeof PanelStateSchema>;

export const EMPTY_PANEL_STATE: PanelState = { kind: 'empty' };

const TabIdSchema = z.number().int().nonnegative();

export const PanelStateGetSchema = envelope(
  'panel.state.get',
  z.strictObject({ tabId: TabIdSchema }),
);
export type PanelStateGet = z.infer<typeof PanelStateGetSchema>;

// Used both as the reply to `panel.state.get` and as the worker's push.
export const PanelStateMessageSchema = envelope(
  'panel.state',
  z.strictObject({ tabId: TabIdSchema, state: PanelStateSchema }),
);
export type PanelStateMessage = z.infer<typeof PanelStateMessageSchema>;

// Panel -> worker: start (or restart) a draft for a tab, and cancel the tab's
// draft. The question is the panel's possibly edited text; the worker builds
// the helper request from it. Fire-and-forget: results arrive as `panel.state`.
export const DraftQuestionSchema = z.string().refine((s) => {
  const n = Array.from(s.trim()).length;
  return n >= MIN_QUESTION_CHARS && n <= MAX_QUESTION_CHARS;
});
export const DraftStartSchema = envelope(
  'draft.start',
  z.strictObject({ tabId: TabIdSchema, captureId: RequestIdSchema, question: DraftQuestionSchema }),
);
export type DraftStart = z.infer<typeof DraftStartSchema>;
export const DraftCancelSchema = envelope('draft.cancel', z.strictObject({ tabId: TabIdSchema }));
export type DraftCancel = z.infer<typeof DraftCancelSchema>;

// Panel -> worker: insert the user's reviewed (possibly edited) answer into the
// captured field. Extension pages only. Fire-and-forget: the outcome arrives as
// `panel.state`. The answer must be nonempty after trimming.
export const InsertStartSchema = envelope(
  'insert.start',
  z.strictObject({
    tabId: TabIdSchema,
    captureId: RequestIdSchema,
    answer: z
      .string()
      .max(MAX_ANSWER_CHARS)
      .refine((s) => s.trim() !== ''),
  }),
);
export type InsertStart = z.infer<typeof InsertStartSchema>;

/** Every known internal message; an unknown `type` fails to parse. */
export const InternalMessageSchema = z.discriminatedUnion('type', [
  CaptureRequestSchema,
  CaptureResultSchema,
  FieldRevalidateRequestSchema,
  FieldRevalidateResultSchema,
  PanelStateGetSchema,
  PanelStateMessageSchema,
  DraftStartSchema,
  DraftCancelSchema,
  InsertStartSchema,
  InsertRequestSchema,
  InsertResultSchema,
]);
export type InternalMessage = z.infer<typeof InternalMessageSchema>;
