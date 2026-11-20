# Actionable Implementation Plan

- Status: Not started
- Planning model: Modified vertical slices for LLM-assisted coding
- Source of truth: `06-prd.md`, `03-architecture.md`, and `05-contracts-and-invariants.md`
- Last updated: 2026-11-19

## Why this planning style

### Styles considered

1. **Horizontal component plan** — finish the extension UI, then the Go helper, then provider integration, then tests. This makes ownership simple, but produces long periods where nothing works end to end and defers the riskiest Chrome-to-Go integration.
2. **Conventional milestone/epic plan** — organize work under Foundation, Profile, Generation, Insertion, and Release. This is readable for humans, but each milestone is too broad for a single LLM context and can produce partially integrated work.
3. **Pure user-story vertical slices** — make every slice independently useful to the end user. This is ideal once the system exists, but the first slice would be too large because the product crosses Chrome, native messaging, Go, local storage, and Claude.
4. **Modified vertical slices** — establish a small tested foundation, build one end-to-end walking skeleton with a deterministic provider, then add one capability at a time across the necessary components. Each slice ends with a demonstrable outcome and a hard verification gate.

### Selected approach

Use **modified vertical slices with a walking skeleton and hardening gates**.

This is the best fit because it:

- Tests the highest-risk browser/native boundary early.
- Gives each LLM session a bounded work packet with explicit context, tests, and exit criteria.
- Keeps the repository buildable after every step.
- Prevents large frontend/backend batches from drifting away from shared contracts.
- Demonstrates user-visible progress without weakening security or privacy boundaries.
- Lets compatibility and document parsing evolve from evidence rather than speculative abstractions.

## How to use this plan

### Work-unit rule

Implement one numbered step at a time unless two adjacent steps are trivially inseparable. Do not ask an LLM to implement an entire slice in one prompt.

For each step:

1. Read `AGENTS.md` and the step's listed context.
2. Inspect the current implementation and tests.
3. Restate the step outcome and invariants.
4. Implement production behavior and tests together.
5. Run the step checks plus any affected canonical checks.
6. Review the diff for scope growth and sensitive logging.
7. Mark the step complete only when its exit condition is met.
8. Stop at the slice gate and report evidence before starting the next slice.

### Status notation

- `[ ]` not started
- `[~]` in progress
- `[x]` complete and verified
- `[!]` blocked; add a short reason below the step

Only update a status after checking the current repository state. Never mark work complete based on a plan description alone.

### Completion report for every step

Record:

- Outcome delivered.
- Files changed.
- Tests added or updated.
- Commands run and results.
- Security/privacy effect.
- Remaining limitation or follow-up.

## Global implementation constraints

- One selected question and one free-response field at a time.
- Generation and insertion remain separate user actions.
- No application navigation or submission behavior.
- No full profile in content-script messages.
- No provider credential access or brokerage.
- Page content and model output remain untrusted.
- LinkedIn and Indeed remain blocked.
- No humanizer capability in this plan.
- Automated tests use local fixtures and fake executables, never real employer submissions.
- The repository must remain green at the end of each completed step.

---

## Slice 0 — Reproducible Foundation

**Outcome:** Both runtimes build and test locally; shared boundaries exist before feature work.

**Requirements prepared:** `COMP-001`, `SEC-001`, `SEC-002`, `SEC-007`.

### 0.1 Scaffold the repository

- [x] Create the root npm project using Node.js 26 LTS and npm.
- [x] Scaffold WXT with React and strict TypeScript, configured to use `extension/` as its source directory.
- [x] Add Tailwind CSS, Radix UI primitives, Zod, Vitest, React Testing Library, and Playwright.
- [x] Create the Go module under `helper/` with thin `cmd/host` and empty internal package boundaries from `03-architecture.md`.
- [x] Add `installer/`, `tests/fixtures/`, `tests/e2e/`, and shared protocol fixture directories.
- [x] Add lint, typecheck, unit-test, build, Go-format, Go-vet, and Go-test commands.
- [x] Pin the extension ID with a manifest `key` so the native-host origin is stable across reloads ([ADR 0002](decisions/0002-subscription-cli-providers.md)).

**Context:** `02-technical-stack.md`, `03-architecture.md`, `rules/00-core.md`, `rules/20-frontend-extension.md`, `rules/30-go-helper.md`.

**Exit:** Empty extension and helper build; baseline TypeScript and Go tests pass; generated output is ignored.

### 0.2 Implement protocol foundations

- [x] Define TypeScript/Zod and Go representations of the versioned envelope, `AppError`, `DraftRequest`, and `DraftResponse`.
- [x] Implement unique request IDs and strict success/error envelope rules.
- [x] Implement conservative native-message framing and size checks in Go.
- [x] Add shared valid/invalid JSON fixtures consumed by both TypeScript and Go tests.
- [x] Implement sanitized error mapping without logging payload contents.

**Context:** `05-contracts-and-invariants.md`, `rules/30-go-helper.md`, `rules/50-security.md`, `rules/60-testing.md`.

**Exit:** Both runtimes accept and reject the same protocol fixtures; malformed framing, versions, types, and sizes have tests.

### 0.3 Establish the design shell and fixture harness

- [x] Define semantic Tailwind tokens and the base side-panel typography, spacing, focus, and state styles.
- [x] Create a minimal accessible side-panel shell with no generation behavior.
- [x] Create a local fixture server/page containing a labeled question, one textarea, and a submit button used only to prove it is never touched.
- [x] Configure Playwright to load the unpacked extension against local fixtures (`npm run test:e2e` rebuilds the extension first and starts the test-only fixture server on `127.0.0.1:4310`).

**Context:** `rules/40-design-style.md`, `rules/60-testing.md`.

**Exit:** Component accessibility smoke test and loaded-extension fixture smoke test pass.

### 0.4 Run the provider and iframe spikes

- [x] For `claude -p`: confirm `--safe-mode`, `--tools ""`, `--no-session-persistence`, `--disable-slash-commands`, and `--output-format json` with `--json-schema` give an isolated run that still uses subscription sign-in (`--bare` is excluded because it ignores subscription sign-in), and confirm user-level configuration is not loaded.
- [ ] (Deferred to step 3.0 by owner decision on 2026-11-19.) For `codex exec`: confirm `-s read-only`, `--ephemeral`, `--ignore-user-config`, `--skip-git-repo-check`, and `--output-schema`; test whether global instructions or MCP configuration still leak in, and decide between an empty working directory and a separate `CODEX_HOME` (PRD D3).
- [x] Confirm how signed-out states appear for Claude Code, including `claude auth status` (done). The usage-limit and timeout signatures for Claude Code, and all `codex` states, are carried to step 3.0.
- [x] Test whether `activeTab` plus `scripting` from a context-menu click reaches same-origin and cross-origin iframes on local fixtures (PRD D5).
- [x] Record confirmed flags, findings, and the decisions on PRD D4-D6 in ADR 0002 and section 22 of the PRD (D3 and the Codex flags are deferred to step 3.0).

**Context:** `rules/52-provider.md`, `specs/decisions/0002-subscription-cli-providers.md`, `rules/50-security.md`.

**Exit:** ADR 0002 lists the confirmed flags and findings for both CLIs (Claude Code done 2026-11-19; Codex deferred to step 3.0) and the iframe result; an adapter is marked unsupported if it cannot be isolated.

### Slice 0 gate

- [x] Acceptance criteria pass: `AC-052`.
- [x] Spike results for Claude Code and iframes are recorded; D4 and D6 are resolved, D5 is deferred to before Slice 4 (owner action O3), and D3 with the Codex spike is deferred to step 3.0 by owner decision (2026-11-19).
- [x] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- [x] `gofmt`, `go vet ./...`, and `go test ./...` pass in `helper/`.
- [x] No Chrome permission beyond the minimum scaffold has been added without justification.

---

## Slice 1 — End-to-End Walking Skeleton

**Outcome:** On a local fixture, select a question, receive a deterministic draft through the real native-messaging boundary, review it, and insert it into one textarea.

**Requirements:** `FR-020`, `FR-021`, `FR-022`, `FR-030`, `FR-031`, `FR-032`, `FR-060`, `FR-061`, `FR-062`, `FR-063`, `FR-065`, `FR-066`, `FR-067`, `FR-069`, `SEC-002`, `SEC-003`, `SEC-006`.

### 1.1 Capture the selected question

- [x] Register **Draft answer** from the service worker for meaningful text selections.
- [x] Block LinkedIn and Indeed before any capture action.
- [x] Send a validated capture request to the active tab/frame using user-gesture access.
- [x] Open the side panel and display editable captured question text.
- [x] Reject missing, empty, and oversized selection text with typed errors.

**Exit:** Component and browser tests prove correct capture, denied domains, and missing-selection errors.

Manual acceptance in real Chrome passed on 2026-11-19: capture on the local fixture, short-selection error, no menu item without a selection, and the LinkedIn/Indeed unsupported state.

### 1.2 Target one standard textarea

- [x] Implement bounded nearby-field discovery for the single-textarea fixture.
- [x] Create a short-lived `FieldTarget` with tab, frame, origin, locator, label, fingerprint, state, and expiry.
- [x] Keep the target in extension runtime state only.
- [x] Invalidate it on reload, navigation, expiry, or obvious element replacement.

**Exit:** Unit tests cover fingerprint equality, expiry, and invalidation; no form-wide scan exists.

Manual acceptance in real Chrome passed on 2026-11-19 on the five local fixture pages (found, several fields match, and three not-found cases) and the reset on reload.

### 1.3 Connect the native helper with a deterministic provider

- [x] Implement service-worker-to-native-host request routing.
- [x] Validate request/response envelopes and correlate request IDs.
- [x] Implement a `FakeProvider` in Go returning a fixed valid `DraftResponse` without profile access.
- [x] Add a development-only registration procedure for the native host using the actual unpacked extension ID.
- [x] Surface helper unavailable, protocol mismatch, and invalid response as typed side-panel states.
- [x] When a response frame exceeds the 512 KiB limit, return `INTERNAL_ERROR` (not `MESSAGE_TOO_LARGE`, which `WriteMessage` and `ToAppError` produce) per PRD section 17.3.
- [x] Echo the requestId from a failed `ParseRequest` when one was valid, and use `""` otherwise.

**Exit:** A real Chrome native-message round trip returns the deterministic answer; extension and Go tests cover routing failures.

Automated: a real Chromium native round trip passes in e2e using a throwaway profile. Manual acceptance in the owner's real Chrome passed on 2026-11-19 (`npm run helper:dev-install`, then Generate draft on the local fixture showed the fixed answer and "Facts used: 2" with the page unchanged); the uninstall/unavailable path was not exercised manually.

### 1.4 Review and insert

- [x] Render the deterministic answer as editable text in the side panel.
- [x] Keep generation separate from insertion.
- [x] Require an explicit **Insert answer** action.
- [x] Revalidate the target, set the textarea through its native setter, dispatch required events, and verify the value.
- [x] Report insertion failure without retrying or touching other elements.

**Exit:** Playwright proves one textarea changes, the submit button receives no event, and generation alone changes nothing.

Automated (unit, jsdom, and real-Chromium e2e of the page-side code) passes. Manual acceptance of the full menu-click chain in the owner's real Chrome passed on 2026-11-20.

### Slice 1 gate

- [x] Acceptance criteria pass: `AC-020`, `AC-021`, `AC-040`, `AC-041`, `AC-045`, `AC-050`.
- [x] Demonstrate select → side panel → native draft → review → insert on the local fixture.
- [x] Verify the content script never receives profile/provider data.
- [x] Run all canonical checks.

Gate passed on 2026-11-20: all canonical checks pass (631 Vitest tests, 45 e2e tests, Go tests with `-race`), and the owner demonstrated select, side panel, native draft, review, and insert in real Chrome on the local fixtures, including the nonempty-field refusal, the two-textarea case, the stale-field case, and an untouched submit button.

---

## Slice 2 — Trusted Manual Profile

**Outcome:** The user can manage verified facts, stories, writing samples, and rules locally; deterministic drafts use selected facts.

**Requirements:** `FR-012`, `FR-013`, `FR-014`, `FR-015`, `FR-016`, `PRIV-001`, `PRIV-002`, `PRIV-003`, `PRIV-004`, `PRIV-005`, `PRIV-007`.

### 2.1 Define and store the profile

- [ ] Define a versioned profile schema containing verified facts, stories, writing samples, and writing rules.
- [ ] Assign stable opaque IDs to verified facts; do not reuse deleted IDs.
- [ ] Implement owner-only application directories and atomic Go writes.
- [ ] Reject malformed, oversized, unknown-version, and symlink-unsafe storage input.
- [ ] Add migration hooks that currently support only the initial version explicitly.

**Exit:** Go tests cover CRUD, permissions, atomic failure, invalid data, and version rejection.

### 2.2 Build manual profile settings

- [ ] Add settings views for creating, editing, verifying, and deleting facts and stories.
- [ ] Add writing-sample and explicit-rule editors, including maximum word/character rules.
- [ ] Route all sensitive operations through the typed native client.
- [ ] Show that profile data stays local and explain what a later draft may send to the selected provider.

**Exit:** React tests cover CRUD, validation, keyboard access, destructive confirmation, and error recovery.

### 2.3 Add export and delete-all-data

- [ ] Export an explicit versioned user-data file after user action.
- [ ] Implement confirmed delete-all for app-owned profile and temporary data.
- [ ] Do not claim deletion from Chrome, the provider, employer sites, backups, or macOS.
- [ ] Add sentinel tests proving profile content does not appear in logs or errors.

**Exit:** Export round-trip and delete tests pass; storage is empty after confirmed deletion.

### 2.4 Select relevant facts for a deterministic draft

- [ ] Implement a deterministic, testable relevance selector using question/job-context terms and source priority.
- [ ] Bound the number and total size of selected facts.
- [ ] Update `FakeProvider` to return a response referencing only supplied fact IDs.
- [ ] Reject unknown evidence IDs before displaying success.

**Exit:** Selecting a question produces a fixture draft tied only to stored, selected facts; unknown evidence IDs fail closed.

### Slice 2 gate

- [ ] Acceptance criteria pass: `AC-011`, `AC-012`, `AC-013`, `AC-014`, `AC-030`, `AC-031`, `AC-057`.
- [ ] Full profile never appears in content-script messages or routine logs.
- [ ] Profile CRUD, export, delete, fact selection, and the Slice 1 flow pass together.
- [ ] Run all canonical checks.

---

## Slice 3 — Real Provider Drafting (Claude Code and Codex)

**Outcome:** The reviewed workflow generates a factual draft through a selectable Claude Code or Codex CLI provider and handles provider failures safely.

**Requirements:** `FR-003`, `FR-005`, `FR-050`, `FR-051`, `FR-052`, `FR-053`, `FR-054`, `FR-070`, `FR-071`, `FR-072`, `FR-073`, `SEC-004`, `SEC-005`, `SEC-008`, `PRIV-005`, `PRIV-006`.

### 3.0 Finish the provider spikes before adapter work

- [ ] Re-run the Claude Code isolation check if the CLI has updated since 2026-11-19, and observe its usage-limit and timeout behavior where it can be done safely.
- [ ] Owner action O1 first: install the Codex CLI and sign in. Then run the `codex exec` spike: confirm `-s read-only`, `--ephemeral`, `--ignore-user-config`, `--skip-git-repo-check`, and `--output-schema`; test whether global instructions or MCP configuration still leak in; decide between an empty working directory and a separate `CODEX_HOME` (PRD D3); record how signed-out, usage-limit, and timeout states appear, including `codex login status`.
- [ ] Record the Codex flags and findings in ADR 0002. If Codex cannot be isolated, mark that adapter unsupported.

**Exit:** ADR 0002 flags match the installed CLIs; the Claude adapter may be built once its check passes, and the Codex adapter only after its spike passes. No adapter code is written before its own check passes.

### 3.1 Implement provider diagnostics and abstraction

- [ ] Finalize the narrow Go `Provider` interface and keep `FakeProvider` for tests.
- [ ] Detect executable presence and classify unauthenticated, unavailable, usage-limit, timeout, cancellation, and generic failures without reading credentials.
- [ ] Return canonical typed errors with one safe user action.
- [ ] Add a settings diagnostic that does not automate login.

**Exit:** Fake-executable tests produce every required provider error deterministically.

### 3.2 Build the isolated prompt and response contract

- [ ] Separate product rules, verified facts, question, job context, and constraints into explicit prompt sections.
- [ ] Label page-derived content as untrusted reference text.
- [ ] Require a strict structure containing `answer`, `evidenceIds`, and `warnings`.
- [ ] Request omission rather than inference when facts are insufficient.
- [ ] Add golden tests for prompt boundaries and injection-like job text.

**Exit:** Prompt tests prove untrusted content cannot become provider configuration and contain only selected facts.

### 3.3 Invoke provider CLIs safely

- [ ] Use `exec.CommandContext` with supported noninteractive mode and stdin.
- [ ] Use a private empty working directory and a controlled environment.
- [ ] Disable tools, MCP servers, hooks, skills, and session persistence using supported CLI configuration for each adapter (flags confirmed by the 3.0 spike).
- [ ] Bound request size, output size, duration, and cancellation.
- [ ] Capture only the output required for parsing; sanitize all errors.

**Exit:** Fake `claude` and `codex` executables verify exact arguments, stdin, environment filtering, timeout, cancellation, and bounded output without a shell.

### 3.4 Validate factual output

- [ ] Strictly parse the provider response.
- [ ] Validate every evidence ID against the selected fact set.
- [ ] Enforce word/character limits and prohibited-question categories.
- [ ] Reject unsupported metrics, dates, employers, titles, or technologies when deterministic validation can identify them.
- [ ] Return warnings without treating them as proof.

**Exit:** Malformed, unsupported, over-limit, and unknown-evidence fixtures fail before the answer reaches the UI.

### 3.5 Integrate the side-panel generation states

- [ ] Replace the production fake provider with the selected adapter (Claude Code or Codex) while preserving dependency injection in tests; add a provider choice to settings with no default, and block drafting until one is chosen.
- [ ] Show generating, cancellation, success, warning, and typed error states.
- [ ] Preserve edited question and context after failure.
- [ ] Disclose provider data transmission and retention boundary before first use.

**Exit:** A manual private test generates one real draft; automated tests remain fully deterministic with fake executables.

### Slice 3 gate

- [ ] Acceptance criteria pass: `AC-003`, `AC-004`, `AC-005`, `AC-032`, `AC-033`, `AC-034`, `AC-035`, `AC-036`, `AC-051`, `AC-053`, `AC-054`, `AC-056`, and manual `AC-061`.
- [ ] The provider cannot access app files, tools, skills, MCP, hooks, or session history through app configuration.
- [ ] No raw prompt/output appears in logs or errors.
- [ ] Run all canonical checks and record the one manual provider test separately.

---

## Slice 4 — Safe Targeting and Insertion

**Prerequisite:** PRD decision D5 (cross-origin iframe handling) must be made first; it depends on owner action O3 in PRD section 22.3. Until then, cross-origin iframe forms use the clipboard fallback.

**Outcome:** Targeting handles ambiguity, staleness, nonempty fields, supported rich editors, and framework rerenders without touching unrelated controls.

**Requirements:** `FR-023`, `FR-030`, `FR-031`, `FR-032`, `FR-033`, `FR-034`, `FR-063`, `FR-064`, `FR-065`, `FR-066`, `FR-067`, `FR-068`, `FR-069`, `FR-074`, `COMP-002`, `COMP-004`.

### 4.1 Reject prohibited question categories

- [ ] Add conservative detection for structured eligibility, demographic, compensation, consent, and legal prompts.
- [ ] Prefer refusal/confirmation over guessing when a prompt is ambiguous.
- [ ] Keep the classification local and deterministic before provider invocation.

**Exit:** Positive and adversarial fixtures prove prohibited prompts never reach the provider.

### 4.2 Add confidence scoring and manual selection

- [ ] Score only recognized fields within a bounded DOM relationship to the selected text.
- [ ] Return `FIELD_NOT_FOUND` or `FIELD_AMBIGUOUS` instead of choosing below threshold.
- [ ] Add a user-initiated **Choose field** mode with visible, temporary, accessible highlighting.
- [ ] Clean up all listeners and highlights on selection, cancellation, navigation, or timeout.

**Exit:** Ambiguous and missing-field fixtures require manual action; no unrelated control is selected.

### 4.3 Support contenteditable and nonempty fields

- [ ] Add an explicit adapter for supported multiline `contenteditable` editors.
- [ ] Keep unsupported custom editors on the fallback path.
- [ ] Detect nonempty content and require a Radix confirmation dialog before replacement.
- [ ] Preserve the old value when confirmation is cancelled or insertion fails.

**Exit:** Contenteditable, nonempty, cancel, and unsupported-editor tests pass.

### 4.4 Verify framework-controlled insertion

- [ ] Use element-specific native setters and events for controlled textareas.
- [ ] Verify the result after observable framework updates rather than fixed sleeps.
- [ ] Invalidate replaced, moved-across-frame, expired, hidden, disabled, or type-changed targets.
- [ ] Ensure retries and regenerated drafts cannot silently revive an invalidated or expired target.
- [ ] Offer user-triggered clipboard copy after safe insertion failure.

**Exit:** React-controlled, rerendered, removed, same-origin iframe, inaccessible-frame, and closed-shadow fixtures pass with expected success or fallback.

### Slice 4 gate

- [ ] Acceptance criteria pass: `AC-022`, `AC-023`, `AC-024`, `AC-042`, `AC-043`, `AC-044`, `AC-046`, `AC-047`.
- [ ] Browser tests prove one-field-only mutation across every fixture.
- [ ] Browser tests prove no click, navigation, selection, upload, save, apply, or submit event occurs.
- [ ] Run all canonical checks.

---

## Slice 5 — Job Context and Refinement

**Outcome:** Drafts use bounded, user-confirmed job context and support safe regeneration, shortening, and directness refinements.

**Requirements:** `FR-040`, `FR-041`, `FR-042`, `FR-043`, `FR-055`, `FR-056`, `UX-001`, `UX-002`, `UX-003`, `UX-004`, `UX-005`, `UX-006`.

### 5.1 Extract bounded job context

- [ ] Implement a deterministic extractor using visible semantic job-description containers and bounded nearby text.
- [ ] Attach a confidence/result source without claiming certainty.
- [ ] Never fall back to full-page scraping.
- [ ] Treat extracted text as untrusted and enforce size limits.

**Exit:** Fixture tests cover confident extraction, ambiguous pages, malicious text, and no-description pages.

### 5.2 Add confirmation and manual editing

- [ ] Show extracted context or an empty paste/edit area in the side panel.
- [ ] Let the user edit, replace, or remove context before generation.
- [ ] Preserve edits across provider errors and regeneration.
- [ ] Do not persist routine job descriptions after the workflow ends.

**Exit:** React tests cover extracted, manual, removed, and error-preserved context.

### 5.3 Add refinement actions

- [ ] Implement Regenerate, Make shorter, and Make more direct as new provider requests.
- [ ] Send the current user-edited draft only when the specific refinement needs it and disclose that behavior in the UI.
- [ ] Apply the same fact, length, injection, and output validation to every refinement.
- [ ] Never insert automatically after refinement.

**Exit:** Each refinement has deterministic provider tests and preserves the explicit Insert boundary.

### 5.4 Complete the focused side-panel UX

- [ ] Enforce the question → context → draft → evidence/warnings → refinements → Insert hierarchy.
- [ ] Distinguish captured, generating, generated, edited, inserted, copied, warning, and error states.
- [ ] Complete keyboard, focus, label, reduced-motion, and WCAG AA checks.
- [ ] Use literal, non-marketing copy without accuracy or detector guarantees.

**Exit:** Component accessibility tests pass and manual keyboard review finds no focus trap or hidden critical state.

### Slice 5 gate

- [ ] Acceptance criteria pass: `AC-037`.
- [ ] Complete primary user flow works with manual or extracted context and real/fake providers.
- [ ] Job context is absent from routine logs and persistence.
- [ ] Run all canonical checks.

---

## Slice 6 — Résumé Import and Profile Completion (optional; may be deferred)

**Outcome:** The user can import PDF/DOCX/pasted résumé text, confirm extraction, and approve atomic verified facts without silently trusting parser or model output.

**Requirements:** `FR-010`, `FR-011`, `FR-014`, `FR-015`, `PRIV-001`, `PRIV-002`, `PRIV-003`, `PRIV-004`, `PRIV-005`, `PRIV-006`, `PRIV-007`.

### 6.1 Run a parser selection spike

- [ ] Create synthetic PDF and DOCX fixtures plus a private, uncommitted manual corpus covering common résumé layouts.
- [ ] Evaluate candidate Go-compatible parsers for text order, bullets, columns, Unicode, licensing, maintenance, binary size, and failure behavior.
- [ ] Require graceful fallback to pasted text.
- [ ] Record the selected parser(s), evidence, and tradeoffs in a new accepted ADR before adding dependencies.

**Exit:** ADR names the chosen parser strategy and documents corpus results; no parser is selected by familiarity alone.

### 6.2 Implement safe extraction

- [ ] Validate file type, size, path handling, and parser resource limits.
- [ ] Extract in the Go helper and return text for confirmation without marking it verified.
- [ ] Reject encrypted, malformed, unsupported, or low-confidence documents with paste fallback.
- [ ] Keep fixtures synthetic and logs free of document content.

**Exit:** PDF, DOCX, malformed, oversized, Unicode, and fallback tests pass.

### 6.3 Convert confirmed text into candidate facts

- [ ] Use deterministic bullet/paragraph segmentation to propose fact cards; do not use a model for initial ingestion.
- [ ] Let the user edit, merge, split, accept, or discard candidates.
- [ ] Assign evidence IDs only after explicit acceptance.
- [ ] Preserve the source type without retaining unnecessary document artifacts.

**Exit:** No extracted sentence becomes a verified fact without user action; accepted facts participate in Slice 3 drafting.

### 6.4 Complete profile lifecycle

- [ ] Ensure export includes the versioned profile and source metadata but not transient drafts/job context.
- [ ] Ensure delete-all removes imported text, facts, stories, samples, rules, and app-created temporary data.
- [ ] Re-run privacy sentinel and permissions tests with imported documents.

**Exit:** Import → confirm → approve facts → draft → export/delete works end to end.

### Slice 6 gate

- [ ] Acceptance criteria pass: `AC-010` (deferred together with this slice if it is deferred).
- [ ] Parser dependency decision is documented and licensed acceptably.
- [ ] Real personal résumé files are never committed or used in automated tests.
- [ ] Run all canonical checks.

---

## Slice 7 — Installer and Setup Diagnostics

**Outcome:** A repeatable user-scoped macOS installation connects Chrome to the Go helper and explains every setup failure.

**Requirements:** `FR-001`, `FR-002`, `FR-003`, `FR-004`.

### 7.1 Build the user-scoped installer

- [ ] Add a Go installer command that accepts and validates the actual unpacked Chrome extension ID.
- [ ] Install the host binary under the app's user-owned Application Support directory.
- [ ] Write the Chrome native-host manifest to the user-scoped NativeMessagingHosts directory with one allowed origin.
- [ ] Make install, repair, and uninstall idempotent.
- [ ] Refuse unsafe paths, invalid extension IDs, or writable-by-others destinations.

**Exit:** Tests run against injected temporary directories and prove exact manifests, permissions, repair, and uninstall behavior.

### 7.2 Add end-user setup diagnostics

- [ ] Show extension version, protocol version, helper connection, helper version, provider executable, and provider readiness as separate checks, per adapter.
- [ ] Provide concise manual next steps without exposing paths or process output unnecessarily.
- [ ] Add a privacy disclosure before the first provider request.
- [ ] Never automate provider login or inspect credential stores.

**Exit:** Each setup failure is reproducible with a fake host/executable and maps to one actionable message.

### 7.3 Package the private build

- [ ] Produce repeatable extension and helper build commands.
- [ ] Document load-unpacked, extension-ID, install, update, repair, and uninstall steps.
- [ ] Exclude user data, test fixtures containing content, temporary files, and credentials from packages.

**Exit:** A clean local install can complete the primary flow and a clean uninstall removes app-owned binaries/manifests without deleting unrelated data.

### Slice 7 gate

- [ ] Acceptance criteria pass: `AC-001`, `AC-002`.
- [ ] Installation and removal are manually verified on macOS.
- [ ] Native host accepts only the installed extension origin.
- [ ] Run all canonical checks.

---

## Slice 8 — Security, Compatibility, and Private Beta

**Outcome:** The private prototype satisfies the PRD acceptance matrix and is ready for controlled personal use, not public distribution.

**Requirements:** `SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-005`, `SEC-006`, `SEC-007`, `SEC-008`, `PRIV-001`, `PRIV-002`, `PRIV-003`, `PRIV-004`, `PRIV-005`, `PRIV-006`, `PRIV-007`, `UX-001`, `UX-002`, `UX-003`, `UX-004`, `UX-005`, `UX-006`, `COMP-001`, `COMP-002`, `COMP-003`, `COMP-004`, `COMP-005`, and all success criteria in the PRD.

### 8.1 Complete abuse and privacy testing

- [ ] Add malicious job-description, HTML-like output, oversized message, unknown origin/frame/type/version, stale response, and sensitive-sentinel suites.
- [ ] Verify no profile, prompt, answer, question, job context, field value, clipboard content, or credential appears in logs/errors.
- [ ] Verify provider isolation and absence of shell/tool/MCP/hook/skill/session access.
- [ ] Review Chrome permissions and remove any permission without a demonstrated requirement.

**Exit:** Security/privacy suite passes and remaining risks are documented rather than hidden.

### 8.2 Run the fixture acceptance matrix

- [ ] Cover standard textarea, controlled textarea, contenteditable, nonempty, ambiguous, removed, rerendered, same-origin iframe, inaccessible frame, closed shadow root, unsupported editor, and denied domain.
- [ ] Assert exactly one intended field changes on every success case.
- [ ] Assert no navigation/submission-related event occurs on every case.
- [ ] Assert every failure produces the documented safe fallback.

**Exit:** `04-done-criteria.md` is fully traceable to automated or explicitly manual evidence.

### 8.3 Run private ATS compatibility checks

- [ ] Test representative Greenhouse, Lever, Workday, Ashby, and custom career pages manually without submitting applications.
- [ ] Record editor type, targeting result, insertion result, fallback, and date; do not retain application content or screenshots by default.
- [ ] Treat failures as compatibility data, not justification for broader permissions or form-wide automation.
- [ ] Recheck current site/employer terms before enabling a domain in personal use.

**Exit:** Compatibility matrix identifies supported patterns and known fallbacks without claiming universal ATS support.

### 8.4 Conduct the private release review

- [ ] Run every canonical check from a clean checkout/build environment.
- [ ] Review the diff against all permanent invariants.
- [ ] Verify export, delete-all, installation, repair, and uninstall manually.
- [ ] Document known limitations and the public-distribution gate.
- [ ] Mark the prototype ready only if no critical security, privacy, factuality, or one-field invariant defect remains.

**Exit:** Private release checklist is signed off with evidence; the build remains explicitly non-public.

### Slice 8 gate

- [ ] Acceptance criteria pass: `AC-055`, manual `AC-060`, and the full `AC-001` to `AC-061` set is passing or explicitly deferred by an approved decision.
- [ ] All PRD requirements are implemented, deferred by an approved decision, or documented as a release blocker.
- [ ] All automated checks pass.
- [ ] Manual private acceptance succeeds without a real application submission.

---

## Requirement Traceability

| Requirement group                          | Primary slice                                  |
| ------------------------------------------ | ---------------------------------------------- |
| `FR-001`–`FR-004` installation/diagnostics | Slice 7 (extension key pinned in Slice 0)      |
| `FR-005` provider selection                | Slice 3                                        |
| `FR-010`–`FR-011` document import          | Slice 6                                        |
| `FR-012`–`FR-016` profile                  | Slice 2; import completion in Slice 6          |
| `FR-020`–`FR-022` capture                  | Slice 1                                        |
| `FR-023` prohibited prompts                | Slice 4                                        |
| `FR-030`–`FR-032` basic targeting          | Slice 1                                        |
| `FR-033`–`FR-034` ambiguity/staleness      | Slice 4                                        |
| `FR-040`–`FR-043` job context              | Slice 5                                        |
| `FR-050`–`FR-054` generation               | Slice 3                                        |
| `FR-055`–`FR-056` refinements              | Slice 5                                        |
| `FR-060`–`FR-063` review/approval          | Slice 1                                        |
| `FR-064`–`FR-069` safe insertion           | Slice 4; baseline in Slice 1                   |
| `FR-070`–`FR-074` errors/recovery          | Slices 1–5; final audit in Slice 8             |
| `SEC-001`–`SEC-008`                        | Built into every slice; final audit in Slice 8 |
| `PRIV-001`–`PRIV-007`                      | Slices 2, 3, and 6; final audit in Slice 8     |
| `UX-001`–`UX-006`                          | Applied throughout; completion in Slice 5      |
| `COMP-001`–`COMP-005`                      | Slices 0, 4, and 8                             |

## Acceptance-criteria traceability

Every criterion in `06-prd.md` section 21 is gated in exactly one slice.

| Slice | Criteria                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `AC-052`                                                                                                                         |
| 1     | `AC-020`, `AC-021`, `AC-040`, `AC-041`, `AC-045`, `AC-050`                                                                       |
| 2     | `AC-011`, `AC-012`, `AC-013`, `AC-014`, `AC-030`, `AC-031`, `AC-057`                                                             |
| 3     | `AC-003`, `AC-004`, `AC-005`, `AC-032`, `AC-033`, `AC-034`, `AC-035`, `AC-036`, `AC-051`, `AC-053`, `AC-054`, `AC-056`, `AC-061` |
| 4     | `AC-022`, `AC-023`, `AC-024`, `AC-042`, `AC-043`, `AC-044`, `AC-046`, `AC-047`                                                   |
| 5     | `AC-037`                                                                                                                         |
| 6     | `AC-010`                                                                                                                         |
| 7     | `AC-001`, `AC-002`                                                                                                               |
| 8     | `AC-055`, `AC-060`                                                                                                               |

## Intentionally deferred beyond this plan

- Public Chrome Web Store distribution.
- Any provider model not approved through a new decision record.
- Firefox, Edge, Windows, or Linux support.
- Cloud sync, user accounts, telemetry, or analytics.
- Whole-application automation or submission.
- Humanizer skill integration or detector-evasion claims.
