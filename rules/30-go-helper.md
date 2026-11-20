# Go Native Helper Rules

Applies to the native host, protocol, profile, document extraction, provider execution, and installer utilities written in Go.

## Design

- Prefer the Go standard library.
- Keep `cmd/host` thin; domain behavior belongs in `internal/` packages.
- Use explicit structs and enums for protocol data and errors.
- Pass `context.Context` through cancellable or blocking operations.
- Inject filesystem, clock, and provider boundaries where tests require control; do not build a general dependency-injection framework.
- Keep provider-specific behavior behind the `Provider` interface.

## Native messaging

- Read and write Chrome's length-prefixed messages exactly.
- Enforce a conservative message-size limit before allocation.
- Validate protocol version, request ID, message type, and payload.
- Reject unexpected or duplicate fields when strict decoding improves safety.
- Write protocol responses only to stdout.
- Write sanitized diagnostics only to stderr.
- Never print prompts, profile text, answers, job descriptions, environment contents, or credentials.
- Return a response for recoverable request errors; terminate only when framing or process integrity is compromised.

## Process execution

- Use `exec.CommandContext`; never invoke a shell or construct a command string.
- Pass untrusted content through stdin or a controlled file, never through shell interpolation.
- Set an explicit private working directory and controlled environment.
- Apply timeouts, cancellation, and bounded output capture.
- Classify exit conditions into typed provider errors.
- Do not retry non-idempotent operations automatically. Generation retries require a new user action or an explicitly safe retry policy.

## Files and storage

- Use explicit application-owned paths.
- Create directories and sensitive files with owner-only permissions.
- Use atomic write-and-rename for durable profile updates.
- Validate formats and size limits before parsing documents.
- Never follow untrusted symlinks into unrelated locations.
- Do not store provider credentials or scrape other applications' data directories.
- Keep temporary files private and remove them promptly.

## Errors and logging

- Wrap errors with operation context without sensitive payloads.
- Map internal errors to the canonical `AppError` codes at the protocol boundary.
- Avoid panics for user, document, provider, and protocol input errors.
- Do not suppress errors to return empty data.

## Quality checks

- Format all Go source with `gofmt`.
- Run `go vet ./...` and `go test ./...`.
- Use table-driven tests when several inputs exercise the same contract.
- Test cancellation, size limits, malformed framing, partial I/O, storage permissions, and provider failures.
