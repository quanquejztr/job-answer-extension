# Provider Rules

Providers are private experimental adapters over the user's own subscription CLIs (Claude Code and Codex), not an application authentication system. See [ADR 0002](../specs/decisions/0002-subscription-cli-providers.md).

## Authentication boundary

- The user installs the CLI and signs in independently.
- The helper may check whether the executable exists and classify its invocation result.
- The helper never reads, copies, refreshes, intermediates, stores, or exports provider credentials or session tokens (including `~/.claude` or `~/.codex` auth files).
- Do not automate login or embed a sign-in flow.
- An unauthenticated state returns `PROVIDER_NOT_AUTHENTICATED` with user-run setup guidance naming the selected provider.

## Provider abstraction

- Depend on a narrow `Provider` interface, not CLI-specific process behavior outside `internal/provider/<adapter>/`.
- Adapters: `claude` (Claude Code) and `codex` (Codex CLI). The user picks one in settings; there is no automatic fallback between providers, because that would silently send data to a second service.
- Provider input is a validated request containing only relevant facts and context.
- Provider output is structured and validated before conversion to `DraftResponse`; validation is shared across adapters.
- Keep provider error classification inside each adapter and map to the shared `PROVIDER_*` codes.
- Do not expose raw stderr, stack traces, or provider payloads to the extension.

## Invocation

- Invoke the executable directly with `exec.CommandContext`.
- Use the noninteractive mode of the installed CLI version (`claude -p`, `codex exec`); exact flags are confirmed by the Slice 0.4 spike and recorded in the ADR.
- Pass prompt data through stdin.
- Disable tools, MCP servers, hooks, skills, and session persistence using supported CLI configuration; run Codex read-only with no approvals.
- Confirm the CLI does not load user-level configuration (for example a global CLAUDE.md, settings, or MCP config) into the drafting run. If it cannot be disabled, treat the adapter as unsafe.
- Run in a private empty working directory.
- Set explicit time, input, and output bounds.
- Do not inherit unnecessary environment variables. For `claude` the confirmed allowlist is `HOME`, `PATH`, and `USER` (without `USER` the CLI cannot find the sign-in); confirmed flags are in ADR 0002.
- Always supply stdin (the prompt); a CLI waiting on empty stdin delays about 3 seconds.
- Never use permission-bypass flags.

## Prompt construction

- Separate system rules, verified facts, question, job context, and writing constraints.
- Label webpage-derived content as untrusted reference text.
- Require JSON or another strictly parseable structure with `answer`, `evidenceIds`, and `warnings`.
- Tell the model to omit unsupported facts rather than infer them.
- Do not request chain-of-thought or persist conversations between drafts.

## Validation

- Reject malformed output, unknown evidence IDs, unsupported claims, prohibited field categories, and length violations.
- Treat model warnings as data, not trusted validation.
- Do not repair materially invalid factual output silently; regenerate only after an explicit user action or return a clear error.
- Preserve the user's question and job-context edits after provider errors.

## Distribution boundary

- Do not market the subscription-CLI route as a generally authorized, stable, or keyless public integration.
- Public distribution requires written provider clarification or migration to an approved API/commercial provider model.
- Keep provider replacement possible without changing content scripts, UI contracts, or stored profiles.
- Never automate the claude.ai or chatgpt.com web interfaces.
