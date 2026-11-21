import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  MAX_DOCX_FILE_BYTES,
  MAX_PDF_FILE_BYTES,
  MAX_PDF_PAGES,
  MAX_PROFILE_TOTAL_CHARS,
  MAX_RESUME_CHARS,
} from '../../lib/constants/limits';
import type { AppError } from '../../schemas/error';
import type { Profile, ResumeSource } from '../../schemas/profile';
import { prepareResumeUpload, type ResumeUploadRefusal } from '../../lib/profile/resume-upload';
import type { ProfileActions } from '../../lib/profile/use-profile';
import {
  checkProfileTotal,
  countChars,
  hasErrors,
  profileContentChars,
  validateResume,
} from '../../lib/profile/validation';
import { detectSensitiveText, type SensitiveCategory } from '../../lib/profile/sensitive-text';
import { ErrorAlert, TextField } from './Controls';
import { SensitiveWarningDialog } from './Dialogs';
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';

type ImportedSource = Exclude<ResumeSource, 'pasted'>;

/**
 * The single résumé: one editable text box with a code-point counter and a Save
 * button. Nothing is saved until Save, and the box keeps what the user typed
 * when the helper refuses or a client check fails. Contact details only warn
 * (PRIV-008, Save anyway).
 *
 * A .docx or .pdf can be uploaded and its text is put in the box for review
 * (replacing the box only after a confirmation when the box has unsaved edits).
 * A .docx is read by the helper; a PDF is read here in the page with pdf.js
 * (ADR 0004) and only the extracted text is used. Saving is still the only thing
 * that stores anything.
 * Source rule: Save sends "docx" or "pdf" while the box's text came from that
 * kind of upload, even after the user edits it; emptying the box resets it to
 * "pasted". A saved résumé keeps its stored source until then.
 */

const PASTE = 'Paste your résumé text into the box instead.';
const REFUSALS: Record<ResumeUploadRefusal, string> = {
  'too-large': `That file is too large to import (the limit is ${MAX_PDF_FILE_BYTES / 1024 / 1024} MiB for a PDF and ${Math.floor(MAX_DOCX_FILE_BYTES / 1024)} KiB for a .docx). ${PASTE}`,
  empty: `That file is empty. ${PASTE}`,
  unreadable: `That file could not be read. ${PASTE}`,
  'pdf-too-large': `That PDF is too large to import (the limit is ${MAX_PDF_FILE_BYTES / 1024 / 1024} MiB). ${PASTE}`,
  'pdf-too-many-pages': `That PDF has more than ${MAX_PDF_PAGES} pages, which is too many for a résumé. ${PASTE}`,
  'pdf-encrypted': `That PDF is password-protected or encrypted. Remove the protection first, or paste your résumé text into the box instead.`,
  'pdf-no-text':
    'This PDF has no selectable text (it may be a scan). Paste your résumé text instead.',
  'pdf-too-much-text': `That PDF has too much text to import. ${PASTE}`,
  'pdf-timeout': `Reading that PDF took too long. ${PASTE}`,
  'pdf-invalid': `That PDF could not be read. It may be damaged or not a real PDF. ${PASTE}`,
};
const IMPORT_FAILED =
  'That document could not be read. It may be password-protected, damaged, not a .docx file, empty, or too large. Paste your résumé text into the box instead.';
export function ResumeSection({ profile, actions }: { profile: Profile; actions: ProfileActions }) {
  const saved = profile.resume;
  const [text, setText] = useState(saved?.text ?? '');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<AppError | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [warning, setWarning] = useState<SensitiveCategory[] | null>(null);
  const [source, setSource] = useState<ResumeSource>(saved?.source ?? 'pasted');
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<{ text: string; error?: AppError } | null>(null);
  const [pending, setPending] = useState<{ text: string; source: ImportedSource } | null>(null);
  const uploadId = useId();
  const saveId = useId();
  const inFlight = useRef(false);

  const fieldErrors = validateResume({ text });
  const others = profileContentChars({ ...profile, resume: null });
  const totalError = checkProfileTotal(others + countChars(text));
  const error = attempted ? (fieldErrors.text ?? totalError) : undefined;

  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    const result = await actions.saveResume({ text: text.trim(), source });
    inFlight.current = false;
    setSaving(false);
    if (result.ok) {
      setJustSaved(true);
      setAttempted(false);
    } else {
      setServerError(result.error);
    }
  }

  function applyImported(imported: string, from: ImportedSource) {
    setText(imported);
    setSource(from);
    setJustSaved(false);
    // Over the résumé limit: show the limit error right away so the user can trim.
    setAttempted(countChars(imported) > MAX_RESUME_CHARS);
    setPending(null);
    setImportNote(
      `Text was extracted from your ${from === 'pdf' ? 'PDF' : 'document'}. Review and edit it below, then click Save résumé. Nothing is saved yet.` +
        (from === 'pdf'
          ? ' Check the line order, bullets, and special characters, because PDF layout can be read out of order.'
          : ''),
    );
  }

  function offerImported(imported: string, from: ImportedSource) {
    // Unsaved edits are never replaced silently.
    if (text.trim() !== '' && text.trim() !== (saved?.text ?? '')) {
      setPending({ text: imported, source: from });
    } else applyImported(imported, from);
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    // Reset so choosing the same file again fires another change event.
    input.value = '';
    if (file === undefined || importing) return;
    setImportNote(null);
    setImportError(null);
    setPending(null);
    setImporting(true);
    const prepared = await prepareResumeUpload(file);
    if (!prepared.ok) {
      setImporting(false);
      setImportError({ text: REFUSALS[prepared.reason] });
      return;
    }
    if (prepared.kind === 'pdf') {
      setImporting(false);
      offerImported(prepared.text, 'pdf');
      return;
    }
    const result = await actions.importDocument(prepared.payload);
    setImporting(false);
    if (!result.ok) {
      setImportError(
        result.error.code === 'INVALID_REQUEST'
          ? { text: IMPORT_FAILED }
          : { text: 'You can also paste your résumé text into the box.', error: result.error },
      );
      return;
    }
    offerImported(result.value.text, 'docx');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || warning !== null) return;
    setAttempted(true);
    setJustSaved(false);
    if (hasErrors(fieldErrors) || totalError !== undefined) return;
    // PRIV-008 (decision D10): a résumé usually trips this; it only warns.
    const found = detectSensitiveText([text]);
    if (found.length > 0) {
      setWarning(found);
      return;
    }
    void send();
  }

  return (
    <section aria-labelledby="resume-heading" className="mt-4">
      <h2 id="resume-heading" tabIndex={-1} className="text-base font-semibold">
        Résumé
      </h2>
      <p className="text-muted mt-1">
        Paste your résumé as plain text, or upload a .pdf or .docx file to fill the box. Every draft
        sends it, whole, to the provider you choose, so remove contact details you do not want sent.
        Your whole profile is limited to {MAX_PROFILE_TOTAL_CHARS.toLocaleString('en-US')}{' '}
        characters.
      </p>
      <div className="mt-3">
        <label htmlFor={uploadId} className="block font-medium">
          Upload résumé (.pdf or .docx)
        </label>
        <input
          id={uploadId}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={INPUT}
          disabled={importing}
          onChange={(event) => void onPickFile(event)}
        />
        <p className="text-muted mt-1">
          PDF files up to {MAX_PDF_FILE_BYTES / 1024 / 1024} MiB ({MAX_PDF_PAGES} pages) and .docx
          files up to {Math.floor(MAX_DOCX_FILE_BYTES / 1024)} KiB are read on this Mac only. A PDF
          needs selectable text; a scan does not work. The text appears below for you to review and
          nothing is saved until you click Save résumé.
        </p>
        {importing && (
          <p role="status" className="state state-loading mt-2">
            Reading your document.
          </p>
        )}
        {importNote !== null && (
          <p role="status" className="state state-success mt-2">
            {importNote}
          </p>
        )}
        {importError !== null && (
          <div role="alert" className="state state-error mt-3">
            {importError.error !== undefined && (
              <>
                <p className="font-medium">{importError.error.message}</p>
                {importError.error.userAction !== undefined && (
                  <p>Next step: {importError.error.userAction}.</p>
                )}
              </>
            )}
            <p>{importError.text}</p>
          </div>
        )}
        {pending !== null && (
          <div role="alert" className="state state-warning mt-3">
            <p className="font-medium">Replace the text in the box with the uploaded document?</p>
            <p>The box has edits that are not saved yet. They would be lost.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={() => applyImported(pending.text, pending.source)}
              >
                Replace with uploaded text
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setPending(null)}>
                Keep my text
              </button>
            </div>
          </div>
        )}
      </div>
      <form noValidate onSubmit={onSubmit}>
        <TextField
          label="Résumé text"
          multiline
          rows={18}
          value={text}
          onChange={(value) => {
            setText(value);
            setJustSaved(false);
            if (value.trim() === '') setSource('pasted');
          }}
          error={error}
          counter={{ count: countChars(text), max: MAX_RESUME_CHARS }}
        />
        {serverError !== null && <ErrorAlert error={serverError} />}
        <div className="mt-4">
          <button id={saveId} type="submit" className={PRIMARY_BUTTON} disabled={saving}>
            {saving ? 'Saving…' : 'Save résumé'}
          </button>
        </div>
        {saving && (
          <p role="status" className="state state-loading mt-2">
            Saving your résumé.
          </p>
        )}
        {justSaved && (
          <p role="status" className="state state-success mt-2">
            Résumé saved.
          </p>
        )}
      </form>
      <SensitiveWarningDialog
        categories={warning}
        noun="résumé"
        onSaveAnyway={() => {
          setWarning(null);
          void send();
        }}
        onCancel={() => setWarning(null)}
        returnFocusId={saveId}
      />
    </section>
  );
}
