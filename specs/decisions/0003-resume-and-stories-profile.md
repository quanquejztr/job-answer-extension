# 0003: Résumé and Stories Profile With Quote Grounding

- Status: Accepted
- Date: 2026-11-20
- Supersedes: The fact-selection and evidence-ID parts of the PRD (fact cards, keyword selection, `evidenceIds`, `usedFacts`) and the wording "relevant verified facts" in the "Data boundary" decision of [0001](0001-foundational-decisions.md)

## Context

The first profile design had the user maintain small verified "facts". The helper selected relevant facts by keyword overlap with the question and job context, and the model cited fact evidence IDs. Slices 2.1 to 2.4 delivered this (fact data model, fact settings UI, the keyword selector, and fact logic in the fake provider). Manual use showed the design fails for the main use case: generic questions such as "Why do you want to work here?" share no keywords with any fact, so the selector chooses nothing and drafting is blocked. Maintaining and ticking individual facts is also more work than the owner wants to do.

## Decision

Decided by the owner on 2026-11-20.

1. **Profile content.** The profile holds one résumé text (plus its source: pasted, pdf, or docx), behavioral stories, writing samples, and writing rules. There are no facts, no accuracy tick, no keyword selection, no evidence IDs, no tags, and no story-to-fact links. The profile file becomes `schemaVersion: 2` with no migration from version 1 (the only existing data is owner test data); version 1 files are rejected as unsupported. Shape: `{ schemaVersion: 2, nextId, settings, resume: { text, source, updatedAt } | null, stories: [{ id "s_N", title, text, createdAt, updatedAt }], samples, rules }`. IDs for stories, samples, and rules stay monotonic and are never reused.
2. **Whole profile per draft.** Every draft sends the question, bounded job context, and the user's whole profile content (résumé text, all stories, all writing samples, all enabled rules) to the provider. Limits: résumé at most 15,000 code points; story title 100 and text 3,000; at most 30 stories; sample 3,000 and at most 5; rule 200 and at most 20. A total profile content cap of 40,000 code points (résumé, story titles and texts, sample texts, rule texts) is enforced when saving (a save that would exceed it is rejected with `INVALID_REQUEST` and a clear message) and re-checked before sending. The 384 KiB profile file cap and the 512 KiB response cap stay. The old per-fact limits (fact characters, tags, fact counts, selected-item caps, the 4,000-character selection budget) are removed.
3. **Grounding replaces evidence IDs.** The provider returns `{ answer, evidence: [{ source, quote }], warnings }`. `source` is `"resume"` or `"story:<id>"`; writing samples and rules are style guidance only and are never evidence. The helper verifies that every quote is an exact excerpt of that source's text after collapsing runs of whitespace to a single space (case-sensitive), each quote 12 to 300 code points. At least one valid evidence quote is required. Any invalid quote fails the draft with `FACT_VALIDATION_FAILED` and no answer is shown. The helper also checks the answer text: every number, year, percentage, and currency amount must appear in the résumé, stories, the question, or the job context, otherwise the draft fails with `FACT_VALIDATION_FAILED`. Capitalized multi-word names that appear nowhere in those texts produce an `UNSUPPORTED_CLAIM` warning (not a failure). `DraftResponse` becomes `{ answer, evidence: [{ source, quote }], warnings }`; the helper returns the verified evidence list to the panel (no `usedFacts`, no `evidenceIds`). An empty or over-limit answer remains `PROVIDER_OUTPUT_INVALID`. The catalog message for `FACT_VALIDATION_FAILED` changes to say the draft was not supported by the user's résumé and stories, with next step "Regenerate, or add the missing detail to your résumé or stories". This is a contract change to `tests/protocol-fixtures/errors.json`, to be made in code by step 2B.3.
4. **Drafting needs a résumé.** Drafting is blocked until a résumé is saved (stories are optional). The panel shows "Add your résumé in the extension's settings before drafting." and Generate draft is disabled. The worker message `panel.factCount.get` becomes `panel.profileStatus.get`, returning only `{ hasResume, storyCount }`. A helper-side draft with no résumé text returns `INVALID_REQUEST` as defense in depth.
5. **Résumé input.** The user can paste text, upload a PDF, or upload a DOCX. The extracted text is always shown in an editable box for the user to review and correct; nothing is saved until the user clicks Save. DOCX extraction uses the Go standard library only. Pasted text works first. The PDF approach (a Go parser versus extracting text in the extension page, and how large files travel given the 256 KiB native request cap) is **not decided here**: it is decided by a spike and a new ADR before any dependency is added (PRD decision D9). The owner will supply a real PDF résumé for the spike locally; real résumés are never committed, logged, or used in automated tests.
6. **Privacy wording.** PRIV-005 changes from "minimum relevant facts" to: send only the question, bounded job context, the profile content within the 40,000 cap, and writing constraints, and nothing else. The first-use disclosure (PRD 18.1) and the settings Privacy text say that each draft sends the question, the job description, the whole résumé, all stories, all writing samples, and the enabled writing rules to the chosen provider, keep the retention and training wording and the advice to avoid sensitive identifiers, and add that a résumé usually contains contact details, so the user should remove them from the saved text if they do not want them sent. PRIV-008's sensitive-text warning now applies to the résumé, stories, and samples; a résumé will usually trigger it, and it stays a warning with Save anyway (PRD decision D10).
7. **Permanent invariants** (`specs/05-contracts-and-invariants.md`) 8, 9, and 11 are rewritten; invariant 10 (the full profile never reaches a content script) is kept. 8: factual claims may be supported only by the user's résumé and stories, and every accepted draft carries at least one evidence quote verified as an exact excerpt. 9: numbers, years, percentages, and amounts not present in the user's text, the question, or the job context are rejected, and unsupported names are warned. 11: only the question, bounded job context, the user's profile content within the cap, and writing constraints are sent to the provider. Invariant 12 and the humanizer rule are unchanged.
8. **Superseded work.** The fact data model and fact UI (Slices 2.1 to 2.3) and the selector and fake-provider fact logic (Slice 2.4) are replaced by Slice 2B in `specs/07-implementation-plan.md`. Code is changed by later steps; until then the code and the docs differ and the docs win. Old Slice 6 is merged into Slice 2B.

## Alternatives considered

- Keep fact cards with keyword matching: rejected because generic questions match nothing, so drafting is blocked exactly when the user most needs it.
- Fact cards with a fallback set (for example the first N facts when nothing matches): rejected because it keeps the cost of maintaining and ticking facts and adds an arbitrary choice of what to send.
- Let the model choose which facts to use: rejected because it needs the whole profile at the model anyway and gives no deterministic record of what supported a claim.
- Send the whole profile with no grounding check: rejected because it removes the only machine check against invented claims.

## Consequences

- More personal data reaches the provider on every draft: the whole résumé (usually with contact details), all stories, and all samples.
- Prompts are larger, so each draft uses more of the user's plan allowance and may be slower.
- The quote and number checks are heuristics. They reduce but cannot eliminate invented claims (for example a true quote used to support a false inference), so the user must review every draft.
- Existing version 1 profile data is discarded; the owner re-enters a résumé.
- Previously delivered fact code, tests, and fixtures must be removed or rewritten by Slice 2B, including the `errors.json` message change and the `profile.item.upsert` kinds.
- The PDF parsing approach and file transport remain open until the spike and its ADR.

## Revisit when

- Prompt size or plan usage per draft becomes a problem, which would justify sending a bounded subset again.
- The quote and number checks let through invented claims in manual use, or reject too many good drafts.
- The owner wants a different disclosure or contact-detail policy for résumés.
- The PDF spike shows the chosen approach cannot meet the limits or the dependency policy.
- The product is considered for distribution beyond the owner.
