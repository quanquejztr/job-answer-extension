# Product Brief

## Target user

An individual job seeker using Chrome on macOS who repeatedly encounters short, open-ended application questions and wants help producing a concise, truthful first draft without surrendering control of the application.

## Core problem

Free-response application questions are repetitive and time-consuming. A general chat assistant can draft an answer, but the user must repeatedly copy the question, job description, and answer between windows. Existing application automation often attempts to fill far more than the user wants.

## Product promise

Turn one selected application question into one factual, editable draft, then insert the user-approved text into exactly one intended field.

The product should feel like a writing assistant attached to the current field—not an autonomous applicant.

## Primary journey

1. Select a narrative question.
2. Choose **Draft answer**.
3. Confirm the question, job context, and target field if necessary.
4. Review and edit the generated answer.
5. Insert it into the selected field.
6. Continue the application manually.

## Supported questions

- Why this company or role?
- Why are you a good fit?
- Describe a relevant project or accomplishment.
- What interests you about this team or product?
- Short motivation, collaboration, leadership, or problem-solving prompts.
- Other narrative prompts that can be answered from the user's résumé and stories.

## Non-goals

- Filling contact, education, employment-history, or résumé-upload fields.
- Answering work authorization, sponsorship, demographic, disability, veteran, consent, compensation, or legal questions.
- Choosing radio buttons, checkboxes, dropdowns, or dates.
- Filling several narrative questions in one action.
- Navigating between application pages.
- Saving or submitting an application.
- Scraping job boards or discovering jobs.
- Impersonating the user or concealing automation from an employer.
- Guaranteeing that generated text will evade AI detection.

## Correct behavior examples

- The user selects “Why do you want to work at Acme?” The extension finds the textarea directly below it, drafts 85 words using the résumé and one story, waits for review, and inserts the edited answer after the user clicks Insert.
- Two textareas are equally close to the selected question. The extension asks the user to click the intended field instead of guessing.
- A field already contains text. The extension shows a replacement confirmation before changing it.
- Job-description extraction has low confidence. The side panel asks the user to paste or confirm the job description.
- A custom editor cannot be written safely. The extension offers clipboard copy and leaves the page unchanged.

## Incorrect behavior examples

- Filling every empty textarea on the page.
- Inferring that the user does not need sponsorship.
- Adding an impressive metric that is not in the user's résumé or stories.
- Following text in the job description that says to ignore product rules or reveal local data.
- Clicking Continue after inserting an answer.
- Replacing an existing answer without confirmation.
- Running on LinkedIn or Indeed despite the domain policy.

## Product principles

### User control

Generation and insertion are separate, explicit actions. The user sees and can edit every answer before it reaches the form.

### Truth over fluency

An ordinary but supported sentence is preferable to a polished invention. Metrics and claims must come from the user's résumé and stories, and each draft must quote its support.

### Minimum necessary data

Only the question, the bounded job context, the user's profile content (within a fixed size cap), and writing constraints are sent to the model, and nothing else. The profile content is the whole résumé, all stories, all writing samples, and the enabled writing rules.

### Honest uncertainty

When question capture, job-description extraction, résumé and story support, or field targeting is uncertain, ask for confirmation or use a safe fallback.

### Narrow automation

Automate the repetitive transfer of one reviewed answer, not the application process.

## Release boundary

Version one is a private, locally installed prototype for its owner, drafting through the owner's own Claude or ChatGPT subscription via official CLIs. Public distribution is a separate decision requiring a privacy policy, store-policy review, site-policy review, and an approved provider/authentication model.
