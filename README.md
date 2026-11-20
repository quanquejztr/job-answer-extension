# Job Answer Extension

Private prototype, not for distribution. A personal macOS Chrome extension that
drafts one reviewed answer for one selected free-response job-application
question. The user reviews the draft and explicitly inserts it.

Status: Slice 0.1 scaffold only (placeholder entrypoints, no feature code).

## Toolchain

- Node.js 26 LTS (`.nvmrc`; tested with 26.13.1), npm 11.20.0
- Go 1.27.4 (standard library only)
- WXT (React template), Manifest V3, strict TypeScript

## Setup

```bash
nvm use            # Node 26
npm install
npm run build      # output in .output/chrome-mv3
```

Load `.output/chrome-mv3` as an unpacked extension in Chrome.

## Scripts

| Script                                  | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run lint`                          | ESLint and Prettier check                              |
| `npm run format`                        | Prettier write                                         |
| `npm run typecheck`                     | `wxt prepare` and `tsc --noEmit`                       |
| `npm test`                              | Vitest (jsdom, React Testing Library)                  |
| `npm run build`                         | WXT production build                                   |
| `npm run test:e2e`                      | Playwright (not in `npm test`; install browsers first) |
| `npm run go:fmt` / `go:vet` / `go:test` | Go format check, vet, tests (in `helper/`)             |
| `npm run check`                         | Everything above except e2e                            |

## Layout

`extension/` (WXT source), `helper/` (Go native helper), `installer/templates/`,
`tests/` (fixtures, e2e, shared protocol fixtures), `specs/`, `rules/`.

Read `specs/00-summary-plan.md` first; see `specs/` for requirements and
architecture and `rules/` for engineering rules.
