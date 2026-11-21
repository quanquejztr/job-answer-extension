# 0004: PDF Résumé Parsing With pdf.js in the Settings Page

- Status: Accepted (owner-approved 2026-11-21)
- Date: 2026-11-21
- Supersedes: None. Resolves PRD decision D9 and the "PDF approach is not decided here" part of [0003](0003-resume-and-stories-profile.md) item 5.

## Context

The résumé can be pasted or uploaded as DOCX (done; Go standard library only). ADR 0003 left the PDF approach open: a Go parser in the helper, or text extraction in the extension page, and how a file travels given the 256 KiB native request cap. The owner wants PDF upload so the common résumé format works, with the extracted text always reviewed in the editable box and nothing saved until Save.

## Options considered

1. **Go PDF parser in the helper** (for example `ledongthuc/pdf`, `rsc.io/pdf`). Rejected: it needs a first Go third-party dependency, the file must travel base64 inside one 256 KiB native request (so about 190 KiB, too small for many PDFs; a bigger cap means changing the native protocol), and the small Go parsers handle text order, ligatures, and encodings worse than pdf.js and are less maintained.
2. **pdf.js in the extension page** (chosen). Mature, Apache-2.0, maintained by Mozilla, the best text-order and encoding handling of the options, and the file never has to travel: only the extracted text goes to the helper, through the existing `profile.resume.set` path. Cost: one npm dependency (about 1.7 MB unpacked into the build, loaded only when a PDF is chosen) and a security surface that must be configured carefully (below).
3. **Poppler (`pdftotext`) run by the helper.** Rejected: an external binary the user must install, a child process fed untrusted files, the same transport limit, and nothing in the installer today runs third-party tools on user files.
4. **Convert with Claude or Codex.** Rejected: it sends the whole file to a provider before the user has reviewed anything, needs a provider call for an import step, and a model can invent or drop text, which breaks the quote-grounding premise.
5. **Paste only.** Rejected by the owner: always available as the fallback, but PDF is the usual résumé format.

## Decision

Use `pdfjs-dist` pinned to exactly **6.2.108** (`npm install --save-exact`; licence Apache-2.0, verified in the package; `npm audit` reports 0 vulnerabilities on 2026-11-21). Text extraction runs in the extension's settings page; only the extracted text goes to the helper.

1. **Where.** `extension/lib/profile/pdf-extract.ts` (limits, errors, timeout), `pdf-runtime.ts` (pdf.js settings and loading), `pdf-text.ts` (text assembly), `resume-upload.ts` (routing by bytes), `ResumeSection.tsx` (UI). The service worker, content script, and helper are not involved. pdf.js is loaded with dynamic imports only when a PDF is chosen, so the settings page's first load is unchanged (the lazy chunk is about 427 kB, 126 kB gzipped, plus the worker file of 1.26 MB, 374 kB gzipped).
2. **Build.** The main pdf.js build is used. It needs a current Chrome (the owner's stable Chrome and Playwright's Chromium both run it); the `legacy` build is used only in the Node unit tests, because Node lacks `DOMMatrix`. The worker is bundled locally by Vite (`pdf.worker.min.mjs?url`, started as a module worker from a `chrome-extension://` URL). No CDN, no remote code.
3. **pdf.js configuration (text only, no rendering).** No scripting manager is created and the sandbox bundle is never loaded, so document JavaScript cannot run; `isEvalSupported: false`; `useWasm: false` (no WebAssembly image decoders); `enableXfa: false`; `useSystemFonts: false`; `disableFontFace: true`; no hardware acceleration, image decoder, or offscreen canvas; `disableRange`, `disableStream`, `disableAutoFetch`, `useWorkerFetch: false`; no `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl`, or document URL. The document is opened from in-memory bytes (a copy), so pdf.js makes no network request. The e2e test asserts that the page makes no request outside the extension while reading a PDF.
4. **No manifest change.** No new permission, no host permission, no network destination, no `content_security_policy` entry (the default extension-page policy stays, so no `wasm-unsafe-eval`), and no `web_accessible_resources`. The manifest smoke test asserts this.
5. **Limits** (extension-only, in `extension/lib/constants/limits.ts` and `tests/protocol-fixtures/extension-limits.json`, no Go mirror because the PDF never reaches the helper): file at most 5 MiB (5,242,880 bytes), at most 10 pages, at most 60,000 extracted code points (the same bound as the DOCX import), and 20 seconds to extract (the worker is stopped on timeout). Encrypted or password-protected files, damaged files, files with no selectable text (a scan), too many pages, too much text, and timeouts are refused with a typed reason and the paste fallback; a scan gets "This PDF has no selectable text (it may be a scan). Paste your résumé text instead." Messages never include file content or the file name.
6. **Routing.** The upload is routed by its bytes (`%PDF-` in the first KiB, or a declared PDF type), not by file name. Anything else follows the DOCX path.
7. **Over the résumé limit.** Extracted text between 15,000 and 60,000 code points is shown in full in the box with the existing over-limit error, so the user can trim it; it is never silently cut. Saving is blocked until it fits (the helper enforces the same cap).
8. **Text assembly.** Lines come from y-position (hasEOL only when a page has no usable positions); reading order is top to bottom, and a page with a clear two-column layout is read left column then right column, with full-width lines (name, banner) splitting the page into bands; leading bullet glyphs become `- `, matching the DOCX import; text is NFC-normalized, common ligatures (ff, fi, fl, ffi, ffl, st) are expanded, control and zero-width characters are removed; pages are separated by one blank line. **No de-hyphenation**: joining a line-ending hyphen cannot be done safely, and the saved text must match what the user can quote. Repeated headers, footers, and page numbers are not removed.
9. **Source rule.** Save sends `pdf` while the box's text came from a PDF upload (including after edits), `docx` for a DOCX upload, `pasted` otherwise; emptying the box resets it to `pasted`.

## Security notes

- **CVE-2024-4367** (arbitrary JavaScript execution through a crafted font in pdf.js) is fixed in 4.2.67, so 6.2.108 is well past it. It was exploitable when `isEvalSupported` was on; we turn it off anyway.
- **CVE-2026-16633** is fixed in 6.2.108, the version we pin. As recorded in the owner's approval, it is exploitable only when scripting is enabled and the page has a permissive CSP. We have scripting off (no scripting manager, no sandbox bundle) and the default extension-page CSP (no `unsafe-eval`, no `wasm-unsafe-eval`). This was not independently re-checked against the advisory text in this change; the advisory should be read when revisiting.
- A malicious PDF can still try to exhaust memory or time; the 5 MiB, 10-page, 60,000-character, and 20-second bounds, plus a worker that is terminated after use, limit that. The worker runs off the main thread of a settings page that has no access to the profile except through the typed profile client.
- The PDF bytes and extracted text are never logged. A PDF with a JavaScript OpenAction and a link action is part of the test suite and must do nothing.
- The package has an optional dependency, `@napi-rs/canvas` (MIT), that npm records in the lockfile for Node use. It is not part of the extension build (pdf.js's `browser` field excludes it).

## Consequences

- One new runtime npm dependency (exact pin, Apache-2.0). Updating it is an intentional maintenance change: run `npm audit`, read pdf.js advisories, rerun the PDF unit and e2e tests, and update this record.
- The extension build grows by the lazy chunk and the worker file (about 1.7 MB unpacked); the first load of the settings page does not.
- Chrome must be recent enough for the main pdf.js build. Predefined CJK CMaps and the standard font files are not bundled, so a PDF that relies on them (rare for résumés) may extract poorly or not at all; the user falls back to paste. Layouts with sidebars, tables, or text boxes can come out in the wrong order; the user reviews and edits the text before saving.
- Scanned PDFs are not supported; there is no OCR.
- The helper gains no code and no dependency.

## Revisit when

- pdf.js publishes a new security advisory, or `npm audit` reports one for this package.
- A pdf.js update changes the minimum Chrome version, or the extension's supported Chrome falls below it.
- The owner needs scanned PDFs (OCR), CJK résumés (bundle CMaps), or better multi-column or table handling.
- The PDF limits turn out too tight for real résumés.
- The product is considered for distribution beyond the owner.
