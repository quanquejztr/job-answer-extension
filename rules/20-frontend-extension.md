# Frontend and Extension Rules

Applies to WXT entrypoints, React UI, extension messaging, DOM targeting, and insertion.

## Structure

- Follow WXT entrypoint conventions.
- Keep service-worker, content-script, side-panel, and settings responsibilities separate.
- Put reusable platform/domain logic in `extension/lib/`.
- Put runtime Zod schemas in `extension/schemas/`.
- React components use typed clients; they do not call native messaging directly.
- Content scripts never import profile or provider modules.

## TypeScript and React

- Enable strict TypeScript.
- Avoid `any`, non-null assertions, and unchecked type casts. If unavoidable, isolate and justify them at the boundary.
- Parse unknown data with Zod before use.
- Prefer small components, local state, context, and reducers.
- Derive state instead of duplicating it.
- Keep effects narrow and clean up listeners, observers, timers, and ports.
- Model loading, success, cancellation, warning, and error states explicitly.

## Chrome permissions

- Request the minimum required permissions.
- Prefer user-gesture `activeTab` access over broad persistent host access.
- Any new permission requires a specification/security review and user-facing justification.
- Do not add remote code, dynamic script downloads, or `eval`-like behavior.

## Page interaction

- Treat DOM text, attributes, URLs, and events as untrusted.
- Search within a bounded region around the selected question; do not classify the entire form.
- Support only recognized free-response controls.
- Use confidence thresholds. Ambiguity triggers manual selection.
- Store a short-lived fingerprint rather than a durable raw DOM reference.
- Revalidate origin, frame, element identity, type, editability, visibility, and fingerprint immediately before insertion.
- Confirm before replacing nonempty content.
- Use the element's native value setter and appropriate `input`/`change` events.
- Verify the value after the page framework has had an opportunity to rerender.
- If verification fails, report failure and offer a safe fallback; do not repeatedly force the value.
- Never click or submit buttons, links, radios, checkboxes, selects, or file inputs.

## Output handling

- Render question, job context, warnings, and model output as text, never raw HTML.
- The content script receives only the final approved answer and target information.
- Clipboard copy requires a user gesture and an explicit status message.
- Do not persist drafts unless a documented feature explicitly requires it.

## Messaging

- Use the canonical versioned envelopes and request IDs.
- Validate sender, tab, frame, origin, message type, and payload.
- Reject stale responses and target IDs.
- Disconnect native ports and cancel work when the user cancels or the owning UI closes where practical.
- Do not expose raw provider or process errors to webpage context.
