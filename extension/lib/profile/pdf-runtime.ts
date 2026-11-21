import type * as Pdfjs from 'pdfjs-dist';
import type { LoadPdfRuntime, PdfRuntime } from './pdf-extract';

/**
 * pdf.js settings for text extraction only (ADR 0004). There is no scripting
 * manager and the sandbox bundle is never loaded, so a document's JavaScript
 * cannot run; eval, WebAssembly, XFA, system fonts, font faces, hardware
 * acceleration, range or streaming fetches, and worker fetches are all off. The
 * document comes from bytes in memory, so pdf.js makes no network request.
 */
export const PDF_DOCUMENT_PARAMS = {
  isEvalSupported: false,
  useWasm: false,
  enableXfa: false,
  useSystemFonts: false,
  disableFontFace: true,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  enableHWA: false,
  disableRange: true,
  disableStream: true,
  disableAutoFetch: true,
  useWorkerFetch: false,
  stopAtErrors: false,
  verbosity: 0,
} as const;

/** Wraps a loaded pdf.js module (and optionally its own worker) as a PdfRuntime. */
export function createPdfRuntime(pdfjs: typeof Pdfjs, worker?: Worker): PdfRuntime {
  const pdfWorker = worker === undefined ? undefined : pdfjs.PDFWorker.create({ port: worker });
  return {
    open: (data) => pdfjs.getDocument({ ...PDF_DOCUMENT_PARAMS, data, worker: pdfWorker }),
    dispose: () => {
      pdfWorker?.destroy();
      worker?.terminate();
    },
  };
}

/**
 * Loads pdf.js and its worker from the extension's own files, only when a PDF is
 * chosen. The dynamic imports keep pdf.js out of the settings page's first load.
 */
export const loadBrowserPdfRuntime: LoadPdfRuntime = async () => {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  const worker = new Worker(workerModule.default, { type: 'module' });
  return createPdfRuntime(pdfjs, worker);
};
