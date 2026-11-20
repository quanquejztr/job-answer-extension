# Definition of Done

A feature is complete only when its behavior, failure handling, tests, documentation, and verification evidence are complete.

## Product acceptance

- Selecting a narrative question and choosing **Draft answer** opens the side panel with the correct question.
- The extension identifies only a nearby compatible free-response field or requests manual selection.
- Job context is extracted with a confidence signal or can be pasted and corrected.
- Generation uses only relevant verified facts and explicit writing rules.
- Drafts respect configured word or character limits.
- The user can edit a draft before insertion.
- Insertion requires an explicit user action.
- Exactly one intended field changes.
- Nonempty fields require replacement confirmation.
- The inserted value persists after framework rerendering or the operation reports failure.
- Unsupported editors fall back safely without modifying the form.
- No navigation, saving, or submission control is activated.

## Negative acceptance

- Structured eligibility, demographic, compensation, consent, and legal questions are not answered.
- Multiple fields are never filled from one action.
- Unknown profile claims and metrics are rejected.
- LinkedIn and Indeed show an unsupported-domain explanation and no drafting or insertion action.
- A stale or ambiguous field target cannot be used silently.
- Instructions embedded in page text cannot override system rules, access files, or enable tools.
- Full profile data never appears in a content-script message.

## Failure acceptance

- Missing native helper provides installation guidance.
- Missing provider executable (`claude` or `codex`) provides setup guidance.
- Unauthenticated provider CLI provides sign-in guidance without inspecting credentials.
- Usage limits, timeouts, cancellation, malformed output, and protocol-version mismatch have distinct typed errors.
- Retrying generation does not duplicate insertion or lose the user's edited question/job context.
- Errors do not include résumé text, drafts, job descriptions, credentials, or raw prompts.

## Test requirements

- Unit tests cover pure targeting, validation, fact selection, prompt construction, and protocol logic.
- React tests cover review, editing, warnings, confirmations, and error states.
- Go tests cover framing, limits, storage permissions, provider execution, cancellation, and validation.
- Playwright tests load the unpacked extension against local fixture pages.
- Fixtures cover textarea, React-controlled textarea, contenteditable, nonempty, ambiguous, removed, rerendered, iframe, and unsupported-editor cases.
- Security tests cover prompt injection, malformed messages, unexpected origins, oversized messages, HTML-like model output, and denied domains.
- Automated tests never contact or submit real employer forms.

## Required evidence

The completion report lists:

- Files changed.
- User-visible behavior.
- Tests added or updated.
- Verification commands and results.
- Security and privacy impact.
- Specification or decision changes.
- Known limitations and unverified assumptions.

Applicable checks must pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
cd helper && gofmt -w .
cd helper && go vet ./...
cd helper && go test ./...
```

If a required command cannot run, the feature is not fully verified and the report must say why.

## Traceability to acceptance criteria

The binary Given/When/Then criteria are in `06-prd.md` section 21 (`AC-001` to `AC-061`). Each criterion is assigned to exactly one slice gate in `07-implementation-plan.md`. This checklist summarizes completion; when it and section 21 differ, section 21 wins.
