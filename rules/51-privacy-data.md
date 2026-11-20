# Privacy and Data Rules

The résumé, stories, writing samples, job descriptions, questions, and drafts are sensitive personal data.

## Data minimization

- Collect only data needed for drafting.
- Keep the complete profile in the Go helper.
- Select the smallest relevant verified fact set for each request.
- Bound job-description context instead of sending an entire page.
- Do not collect browsing history, unrelated form fields, employer responses, or application status.
- Version one has no telemetry or remote analytics.

## Transparency and control

- Show extracted résumé text before accepting it as verified profile data.
- Let users correct or delete facts, stories, samples, and rules.
- Provide export and delete-all-data actions.
- Explain what is sent to the selected provider before first use, using the disclosure text in `specs/06-prd.md` section 18.1, and warn before saving facts that contain email, phone, or street-address patterns.
- Disclose that disabling local session persistence does not guarantee provider-side zero retention.
- Do not describe local storage as encrypted unless encryption is actually implemented and verified.

## Storage

- Store sensitive files in an application-owned user directory with owner-only permissions.
- Use atomic writes and validated formats.
- Separate user data from packaged application files and source code.
- Do not store routine drafts or job descriptions by default.
- Do not put sensitive data in browser sync storage.
- Temporary files are private, narrowly scoped, and deleted promptly.

## Logging and diagnostics

- Never log résumé text, profile facts, stories, writing samples, questions, job descriptions, prompts, provider output, drafts, field values, clipboard contents, or credentials.
- Log only event names, sanitized error codes, versions, durations, and bounded non-sensitive diagnostics needed locally.
- User-exported diagnostics must be previewable before sharing.
- Screenshots are not collected automatically.

## Data flow

- The webpage receives only the final answer inserted by the user.
- Content scripts receive only bounded page context and the final approved answer.
- The provider receives only the selected question, bounded job context, relevant verified facts, and writing constraints.
- No third party other than the explicitly selected provider receives user content.

## Deletion

Delete-all-data removes the local profile, extracted text, stories, samples, rules, cached provider data owned by this app, and app-created temporary artifacts. It does not claim to delete data retained independently by Chrome, the provider, an employer site, backups, or the operating system.
