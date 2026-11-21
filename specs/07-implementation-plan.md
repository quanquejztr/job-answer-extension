# Actionable Implementation Plan

- Status: Not started
- Planning model: Modified vertical slices for LLM-assisted coding
- Source of truth: `06-prd.md`, `03-architecture.md`, and `05-contracts-and-invariants.md`
- Profile pivot: [ADR 0003](decisions/0003-resume-and-stories-profile.md) (2026-11-20) replaced facts, keyword fact selection, and evidence IDs with a résumé text, stories, whole-profile drafting, and quote grounding. Steps 2.1 to 2.4 below were delivered for facts and are superseded by Slice 2B; the docs describe the target and the code catches up in Slice 2B.
- Last updated: 2026-11-20 (profile pivot: ADR 0003 adds Slice 2B and supersedes the fact parts of Slice 2 and old Slice 6)

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

**Outcome (as delivered):** The user can manage verified facts, stories, writing samples, and rules locally; deterministic drafts use selected facts.

**Superseded in part (ADR 0003, 2026-11-20):** the fact data model, fact settings UI, keyword selector, and `FakeProvider` fact logic delivered by steps 2.1 to 2.4 are replaced by [Slice 2B](#slice-2b--résumé-and-stories-profile). Export, delete-all, the atomic store, locking, and the typed worker plumbing stay. The completion notes below are history of what was delivered.

**Requirements:** `FR-012`, `FR-013`, `FR-015`, `FR-016`, `PRIV-001`, `PRIV-002`, `PRIV-003`, `PRIV-004`, `PRIV-007` (`FR-014` and `PRIV-005`, `PRIV-008` move to Slice 2B).

### 2.1 Define and store the profile (delivered for facts; the fact model is superseded by step 2B.1)

- [x] Define a versioned profile schema containing verified facts, stories, writing samples, and writing rules.
- [x] Assign stable opaque IDs to verified facts; do not reuse deleted IDs.
- [x] Implement owner-only application directories and atomic Go writes.
- [x] Reject malformed, oversized, unknown-version, and symlink-unsafe storage input.
- [x] Add migration hooks that currently support only the initial version explicitly.

**Exit:** Go tests cover CRUD, permissions, atomic failure, invalid data, and version rejection.

Passed 2026-11-20: 111 profile test results under `-race`, plus the shared limits sync tests. Carry-over for step 2.2: apply a deadline around mutations (the file lock waits without a timeout) and map store errors to `STORAGE_ERROR`; carry-over for step 2.3: delete-all must also remove `.profile.lock` and leftover temp files.

### 2.2 Build manual profile settings (delivered; the Facts tab and accuracy tick are superseded by step 2B.2)

- [x] Add settings views for creating, editing, verifying, and deleting facts and stories.
- [x] Add writing-sample and explicit-rule editors, including maximum word/character rules.
- [x] Route all sensitive operations through the typed native client.
- [x] Show that profile data stays local and explain what a later draft may send to the selected provider.

**Exit:** React tests cover CRUD, validation, keyboard access, destructive confirmation, and error recovery.

Automated checks passed 2026-11-20 (852 unit tests, 50 e2e tests, Go tests with `-race`). Manual acceptance in the owner's real Chrome on 2026-11-20 covered the options page loading, adding a fact (including the required accuracy tick), persistence across reload, and edit and delete; the remaining manual items (story link cascade, sensitive-text warning, sample and rule limits, Privacy tab, helper-unavailable recovery) are covered by the automated e2e tests and were not run by hand.

### 2.3 Add export and delete-all-data

- [x] Export an explicit versioned user-data file after user action.
- [x] Implement confirmed delete-all for app-owned profile and temporary data.
- [x] Do not claim deletion from Chrome, the provider, employer sites, backups, or macOS.
- [x] Add sentinel tests proving profile content does not appear in logs or errors.

**Exit:** Export round-trip and delete tests pass; storage is empty after confirmed deletion.

Automated checks passed 2026-11-20 (923 unit tests, 52 e2e tests, Go tests with `-race`). "Storage is empty" means no profile data remains; the empty `.profile.lock` and `bin/` stay. Manual acceptance in the owner's real Chrome passed on 2026-11-20: export downloaded a file matching the stored data, delete-all required typing `DELETE`, lists were empty after reload, and `profile.json` was removed while `bin/` and the lock file remained.

### 2.4 Select relevant facts for a deterministic draft (delivered, then superseded by step 2B.3)

- [x] Implement a deterministic, testable relevance selector using question/job-context terms and source priority.
- [x] Bound the number and total size of selected facts.
- [x] Update `FakeProvider` to return a response referencing only supplied fact IDs.
- [x] Reject unknown evidence IDs before displaying success.

**Exit:** Selecting a question produces a fixture draft tied only to stored, selected facts; unknown evidence IDs fail closed.

Automated checks passed 2026-11-20 (965 unit tests, 55 e2e tests, Go tests with `-race`). Manual acceptance of this step was pending when the owner pivoted the design (ADR 0003): the selector, `FakeProvider` fact logic, and "Facts used" panel are replaced by step 2B.3, so this manual acceptance is dropped and the Slice 2B manual check replaces it.

### Slice 2 gate

- [ ] Acceptance criteria pass: `AC-013`, `AC-014` (`AC-011`, `AC-012`, `AC-030`, `AC-031`, and `AC-057` are re-written for the new profile and gated in Slice 2B).
- [ ] Full profile never appears in content-script messages or routine logs.
- [ ] Profile CRUD, export, delete, and the Slice 1 flow pass together (the fact-selection item is replaced by Slice 2B).
- [ ] Run all canonical checks.

The Slice 2 gate closes together with the Slice 2B gate, because 2B rewrites the profile code that the gate exercises.

---

## Slice 2B — Résumé and Stories Profile

**Outcome:** The user keeps one reviewed résumé text plus stories, samples, and rules; every draft sends the whole profile to the provider; the helper verifies that each draft is supported by exact quotes from the résumé or a story and by the numbers in the user's text. PDF and DOCX résumé upload is added after pasted text works (this slice absorbs old Slice 6).

**Source:** [ADR 0003](decisions/0003-resume-and-stories-profile.md) and PRD decisions D8 to D10.

**Requirements:** `FR-010`, `FR-011`, `FR-012`, `FR-013`, `FR-014`, `FR-016`, `FR-050`, `FR-052`, `FR-053`, `PRIV-004`, `PRIV-005`, `PRIV-006`, `PRIV-008`, `SEC-001`.

**Replaces:** the fact model and fact UI (2.1 to 2.3), and the selector, `FakeProvider` fact logic, and `internal/facts` (2.4). Existing `schemaVersion` 1 test data is discarded.

### 2B.1 Profile v2 store

- [ ] Change the profile to `schemaVersion` 2: `resume: { text, source, updatedAt } | null`, `stories` (`id`, `title`, `text`, timestamps), `samples`, `rules`; remove facts, tags, and story-to-fact links.
- [ ] Reject version 1 files as unsupported (`STORAGE_ERROR`) with no migration and without rewriting them; delete-all still clears them.
- [ ] Enforce the limits in PRD 15.1: résumé 15,000 code points; story title 100 and text 3,000, at most 30 stories; samples and rules as before; total profile content at most 40,000 code points, counting the new text instead of the replaced text. Reject an over-cap save with `INVALID_REQUEST` and a clear message and write nothing.
- [ ] Keep IDs for stories, samples, and rules monotonic and never reused; keep atomic writes, locking, and permission checks.
- [ ] Update the limits in `extension/lib/constants/limits.ts`, `helper/internal/limits/limits.go`, and `tests/protocol-fixtures/limits.json` together; remove the per-fact limits and the selection caps.
- [ ] Add `profile.resume.set` to the protocol (both runtimes) and change the `profile.item.upsert` kinds to `story`, `sample`, `rule`; remove the old `profile.import.text` message.

**Context:** `06-prd.md` sections 15.1, 16.1, 17.2; `rules/30-go-helper.md`, `rules/51-privacy-data.md`, `rules/60-testing.md`.

**Exit:** Go and TypeScript tests cover the v2 round trip, v1 rejection, every limit and the 40,000 total (at, under, and over the cap), ID non-reuse, and an unchanged file after a rejected save (`AC-011`, `AC-012`).

### 2B.2 Protocol, worker, and settings UI

- [ ] Add the settings Résumé tab: a large editable text box with a code-point counter against 15,000, paste, and a Save button; nothing is saved until Save.
- [ ] Add the Stories tab (title and text); keep the samples and rules editors; remove the Facts tab and the accuracy tick.
- [ ] Update the Privacy text and the first-use disclosure to the PRD 18.1 wording (whole résumé, all stories, all samples, enabled rules; contact-detail advice).
- [ ] Apply the PRIV-008 sensitive-text warning (email, phone, street-address patterns) to the résumé, stories, and samples, as a warning with Save anyway (decision D10).
- [ ] Replace `panel.factCount.get` with `panel.profileStatus.get` returning only `{ hasResume, storyCount }`; add `settings.profile.resume.set`.
- [ ] Show "Add your résumé in the extension's settings before drafting." and disable Generate draft when no résumé is saved (`AC-062`).

**Context:** `06-prd.md` sections 17.1, 18, 18.1; `rules/20-frontend-extension.md`, `rules/40-design-style.md`, `rules/60-testing.md`.

**Exit:** React tests cover résumé save, counter, over-cap and over-limit errors, stories CRUD, the warning with Save anyway, the no-résumé hint and disabled button, keyboard access, and error recovery; e2e covers the settings flows and the panel hint.

### 2B.3 Grounded fake-provider pipeline

- [x] The helper loads the whole profile, re-checks the 40,000 total, and passes the question, bounded job context, constraints, and the whole profile content to the provider; a draft with no résumé text returns `INVALID_REQUEST`.
- [x] Change `DraftResponse` to `{ answer, evidence: [{ source, quote }], warnings }` in both runtimes and the protocol fixtures; remove `usedFacts` and `evidenceIds`.
- [x] Update `FakeProvider` to return an answer with evidence quotes taken from the supplied résumé and stories.
- [x] Implement quote verification in `internal/validate`: `source` is `resume` or `story:<id>`; the quote is an exact, case-sensitive excerpt of that source after collapsing whitespace, 12 to 300 code points; at least one valid quote; any invalid quote fails with `FACT_VALIDATION_FAILED` and no answer (`AC-031`, `AC-063`).
- [x] Implement the answer checks: a number, year, percentage, or amount not in the résumé, stories, question, or job context fails with `FACT_VALIDATION_FAILED`; an unsupported capitalized multi-word name adds an `UNSUPPORTED_CLAIM` warning (`AC-032`).
- [x] Return the verified evidence list and show "Evidence: N quotes" with the quotes in the side panel in place of "Facts used".
- [x] Change the `FACT_VALIDATION_FAILED` entry in `tests/protocol-fixtures/errors.json` (message "The draft was not supported by your résumé and stories.", user action "Regenerate, or add the missing detail to your résumé or stories") and the TypeScript and Go tables.
- [x] Remove `helper/internal/facts/` and all selector code, fact fixtures, and fact tests.
- [x] Remove the unused `LOW_FACT_SUPPORT` warning code from the schemas, Go types, and fixtures (nothing produces it; PRD 16.2 and specs/05 already omit it).
- [x] Prove a maximum-size profile is sent whole and never exceeds 40,000 code points of profile content (`AC-030`).

**Context:** `05-contracts-and-invariants.md`, `06-prd.md` sections 15.2, 16.2, 17.2, 17.3; `rules/30-go-helper.md`, `rules/50-security.md`, `rules/51-privacy-data.md`, `rules/52-provider.md`.

**Exit:** Fake-provider tests cover the success path with evidence and the failures (unknown source, non-excerpt quote, wrong quote length, writing-sample source, zero quotes, unsupported number, unsupported name warning, empty and over-limit answers, no résumé); no answer reaches the panel on any failure.

Automated checks passed 2026-11-20 (Go tests with `-race`, Vitest, and e2e through the real helper with the fake provider). Manual acceptance is in `08-manual-test-checklist.md`, section "2B.3".

### 2B.4 Résumé import (PDF spike, DOCX, review step)

- [x] PDF approach decided (PRD D9): the owner decided on 2026-11-21 to use pdf.js 6.2.108 in the extension page instead of running a separate spike on a real PDF; text order, bullets, columns, and Unicode are checked by synthetic PDFs in tests and by the owner's own PDF in the manual checklist (2B.4b).
- [x] Record the decision, evidence, and tradeoffs in a new accepted ADR before any dependency is added. (`specs/decisions/0004-pdf-resume-parsing.md`, Accepted, owner-approved 2026-11-21.)
- [x] Implement DOCX text extraction with the Go standard library only, with file type, size, and resource limits and no use of file names as paths. (`helper/internal/importer`; done.)
- [x] Upload transport (done for DOCX): `profile.import.document` `{ bytesBase64 }`, 190 KiB file limit inside the 256 KiB native request, settings Résumé tab file picker with the paste fallback.
- [x] Implement the PDF path: pdf.js text extraction in the settings page (lazy-loaded, bundled worker, scripting and WASM off), text assembly, limits (5 MiB, 10 pages, 60,000 code points, 20 s), refusals with the paste fallback, source rule (`pdf`). Dependency added with the owner's explicit approval; `npm audit` clean on 2026-11-21.
- [x] Always show extracted text in the editable résumé box; nothing is saved until Save (`AC-010`). Reject encrypted, malformed, unsupported, or oversized documents with the paste fallback. (Done for DOCX and PDF.)
- [x] Use synthetic DOCX fixtures only in automated tests (done for DOCX; synthetic PDFs are generated in test code by `tests/support/make-pdf.ts`); evaluate the owner's real résumé only manually and locally, and never commit, log, or test with it.
- [x] Re-run the privacy sentinel and permissions tests with imported documents; export and delete-all must cover the saved résumé. (Done for DOCX and PDF.)

**Context:** `06-prd.md` sections 7.2, 15.1, 17.2, 22.2; `rules/30-go-helper.md`, `rules/50-security.md`, `rules/51-privacy-data.md`.

**Status (done, automated):** DOCX and PDF import, UI, tests, ADR 0004, and the manual checklist sections (2B.4 and 2B.4b) are finished. Pending: the owner's manual PDF check (O5, checklist 2B.4b). Maintenance note: `pdfjs-dist` is pinned exactly; on any update run `npm audit`, read the pdf.js security advisories, rerun the PDF unit and e2e tests, and record the new version in ADR 0004.

**Exit:** An accepted ADR names the PDF approach (or records that PDF is deferred); DOCX, malformed, oversized, Unicode, and fallback tests pass; the review-and-edit flow works with pasted, DOCX, and PDF input.

### Slice 2B gate

- [ ] Acceptance criteria pass: `AC-010`, `AC-011`, `AC-012`, `AC-030`, `AC-031`, `AC-032`, `AC-057`, `AC-062`, `AC-063`.
- [ ] The Slice 2 gate (`AC-013`, `AC-014`, no profile data in content-script messages or logs) passes against the v2 profile.
- [ ] No fact, selector, `evidenceIds`, or `usedFacts` code, fixtures, or tests remain.
- [x] The ADR for the PDF approach is accepted and the dependency is licensed acceptably (ADR 0004; pdf.js is Apache-2.0).
- [ ] Real personal résumé files are never committed, logged, or used in automated tests.
- [ ] Manual check in the owner's real Chrome: save a résumé, add a story, draft with the fake provider, and see the evidence quotes.
- [ ] Run all canonical checks (and `npm run test:e2e`, since the extension messages changed).

---

## Slice 3 — Real Provider Drafting (Claude Code and Codex)

**Outcome:** The reviewed workflow generates a factual draft through a selectable Claude Code or Codex CLI provider and handles provider failures safely.

**Requirements:** `FR-003`, `FR-005`, `FR-050`, `FR-051`, `FR-052`, `FR-053`, `FR-054`, `FR-070`, `FR-071`, `FR-072`, `FR-073`, `SEC-004`, `SEC-005`, `SEC-008`, `PRIV-005`, `PRIV-006`.

### 3.0 Finish the provider spikes before adapter work

- [x] Re-run the Claude Code isolation check if the CLI has updated since 2026-11-19, and observe its usage-limit and timeout behavior where it can be done safely. (2026-11-20: version unchanged at 2.1.328, no re-run needed; the usage-limit and timeout signatures cannot be observed without burning limits, so the fallback rule stands. See ADR 0002.)
- [ ] Owner action O1 first: install the Codex CLI and sign in. Then run the `codex exec` spike: confirm `-s read-only`, `--ephemeral`, `--ignore-user-config`, `--skip-git-repo-check`, and `--output-schema`; test whether global instructions or MCP configuration still leak in; decide between an empty working directory and a separate `CODEX_HOME` (PRD D3); record how signed-out, usage-limit, and timeout states appear, including `codex login status`.
- [ ] Record the Codex flags and findings in ADR 0002. If Codex cannot be isolated, mark that adapter unsupported.

**Exit:** ADR 0002 flags match the installed CLIs; the Claude adapter may be built once its check passes, and the Codex adapter only after its spike passes. No adapter code is written before its own check passes.

### 3.1 Implement provider diagnostics and abstraction

- [x] Finalize the narrow Go `Provider` interface and keep `FakeProvider` for tests.
- [x] Detect executable presence and classify unauthenticated, unavailable, usage-limit, timeout, cancellation, and generic failures without reading credentials.
- [x] Return canonical typed errors with one safe user action.
- [x] Add a settings diagnostic that does not automate login.

**Exit:** Fake-executable tests produce every required provider error deterministically. (Claude only; the Codex adapter is an unsupported stub until the owner installs Codex.)

### 3.2 Build the isolated prompt and response contract

- [x] Separate product rules, the whole profile (résumé, stories, samples, rules, each in its own labeled section), question, job context, and constraints into explicit prompt sections.
- [x] Label page-derived content (job description, selected text) as untrusted reference text.
- [x] Require a strict structure containing `answer`, `evidence` (`source` and `quote`), and `warnings`; tell the model that writing samples and rules are style guidance and never evidence.
- [x] Request omission rather than inference when the résumé and stories are insufficient.
- [x] Add golden tests for prompt boundaries and injection-like job text.

**Exit:** Prompt tests prove untrusted content cannot become provider configuration and that the prompt contains only the question, bounded job context, the profile content within the 40,000 code-point cap, and constraints.

### 3.3 Invoke provider CLIs safely

- [x] Use `exec.CommandContext` with supported noninteractive mode and stdin.
- [x] Use a private empty working directory and a controlled environment.
- [x] Disable tools, MCP servers, hooks, skills, and session persistence using supported CLI configuration for each adapter (flags confirmed by the 3.0 spike).
- [x] Bound request size, output size, duration, and cancellation.
- [x] Capture only the output required for parsing; sanitize all errors.

**Exit:** Fake `claude` and `codex` executables verify exact arguments, stdin, environment filtering, timeout, cancellation, and bounded output without a shell.

### 3.4 Validate factual output

- [x] Strictly parse the provider response.
- [x] Reuse the helper's quote and number checks from step 2B.3 (every evidence quote an exact excerpt of the résumé or a cited story, at least one valid quote, numbers, years, percentages, and amounts present in the user's text, the question, or the job context) on real provider output; do not add a second validator.
- [x] Enforce word/character limits. (Prohibited-question categories are not enforced here: PRD 15.2 runs that detection locally in the extension before any request, and plan step 4.1 builds it. Until 4.1, nothing blocks a prohibited question from reaching the provider.)
- [x] Warn about unsupported capitalized names without treating the warning as proof.
- [x] Return warnings without treating them as proof.

**Exit:** Malformed, unsupported, over-limit, and invalid-quote fixtures fail before the answer reaches the UI. (Done 2026-11-20: host tests run the real `claude.Provider` over a fake executable for every bad output.)

### 3.5 Integrate the side-panel generation states

- [x] Replace the production fake provider with the selected adapter (Claude Code or Codex) while preserving dependency injection in tests; add a provider choice to settings with no default, and block drafting until one is chosen.
- [x] Show generating, cancellation, success, warning, and typed error states.
- [x] Preserve edited question and context after failure.
- [x] Disclose provider data transmission and retention boundary before first use.

**Exit:** A manual private test generates one real draft (owner action, `specs/08-manual-test-checklist.md` section "3.4/3.5 — real drafting with Claude"; AC-061 stays open until then); automated tests remain fully deterministic with fake executables. (Code and automated tests done 2026-11-20.)

### Slice 3 gate

- [ ] Acceptance criteria pass: `AC-003`, `AC-004`, `AC-005`, `AC-033`, `AC-034`, `AC-035`, `AC-036`, `AC-051`, `AC-053`, `AC-054`, `AC-056`, and manual `AC-061` (`AC-032` is gated in Slice 2B and re-exercised through the shared validator here).
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
- [ ] Apply the same grounding (quote and number), length, injection, and output validation to every refinement.
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

## Slice 6 — Résumé Import and Profile Completion (merged into Slice 2B)

**Status:** Merged into [Slice 2B](#slice-2b--résumé-and-stories-profile) step 2B.4 by ADR 0003 on 2026-11-20. Do no separate work here.

- Old 6.1 (parser selection spike and ADR) and 6.2 (safe extraction) are step 2B.4, with the decision recorded as PRD D9.
- Old 6.3 (convert confirmed text into candidate facts) is removed: there are no facts, and the résumé is one reviewed text.
- Old 6.4 (export and delete-all with imported content) is covered by step 2B.4 and the existing export and delete-all.
- `AC-010` is gated in Slice 2B. Old requirements `FR-010`, `FR-011` move to Slice 2B; `FR-014` is rewritten as résumé review and save.

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

| Requirement group                          | Primary slice                                                  |
| ------------------------------------------ | -------------------------------------------------------------- |
| `FR-001`–`FR-004` installation/diagnostics | Slice 7 (extension key pinned in Slice 0)                      |
| `FR-005` provider selection                | Slice 3                                                        |
| `FR-010`–`FR-011` résumé input and review  | Slice 2B (paste first, DOCX and PDF in 2B.4)                   |
| `FR-012`–`FR-016` profile                  | Slice 2 (export, delete); Slice 2B (résumé, stories, `FR-014`) |
| `FR-020`–`FR-022` capture                  | Slice 1                                                        |
| `FR-023` prohibited prompts                | Slice 4                                                        |
| `FR-030`–`FR-032` basic targeting          | Slice 1                                                        |
| `FR-033`–`FR-034` ambiguity/staleness      | Slice 4                                                        |
| `FR-040`–`FR-043` job context              | Slice 5                                                        |
| `FR-050`–`FR-054` generation               | Slice 3; whole-profile prompt and grounding in Slice 2B        |
| `FR-055`–`FR-056` refinements              | Slice 5                                                        |
| `FR-060`–`FR-063` review/approval          | Slice 1                                                        |
| `FR-064`–`FR-069` safe insertion           | Slice 4; baseline in Slice 1                                   |
| `FR-070`–`FR-074` errors/recovery          | Slices 1–5; final audit in Slice 8                             |
| `SEC-001`–`SEC-008`                        | Built into every slice; final audit in Slice 8                 |
| `PRIV-001`–`PRIV-008`                      | Slices 2, 2B, and 3; final audit in Slice 8                    |
| `UX-001`–`UX-006`                          | Applied throughout; completion in Slice 5                      |
| `COMP-001`–`COMP-005`                      | Slices 0, 4, and 8                                             |

## Acceptance-criteria traceability

Every criterion in `06-prd.md` section 21 is gated in exactly one slice.

| Slice | Criteria                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 0     | `AC-052`                                                                                                               |
| 1     | `AC-020`, `AC-021`, `AC-040`, `AC-041`, `AC-045`, `AC-050`                                                             |
| 2     | `AC-013`, `AC-014`                                                                                                     |
| 2B    | `AC-010`, `AC-011`, `AC-012`, `AC-030`, `AC-031`, `AC-032`, `AC-057`, `AC-062`, `AC-063`                               |
| 3     | `AC-003`, `AC-004`, `AC-005`, `AC-033`, `AC-034`, `AC-035`, `AC-036`, `AC-051`, `AC-053`, `AC-054`, `AC-056`, `AC-061` |
| 4     | `AC-022`, `AC-023`, `AC-024`, `AC-042`, `AC-043`, `AC-044`, `AC-046`, `AC-047`                                         |
| 5     | `AC-037`                                                                                                               |
| 6     | none (merged into Slice 2B)                                                                                            |
| 7     | `AC-001`, `AC-002`                                                                                                     |
| 8     | `AC-055`, `AC-060`                                                                                                     |

## Intentionally deferred beyond this plan

- Public Chrome Web Store distribution.
- Any provider model not approved through a new decision record.
- Firefox, Edge, Windows, or Linux support.
- Cloud sync, user accounts, telemetry, or analytics.
- Whole-application automation or submission.
- Humanizer skill integration or detector-evasion claims.
