# Contracts and Invariants

This document is the canonical behavioral contract. Concrete TypeScript, Zod, and Go definitions must preserve these semantics.

## Protocol envelope

Every extension-to-helper message uses a versioned envelope:

```ts
type RequestEnvelope<T> = {
  protocolVersion: 1;
  requestId: string;
  type: string;
  payload: T;
};

type ResponseEnvelope<T> = {
  protocolVersion: 1;
  requestId: string;
  ok: boolean;
  result?: T;
  error?: AppError;
};
```

Requirements:

- `requestId` is unique per operation and returned unchanged.
- Unknown versions and message types are rejected.
- Success contains `result` and no `error`; failure contains `error` and no `result`.
- Message size limits are checked before expensive parsing or processing.
- Protocol types are mirrored in TypeScript and Go and validated at runtime.

## Core types

```ts
type FieldTarget = {
  id: string;
  tabId: number;
  frameId: number;
  pageOrigin: string;
  labelText: string;
  locator: FieldLocator;
  fingerprint: FieldFingerprint;
  state: 'captured' | 'validated' | 'approved' | 'inserted' | 'invalidated';
  expiresAt: string;
};

type DraftRequest = {
  question: string;
  jobContext?: string;
  constraints: DraftConstraints;
  requestedAt: string;
};

type DraftConstraints = {
  maxWords: number; // 20-400, default 150
  maxChars?: number; // from the field's maxlength when present
  refinement?: 'regenerate' | 'shorter' | 'direct';
  currentDraft?: string; // only for shorter/direct, at most 4,000 characters
};

type DraftWarning = {
  code: 'UNSUPPORTED_CLAIM' | 'TRUNCATED_CONTEXT' | 'MODEL_NOTE';
  severity: 'info' | 'warn';
  message: string; // at most 200 characters, plain text
};

type EvidenceQuote = {
  source: string; // 'resume' or 'story:<id>'; samples and rules are never evidence
  quote: string; // 12-300 code points, an exact excerpt of the source after whitespace collapsing
};

type DraftResponse = {
  answer: string;
  evidence: EvidenceQuote[]; // at least one; verified by the helper before it is returned
  warnings: DraftWarning[];
};

type FieldFingerprint = {
  tag: 'textarea' | 'div' | 'p' | 'input';
  contentEditable: boolean;
  nameAttr?: string;
  idAttr?: string;
  placeholder?: string;
  labelText: string;
  maxLength?: number;
  sizeBucket: [number, number]; // width and height rounded to 20 px
  domPath: number[]; // child-index path from the frame body, depth at most 40
};

type FieldLocator = { frameId: number; domPath: number[] };

type AppError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  userAction?: string;
};
```

The helper loads the profile after receiving `DraftRequest` and sends the whole profile content (within the 40,000 code-point cap) to the provider; the extension does not transmit the profile with the request, and the profile never reaches a content script. The profile removed `ProfileFact` in [ADR 0003](decisions/0003-resume-and-stories-profile.md): it holds one résumé text, stories, samples, and rules (`06-prd.md` section 16.1). The complete limits, profile file schema, message catalog, and error table are in `06-prd.md` sections 15-17; the definitions above must stay identical to them.

## Field-target lifecycle

```text
captured -> validated -> approved -> inserted
    |           |           |
    +-----------+-----------+-> invalidated
```

- `captured`: a candidate field was found near the selected question.
- `validated`: the current DOM still matches the fingerprint.
- `approved`: the user explicitly chose Insert and any replacement confirmation succeeded.
- `inserted`: the value was written and verified after page/framework updates.
- `invalidated`: the page, frame, field identity, expiry, or confidence check failed.

Only `approved` targets may be written. Any navigation, reload, frame change, expiry, missing element, incompatible type, or material fingerprint mismatch invalidates the target.

## Error categories

At minimum, support distinct codes for:

- `INVALID_REQUEST`
- `PROTOCOL_VERSION_UNSUPPORTED`
- `MESSAGE_TOO_LARGE`
- `UNSUPPORTED_DOMAIN`
- `QUESTION_MISSING`
- `FIELD_NOT_FOUND`
- `FIELD_AMBIGUOUS`
- `FIELD_STALE`
- `FIELD_NONEMPTY`
- `FIELD_UNSUPPORTED`
- `HELPER_UNAVAILABLE`
- `PROVIDER_NOT_FOUND`
- `PROVIDER_NOT_AUTHENTICATED`
- `PROVIDER_USAGE_LIMIT`
- `PROVIDER_TIMEOUT`
- `PROVIDER_CANCELLED`
- `PROVIDER_OUTPUT_INVALID`
- `FACT_VALIDATION_FAILED` (a draft not supported by the user's résumé and stories: an invalid evidence quote, no valid quote, or an unsupported number, year, percentage, or amount)
- `STORAGE_ERROR`
- `INTERNAL_ERROR`

Errors shown to users are actionable and sanitized. Internal errors never include prompts, profile text, drafts, job descriptions, credentials, or raw process output.

## Permanent invariants

1. A user action can modify at most one free-response field.
2. Generation never modifies a page; insertion is a separate explicit action.
3. A target is revalidated immediately before insertion.
4. Existing field text is never overwritten without confirmation.
5. The extension never activates navigation, save, apply, or submit controls.
6. Structured, eligibility, demographic, compensation, consent, and legal fields are outside the product boundary.
7. Page text and model output are untrusted data, never executable instructions or HTML.
8. Factual claims may be supported only by the user's résumé and stories, and every accepted draft carries at least one evidence quote verified as an exact excerpt of the cited source.
9. Numbers, years, percentages, and amounts not present in the user's text, the question, or the job context are rejected, and unsupported names are warned.
10. The full profile remains in the helper and never reaches a content script.
11. Only the question, bounded job context, the user's profile content within the cap, and writing constraints are sent to the provider.
12. Provider (Claude or ChatGPT) credentials and session tokens are never read, stored, logged, or transported.
13. Provider tools, MCP servers, hooks, skills, and session persistence are disabled for drafting.
14. LinkedIn and Indeed are unsupported domains.
15. Clipboard fallback never triggers automatically; it requires a user action.
16. No sensitive content appears in routine logs or analytics; version one has no telemetry.
17. The humanizer feature remains absent until a separate approved specification exists.

## Contract-change policy

A change to an envelope, core type, lifecycle, error meaning, trust boundary, or permanent invariant requires:

1. A specification update.
2. A decision record when the change is architectural.
3. TypeScript and Go compatibility consideration.
4. Migration or versioning behavior for stored/protocol data.
5. Positive, negative, and backward-compatibility tests as applicable.
