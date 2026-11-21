# Manual test checklist

What the owner should test by hand at each step; each section lists setup, exact steps, and expected results.

## 2B.1 and 2B.2 — profile v2 and settings

### Setup

1. In a terminal at the repo root, run `npm run helper:build`, then `npm run helper:dev-install`. This rebuilds the helper and points Chrome at the new copy.
2. Run `npm run build`. In Chrome open `chrome://extensions`, find the unpacked extension (`.output/chrome-mv3`), and click its reload arrow.
3. Your existing real profile file (`~/Library/Application Support/JobAnswerDrafter/profile.json`) is the old version 1 and the new helper rejects it. Do not edit it by hand. You clear it in the first test below.
4. Open the settings page: on `chrome://extensions` click **Details** on the extension, then **Extension options**.

### 1. Clear the old profile

1. On the settings page you will probably see a red message: "The profile could not be read or saved." This is expected for the old file.
2. Click the **Privacy** tab. Under **Your data** click **Delete all data…**.
3. Type `DELETE` in the box and click **Delete all data**.
4. Expected: the dialog closes. Reload the settings page. The red message is gone and the **Résumé** tab shows an empty Résumé text box.

### 2. Save a résumé

1. Click the **Résumé** tab. Click in the Résumé text box and paste some made-up résumé text with no email or phone number (for example "Built a budgeting tool for a student club in Go. Led a team of 3 in 2022.").
2. Expected: under the box you see "N of 15000 characters" and N goes up as you type. Nothing is saved yet.
3. Reload the page without clicking Save. Expected: the box is empty again (nothing was saved).
4. Paste the text again and click **Save résumé**.
5. Expected: "Résumé saved." appears. Reload the page: the text is still there.
6. Change one word, click **Save résumé** again, reload. Expected: the new text replaces the old one.

### 3. Add a story, a writing sample, and a writing rule

1. Click the **Stories** tab. Expected: "No stories yet." Click **Add story**, enter a title and some text, click **Save story**.
2. Expected: the story appears in the list with "1 of 30 stories saved." Click **Edit story**, change the text, save, and confirm the change shows.
3. Click **Delete story** on it. Expected: a dialog names the story. Click **Cancel**: nothing changes. Open it again and click **Delete**: the story is gone.
4. Add another story. Expected: it is saved (IDs are never reused, which you cannot see, but nothing breaks).
5. Click **Writing samples**, add one with a label and text, save. Expected: it appears in the list.
6. Click **Writing rules**, add one rule such as "Keep it under 120 words.", save. Expected: it appears in the list.
7. Expected: there is no **Facts** tab and no tick box about accuracy anywhere.

### 4. Size limit checks

1. On the **Résumé** tab paste more than 15,000 characters (for example copy a paragraph and paste it many times). Expected: the counter turns red ("15001 of 15000 characters" or more).
2. Click **Save résumé**. Expected: an error under the box tells you to shorten the text. Your pasted text is still in the box and nothing was saved.
3. Delete text until the counter is 15,000 or less. Expected: it saves normally.
4. To test the whole-profile limit of 40,000, add stories of about 3,000 characters each until you have 9 or so, then try a long résumé. Expected: Save résumé shows an error saying your profile would hold more than 40000 characters, and nothing is saved. Shorten the text and it saves.
5. On the **Stories** tab, a story title over 100 characters or a story over 3,000 characters shows an error under that field.

### 5. Sensitive text warning

1. On the **Résumé** tab put an email address (for example `sam.example@example.com`) in the box and click **Save résumé**.
2. Expected: a dialog "This résumé may contain personal details" says it looks like an email address. It does not show the email itself. Nothing is saved yet.
3. Click **Cancel**. Expected: you are back in the box with your text unchanged.
4. Click **Save résumé** again, then **Save anyway**. Expected: "Résumé saved."
5. Repeat on the Stories tab with a phone number such as `555-123-4567`, and on Writing samples with `42 Maple Street`. Expected: the same warning, and the item saves only after **Save anyway**.

### 6. Side panel hint with and without a résumé

1. Clear the résumé: on the **Privacy** tab click **Delete all data…**, type `DELETE`, confirm. Reload the settings page.
2. Open a plain test page with a text box, for example one of the files in `tests/fixtures/` served by `node tests/fixtures/serve.mjs`, at `http://127.0.0.1:4310/basic-question.html`. Do not use a real employer page.
3. Select the question text, right-click, and choose **Draft answer**. Open the side panel if it does not open by itself.
4. Expected: the panel shows "Add your résumé in the extension's settings before drafting." and the **Generate draft** button is greyed out.
5. Go to the settings page, save a résumé (use text without contact details), then click back into the side panel window or tab.
6. Expected: the hint disappears and **Generate draft** is enabled. (Drafting itself is not part of this step.)
7. Delete the résumé again (**Delete all data…**) and add only a story. Expected: with only a story the panel still shows the hint and Generate draft stays disabled.

### 7. Export and delete all

1. Save a résumé and one story. On the **Privacy** tab click **Export my data**.
2. Expected: a file downloads. Open it in a text editor: it has `"schemaVersion": 2`, your résumé text, and your story. Delete the downloaded file when you are done; it contains your data.
3. Click **Delete all data…**, type `DELETE`, confirm.
4. Expected: the Résumé box and the Stories list are empty after reload, and the side panel hint from test 6 shows again.
5. Read the Privacy tab text once. Expected: it says each draft sends the question, the job description, your whole résumé, all your stories, all your writing samples, and your enabled writing rules, and it tells you to remove contact details from the saved text if you do not want them sent.

## 2B.3 — grounded draft with the fake provider

This step makes drafting use your whole saved profile. The fake provider still writes a fixed sample answer (it starts with "Deterministic sample draft based on your saved resume:" and repeats the start of your résumé), but now it also cites evidence quotes, and the helper checks every quote before the panel shows anything. No real Claude or Codex is involved yet.

### Setup

1. In a terminal at the repo root, run `npm run helper:build`, then `npm run helper:dev-install`. This rebuilds the helper and points Chrome at the new copy. Chrome starts a fresh helper for every draft, so you do not need to restart Chrome.
2. Run `npm run build`. In Chrome open `chrome://extensions`, find the unpacked extension (`.output/chrome-mv3`), and click its reload arrow.
3. Start the local test page server in a second terminal: `node tests/fixtures/serve.mjs`. Use only pages from `http://127.0.0.1:4310/` for these tests, never a real employer page.
4. Open the settings page (**Details**, then **Extension options**). On the **Privacy** tab, if you have saved data from earlier tests you want to start clean, click **Delete all data…**, type `DELETE`, and confirm. Use only made-up text below.

### 1. Draft with a résumé and a story

1. On the **Résumé** tab paste: `Built a budgeting tool for a student club in Go. Led a team of 3 in 2022.` and click **Save résumé**. Expected: "Résumé saved."
2. On the **Stories** tab click **Add story**, give it the title `Club project` and the text `Organized a weekly study group for first-year students and kept notes for everyone.`, and click **Save story**. Expected: the story appears in the list.
3. Open `http://127.0.0.1:4310/basic-question.html` in a tab. Select the question text, right-click, and choose **Draft answer**. Open the side panel if it does not open by itself.
4. Expected: the panel shows the question, an "Answer field: found" line, and an enabled **Generate draft** button.
5. Click **Generate draft**. Expected: a **Draft answer** box appears starting with "Deterministic sample draft based on your saved resume:" followed by your résumé text.
6. Expected: under the box a line says "Generated draft. Evidence: 2 quotes. Nothing has been inserted into the page." There is no "Facts used" anywhere.
7. Click **Evidence** to open the list. Expected: two lines. The first starts with "Résumé:" and shows the first part of your résumé in quotation marks. The second starts with "Story:" and shows the start of your story text in quotation marks. Neither line shows a story ID or any HTML.
8. Expected: the page's text box on the test page is still empty. Nothing was inserted.

### 2. Insert still needs your click

1. In the same panel click **Insert answer** only after reading the draft. Expected: the answer is written into the page's one text box and the panel says it was inserted. Nothing else on the page changes and nothing is submitted.
2. Select the question again, choose **Draft answer**, and click **Generate draft**. Type a few words into the page's text box yourself first. Click **Insert answer**. Expected: the page keeps your text and the panel tells you the field is not empty (overwriting needs a later step). Nothing is replaced.

### 3. Only the résumé quote when there are no stories

1. In settings, delete your story (**Stories** tab, **Delete story**, confirm).
2. Draft again from the test page. Expected: "Evidence: 1 quote." and the list has only the **Résumé:** line.

### 4. No résumé means no drafting

1. In settings click **Privacy**, **Delete all data…**, type `DELETE`, confirm. Add only a story (no résumé).
2. Select a question on the test page, choose **Draft answer**. Expected: the panel says "Add your résumé in the extension's settings before drafting." and **Generate draft** is greyed out.
3. Save a résumé, click back into the side panel. Expected: the hint goes away and **Generate draft** works again.

### 5. A very short résumé cannot be cited

1. Replace the résumé with the text `Go dev` and save it. Delete your stories.
2. Draft from the test page. Expected: a red box says "The draft was not supported by your résumé and stories." with the next step "Regenerate, or add the missing detail to your résumé or stories." No draft text appears, and your question is still in the box.
3. Put a normal résumé back (as in test 1) and draft again. Expected: it works.

### 6. Whole profile and the 40,000-character limit

1. Save a résumé of about 15,000 characters and several stories of about 3,000 characters each, until the total is near 40,000. Expected: saving works until the total would pass 40,000, then it shows an error and saves nothing.
2. Draft from the test page. Expected: a draft with evidence quotes appears (the fake provider only shows the start of the résumé and first story, but the helper receives all of them).
3. Delete the large stories when you are done.

### 7. Nothing leaks

1. Open the side panel while a draft is showing. Expected: you see only the question, the draft, the evidence quotes, and any warnings. Your other stories, samples, and rules are not shown anywhere.
2. In the test page, right-click and choose **Inspect**, open the Console, and look: Expected: no messages mention your résumé, stories, or draft text.

### Not covered here

- Real Claude or Codex output, and what happens when a real model invents a number or a quote: those failure cases are covered by automated tests with fake providers (a quote that is not in your résumé, an unknown story, a made-up number, an empty answer) and get a manual check in Slice 3.

## 2B.4 — résumé upload (DOCX)

You can now fill the Résumé box from a Word `.docx` file. The helper reads the file on this Mac and returns plain text; nothing is saved until you click **Save résumé**. PDF upload is covered in section 2B.4b.

### Setup

1. In a terminal at the repo root, run `npm run helper:build`, then `npm run helper:dev-install`.
2. Run `npm run build`. In Chrome open `chrome://extensions`, find the unpacked extension (`.output/chrome-mv3`), and click its reload arrow.
3. Open the settings page (**Details**, then **Extension options**) and stay on the **Résumé** tab.
4. Get a `.docx` copy of your résumé. If you only have a PDF or Pages file: open it in Word, Pages, or Google Docs and use **File**, then **Save As** or **Download**, and choose **Word (.docx)**. Keep the copy outside this repository (for example on your Desktop outside the project folder) and do not commit it. Your real résumé is only used by you, by hand, here; automated tests use made-up files.
5. The file must be at most 190 KiB (a typical text résumé is 20 to 80 KiB). If yours is larger, remove images or logos and save again, or paste the text instead.

### 1. Upload fills the box and saves nothing

1. Under **Upload résumé (.pdf or .docx)** click **Choose File** and pick your `.docx` file.
2. Expected: a line says "Text was extracted from your document. Review and edit it below, then click Save résumé. Nothing is saved yet." and the Résumé text box fills with your résumé, one line per paragraph, with "- " in front of bullet points. Your file name is not shown anywhere.
3. Reload the settings page without clicking Save. Expected: the box is back to what was saved before (empty if nothing was saved). The upload saved nothing.
4. Upload the file again, fix anything that looks wrong in the box (columns or tables can come out in an odd order), and click **Save résumé**. Expected: "Résumé saved." Reload: the text is still there.

### 2. Unsaved typing is protected

1. Type a few words in the box (do not save). Upload the file again.
2. Expected: an alert asks "Replace the text in the box with the uploaded document?". Click **Keep my text**. Expected: your words are still in the box.
3. Upload again and click **Replace with uploaded text**. Expected: the box now holds the document text. Still nothing is saved.

### 3. Files that cannot be read

1. Rename a `.txt` file to `something.docx` and upload it. Expected: a red box says the document could not be read (it may be password-protected, damaged, not a .docx file, empty, or too large) and tells you to paste your résumé text into the box instead. The box is unchanged.
2. If you have a password-protected `.docx`, upload it. Expected: the same red box.
3. Upload a `.docx` larger than 190 KiB, or any file with the **All Files** option in the picker. Expected: a red box about the size or file type, with the paste fallback. Nothing is sent.
4. Pick a `.pdf` file. PDF upload has its own steps in section 2B.4b below.
5. In every case, paste text into the box and click **Save résumé**. Expected: it saves normally.

### 4. Source and your data

1. After saving an uploaded résumé, click **Privacy**, then **Export my data**. Open the downloaded file in a text editor. Expected: `"resume"` has `"source": "docx"` and your text (this file contains your résumé, so delete it when done).
2. Back on **Résumé**, empty the box, paste new text, and save. Export again. Expected: `"source": "pasted"`. (Editing the uploaded text keeps `docx`; only emptying the box resets it.)
3. Click **Delete all data…**, type `DELETE`, confirm. Expected: the résumé is gone after a reload.
4. Draft once from `http://127.0.0.1:4310/basic-question.html` after saving an uploaded résumé. Expected: it behaves like a pasted résumé.

## 2B.4b — PDF upload

You can now fill the Résumé box from a `.pdf` file. The text is read inside the settings page on this Mac (no network, nothing sent to the helper or any provider) and put in the box; nothing is saved until you click **Save résumé**. It reads PDFs with selectable text, up to 5 MiB and 10 pages. A scan (a picture of text) has no selectable text and cannot be read.

### Setup

1. In a terminal at the repo root run `npm run build`. Make sure the helper is installed as in 2B.4 (`npm run helper:build`, then `npm run helper:dev-install`).
2. In Chrome open `chrome://extensions`, find the unpacked extension (`.output/chrome-mv3`), and click its reload arrow. Open the settings page (**Details**, then **Extension options**) and stay on the **Résumé** tab.
3. Have your own PDF résumé ready somewhere outside this repository (for example on your Desktop outside the project folder). Do not commit it. If you have them, also have a scanned PDF, a password-protected PDF, and a PDF larger than 5 MiB.

### 1. Upload your PDF résumé

1. Under **Upload résumé (.pdf or .docx)** click **Choose File** and pick your PDF.
2. Expected: a line says "Text was extracted from your PDF. Review and edit it below, then click Save résumé. Nothing is saved yet." plus a reminder to check line order, bullets, and special characters. The Résumé text box fills with your résumé. Your file name is not shown anywhere.
3. Read the box from top to bottom and check:
   - **Text order:** sections and lines appear in the order you would read them on the page.
   - **Bullets:** bullet points start with "- ".
   - **Columns:** if your résumé has two columns, the left column should be read first, then the right. Sidebars, tables, and text boxes can come out in a different order; that is a known limitation, so note exactly what is out of order.
   - **Special characters:** accents, dashes, quotes, and symbols look right (for example é, —, ’). Common ligatures such as "fi" in "first" should read as normal letters.
   - **Line breaks:** a word split by a hyphen at the end of a line stays as written (the app does not join it).
   - **Extras:** page numbers or repeated headers and footers may appear; delete them if you like.
4. Reload the settings page without clicking Save. Expected: the box is back to what was saved before (empty if nothing was saved). The upload saved nothing.

### 2. Edit and Save

1. Upload the PDF again, fix anything that looks wrong in the box, and click **Save résumé**. Expected: "Résumé saved." Reload: the text is still there.
2. Click **Privacy**, then **Export my data**, and open the downloaded file in a text editor. Expected: `"resume"` has `"source": "pdf"` and your text (this file contains your résumé, so delete it when done).
3. On **Résumé**, empty the box, paste new text, and save. Export again. Expected: `"source": "pasted"`. (Editing the uploaded text keeps `pdf`; only emptying the box resets it.)

### 3. Unsaved typing is protected

1. Type a few words in the box (do not save), then upload the PDF.
2. Expected: an alert asks "Replace the text in the box with the uploaded document?". Click **Keep my text**: your words stay. Upload again and click **Replace with uploaded text**: the box now holds the PDF text. Still nothing is saved.

### 4. Files that cannot be read

For each, expected: a red box with a plain message and the advice to paste your résumé text into the box; the box is unchanged and nothing is saved. Pasting text and clicking **Save résumé** still works afterward.

1. A scanned PDF (if you have one): "This PDF has no selectable text (it may be a scan). Paste your résumé text instead."
2. A password-protected PDF (if you have one): the PDF is password-protected or encrypted.
3. A PDF larger than 5 MiB (if you have one), or a PDF with more than 10 pages: a message about size or page count.
4. Rename a `.txt` file to `something.pdf` and upload it: the PDF could not be read.
5. A résumé with more than 15,000 characters of text (a long PDF such as an article, if you have one): the whole text appears in the box with the red over-limit message; trim it, then Save works.

### 5. Delete all

1. Click **Privacy**, **Delete all data…**, type `DELETE`, confirm. Expected: the résumé is gone after a reload.

### What to report back

- Which of the checks above passed or failed.
- For your PDF: what was out of order (describe the layout: one column, two columns, sidebar, table), which bullets or characters looked wrong, and roughly how many lines needed fixing. Do not paste your résumé text; describe the problems instead.
- Whether any error message was unclear, whether anything felt slow (more than a couple of seconds for a one- or two-page PDF), and whether Chrome showed any new permission prompt (it should not).
- Your Chrome version (**chrome://version**).

## 3.0/3.1 — Claude check and provider diagnostics

What changed: the settings page has a new **Provider** section with a **Check provider** button. It asks the helper whether the `claude` command is installed and whether you are signed in. It never signs you in and never reads your Claude files. Drafting still uses the fake provider; this step only adds the check. Codex is not checked because it is not installed (its adapter is a stub).

### 1. Rebuild and reinstall the helper

1. In Terminal, in the project folder, run `npm run build`, then rebuild and reinstall the helper the same way you did after the last step (the installer step you used for the profile work).
2. In `chrome://extensions`, click the reload arrow on the extension. Then open the extension's **Settings** page.
3. Expected: below the profile tabs there is a **Provider** heading, a short explanation that Codex is not available yet, and a **Check provider** button. Nothing runs until you press it.

### 2. Check provider while signed in

1. Press **Check provider**.
2. Expected: "Checking…" for a moment, then three lines: **Helper: OK**, **Claude Code command: OK**, **Claude Code sign-in: OK**. It should take a few seconds at most.
3. Press it again. Expected: the same result, and the button is disabled only while it is checking.
4. Expected: no browser tab, login page, or Terminal window opens.

### 3. What a failure looks like (read only, do not try to cause these)

You do not need to sign out or move anything. These are the results the app shows, and the automated tests check each one with a fake `claude`:

- Claude Code not installed or not found: **Claude Code command** says "The provider command was not found. Next step: Install the selected provider CLI." The sign-in line is not shown.
- Signed out: **Claude Code sign-in** says "The provider is not signed in. Next step: Sign in with the CLI yourself." Sign in yourself in Terminal; the button does not do it for you.
- Takes too long (over 15 seconds) or the check is cancelled: the line says the provider took too long (Retry) or the request was cancelled.
- Anything unexpected from `claude` (for example a changed command): "The provider output was not usable. Next step: Regenerate."
- Helper not installed: a red box says the native helper is unavailable and to run the installer.

### Known limits

- The "usage limit reached" message from Claude Code has not been seen yet (seeing it would use up your plan limit), so the app recognizes it by a best guess at the wording. If it is not recognized, you would see "The provider output was not usable" instead.
- There is no provider choice yet (step 3.5). The check always looks at Claude Code.

## 3.2/3.3 — prompt and Claude invocation

What changed: the helper can now build the prompt and run `claude -p` safely, but nothing in the extension uses it yet. Drafting still uses the fake provider, so there is nothing to click and nothing new to see in Chrome. All checks use a fake `claude` program, never the real one, and never your real profile.

### 1. Nothing to click

1. Rebuilding or reloading the extension is not needed. The side panel and settings page behave exactly as after the last step.

### 2. Optional: run the automated checks yourself

1. In Terminal, in the project folder, run `cd helper && go test ./internal/prompt ./internal/provider/... -race`.
2. Expected: every line starts with `ok`. This runs the prompt tests (labels, injection-like job text, size limits) and the fake-`claude` tests (exact flags, only the prompt on stdin, only `HOME`, `PATH`, and `USER` passed on, timeout, cancel, oversized or broken output).
3. To read what the model would be sent, open `helper/internal/prompt/testdata/injection.golden`. It uses made-up text only.

### Known limits

- The real `claude` has not been called with this prompt. That happens in step 3.5, when the real provider is wired in and you try it.

## 3.4/3.5 — real drafting with Claude

What changed: drafting now runs your real `claude` command. Before it will draft, settings needs three things: you choose **Claude Code** as the provider, you read and accept the first-use disclosure, and a résumé is saved. The side panel says what is missing and links to settings. A draft is only shown if every evidence quote is an exact piece of your résumé or a story and every number in the answer appears in your text, the question, or the job description. This is the one real-draft test (AC-061): the automated tests only ever use a fake `claude`.

Use made-up or low-risk content for the first run. Each draft sends the question, the job description, your whole résumé, all your stories, all your writing samples, and your enabled writing rules to Claude. Before you start, check your Claude privacy settings (model training) as the disclosure tells you, and remove contact details from the saved résumé text if you do not want them sent.

### Setup

1. In Terminal, in the project folder, run `npm run helper:build`, then `npm run helper:dev-install`. This rebuilds the helper and points Chrome at the new copy.
2. Run `npm run build`. In Chrome open `chrome://extensions` and click the reload arrow on the unpacked extension (`.output/chrome-mv3`).
3. In Terminal check that you are signed in: run `claude auth status` and look for `"loggedIn": true`. If not, run `claude` and sign in yourself.
4. Have a page with a text box ready. Either a real application page you only want to look at (do not submit anything), or a local page: save a file `question.html` on your Desktop containing `<p>Why do you want to work at this company?</p><textarea rows="8" cols="60"></textarea>` and open it in Chrome.

### 1. Settings before the first draft

1. Open the extension's **Settings** page. The page now opens in its own browser tab.
2. Expected, top to bottom: **Before your first draft** (the disclosure) with a yellow note "Drafting is blocked until you accept this", **Provider** with **Claude Code** and **Codex (not available yet)**, and **Provider check**, then your profile tabs.
3. Expected: nothing is chosen. **Codex (not available yet)** is greyed out and cannot be clicked. The **Accept** button is disabled and **Check provider** is disabled.
4. Click **Claude Code**. Expected: "Provider saved: Claude Code." and **Check provider** is no longer disabled.
5. Read the disclosure. Tick **I have checked these settings.** and click **Accept**. Expected: the note changes to "You accepted this on <today's date>."
6. Click **Check provider**. Expected: **Helper: OK**, **Claude Code command: OK**, **Claude Code sign-in: OK**. No window or login page opens.
7. On the **Résumé** tab, make sure a résumé is saved (paste some text and click **Save résumé** if not). Add one story if you like.

### 2. The panel blocks drafting until settings are done (optional, quick)

1. To see the gate, open Settings, **Privacy** tab, **Delete all data…**, type `DELETE`, and confirm. This clears the provider choice, the disclosure, and the profile. (Skip this if you do not want to re-enter your profile; the automated tests already check it.)
2. Open your test page, select the question text, right-click, choose **Draft answer**. Expected in the side panel: "Choose Claude Code or Codex in settings before drafting." with an **Open settings** button, and **Generate draft** greyed out.
3. Click **Open settings**. Expected: the settings page opens. Choose Claude Code. Go back to the panel (click it). Expected: the hint changes to "Read and accept the first-use disclosure in settings before drafting." Accept the disclosure. Expected: next the résumé hint appears; save a résumé and the button turns on.

### 3. Generate one real draft

1. On your test page, select the question text, right-click, and choose **Draft answer**.
2. Expected: the side panel shows the question, "Answer field: found", and **Generate draft** (enabled).
3. Click **Generate draft**. Expected: "Generating with Claude Code… N s elapsed." and a **Cancel** button. The first run can take 10 to 60 seconds (the limit is 90 seconds).
4. Expected when it finishes: an editable **Draft answer** box, "N of 150 words", "Evidence: N quotes", and at the bottom **Insert answer**. Nothing has been put into the page yet.
5. Click **Evidence**. Expected: a list of quotes, each marked **Résumé** or **Story**. Open your résumé settings in another tab and confirm each quote really is a piece of your text, word for word.
6. Read the whole draft. For each factual statement (employer, title, tool, number, date) find the evidence quote that supports it. Write down any statement you cannot trace to a quote. This is the AC-061 check.
7. Click **Insert answer**. Expected: the draft appears in the text box on the page and the panel says "Inserted into: …". Check that nothing else on the page changed and nothing was submitted.

### 4. Things to try

- **A question your résumé does not cover.** Select a question such as "Describe your experience with Rust." when your résumé has nothing about Rust. Expected: either a short, honest draft that leaves it out, or a red message "The draft was not supported by your résumé and stories." with the next step. It must not invent experience. Note which one happened.
- **A refusal or an odd answer.** If Claude says it cannot answer, the panel should show "The provider output was not usable. Next step: Regenerate." and no draft. Note what you saw.
- **Warnings.** If a yellow "Warning: Check these names…" line appears, check those names yourself. A warning is not proof that the rest is right.
- **Cancel mid-draft.** Click **Generate draft**, then **Cancel** after a couple of seconds. Expected: the panel returns to your question with **Generate draft** enabled and no error. In Terminal run `pgrep -fl "claude -p"`. Expected: nothing is listed (the process was stopped). Your edited question is still in the box.
- **Edit and retry.** Change the question text, click **Generate draft** again, then **Generate again**. Expected: each works and your edit stays.
- **Sign out check (optional, only if you are comfortable).** In Terminal run `claude auth logout`, click **Generate draft**. Expected: "The provider is not signed in. Next step: Sign in with the CLI yourself." and your question is still there. Sign in again yourself afterwards with `claude`.

### What to report back

1. Did the real draft work end to end (draft, evidence, Insert)? How long did it take?
2. Every factual statement that did not trace to an evidence quote, and every quote that was not an exact piece of your text.
3. What happened for the question your résumé does not cover, and for the refusal or odd answer, if you saw one.
4. Any message you did not understand, and its exact wording.
5. If the usage-limit message ever appears, its exact wording (it has never been seen; the app guesses at it).
6. Whether **Cancel** stopped `claude` (the `pgrep` check).
7. Whether anything was written to a page without you pressing **Insert answer**, or anything was submitted. (It should never happen.)

### Known limits

- The prompt and the `--json-schema` flag have only been tested against a fake `claude` until this run. If the real `claude` rejects the flags, you will see "The provider output was not usable." Tell me, and do not edit settings by hand.
- Codex is not installed and cannot be chosen. One disclosure acceptance covers either provider.
- The quote and number checks are heuristics. A true quote can still support a false conclusion, so you review every draft.
