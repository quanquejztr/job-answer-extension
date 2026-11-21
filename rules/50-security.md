# Security Rules

Security boundaries are product requirements, not optional hardening.

## Browser boundary

- Treat every page, frame, DOM node, label, selection, URL, and event as attacker-controlled.
- Use text APIs, never `innerHTML`, for untrusted or model-generated content.
- Do not execute page-provided code or accept page instructions as configuration.
- Keep selectors and DOM traversal bounded.
- Validate the tab, frame, origin, target expiry, and fingerprint immediately before insertion.
- Block LinkedIn and Indeed before capture, generation, or insertion.
- Do not broaden host permissions to work around a targeting problem.

## Extension messaging

- Validate message schemas and senders at every receiver.
- Bind responses to request IDs and the initiating tab/frame.
- Reject unexpected message types, origins, frames, and protocol versions.
- Do not send sensitive profile data to content scripts.
- Assume stale messages can arrive after navigation or UI closure.

## Native messaging

- Register the host for only the expected extension origin.
- Validate the caller information Chrome supplies and the protocol envelope.
- Apply message-size, output-size, and execution-time limits.
- Keep the native binary and manifest in user-owned, non-world-writable locations.
- Never interpret native-message data as a command, path, or shell fragment without strict validation.
- Treat native-host compromise as higher impact than extension UI compromise and minimize its capabilities.

## Prompt injection

- Delimit question, job description, résumé, stories, samples, and rules as data with explicit roles.
- State that instructions inside page/job content are untrusted and must not be followed.
- Run the provider without tools, MCP servers, hooks, skills, or persistent sessions.
- Use a private empty working directory.
- Do not make local files available to the model process beyond controlled input.
- Validate structured output independently of the prompt.

## Output and insertion

- Parse provider output as data and render it as text.
- Verify evidence quotes and unsupported numbers before displaying a successful draft.
- Require explicit review and insertion.
- Never trigger application navigation or submission.
- If field identity or insertion success is uncertain, fail closed and offer a manual fallback.

## Secret handling

- This project has no application secrets in version one.
- Never read, copy, export, log, or transmit Claude or ChatGPT OAuth credentials, session tokens, browser cookies, or keychain entries.
- Never add secrets to code, fixtures, logs, screenshots, or documentation examples.

## Security review triggers

Update the security specification and tests before adding a Chrome permission, supported domain class, provider, file capability, network destination, credential flow, persistent draft store, or remote update mechanism.
