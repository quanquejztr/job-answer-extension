# Architecture

## Repository layout

```text
extension/
  entrypoints/
    background.ts        # service worker: menu, panel open, routing, target store
    content.ts           # capture, targeting, choose-field, insertion
    sidepanel/           # React side-panel app
    options/             # React settings app
  assets/                # global styles and Tailwind tokens
  components/            # Reusable presentation components
  lib/
    constants/           # PRD section 15.1 limits (single TypeScript source)
    messaging/           # internal envelope and sender validation
    native/              # native-messaging client and request-ID correlation
    domain/              # blocked-domain check
    question/            # normalization and prohibited-category detection
    targeting/           # candidate scoring, fingerprints, expiry, choose mode
    jobcontext/          # bounded job-description extractor
    insertion/           # textarea and contenteditable adapters, verification
    draft/               # draft-session state machine
  schemas/               # Zod schemas for extension-side runtime validation
helper/
  cmd/host/              # Native-messaging executable entrypoint (thin)
  cmd/installer/         # Install, repair, uninstall entrypoint (thin)
  internal/
    protocol/            # Go message types, framing, validation, and errors
    host/                # Native-messaging dispatcher: reads frames, checks the caller origin, routes to handlers and the provider
    identity/            # The single Go home of the pinned extension ID and allowed origin
    limits/              # PRD section 15.1 limits (single Go source)
    profile/             # Local profile schema, atomic store, IDs, export, delete
    facts/               # Relevance-based fact selection
    prompt/              # Prompt construction and golden tests
    validate/            # Evidence, claim, length, and output validation
    provider/            # Provider interface; fake/, claude/, codex/ adapters
    importer/            # Text and document extraction
    install/             # Manifest templates and path safety
installer/templates/     # Native-host manifest templates
tests/
  fixtures/              # Local HTML fixture pages
  e2e/                   # Playwright specs
  protocol-fixtures/     # Shared JSON used by TypeScript and Go tests
specs/                   # Product and architecture source of truth
rules/                   # AI-assisted coding rules
```

The limits in `extension/lib/constants/` and `helper/internal/limits/` mirror each other and are checked against `tests/protocol-fixtures/limits.json` by one test in each runtime.

## Components

### Service worker

Owns context-menu registration, active-tab coordination, side-panel opening, and routing between extension surfaces. It does not parse résumés, generate answers, manipulate page fields, or hold sensitive profile content longer than required for a request.

### Content script

Owns selected-question capture, nearby field discovery, manual field selection, short-lived target fingerprints, field revalidation, and approved insertion. It receives only the final approved answer, never the résumé or full profile.

### Side panel

Owns question confirmation, job-context confirmation, generation status, draft review/editing, warnings, regeneration controls, and the explicit Insert action. React components call typed clients in `extension/lib/`; they do not call Chrome native messaging directly.

### Settings UI

Owns profile setup, résumé-text confirmation, project stories, writing samples, writing rules, diagnostics, local export, and delete-all-data. Sensitive operations are delegated to the Go helper through a typed client.

### Go native helper

Owns native-message framing, caller/version validation, sensitive profile storage, document extraction, relevant-fact selection, provider invocation, output validation, and typed errors. Protocol output uses stdout; sanitized diagnostics use stderr.

### Provider boundary

`Provider` accepts a validated draft request and returns a validated draft response. Version one has two interchangeable adapters, each invoking the user's installed CLI: Claude Code and Codex. The user selects one in settings. No extension component depends on provider-specific process details.

### Installer

Owns installation of the Go binary and the Chrome native-host manifest in user-scoped macOS locations. The manifest allows only the expected extension origin. Installation and removal must be idempotent.

## End-to-end data flow

1. A user selection triggers **Draft answer**.
2. The service worker asks the content script for the selected text and a nearby field candidate.
3. The content script returns question text, bounded page context, and a short-lived `FieldTarget`; it does not return the entire page.
4. The side panel displays the captured information for correction.
5. The side panel sends a versioned `DraftRequest` through the service worker to the native helper.
6. The helper loads the local profile, chooses relevant facts, builds an isolated prompt, and invokes the provider.
7. The helper validates the provider response and returns `DraftResponse`.
8. The side panel displays the draft and warnings. Edits remain in extension memory unless the user explicitly saves a writing example.
9. On Insert, the service worker sends the approved answer and target ID to the originating content script.
10. The content script revalidates the target, requests confirmation if nonempty, writes the answer, dispatches required events, and verifies persistence.

## Trust boundaries

- Webpage DOM, selected text, and job descriptions are hostile input.
- Extension messages may be stale, malformed, or sent from the wrong surface and must be validated.
- Native messaging crosses into a higher-privilege local process and requires strict origin, version, size, and type checks.
- Model output is untrusted until parsed and validated.
- Local profile data is sensitive and remains helper-owned.
- Provider authentication (Claude or ChatGPT sign-in) is external provider state, not application data.

## Dependency rules

- `components/` may depend on typed interfaces in `lib/`, not Chrome APIs directly.
- `entrypoints/` coordinate platform APIs but keep reusable logic in `lib/`.
- The content script cannot import profile or provider code.
- The provider cannot write to fields or control Chrome.
- The Go protocol package cannot depend on provider or profile implementations.
- The installer cannot read profile data or provider credentials.
- No component may introduce application submission behavior.

## Failure behavior

- If target confidence is low, require manual field selection.
- If a target becomes stale, invalidate it and require recapture.
- If a field cannot be safely written, offer clipboard copy without altering the page.
- If job-context extraction is uncertain, require manual confirmation or paste.
- If the selected provider CLI is missing, unauthenticated, limited, timed out, or returns invalid output, preserve the user's context and show a typed, actionable error.
- Never respond to a failure by broadening permissions, scanning the entire form, or attempting automatic navigation.
