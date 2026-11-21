# Single-Question Job Answer Extension

## Product summary

Build a personal macOS Chrome extension that drafts a short answer for one selected free-response job-application question. The user reviews the draft in a Chrome side panel and explicitly inserts it into one nearby answer field.

The product is an assisted writing tool, not an autonomous application agent.

## User flow

1. The user highlights a free-response question such as “Why do you want to work here?”
2. The user right-clicks and chooses **Draft answer**.
3. The extension captures the selected question and identifies only its nearby free-response field.
4. The extension extracts the job description when it can do so confidently; otherwise the user can paste or edit it.
5. The local Go helper loads the user's profile (résumé, stories, writing samples, and rules) and invokes the user's installed Claude Code or Codex CLI, signed in with the user's own subscription. The helper verifies that the draft is supported by the résumé and stories before showing it.
6. The draft appears in the side panel.
7. The user reviews and may edit, regenerate, shorten, or make the answer more direct.
8. The user clicks **Insert answer**.
9. The extension revalidates the target and fills exactly that field.
10. The user decides what to do next on the application page.

## Scope

Version one supports:

- One question and one free-response field at a time.
- Standard `textarea` elements and supported multiline `contenteditable` editors.
- A local profile built from one résumé text, behavioral stories, writing samples, and explicit writing rules ([ADR 0003](decisions/0003-resume-and-stories-profile.md)).
- Job-description extraction with manual paste/edit fallback.
- User review and editing before insertion.
- A private, locally installed macOS and Chrome prototype.

Version one does not support:

- Whole-application or multi-field autofill.
- Eligibility, sponsorship, demographic, compensation, consent, or legal-attestation answers.
- Résumé or cover-letter uploads into employer forms.
- Clicking Next, Continue, Save, Apply, or Submit.
- LinkedIn or Indeed pages.
- Automated job discovery or application tracking.
- A cloud account, hosted backend, analytics, or telemetry.
- A humanizer skill or an “AI-undetectable” claim.

## Implementation phases

The execution-level sequence, work packets, gates, and requirement traceability live in [`07-implementation-plan.md`](07-implementation-plan.md). The phase summary below describes product progression, not a separate execution order.

### Phase 1: Foundation

- Scaffold a WXT Manifest V3 extension using React and TypeScript.
- Build a Go native-messaging host.
- Add macOS native-host registration and local setup diagnostics.
- Establish shared, versioned message contracts.

### Phase 2: Profile setup

- Accept pasted résumé text first, then DOCX upload (read by the helper) and PDF upload (pdf.js in the settings page, ADR 0004; only the extracted text reaches the helper).
- Always show the extracted text in an editable box; nothing is saved until the user clicks Save.
- Store one résumé text, plus behavioral stories with stable IDs.
- Collect writing examples and explicit answer rules.
- Provide local export and delete-all-data actions.
- Steps 2.1 to 2.4 delivered a fact model and keyword fact selection; Slice 2B replaces them (ADR 0003).

### Phase 3: Capture and targeting

- Add the **Draft answer** selection context menu.
- Capture the selected question.
- Locate only a nearby compatible field.
- Create a short-lived `FieldTarget` fingerprint.
- Offer manual field selection when targeting is uncertain.

### Phase 4: Draft generation

- Send only the question, bounded job context, the user's profile content within the 40,000 code-point cap, and writing constraints.
- Invoke the provider CLI (Claude Code or Codex) without a shell, tools, MCP servers, hooks, skills, or persistent sessions.
- Require structured output with an answer, evidence quotes, and warnings.
- Validate length, that every evidence quote is an exact excerpt of the résumé or a cited story, and that numbers, years, percentages, and amounts in the answer appear in the user's text, the question, or the job context.

### Phase 5: Review and insertion

- Present an editable answer in the side panel.
- Require an explicit Insert action.
- Revalidate the field before writing.
- Use native value setters and appropriate events.
- Verify the value after framework rerenders.
- Fall back to manual field selection or clipboard copy when safe insertion is unavailable.

### Phase 6: Hardening and private beta

- Test fixture forms and representative supported ATS pages.
- Add prompt-injection, protocol, privacy, and failure tests.
- Block LinkedIn and Indeed.
- Package the helper, registration script, and extension for personal installation.
- Do not pursue public distribution until the provider-integration and site-policy questions are resolved.

## Research-driven constraints

- Chrome supports selection context menus, side panels, content scripts, and native messaging, making the core workflow technically feasible.
- Neither Claude Pro nor ChatGPT Plus includes API keys, so drafting uses the official `claude` or `codex` CLI signed in with the user's own subscription. This is acceptable for private personal use ([ADR 0002](decisions/0002-subscription-cli-providers.md)); it is not promised for public distribution. Both providers' current terms must be rechecked before relying on a CLI route.
- LinkedIn and Indeed publish restrictions relevant to third-party browser automation. They are blocked rather than treated as supported targets.
- Consumer subscription use (Claude or ChatGPT) is not zero-retention. The product must minimize transmitted data and disclose that local session settings do not control provider-side retention.
- AI-detector avoidance cannot be guaranteed. The legitimate objective is accurate writing that matches the user's real voice.

## References

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Anthropic Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [LinkedIn prohibited software](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions)
- [Indeed terms](https://www.indeed.com/legal?hl=en_US)
