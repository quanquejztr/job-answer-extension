import { z } from 'zod';
import {
  MAX_DOCX_FILE_BYTES,
  MAX_LABEL_CHARS,
  MAX_RESUME_CHARS,
  MAX_RULE_CHARS,
  MAX_RULES,
  MAX_SAMPLE_CHARS,
  MAX_SAMPLES,
  MAX_STORIES,
  MAX_STORY_CHARS,
  MAX_TITLE_CHARS,
} from '../lib/constants/limits';

// Profile types (PRD 16.1). Mirrors helper/internal/profile/schema.go. Strict:
// unknown fields are rejected. Used to validate every helper response before the
// settings UI sees it.

const chars = (s: string): number => Array.from(s).length;
const boundedText = (max: number) => z.string().refine((s) => chars(s) >= 1 && chars(s) <= max);

// "<prefix>_<n>": positive decimal, no leading zero, at most nine digits.
const idOf = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[1-9][0-9]{0,8}$`));
export const StoryIdSchema = idOf('s');
export const SampleIdSchema = idOf('w');
export const RuleIdSchema = idOf('r');

export const RESUME_SOURCES = ['pasted', 'pdf', 'docx'] as const;
export const ResumeSourceSchema = z.enum(RESUME_SOURCES);
export type ResumeSource = z.infer<typeof ResumeSourceSchema>;

export const RULE_KINDS = ['length', 'tone', 'style', 'avoid'] as const;
export const RuleKindSchema = z.enum(RULE_KINDS);
export type RuleKind = z.infer<typeof RuleKindSchema>;

export const PROVIDERS = ['claude', 'codex'] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

// The single saved résumé (no ID). Mirrors helper/internal/profile.Resume.
export const ResumeSchema = z.strictObject({
  text: boundedText(MAX_RESUME_CHARS),
  source: ResumeSourceSchema,
  updatedAt: z.string().min(1),
});
export type Resume = z.infer<typeof ResumeSchema>;

export const StorySchema = z.strictObject({
  id: StoryIdSchema,
  title: boundedText(MAX_TITLE_CHARS),
  text: boundedText(MAX_STORY_CHARS),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Story = z.infer<typeof StorySchema>;

export const WritingSampleSchema = z.strictObject({
  id: SampleIdSchema,
  label: boundedText(MAX_LABEL_CHARS),
  text: boundedText(MAX_SAMPLE_CHARS),
  createdAt: z.string().min(1),
});
export type WritingSample = z.infer<typeof WritingSampleSchema>;

export const WritingRuleSchema = z.strictObject({
  id: RuleIdSchema,
  kind: RuleKindSchema,
  text: boundedText(MAX_RULE_CHARS),
  enabled: z.boolean(),
});
export type WritingRule = z.infer<typeof WritingRuleSchema>;

export const ProfileSchema = z.strictObject({
  schemaVersion: z.literal(2),
  nextId: z.number().int().min(1),
  settings: z.strictObject({
    provider: ProviderSchema.optional(),
    disclosureAcceptedAt: z.string().min(1).optional(),
  }),
  resume: ResumeSchema.nullable(),
  stories: z.array(StorySchema).max(MAX_STORIES),
  samples: z.array(WritingSampleSchema).max(MAX_SAMPLES),
  rules: z.array(WritingRuleSchema).max(MAX_RULES),
});
export type Profile = z.infer<typeof ProfileSchema>;

// Input shapes for profile.item.upsert. `id` absent creates; present updates.
// Structural only, like the Go parser: length and content rules are enforced by
// the helper (INVALID_REQUEST) and mirrored inline by the settings forms.
export const StoryInputSchema = z.strictObject({
  id: StoryIdSchema.optional(),
  title: z.string(),
  text: z.string(),
});
export type StoryInput = z.infer<typeof StoryInputSchema>;

// profile.resume.set: the reviewed text and where it came from. Structural
// only; the helper enforces the length limit and the 40,000 total.
export const ResumeSetPayloadSchema = z.strictObject({
  text: z.string(),
  source: ResumeSourceSchema,
});
export type ResumeSetPayload = z.infer<typeof ResumeSetPayloadSchema>;

// profile.import.document: the bytes of one .docx file, standard base64. There
// is no file name on the wire. Size is checked by the sender (the native
// request cap) and again by the helper; structural only here.
export const ImportDocumentPayloadSchema = z.strictObject({
  bytesBase64: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((s) => s.length % 4 === 0)
    .refine((s) => (s.length / 4) * 3 - (s.match(/=*$/)?.[0].length ?? 0) <= MAX_DOCX_FILE_BYTES),
});
export type ImportDocumentPayload = z.infer<typeof ImportDocumentPayloadSchema>;
// The extracted text for the editable box. Nothing has been saved.
export const ImportResultSchema = z.strictObject({
  text: z.string().min(1),
  source: z.literal('docx'),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;
export const ResumeResultSchema = z.strictObject({ resume: ResumeSchema });

export const SampleInputSchema = z.strictObject({
  id: SampleIdSchema.optional(),
  label: z.string(),
  text: z.string(),
});
export type SampleInput = z.infer<typeof SampleInputSchema>;

export const RuleInputSchema = z.strictObject({
  id: RuleIdSchema.optional(),
  kind: RuleKindSchema,
  text: z.string(),
  enabled: z.boolean().optional(),
});
export type RuleInput = z.infer<typeof RuleInputSchema>;

export const ITEM_KINDS = ['story', 'sample', 'rule'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ProfileGetPayloadSchema = z.strictObject({});

export const ItemUpsertPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('story'), item: StoryInputSchema }),
  z.strictObject({ kind: z.literal('sample'), item: SampleInputSchema }),
  z.strictObject({ kind: z.literal('rule'), item: RuleInputSchema }),
]);
export type ItemUpsertPayload = z.infer<typeof ItemUpsertPayloadSchema>;

export const ItemDeletePayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('story'), id: StoryIdSchema }),
  z.strictObject({ kind: z.literal('sample'), id: SampleIdSchema }),
  z.strictObject({ kind: z.literal('rule'), id: RuleIdSchema }),
]);
export type ItemDeletePayload = z.infer<typeof ItemDeletePayloadSchema>;

export const DeleteResultSchema = z.strictObject({ deleted: z.literal(true) });

// profile.export: payload {} -> {file: Profile}, the full versioned profile as
// stored. profile.deleteAll: the literal confirmation (any other string is
// rejected) -> {deleted: true}.
export const ProfileExportPayloadSchema = z.strictObject({});
export const ExportResultSchema = z.strictObject({ file: ProfileSchema });
export type ExportResult = z.infer<typeof ExportResultSchema>;
export const DELETE_ALL_CONFIRMATION = 'DELETE';
export const DeleteAllPayloadSchema = z.strictObject({
  confirm: z.literal(DELETE_ALL_CONFIRMATION),
});
export type DeleteAllPayload = z.infer<typeof DeleteAllPayloadSchema>;

/** Result schema for profile.item.upsert, chosen by the kind that was sent. */
export const UPSERT_RESULT_SCHEMAS = {
  story: z.strictObject({ item: StorySchema }),
  sample: z.strictObject({ item: WritingSampleSchema }),
  rule: z.strictObject({ item: WritingRuleSchema }),
} as const;

// settings.setProvider: the owner's provider choice (no default; Codex is stored
// but has no adapter yet). settings.acceptDisclosure: payload {}; the helper
// stamps the time, so the client cannot choose it.
export const SetProviderPayloadSchema = z.strictObject({ provider: ProviderSchema });
export type SetProviderPayload = z.infer<typeof SetProviderPayloadSchema>;
export const ProviderResultSchema = z.strictObject({ provider: ProviderSchema });
export const AcceptDisclosurePayloadSchema = z.strictObject({});
export const DisclosureResultSchema = z.strictObject({
  disclosureAcceptedAt: z.string().min(1),
});
export type DisclosureResult = z.infer<typeof DisclosureResultSchema>;
