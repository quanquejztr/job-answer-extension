import { z } from 'zod';
import { RequestIdSchema } from './request-id';

// PRD 16.2 and specs/05: FieldFingerprint, FieldLocator, FieldTarget. The
// content script produces only a FieldCandidate (label + fingerprint); the
// worker adds tab, frame, origin, state, and expiry. Fingerprint and locator
// data never reach the side panel or the helper.

/** Bounds shared by builders (which truncate) and schemas (which reject). */
export const MAX_FIELD_LABEL_CHARS = 200;
export const MAX_ATTRIBUTE_CHARS = 200;
export const MAX_DOM_PATH_DEPTH = 40;
export const SIZE_BUCKET_PX = 20;

const BoundedText = z.string().max(MAX_ATTRIBUTE_CHARS);
const DomPathSchema = z.array(z.number().int().nonnegative()).max(MAX_DOM_PATH_DEPTH);

export const FieldFingerprintSchema = z.strictObject({
  tag: z.enum(['textarea', 'div', 'p', 'input']),
  contentEditable: z.boolean(),
  nameAttr: BoundedText.optional(),
  idAttr: BoundedText.optional(),
  placeholder: BoundedText.optional(),
  labelText: z.string().max(MAX_FIELD_LABEL_CHARS),
  maxLength: z.number().int().nonnegative().optional(),
  sizeBucket: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  domPath: DomPathSchema,
});
export type FieldFingerprint = z.infer<typeof FieldFingerprintSchema>;

export const FieldLocatorSchema = z.strictObject({
  frameId: z.number().int().nonnegative(),
  domPath: DomPathSchema,
});
export type FieldLocator = z.infer<typeof FieldLocatorSchema>;

export const FIELD_STATES = [
  'captured',
  'validated',
  'approved',
  'inserted',
  'invalidated',
] as const;
export const FieldStateSchema = z.enum(FIELD_STATES);
export type FieldState = z.infer<typeof FieldStateSchema>;

export const FieldTargetSchema = z.strictObject({
  id: RequestIdSchema,
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  pageOrigin: z.string().min(1).max(2048),
  labelText: z.string().max(MAX_FIELD_LABEL_CHARS),
  locator: FieldLocatorSchema,
  fingerprint: FieldFingerprintSchema,
  state: FieldStateSchema,
  expiresAt: z.iso.datetime(),
});
export type FieldTarget = z.infer<typeof FieldTargetSchema>;

/** What the content script reports for the field it found; the locator is its domPath. */
export const FieldCandidateSchema = z.strictObject({
  labelText: z.string().max(MAX_FIELD_LABEL_CHARS),
  fingerprint: FieldFingerprintSchema,
});
export type FieldCandidate = z.infer<typeof FieldCandidateSchema>;

export const FIELD_STATUSES = ['found', 'not-found', 'ambiguous'] as const;
export const FieldStatusSchema = z.enum(FIELD_STATUSES);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const REVALIDATION_FAILURES = ['missing', 'changed', 'hidden', 'disabled'] as const;
export const RevalidationFailureSchema = z.enum(REVALIDATION_FAILURES);
export type RevalidationFailure = z.infer<typeof RevalidationFailureSchema>;
