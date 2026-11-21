import { MAX_PDF_FILE_BYTES } from '../constants/limits';
import type { ImportDocumentPayload } from '../../schemas/profile';
import { prepareDocxBytes } from './docx-upload';
import { extractPdfText, type LoadPdfRuntime, type PdfRefusal } from './pdf-extract';
import { loadBrowserPdfRuntime } from './pdf-runtime';

/** Why a chosen file did not become résumé text. The file name is never kept or shown. */
export type ResumeUploadRefusal = 'too-large' | 'empty' | 'unreadable' | `pdf-${PdfRefusal}`;

export type PreparedResumeUpload =
  | { ok: true; kind: 'docx'; payload: ImportDocumentPayload }
  | { ok: true; kind: 'pdf'; text: string }
  | { ok: false; reason: ResumeUploadRefusal };

function looksLikePdf(file: File, bytes: Uint8Array): boolean {
  // The PDF header may follow a few bytes of junk, but must be in the first KiB.
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-') || file.type === 'application/pdf';
}

/**
 * Routes the picked file by its bytes (and declared type; the name is not
 * used). A PDF is read here, in the extension page, and only its text comes
 * back. A .docx is passed on as base64 for the helper to read. Nothing is saved.
 */
export async function prepareResumeUpload(
  file: File,
  loadPdfRuntime: LoadPdfRuntime = loadBrowserPdfRuntime,
): Promise<PreparedResumeUpload> {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_PDF_FILE_BYTES) return { ok: false, reason: 'too-large' };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (bytes.length > MAX_PDF_FILE_BYTES) return { ok: false, reason: 'too-large' };
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (looksLikePdf(file, bytes)) {
    const result = await extractPdfText(bytes, loadPdfRuntime);
    return result.ok
      ? { ok: true, kind: 'pdf', text: result.text }
      : { ok: false, reason: `pdf-${result.reason}` };
  }
  const docx = prepareDocxBytes(bytes);
  return docx.ok ? { ok: true, kind: 'docx', payload: docx.payload } : docx;
}
