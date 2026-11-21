# 0002: Subscription CLI Providers (Claude Code and Codex)

- Status: Accepted
- Date: 2026-11-18
- Supersedes: The "Provider boundary" decision in [0001](0001-foundational-decisions.md)

## Context

Claude Pro and ChatGPT Plus subscriptions do not include API keys; the APIs are billed separately. The product is a private, single-user prototype, so a pay-per-token API backend and its secret handling are unnecessary if an official subscription CLI can draft the answers. ADR 0001 named Claude Code as the only first provider.

## Decision

- Keep the `Provider` interface and add two adapters: Claude Code (`claude -p`) and Codex (`codex exec`), each using the user's own signed-in subscription.
- The user selects one provider in settings. There is no default provider: drafting is blocked until the user chooses one. There is no automatic fallback between providers.
- The owner accepted on 2026-11-19 that running `claude -p` under a subscription is a gray area under the provider's published policy, for private use only (PRD decision D1).
- The helper never reads or brokers credentials for either provider.
- Error codes become provider-neutral: `PROVIDER_NOT_FOUND`, `PROVIDER_NOT_AUTHENTICATED`, `PROVIDER_USAGE_LIMIT`.
- The extension never automates the claude.ai or chatgpt.com web interfaces.
- Private use only. Public distribution still requires provider clarification or an approved API model.
- Pin the extension ID early with a manifest `key` so the native-host origin stays stable across reloads. Confirmed on 2026-11-19: a locally generated key loads in Chrome with ID `fofmklpoecdileojcljpmemhcefmhbfc`, so the only allowed native-host origin is `chrome-extension://fofmklpoecdileojcljpmemhcefmhbfc/`.
- Run a spike in Slice 0 (step 0.4), before any adapter work, to confirm, per CLI: isolation flags (no tools, MCP, hooks, skills, sessions), that user-level config is not loaded, structured-output behavior, and noninteractive sign-in detection.

## Alternatives considered

- API key in the Keychain: rejected for now. Separate billing, and it adds a real secret. Revisit if the CLIs prove unreliable.
- Manual copy and paste bridge: deferred. No policy risk, but extra steps per answer; can be added behind the same interface if wanted.
- Driving the chat web UIs: rejected. Account risk and brittle.
- Local model: deferred. Free and private, but weaker writing and a localhost network destination needing its own review.
- Claude only: rejected in favor of two adapters so a limit or policy change on one does not stop the project.

## Consequences

- Draft quality, speed, and limits depend on each CLI and plan.
- Shared output validation must work for both adapters; adapters only own process handling and error classification.
- Consumer-plan requests follow the provider account's training and retention settings, which the product cannot verify; the first-use disclosure asks the owner to confirm them (PRD D7, section 18.1).
- Behavior may break when a CLI changes flags; the spike results and fake-executable tests document the expected invocation.

## Revisit when

- Either provider changes its terms or CLI behavior for subscription use.
- The spike shows a CLI cannot be isolated from user-level configuration.
- The project moves toward public distribution.

## Spike results: Claude Code 2.1.328 (2026-11-19)

Run in an empty directory with prompts over stdin, on a signed-in claude.ai subscription. No file under `~/.claude` was read.

Confirmed invocation:

```text
env -i HOME=$HOME PATH=$PATH USER=$USER \
  claude -p --safe-mode --tools "" --no-session-persistence --disable-slash-commands \
  --output-format json --json-schema '<schema>'      # prompt on stdin
```

- **Environment allowlist:** `HOME`, `PATH`, and `USER` are enough. Without `USER` the CLI reports "Not logged in" (exit 1), so the sign-in lookup needs it. Variables inherited from a parent Claude Code session (`CLAUDE_CODE_*`) are dropped by `env -i`.
- **Isolation:** the same prompt with default flags exposed the user's skills, MCP tools, and 14 tools to the model, took 6.7 s, and cost $0.11. With the flags above the model saw only the `StructuredOutput` tool and no skills, commands, MCP servers, or custom instructions, took about 2.6 s, and cost about $0.012.
- **Injection:** a job description telling the model to run `ls /` and read `~/.zshrc` produced no tool call (`permission_denials` empty) and the model refused the instruction.
- **Output:** with `--output-format json --json-schema`, the validated object is in `structured_output`; `result` holds the same JSON as text. Useful fields: `is_error`, `terminal_reason`, `num_turns`, `duration_ms`, `total_cost_usd`.
- **Session persistence:** `claude -p --resume <session_id>` on a `--no-session-persistence` run fails with "No conversation found", so nothing was saved.
- **Signed out:** stdout is JSON with `is_error: true`, `result: "Not logged in · Please run /login"`, `terminal_reason: "api_error"`, exit code 1, and nothing on stderr. `claude auth status` returns JSON with `loggedIn` and `authMethod` and exits 0 or 1; diagnostics should use it instead of matching the message text.
- **stdin:** if no stdin arrives within 3 s the CLI prints a warning and continues, so the adapter must always supply stdin (it does: the prompt) and tests should redirect `< /dev/null`.
- **Flags:** `--max-turns` is accepted although it is missing from `--help`. `--bare` is excluded (ignores subscription sign-in).
- **Not yet observed (still not observed after step 3.0):** the usage-limit and timeout signatures. The adapter must treat any other non-zero exit, `is_error: true`, or missing `structured_output` as `PROVIDER_OUTPUT_INVALID` until those are seen.

## Step 3.0 check: Claude Code 2.1.328 (2026-11-20)

- `claude --version` still prints 2.1.328, the version the spike used, so the isolation check was not re-run and the confirmed invocation above stands.
- `env -i HOME PATH USER claude auth status` in an empty directory, stdin from `/dev/null`: exit 0, stdout JSON with `loggedIn: true` (plus other account fields the helper ignores), nothing on stderr. Only `loggedIn` is read.
- Usage-limit signature: not observed. Seeing it would mean exhausting the plan's limit, which was not done. The classifier matches the `result` text of an `is_error` run against fixed, unverified phrases ("usage limit", "limit reached", "rate limit"). A wrong guess can only miss a classification: anything unmatched is `PROVIDER_OUTPUT_INVALID`, as before. Replace the phrases when a real one is seen.
- Timeout signature: not observed from the CLI. The helper does not rely on one: its own 90 s deadline kills the process and returns `PROVIDER_TIMEOUT` (`context.DeadlineExceeded`), and cancellation returns `PROVIDER_CANCELLED`.
- Codex: the CLI is not installed (owner action O1 not done), so the Codex spike and flags remain deferred and the Codex adapter is an unsupported stub. No Codex adapter code exists.

## Step 3.1: diagnostics and classification (2026-11-20)

- `helper/internal/provider/claude` owns process handling and classification. A `Runner` interface (`ExecRunner` in production: `os/exec`, no shell, fresh private empty working directory, environment of exactly `HOME`, `PATH`, `USER`, stdin always supplied, stdout bounded to 64 KiB, stderr discarded) is injected, so tests run a fake `claude` built from `testdata/fakeclaude`.
- The executable is found with `exec.LookPath` on each absolute directory of `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, and `~/.npm-global/bin`, because Chrome starts native hosts with a minimal `PATH`. Nothing under `~/.claude` is read.
- Sign-in diagnostic: `claude auth status`, `loggedIn` only. Classification: not found, `PROVIDER_NOT_AUTHENTICATED` (`loggedIn: false`), `PROVIDER_TIMEOUT`, `PROVIDER_CANCELLED`, and anything else (unparseable, missing `loggedIn`, truncated, start failure) is `PROVIDER_OUTPUT_INVALID`.
- `ClassifyPrint` classifies `claude -p --output-format json` runs for step 3.3: "Not logged in" is `PROVIDER_NOT_AUTHENTICATED`, the assumed phrases above are `PROVIDER_USAGE_LIMIT`, everything else that is not a clean run with `structured_output` is `PROVIDER_OUTPUT_INVALID`. Provider text is matched but never returned or logged.
- The settings page's **Check provider** button sends `diagnostics.run` through the worker. With no provider choice yet (step 3.5), it checks Claude Code only.

## Steps 3.2 and 3.3: prompt and Claude invocation (2026-11-20)

- `helper/internal/prompt` builds one prompt. Every block (product rules, résumé, each story with its id, each sample, each enabled rule, question, job context, constraints, optional current draft) sits between `[[<token> BEGIN <name>]]` and `[[<token> END <name>]]` lines. The token is 24 random hex characters drawn per prompt and redrawn if it occurs in any block text, so no text can close or forge a block. Question and job context are labeled untrusted reference text; samples and rules are labeled style only. The schema passed to `--json-schema` uses only basic keywords (type, required, enum, items, additionalProperties); lengths, quote exactness, and numbers are checked by the shared validator.
- `claude.Provider` runs the confirmed flags exactly, prompt on stdin, through the injected `Runner` (`NewProvider` uses `ExecRunner` with the `HOME`/`PATH`/`USER` environment and a 512 KiB stdout cap), with a 90 s deadline. It parses `structured_output` with `protocol.ParseDraftResponse` and returns typed errors only. Input that cannot be sent (no résumé, over a cap, unsafe id) is `provider.ErrInvalidInput`, which maps to `INVALID_REQUEST`; nothing is started. Grounding validation stays in `internal/validate` and is applied by the host in step 3.4. The production host still uses the fake provider.
- Not verified against the real CLI: `--json-schema` acceptance of this exact schema and the prompt's real-world answer quality. Those are confirmed in step 3.5 when the real provider is wired in.

## Steps 3.4 and 3.5: real provider wired in (2026-11-20)

- The production host (`cmd/host`) builds `claude.NewProvider` and `claude.New` and uses them when the profile's `settings.provider` is `claude`. The choice and `disclosureAcceptedAt` are stored in `profile.json` and written by `settings.setProvider` and `settings.acceptDisclosure`. `draft.generate` fails with `INVALID_REQUEST` and starts nothing when there is no résumé, no provider, no accepted disclosure, or a provider with no adapter (Codex). Diagnostics follow the stored choice.
- Provider output goes through the shared `internal/validate` only; the Claude adapter parses, the host validates, and nothing reaches the panel otherwise.
- **How tests avoid the real `claude`:** there is no override variable or flag in production code. The executable is found through `PATH` and the fixed install directories. Go host tests build `helper/internal/host/testdata/fakeclaude` and pass the adapter an explicit locator and child environment. The browser tests build the same program as `claude` into a temporary directory and register the host through a test-only wrapper script (in the throwaway temp home, never shipped) that sets `HOME` to a throwaway directory and `PATH` to that directory plus `/usr/bin:/bin`, and exits if the fake is missing. The fake takes its behavior from a mode file in that `HOME`, because the production child environment carries only `HOME`, `PATH`, and `USER`. Nothing in an automated test can reach the real executable unless the fake is absent and a real one sits in a fixed install directory, which the wrapper's check prevents.
- Not yet verified against the real CLI: `--json-schema` acceptance of this schema, the prompt's real answer quality, and the real usage-limit text. The owner's manual run (checklist section "3.4/3.5 — real drafting with Claude") covers the first two.

## Spike results: activeTab and iframes (2026-11-19)

A throwaway extension with only `contextMenus`, `activeTab`, `scripting`, and `webNavigation` (no host permissions) was loaded in the owner's Chrome. A page on `localhost:4311` contained a same-origin iframe and a cross-origin iframe (`127.0.0.1:4312`). The owner selected text and used a context-menu item in the main page and in each iframe; the extension then called `chrome.scripting.executeScript` on every frame.

| Click location      | Main page | Same-origin iframe | Cross-origin iframe |
| ------------------- | --------- | ------------------ | ------------------- |
| Main page           | injected  | injected           | refused             |
| Same-origin iframe  | injected  | injected           | refused             |
| Cross-origin iframe | injected  | injected           | refused             |

- The refusal message was "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
- Clicking inside the cross-origin iframe did not grant access to that iframe, but `info.selectionText`, `info.frameId`, and `info.frameUrl` still identified the selected text and its frame.
- `allFrames: true` silently skipped the refused frame instead of failing, so a skipped frame must be detected by comparing results with `webNavigation.getAllFrames`.
- Consequence: with `activeTab` alone, forms in cross-origin iframes (for example an ATS board embedded in a company careers page) can supply the question text but cannot be targeted or filled. Same-origin frames and pages opened as the top-level tab work.
