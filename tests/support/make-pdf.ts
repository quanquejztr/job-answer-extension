// Builds tiny synthetic PDFs for tests: made-up text only, hand-written bytes,
// no third-party code and no real document. Text uses the standard Helvetica
// font with WinAnsi encoding, so characters are written as single bytes.

export interface PdfText {
  x: number;
  y: number;
  text: string;
  size?: number;
}

export interface PdfPageSpec {
  texts: PdfText[];
}

export interface PdfOptions {
  /** Adds an /OpenAction and a link annotation that carry JavaScript. */
  javascript?: boolean;
  /** Adds an /Encrypt entry to the trailer (a dictionary pdf.js cannot open without a password). */
  encrypt?: boolean;
}

// WinAnsi (cp1252) code points above 0x7f that tests use.
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = WIN_ANSI[ch] ?? (code <= 0xff ? code : 63);
    const c = String.fromCharCode(byte);
    out += c === '\\' || c === '(' || c === ')' ? `\\${c}` : c;
  }
  return out;
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function makePdf(pages: PdfPageSpec[], options: PdfOptions = {}): Uint8Array {
  // Object numbers: 1 catalog, 2 pages, 3 font, then per page: page, contents.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const annotId = 4 + pages.length * 2;
  const actionId = annotId + 1;
  const encryptId = actionId + 1;
  const open = options.javascript ? ` /OpenAction ${actionId} 0 R` : '';
  objects[1] = `<< /Type /Catalog /Pages 2 0 R${open} >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((page, i) => {
    const id = pageIds[i] ?? 0;
    const stream = page.texts
      .map((t) => `BT /F1 ${t.size ?? 12} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${toWinAnsi(t.text)}) Tj ET`)
      .join('\n');
    const annots = options.javascript && i === 0 ? ` /Annots [${annotId} 0 R]` : '';
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R${annots} >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  if (options.javascript) {
    objects[annotId] = `<< /Type /Annot /Subtype /Link /Rect [0 0 612 792] /A ${actionId} 0 R >>`;
    objects[actionId] =
      '<< /S /JavaScript /JS (globalThis.__pdfScriptRan = true; app.alert\\(1\\);) >>';
  }
  let encrypt = '';
  if (options.encrypt) {
    objects[encryptId] =
      '<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>';
    encrypt = ` /Encrypt ${encryptId} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]`;
  }
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    const obj = objects[n];
    if (obj === undefined) continue;
    offsets[n] = body.length;
    body += `${n} 0 obj\n${obj}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    const off = offsets[n];
    body +=
      off === undefined ? '0000000000 65535 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R${encrypt} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1(body);
}

/** One page of lines, top to bottom, left margin 72, 16 points apart. */
export function simplePdf(lines: string[], options: PdfOptions = {}): Uint8Array {
  return makePdf([{ texts: lines.map((text, i) => ({ x: 72, y: 720 - i * 16, text })) }], options);
}
