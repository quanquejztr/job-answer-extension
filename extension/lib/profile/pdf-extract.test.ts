// @vitest-environment node
import { pathToFileURL } from 'node:url';
import { makePdf, simplePdf } from '../../../tests/support/make-pdf';
import { MAX_PDF_FILE_BYTES } from '../constants/limits';
import {
  extractPdfText,
  type LoadPdfRuntime,
  type PdfDocumentLike,
  type PdfRuntime,
} from './pdf-extract';
import { PDF_DOCUMENT_PARAMS, createPdfRuntime } from './pdf-runtime';

// Real pdf.js on synthetic PDFs. Node needs the legacy build (the main build is
// for current browsers; the Playwright test covers it in Chromium).
const realRuntime: LoadPdfRuntime = async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    `${process.cwd()}/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`,
  ).href;
  return createPdfRuntime(pdfjs);
};

const extract = (bytes: Uint8Array) => extractPdfText(bytes, realRuntime);

describe('extractPdfText with real pdf.js', () => {
  it('reads one page of lines, bullets, and Unicode', async () => {
    const result = await extract(
      simplePdf([
        'Made-up Person',
        'Résumé — Zoë’s “notes”',
        '• Built a small tool',
        '• Ran a club',
      ]),
    );
    expect(result).toEqual({
      ok: true,
      text: 'Made-up Person\nRésumé — Zoë’s “notes”\n- Built a small tool\n- Ran a club',
    });
  });

  it('separates pages with a blank line', async () => {
    const bytes = makePdf([
      { texts: [{ x: 72, y: 700, text: 'Page one' }] },
      { texts: [{ x: 72, y: 700, text: 'Page two' }] },
    ]);
    expect(await extract(bytes)).toEqual({ ok: true, text: 'Page one\n\nPage two' });
  });

  it('reads a simple two-column page column by column', async () => {
    const left = ['Skills', 'Go and Rust', 'Testing', 'Writing', 'Teaching'];
    const right = ['Experience', 'Built a tool', 'Ran a club', 'Wrote docs', 'Mentored people'];
    const bytes = makePdf([
      {
        texts: [
          { x: 72, y: 740, text: 'Made-up Person', size: 16 },
          // Stream order interleaves the columns row by row.
          ...left.flatMap((text, i) => [
            { x: 72, y: 700 - i * 16, text },
            { x: 330, y: 700 - i * 16, text: right[i] ?? '' },
          ]),
        ],
      },
    ]);
    expect(await extract(bytes)).toEqual({
      ok: true,
      text: ['Made-up Person', ...left, ...right].join('\n'),
    });
  });

  it('refuses a page with no text as a possible scan', async () => {
    expect(await extract(makePdf([{ texts: [] }, { texts: [] }]))).toEqual({
      ok: false,
      reason: 'no-text',
    });
    expect(await extract(simplePdf(['   ']))).toEqual({ ok: false, reason: 'no-text' });
  });

  it('refuses an encrypted file', async () => {
    expect(await extract(simplePdf(['Hidden'], { encrypt: true }))).toEqual({
      ok: false,
      reason: 'encrypted',
    });
  });

  it('refuses malformed files', async () => {
    const good = simplePdf(['Some text here']);
    for (const bytes of [
      new Uint8Array([1, 2, 3]),
      new TextEncoder().encode('%PDF-1.4\nthis is not a real document'),
      good.slice(0, 40),
    ]) {
      expect(await extract(bytes)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses more than the page limit', async () => {
    const pages = Array.from({ length: 11 }, (_, i) => ({
      texts: [{ x: 72, y: 700, text: `Page ${i + 1}` }],
    }));
    expect(await extract(makePdf(pages))).toEqual({ ok: false, reason: 'too-many-pages' });
    expect((await extract(makePdf(pages.slice(0, 10)))).ok).toBe(true);
  });

  it('refuses an oversize file without loading pdf.js', async () => {
    const load = vi.fn(realRuntime);
    const result = await extractPdfText(new Uint8Array(MAX_PDF_FILE_BYTES + 1), load);
    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(load).not.toHaveBeenCalled();
  });

  it('does nothing with a JavaScript OpenAction or link action', async () => {
    const alert = vi.fn();
    const target = globalThis as unknown as Record<string, unknown>;
    target.alert = alert;
    target.app = undefined;
    try {
      const result = await extract(simplePdf(['Harmless text'], { javascript: true }));
      expect(result).toEqual({ ok: true, text: 'Harmless text' });
      expect(target.__pdfScriptRan).toBeUndefined();
      expect(alert).not.toHaveBeenCalled();
      expect(target.app).toBeUndefined();
    } finally {
      delete target.alert;
      delete target.app;
    }
  });
});

describe('extractPdfText with a stand-in runtime', () => {
  function runtimeFor(doc: Promise<PdfDocumentLike>) {
    const destroy = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const runtime: PdfRuntime = { open: () => ({ promise: doc, destroy }), dispose };
    return { load: async () => runtime, destroy, dispose };
  }
  const oneLinePage = (text: string): PdfDocumentLike => ({
    numPages: 1,
    getPage: async () => ({
      getTextContent: async () => ({
        items: [
          { str: text, transform: [1, 0, 0, 1, 72, 700], width: 100, height: 12, hasEOL: true },
        ],
      }),
      cleanup: () => undefined,
    }),
  });

  it('passes a copy of the bytes, so the caller keeps its buffer', async () => {
    const seen: Uint8Array[] = [];
    const runtime: PdfRuntime = {
      open: (data) => {
        seen.push(data);
        return { promise: Promise.resolve(oneLinePage('x')), destroy: async () => undefined };
      },
      dispose: () => undefined,
    };
    const bytes = new Uint8Array([1, 2, 3]);
    await extractPdfText(bytes, async () => runtime);
    expect(seen[0]).not.toBe(bytes);
    expect(Array.from(seen[0] ?? [])).toEqual([1, 2, 3]);
  });

  it('stops at the time limit and cleans up', async () => {
    vi.useFakeTimers();
    try {
      const { load, destroy, dispose } = runtimeFor(new Promise<PdfDocumentLike>(() => undefined));
      const pending = extractPdfText(new Uint8Array([1]), load, 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toEqual({ ok: false, reason: 'timeout' });
      expect(dispose).toHaveBeenCalledTimes(1);
      // Disposing the runtime stops the worker, which ends the unfinished load.
      expect(destroy).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a runtime that fails to load', async () => {
    const result = await extractPdfText(new Uint8Array([1]), async () => {
      throw new Error('no worker');
    });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses extracted text above the text limit', async () => {
    const { load } = runtimeFor(Promise.resolve(oneLinePage('x'.repeat(60001))));
    expect(await extractPdfText(new Uint8Array([1]), load)).toEqual({
      ok: false,
      reason: 'too-much-text',
    });
  });

  it('always destroys the loading task and disposes the runtime', async () => {
    const ok = runtimeFor(Promise.resolve(oneLinePage('Some text')));
    expect((await extractPdfText(new Uint8Array([1]), ok.load)).ok).toBe(true);
    expect(ok.destroy).toHaveBeenCalledTimes(1);
    expect(ok.dispose).toHaveBeenCalledTimes(1);
    const failed = runtimeFor(Promise.reject(Object.assign(new Error('x'), { name: 'X' })));
    expect(await extractPdfText(new Uint8Array([1]), failed.load)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(failed.destroy).toHaveBeenCalledTimes(1);
    expect(failed.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not put error messages or content in the refusal', async () => {
    const result = await extractPdfText(new Uint8Array([1]), async () => {
      throw new Error('SECRET résumé text');
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('pdf.js settings', () => {
  it('turns off eval, WebAssembly, XFA, system fonts, and every fetch mode', () => {
    expect(PDF_DOCUMENT_PARAMS).toMatchObject({
      isEvalSupported: false,
      useWasm: false,
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      useWorkerFetch: false,
    });
    for (const url of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'iccUrl', 'url']) {
      expect(PDF_DOCUMENT_PARAMS).not.toHaveProperty(url);
    }
  });

  it('opens documents from in-memory bytes with those settings', () => {
    const getDocument = vi.fn(() => ({}));
    const pdfjs = { getDocument, PDFWorker: { create: vi.fn() } };
    const runtime = createPdfRuntime(pdfjs as unknown as Parameters<typeof createPdfRuntime>[0]);
    runtime.open(new Uint8Array([1]));
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ ...PDF_DOCUMENT_PARAMS, data: new Uint8Array([1]) }),
    );
  });
});
