# Core Engineering Rules

These rules apply to every change.

## Scope discipline

- Implement only the requested behavior and the smallest supporting change.
- Preserve the single-question, single-field product boundary.
- Do not add whole-form scanning, bulk generation, navigation, submission, job discovery, tracking, or unrelated automation.
- Do not modify the separate `scraper-applier` project.
- Do not add the deferred humanizer capability or detector-evasion behavior.

## Change discipline

- Inspect relevant code and tests before editing.
- Keep changes cohesive; avoid drive-by refactors and formatting unrelated files.
- Prefer existing patterns and platform capabilities over new abstractions.
- Do not introduce a dependency without following `specs/02-technical-stack.md`.
- Do not leave placeholder implementations, silent `TODO` behavior, or commented-out alternatives in production code.
- Do not weaken types, validation, permissions, privacy boundaries, or tests to make a change pass.
- Preserve user changes in a dirty worktree.

## Boundary validation

- Validate every browser, native-message, storage, document, and provider boundary.
- Use explicit typed errors rather than booleans or ambiguous strings.
- Fail closed when identity, origin, field target, résumé and story support, or permissions are uncertain.
- Keep user-facing errors actionable and internal diagnostics sanitized.

## Documentation

- Update the canonical specification when behavior or a contract intentionally changes.
- Add a decision record for architectural changes.
- Do not duplicate a canonical rule with slightly different wording elsewhere; link to it.
- Keep examples consistent with current behavior.

## Completion

- Add tests for visible behavior and meaningful failure paths.
- Run all applicable checks in `AGENTS.md`.
- Report skipped checks and remaining risk honestly.
- A build passing without behavioral tests is not sufficient evidence.
