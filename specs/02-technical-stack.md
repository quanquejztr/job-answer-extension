# Technical Stack

## Locked choices

| Area                | Choice                                                    | Constraint                                                                          |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Extension framework | WXT official React template                               | Use WXT entrypoint conventions; do not hand-roll the build pipeline.                |
| Browser platform    | Chrome Manifest V3                                        | Chrome on macOS is the only v1 target.                                              |
| UI language         | TypeScript with strict mode                               | Avoid `any`; validate data at runtime boundaries.                                   |
| UI framework        | React                                                     | Prefer small components and local state.                                            |
| Styling             | Tailwind CSS                                              | Use semantic tokens defined by the design rules.                                    |
| UI primitives       | Radix UI                                                  | Use only where an accessible primitive is needed.                                   |
| Runtime schemas     | Zod                                                       | Shared extension-side schemas for messages and model output.                        |
| Node runtime        | Node.js 26 LTS (LTS since 2026-10-28)                     | Pinned by `.nvmrc` and `engines`; use `nvm use` in new shells.                      |
| Package manager     | npm                                                       | Commit `package-lock.json`; do not mix package managers.                            |
| Native helper       | Go                                                        | Own native messaging, sensitive profile access, validation, and provider execution. |
| Lint and format     | ESLint (flat config) with typescript-eslint, and Prettier | `no-explicit-any` is an error; `npm run lint` also runs `prettier --check`.         |
| Frontend tests      | Vitest and React Testing Library                          | Unit and component behavior.                                                        |
| Browser tests       | Playwright                                                | Fixture pages and loaded-extension workflows only.                                  |
| Go tests            | Standard `testing`, `go test`, and `go vet`               | Prefer the standard library.                                                        |
| DOCX extraction     | Go `archive/zip` and `encoding/xml`                       | No dependency; a DOCX is a zip containing `word/document.xml`.                      |
| PDF extraction      | Decided in the Slice 6 spike and an ADR                   | Candidates: `ledongthuc/pdf`, `rsc.io/pdf`; pasted text is always the fallback.     |
| Providers           | Official `claude` and `codex` CLIs                        | See ADR 0002; no API keys, no SDKs.                                                 |

Package versions are pinned by the generated lockfile and `go.mod`. A dependency update is an intentional maintenance change, not an incidental part of feature work.

## Deliberately excluded

- No hosted backend or product-side local HTTP server. The one exception is the test-only static fixture server for Playwright (`tests/fixtures/serve.mjs`, `127.0.0.1:4310`).
- No database.
- No product user accounts.
- No analytics, crash-reporting SDK, or telemetry.
- No global React state library initially; use component state, context, and reducers.
- No UI component suite beyond Radix primitives.
- No Go third-party dependencies until a decision record justifies one (PDF parsing is the expected first).
- No remote configuration.
- No second browser target in version one.
- No shell scripts that interpolate untrusted content into commands.

## Dependency policy

Before adding a runtime dependency:

1. Confirm the capability is not already supplied by WXT, React, Radix, Zod, Go, or the platform.
2. Explain why a small local implementation is less safe or maintainable.
3. Check license, maintenance state, bundle/runtime cost, and security implications.
4. Add the narrowest package that solves the problem.
5. Add tests around the new boundary.
6. Record an architectural dependency in the decision log when it materially shapes the system.

## Build outputs

- WXT-generated extension output is disposable and never edited directly.
- Go binaries and packaged installers are generated artifacts and never treated as source.
- Source schemas, native-host manifests, and installer templates remain reviewable in the repository.
- Secrets, profiles, résumés, drafts, local logs, and native-host installation state are never committed.
