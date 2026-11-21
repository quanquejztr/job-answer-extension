# Testing Rules

Tests must prove both desired behavior and the absence of dangerous behavior.

## Test layers

### Unit tests

Cover pure functions and contracts:

- Question normalization.
- Bounded context extraction.
- Field-candidate scoring and ambiguity thresholds.
- Fingerprint comparison and expiry.
- Zod/protocol validation.
- Evidence quote verification, number and name checks, and the 40,000 code-point profile cap.
- Length and writing-rule validation.
- Error mapping.

### React tests

Cover:

- Captured-question and job-context editing.
- Loading, cancellation, success, warning, and error states.
- Draft editing and regeneration controls.
- Nonempty-field confirmation.
- Unsupported-domain and fallback messages.
- Keyboard navigation and accessible labels.

### Go tests

Cover:

- Length-prefixed framing, partial reads/writes, and size limits.
- Version, request-ID, type, and payload validation.
- Atomic storage and owner-only permissions.
- Document size/type failures.
- Provider command construction without a shell.
- Timeout, cancellation, exit classification, bounded output, and malformed output.
- Logging redaction.

### Browser tests

Load the unpacked extension against local fixtures for:

- Standard textarea.
- React-controlled textarea.
- Supported `contenteditable` editor.
- Two ambiguous nearby fields.
- Nonempty field.
- Field removed or replaced after capture.
- Framework rerender after input.
- Same-origin iframe.
- Cross-origin or otherwise inaccessible frame fallback.
- Closed shadow root or unsupported custom editor fallback.
- LinkedIn/Indeed-style denied origin.

Never run automated tests against or submit real employer applications.

## Security and privacy tests

- A job description containing prompt-injection instructions cannot alter provider permissions or protocol behavior.
- HTML/script-like provider output is displayed as text.
- Unknown origins, frames, message types, versions, and oversized payloads are rejected.
- The content script never receives résumé text, stories, samples, or rules.
- Logs and errors do not contain supplied sensitive sentinel strings.
- Insertion changes exactly one intended field.
- No click, navigation, file upload, selection, save, apply, or submit event occurs.

## Regression policy

- Every bug fix includes a test that fails before the fix and passes after it when practical.
- Do not delete or weaken a test merely because implementation behavior changed; update the specification first when behavior should change.
- Avoid snapshots for behavioral contracts that are clearer as explicit assertions.
- Keep fixtures small, deterministic, local, and free of real personal data.

## Verification

Run the checks applicable to the change as listed in `AGENTS.md`. Report exact failures or skipped commands. A mocked unit test does not replace a browser test for DOM insertion, and a browser test does not replace protocol/provider unit tests.
