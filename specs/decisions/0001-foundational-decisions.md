# 0001: Foundational Product and Architecture Decisions

- Status: Accepted (the provider-boundary decision is superseded by [0002](0002-subscription-cli-providers.md))
- Date: 2026-11-18
- Supersedes: None

## Context

The project needs a narrow, reliable first version that helps one job seeker draft short narrative answers without becoming a general job-application automation tool. It must integrate a Chrome page with local sensitive profile data and a locally installed Claude Code client while preserving user control.

## Decisions

### Product boundary

The product drafts one selected free-response answer and inserts it into one user-approved field. It does not fill whole applications, answer structured questions, navigate, save, or submit.

### Extension stack

Use the WXT React and TypeScript starter with Manifest V3, Tailwind CSS, Radix UI primitives, and Zod. WXT reduces custom build and manifest choices while preserving standard Chrome extension architecture.

### Native helper

Use Go for native messaging, sensitive profile access, document extraction, fact selection, validation, and provider invocation. The extension never hosts a local HTTP server.

### Provider boundary

Use a provider interface. The first provider invokes the user's installed Claude Code executable as a private experimental integration. The implementation never reads or brokers Claude credentials. A public release requires Anthropic clarification or an approved API-backed provider.

### Data boundary

The Go helper owns the complete profile. Content scripts receive only page context needed for targeting and the final user-approved answer needed for insertion. Provider requests include only relevant verified facts.

### Domain policy

LinkedIn and Indeed are blocked based on their published restrictions. Other ATS pages receive best-effort support and must pass compatibility tests; support never overrides an employer's own terms or AI-use disclosure.

### Humanizer feature

No humanizer skill is included. The user will provide a text file for separate review before any such feature is specified. The product will not claim AI-detector evasion.

## Alternatives considered

- A full-form autofill agent: rejected because it expands policy, safety, targeting, and user-control risks beyond the core problem.
- Copy-only workflow: rejected as the primary flow because the user explicitly wants safe direct insertion; retained as a fallback.
- A local Node helper: rejected in favor of Go at the user's request and for a small distributable native binary.
- A hosted backend: rejected because it adds accounts, secret management, hosting, and broader data exposure.
- Direct coupling to Claude Code: rejected because legal/product constraints may require replacing it with an API provider.
- Plain Vite wiring: rejected because WXT provides a more constrained extension-specific structure.

## Consequences

- Field targeting and insertion must remain deliberately narrow.
- The protocol and provider boundary must be designed before feature growth.
- Some custom editors and frames will use a manual or clipboard fallback.
- Private installation can proceed before public distribution questions are resolved.
- New work that introduces whole-application behavior conflicts with this accepted decision.

## Revisit when

- The user explicitly changes the product boundary.
- Anthropic provides written product-integration guidance or an API provider is adopted.
- A supported browser or operating system is added.
- The humanizer text is supplied and approved through a separate specification.
- Site policies materially change and are verified from primary sources.
