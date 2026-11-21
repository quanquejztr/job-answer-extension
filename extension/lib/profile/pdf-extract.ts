import {
  MAX_PDF_FILE_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  PDF_EXTRACT_TIMEOUT_MS,
} from '../constants/limits';
import { assembleDocument, type PdfTextItem } from './pdf-text';

/** Why a PDF was not turned into text. Messages never carry file content or the file name. */
export type PdfRefusal =
  | 'too-large'
  | 'too-many-pages'
  | 'encrypted'
  | 'no-text'
  | 'too-much-text'
  | 'timeout'
  | 'invalid';

export type PdfExtraction = { ok: true; text: string } | { ok: false; reason: PdfRefusal };

// The small part of pdf.js this module uses, so tests can supply a stand-in.
export interface PdfPageLike {
  getTextContent(): Promise<{ items: object[] }>;
  cleanup(): unknown;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}
/** One loaded pdf.js. `open` starts reading the bytes; `dispose` stops its worker. */
export interface PdfRuntime {
  open(data: Uint8Array): PdfLoadingTaskLike;
  dispose(): void;
}
export type LoadPdfRuntime = () => Promise<PdfRuntime>;

// pdf.js items are text items or marked-content markers; only text items count.
function toItem(raw: object): PdfTextItem | null {
  const r: Record<string, unknown> = { ...raw };
  if (typeof r.str !== 'string') return null;
  const t: unknown[] = Array.isArray(r.transform) ? r.transform : [];
  const num = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);
  return {
    str: r.str,
    x: num(t[4]),
    y: num(t[5]),
    width: num(r.width),
    height: num(r.height),
    hasEOL: r.hasEOL === true,
  };
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
}

function refusalFor(error: unknown): PdfRefusal {
  return errorName(error) === 'PasswordException' ? 'encrypted' : 'invalid';
}

class Refused extends Error {
  constructor(readonly reason: PdfRefusal) {
    super(reason);
  }
}

async function readText(runtime: PdfRuntime, bytes: Uint8Array): Promise<string> {
  // pdf.js transfers the buffer to its worker, so give it a copy.
  const task = runtime.open(bytes.slice());
  try {
    let doc: PdfDocumentLike;
    try {
      doc = await task.promise;
    } catch (error) {
      throw new Refused(refusalFor(error));
    }
    if (doc.numPages > MAX_PDF_PAGES) throw new Refused('too-many-pages');
    const pages: PdfTextItem[][] = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map(toItem).filter((i): i is PdfTextItem => i !== null));
        page.cleanup();
      }
    } catch (error) {
      throw new Refused(refusalFor(error));
    }
    const text = assembleDocument(pages);
    if (text.trim() === '') throw new Refused('no-text');
    if ([...text].length > MAX_PDF_TEXT_CHARS) throw new Refused('too-much-text');
    return text;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/**
 * Extracts the text of one PDF in the extension page. Text only: nothing is
 * rendered, no script runs, and nothing leaves the page. Bounded by file size,
 * page count, extracted text size, and a time limit; every failure is a typed
 * refusal so the page can show the paste fallback.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  loadRuntime: LoadPdfRuntime,
  timeoutMs: number = PDF_EXTRACT_TIMEOUT_MS,
): Promise<PdfExtraction> {
  if (bytes.length > MAX_PDF_FILE_BYTES) return { ok: false, reason: 'too-large' };
  let runtime: PdfRuntime | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Refused('timeout')), timeoutMs);
    });
    const work = (async () => {
      try {
        runtime = await loadRuntime();
      } catch {
        throw new Refused('invalid');
      }
      return readText(runtime, bytes);
    })();
    // If the time limit wins, the late result of `work` is dropped.
    work.catch(() => undefined);
    return { ok: true, text: await Promise.race([work, timeout]) };
  } catch (error) {
    return { ok: false, reason: error instanceof Refused ? error.reason : 'invalid' };
  } finally {
    clearTimeout(timer);
    runtime?.dispose();
  }
}
