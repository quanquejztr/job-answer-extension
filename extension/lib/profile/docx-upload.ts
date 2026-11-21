import { MAX_DOCX_FILE_BYTES } from '../constants/limits';
import type { ImportDocumentPayload } from '../../schemas/profile';

/** Why a chosen file was not sent to the helper. The file name is never kept or shown. */
export type DocxRefusal = 'too-large' | 'empty' | 'unreadable';

export type PreparedUpload =
  { ok: true; payload: ImportDocumentPayload } | { ok: false; reason: DocxRefusal };

/** Standard padded base64, built in chunks so large arrays do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Turns the bytes of a picked .docx into the helper payload, or says why not.
 * Only the size is checked here; the helper decides whether the bytes are a
 * readable .docx. PDFs are routed away before this (see resume-upload.ts).
 */
export function prepareDocxBytes(bytes: Uint8Array): PreparedUpload {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_DOCX_FILE_BYTES) return { ok: false, reason: 'too-large' };
  return { ok: true, payload: { bytesBase64: toBase64(bytes) } };
}
