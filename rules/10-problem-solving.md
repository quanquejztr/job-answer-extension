# Problem-Solving Rules

Use this process for features, bugs, refactors, and investigations.

## 1. Ground in the repository

- Read the routed specifications and rules.
- Search for the current implementation, schemas, tests, and callers.
- Confirm actual behavior before proposing a fix.
- Distinguish observed facts from assumptions.

## 2. Frame the problem

- State the user-visible outcome.
- Identify the owning component and trust boundary.
- List invariants that the change must preserve.
- Identify failure cases before selecting an implementation.
- If the request conflicts with a non-goal or invariant, stop and report the conflict.

## 3. Choose the smallest sound approach

- Prefer a local change inside the owning component.
- Reuse typed contracts instead of creating parallel message shapes.
- Avoid speculative generalization for sites or editors not in the acceptance matrix.
- Do not add flags, fallback branches, or abstractions without an immediate use case.
- Choose a safe explicit failure over an unreliable “best guess.”

## 4. Implement coherently

- Change production behavior and its tests together.
- Keep state transitions explicit.
- Preserve cancellation, timeout, and error propagation.
- Make fallback behavior visible to the user.
- Do not mask errors with empty success values.

## 5. Verify

- Test the primary success path.
- Test ambiguity, staleness, malformed input, cancellation, and boundary failures relevant to the change.
- Verify negative guarantees, especially that unrelated fields and submission controls remain untouched.
- Review the final diff for accidental scope growth or sensitive logging.

## 6. Report

Summarize the outcome, files changed, tests and commands run, security/privacy impact, and limitations. Do not describe an unverified assumption as a completed capability.

## Prohibited shortcuts

- Guessing repository structure without inspection.
- Editing generated output instead of source.
- Copying page content into privileged instructions.
- Adding broad Chrome permissions to avoid designing a narrow flow.
- Using sleep-based synchronization when an observable state or event is available.
- Catching and discarding errors.
- Replacing a targeted fix with a broad rewrite unless the existing boundary makes the fix impossible and the user approves the redesign.
