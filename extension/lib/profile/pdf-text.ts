/**
 * Turns pdf.js text-content items into readable résumé text. Pure functions, no
 * pdf.js import, so the layout rules are unit-testable.
 *
 * Rules (documented in specs/decisions/0004-pdf-resume-parsing.md):
 * - Lines come from y-position: items whose baselines are within a small
 *   tolerance share a line, ordered left to right. `hasEOL` is used only when a
 *   page has no usable positions.
 * - Reading order is top to bottom. A page with a clear two-column layout is read
 *   column by column (left, then right); full-width lines (a name or a section
 *   banner across both columns) split the page into bands that are read in order.
 *   Other layouts (sidebars, tables, text boxes) can come out in the wrong order;
 *   the user reviews and edits the text.
 * - Leading bullet glyphs become "- ", as the DOCX import does.
 * - Text is NFC-normalized, common ligatures are expanded, control and
 *   zero-width characters are removed.
 * - No de-hyphenation: a line-ending hyphen is kept as written, because joining
 *   "co-" and "worker" cannot be done safely and the saved text must match what
 *   the user can quote.
 * - Pages are separated by one blank line; repeated headers and footers and page
 *   numbers are not removed.
 */

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
};

const BULLET_GLYPHS = '•●▪■◦∙·‣⁃◆➢➤';
const BULLET_START = new RegExp(`^[${BULLET_GLYPHS}]\\s*`, 'u');
// Control characters, zero-width characters, soft hyphen, and the replacement character.
const LIGATURE_CHARS = new RegExp('[\\uFB00-\\uFB06]', 'gu');
const SPACES = new RegExp('[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000\\t]', 'gu');
const STRIP = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200D\\u2060\\uFEFF\\u00AD\\uFFFD]',
  'gu',
);

/** Normalizes one line of text. */
export function normalizeLine(line: string): string {
  let out = line.replace(LIGATURE_CHARS, (c) => LIGATURES[c] ?? c);
  out = out.replace(SPACES, ' ');
  out = out.replace(STRIP, '').normalize('NFC');
  out = out.replace(/ {2,}/g, ' ').trim();
  return out.replace(BULLET_START, '- ');
}

function isUsable(item: PdfTextItem): boolean {
  return [item.x, item.y, item.width, item.height].every((n) => Number.isFinite(n));
}

function fontSize(item: PdfTextItem): number {
  return item.height > 0 ? item.height : 10;
}

function joinFragments(items: PdfTextItem[]): string {
  let text = '';
  let previous: PdfTextItem | undefined;
  for (const item of items) {
    if (previous !== undefined) {
      const gap = item.x - (previous.x + previous.width);
      const spaced = text.endsWith(' ') || item.str.startsWith(' ');
      if (!spaced && gap > fontSize(item) * 0.15) text += ' ';
    }
    text += item.str;
    previous = item;
  }
  return text;
}

interface Line {
  y: number;
  x: number;
  items: PdfTextItem[];
}

/** Groups items into lines by baseline, top to bottom, each line left to right. */
function buildLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.y - a.item.y || a.index - b.index)
    .map(({ item }) => item);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(1.5, fontSize(item) * 0.4);
    if (last !== undefined && Math.abs(last.y - item.y) <= tolerance) last.items.push(item);
    else lines.push({ y: item.y, x: item.x, items: [item] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0]?.x ?? 0;
  }
  return lines;
}

function lineText(line: Line): string {
  return normalizeLine(joinFragments(line.items));
}

/** Finds the x position of a vertical gutter between two columns, if there is one. */
function findGutter(items: PdfTextItem[]): { start: number; end: number } | null {
  const spans = items.filter((i) => i.str.trim() !== '' && i.width > 0);
  if (spans.length < 8) return null;
  const minX = Math.min(...spans.map((i) => i.x));
  const maxX = Math.max(...spans.map((i) => i.x + i.width));
  const span = maxX - minX;
  if (span < 200) return null;
  const from = minX + span * 0.2;
  const to = maxX - span * 0.2;
  const step = 2;
  let best: { start: number; end: number } | null = null;
  let runStart: number | null = null;
  for (let p = from; p <= to + step; p += step) {
    const crossing = spans.filter((i) => i.x < p && i.x + i.width > p).length;
    const free = p <= to && crossing <= spans.length * 0.2;
    if (free && runStart === null) runStart = p;
    if (!free && runStart !== null) {
      if (best === null || p - runStart > best.end - best.start) best = { start: runStart, end: p };
      runStart = null;
    }
  }
  if (best === null || best.end - best.start < 14) return null;
  const mid = (best.start + best.end) / 2;
  const left = spans.filter((i) => i.x + i.width <= best.end && i.x < mid);
  const right = spans.filter((i) => i.x >= best.start && i.x >= mid);
  if (left.length < 3 || right.length < 3) return null;
  // A real right column starts at one consistent x.
  const starts = new Map<number, number>();
  for (const r of right)
    starts.set(Math.round(r.x / 4), (starts.get(Math.round(r.x / 4)) ?? 0) + 1);
  const modal = Math.max(...starts.values());
  return modal >= right.length * 0.5 ? best : null;
}

function singleColumn(items: PdfTextItem[]): string[] {
  return buildLines(items).map(lineText);
}

function twoColumn(items: PdfTextItem[], gutter: { start: number; end: number }): string[] {
  const mid = (gutter.start + gutter.end) / 2;
  const isSpanner = (i: PdfTextItem) => i.x < gutter.start && i.x + i.width > gutter.end;
  const spanners = buildLines(items.filter(isSpanner));
  const rest = items.filter((i) => !isSpanner(i));
  const out: string[] = [];
  let upper = Infinity;
  const emit = (lower: number, upperBound: number) => {
    const band = rest.filter((i) => i.y < upperBound && i.y >= lower);
    const left = band.filter((i) => i.x + i.width / 2 < mid);
    const right = band.filter((i) => i.x + i.width / 2 >= mid);
    out.push(...singleColumn(left), ...singleColumn(right));
  };
  for (const spanner of spanners) {
    const tolerance = Math.max(1.5, Math.max(...spanner.items.map(fontSize)) * 0.4);
    emit(spanner.y + tolerance, upper);
    out.push(lineText(spanner));
    upper = spanner.y + tolerance;
  }
  emit(-Infinity, upper);
  return out;
}

function streamOrder(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const item of items) {
    current += item.str;
    if (item.hasEOL) {
      lines.push(normalizeLine(current));
      current = '';
    }
  }
  if (current !== '') lines.push(normalizeLine(current));
  return lines;
}

/** Text of one page, one line per row. */
export function assemblePage(rawItems: PdfTextItem[]): string {
  const items = rawItems.filter((i) => i.str !== '' || i.hasEOL);
  let lines: string[];
  if (!items.every(isUsable)) {
    lines = streamOrder(items);
  } else {
    const visible = items.filter((i) => i.str !== '');
    const gutter = findGutter(visible);
    lines = gutter === null ? singleColumn(visible) : twoColumn(visible, gutter);
  }
  // At most one blank line in a row, none at the ends.
  return lines
    .filter((line, i) => line !== '' || (i > 0 && lines[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** Joins pages with one blank line, skipping pages with no text. */
export function assembleDocument(pages: PdfTextItem[][]): string {
  return pages
    .map(assemblePage)
    .filter((text) => text !== '')
    .join('\n\n');
}
