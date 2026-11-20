# Agent Instructions

A personal macOS Chrome extension that drafts one answer for one selected free-response job-application question, which the user reviews and then inserts into one field. A Go native helper owns the profile and runs the user's `claude` or `codex` CLI. Private prototype; not for distribution.

## 1. Exact shell commands

Run from the repo root. Use Node 26 (`nvm use` reads `.nvmrc`) and Go 1.27.

```bash
npm install                 # also runs `wxt prepare` (postinstall)
npx wxt                     # dev server with Chrome launch/reload (there is no `dev` script)
npm run build               # production build into .output/chrome-mv3/
npm run lint                # eslint . && prettier --check .
npm run format              # prettier --write .
npm run typecheck           # wxt prepare && tsc --noEmit
npm test                    # vitest run (extension/**/*.test.ts[x] only)
npm run test:e2e            # rebuilds, then Playwright against local fixtures (see section 5)
npm run go:fmt              # fails if gofmt would change anything
npm run go:vet
npm run go:test
npm run check               # everything above except e2e; run before finishing any task
```

Single-test syntax, so you do not run the whole suite:

```bash
npx vitest run extension/lib/constants/limits.test.ts            # one file
npx vitest run extension/lib/targeting -t "ambiguous"            # folder + test name
cd helper && go test ./internal/limits -run TestLimits -v        # one Go package/test
npx playwright test tests/e2e/insert.spec.ts -g "nonempty"       # one e2e spec/test
```

`cd helper && gofmt -w .` rewrites Go files; `npm run go:fmt` only checks.

## 2. Codebase map and module boundaries

```text
extension/entrypoints/   background.ts (service worker), content.ts, sidepanel/, options/
extension/lib/           domain logic with no React and no direct Chrome calls where avoidable:
                         constants/ messaging/ native/ domain/ question/ targeting/
                         jobcontext/ insertion/ draft/
extension/schemas/       Zod schemas for every runtime boundary
extension/components/    presentational React components
extension/assets/        global CSS and Tailwind tokens (outside entrypoints/ on purpose)
helper/cmd/host/         thin native-messaging main;  helper/cmd/installer/  thin installer main
helper/internal/         protocol/ limits/ profile/ facts/ prompt/ validate/
                         provider/{fake,claude,codex}/ importer/ install/
installer/templates/     native-host manifest templates
tests/                   fixtures/ (local HTML), e2e/ (Playwright), protocol-fixtures/ (shared JSON)
specs/  rules/           source of truth; see section 7
```

Dependency direction:

- `components/` use typed clients in `lib/`; they never call `chrome.*` or native messaging directly.
- The content script never imports profile, provider, or native-messaging code and never receives profile data. It gets only bounded page context out and the final approved answer in.
- Only the service worker talks to the native helper. Side panel and settings go through it via typed clients.
- Go: `protocol/` imports no provider or profile code. Providers never write to fields or control Chrome. The installer never reads profile data or provider credentials. `cmd/*` stays thin; behavior lives in `internal/`.
- The limits in `extension/lib/constants/limits.ts` and `helper/internal/limits/limits.go` must match `tests/protocol-fixtures/limits.json`. Change all three together.

## 3. Code style and naming (beyond what the linter enforces)

- Files in `lib/` and `schemas/`: `kebab-case.ts`. React components: `PascalCase.tsx`. Tests sit next to the code: `name.test.ts(x)`, `name_test.go`.
- Parse unknown data with Zod at every boundary; never cast. Return typed `AppError` codes from `specs/05-contracts-and-invariants.md`; never throw strings or booleans for failures.

```ts
const parsed = DraftRequestSchema.safeParse(message.payload);
if (!parsed.success) return fail('INVALID_REQUEST'); // no payload text in the error
```

- Render question, job context, warnings, and model output as text only. No `innerHTML`, no `dangerouslySetInnerHTML`.
- Go: wrap errors with context but never with payload content; protocol on stdout only, sanitized diagnostics on stderr only.

```go
if err := validate(req); err != nil {
    return fmt.Errorf("validate draft request: %w", err) // never include req fields
}
```

- Logs carry event names, error codes, versions, and durations only; never résumé text, facts, questions, job text, prompts, drafts, field values, or credentials.
- No sleep-based waits; wait on an observable event or state with a bounded timeout.

## 4. Testing and verification rules

- Unit and component tests: Vitest and React Testing Library, next to the code. Go: standard `testing`, table-driven where inputs vary.
- Browser behavior (targeting, insertion, no-submit guarantees) needs a Playwright test against a local fixture in `tests/fixtures/`. A jsdom test does not replace it.
- Mock the providers with fake `claude` and `codex` executables built from `helper/**/testdata/`; never call a real provider, a real employer page, or any network service in automated tests.
- Protocol and limit changes update `tests/protocol-fixtures/` and both the TypeScript and Go tests.
- Every behavior change needs tests for the success path and the relevant failure paths (ambiguity, staleness, malformed input, size limits, cancellation). Each fix gets a test that fails without it.
- Acceptance criteria are `AC-001` to `AC-061` in `specs/06-prd.md` section 21; each is gated in one slice in `specs/07-implementation-plan.md`.
- A task is finished only when `npm run check` passes (plus `npm run test:e2e` when targeting, insertion, or the extension manifest changed). If a check cannot run, say which one and why; do not claim completion.
- Completion report: files changed, behavior, tests added, commands and results, security and privacy effects, spec or PRD changes ("PRD updated: yes/no"), known limitations.

## 5. Environment and external services

- There is no database, no hosted backend, no product-side local HTTP server (the only server is the test-only fixture server below), no `.env` file, and no API keys. There are no migrations or seed scripts. Do not add any.
- Toolchain: Node 26 (`nvm use`), npm, Go 1.27 from Homebrew.
- Providers are the user's own `claude` and `codex` CLIs, installed and signed in by the user. Authentication belongs to the CLI; do not read its files. Confirmed invocation flags live in `specs/decisions/0002-subscription-cli-providers.md` after the Slice 0.4 spike; do not guess flags.
- Playwright's bundled Chromium is installed (`npx playwright install chromium`, already done). Ask before installing any other browser. `npm run test:e2e` rebuilds the extension, starts the test-only static fixture server (`tests/fixtures/serve.mjs`, `127.0.0.1:4310`, so that port must be free), and loads `.output/chrome-mv3` in headless Chromium (`--headless=new`; Playwright's own headless shell cannot load extensions). Never point it at real sites.
- The profile (résumé facts, stories, samples) lives in an owner-only directory under `~/Library/Application Support/`, outside this repo, owned by the Go helper. The native-host manifest goes under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` and allows only the pinned extension origin. Neither exists yet.
- This repo is in iCloud Drive. Never put real personal data, résumés, or profile files in it.

## 6. Hard boundaries (never do)

- Never fill a whole application, more than one field per action, structured eligibility, demographic, compensation, consent, or legal questions, or file, select, radio, or checkbox fields. Never click Next, Continue, Save, Apply, or Submit.
- Never insert without a visible review and an explicit Insert action; never overwrite a nonempty field without confirmation.
- Never run on LinkedIn or Indeed, and never automate the claude.ai or chatgpt.com web interfaces.
- Never read, copy, store, log, or transmit provider credentials, session tokens, browser cookies, or keychain entries (including `~/.claude` and `~/.codex`). Never use `claude --bare` (it ignores subscription sign-in) or permission-bypass flags.
- Never send the full profile to a content script, and never send more than the minimum facts and context to a provider.
- Never invent profile facts, metrics, dates, employers, or titles; reject output that does.
- Never commit secrets, résumés, profile data, or real application content. Never run `git commit` or `git push` unless asked.
- Never edit generated output (`.output/`, `.wxt/`, built Go binaries) or lockfiles by hand.
- Never delete, skip, or weaken a failing test, lint rule, type check, or validation to make a check pass.
- Never add a dependency (npm or Go module), Chrome permission, host permission, or network destination without asking first.
- Never add telemetry, analytics, remote code, `eval`, or a humanizer feature (the user must supply and approve its instruction file first).
- Never modify the separate `scraper-applier` project.
- Never silently resolve a conflict between documents; report it.

## 7. Specs and precedence

Read `specs/00-summary-plan.md`, `specs/01-product-brief.md`, `specs/06-prd.md`, `specs/07-implementation-plan.md`, and `rules/00-core.md` before changing anything, then the files for your task:

| Task                                         | Also read                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Side panel or settings UI                    | `rules/20-frontend-extension.md`, `rules/40-design-style.md`, `rules/60-testing.md`                                                                                    |
| Service worker, context menu, content script | `specs/03-architecture.md`, `specs/05-contracts-and-invariants.md`, `rules/20-frontend-extension.md`, `rules/50-security.md`, `rules/60-testing.md`                    |
| Go helper, profile, documents, installer     | `specs/03-architecture.md`, `specs/05-contracts-and-invariants.md`, `rules/30-go-helper.md`, `rules/50-security.md`, `rules/51-privacy-data.md`, `rules/60-testing.md` |
| Provider prompting or integration            | `specs/05-contracts-and-invariants.md`, `rules/50-security.md`, `rules/51-privacy-data.md`, `rules/52-provider.md`, `rules/60-testing.md`                              |
| Architectural change                         | All specs plus `specs/decisions/README.md`; add a decision record                                                                                                      |

When documents disagree, the order is: the user's current request (within the safety boundaries above), then `specs/06-prd.md` and `specs/01-product-brief.md`, then `specs/03-architecture.md` and `specs/05-contracts-and-invariants.md`, then `rules/`, then existing code. When behavior changes, update the PRD in the same change.

## 8. Git conventions

- **Branches:** `stephenl/<name>`, lowercase kebab-case. Use `slice-NN-short-name` for planned slice work (for example `stephenl/slice-02-profile-store`) or a plain feature name (for example `stephenl/draft-generation`). One branch per slice or feature.
- **Commit messages:** one short imperative subject line, under 72 characters, in general terms (for example `Add profile storage`). No body, no slice or step numbers, and no attribution or `Co-Authored-By` lines (Claude Code's `attribution` setting is already emptied in `.claude/settings.json`).
- **When:** only when the user asks. Commit only when `npm run check` passes (plus `npm run test:e2e` if the change needs it). Keep each commit one logical change.
- **Never:** push, force-push, rewrite history, or commit to a shared branch unless the user asks.
