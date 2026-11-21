import { assembleDocument, assemblePage, normalizeLine, type PdfTextItem } from './pdf-text';

const item = (
  str: string,
  x: number,
  y: number,
  extra: Partial<PdfTextItem> = {},
): PdfTextItem => ({
  str,
  x,
  y,
  width: str.length * 6,
  height: 12,
  hasEOL: false,
  ...extra,
});

describe('normalizeLine', () => {
  it('expands ligatures, applies NFC, and keeps accents and symbols', () => {
    expect(normalizeLine('oﬃce ﬁrst ﬂow ﬀ ﬅ')).toBe('office first flow ff st');
    expect(normalizeLine('Zoë résumé')).toBe('Zoë résumé');
    expect(normalizeLine('東京 — 😀 “quoted” C++')).toBe('東京 — 😀 “quoted” C++');
  });

  it('removes control, zero-width, soft-hyphen, and replacement characters', () => {
    expect(normalizeLine('a\u0001b​c­d﻿e�f\u0000')).toBe('abcdef');
  });

  it('turns non-breaking spaces and tabs into single spaces and trims', () => {
    expect(normalizeLine('  a  b\tc  ')).toBe('a b c');
  });

  it.each(['•', '●', '▪', '◦', '∙', '·', '‣', ''])('turns a leading %s into "- "', (glyph) => {
    expect(normalizeLine(`${glyph} Built things`)).toBe('- Built things');
    expect(normalizeLine(`${glyph}Built things`)).toBe('- Built things');
  });

  it('leaves bullets in the middle of a line alone', () => {
    expect(normalizeLine('Go • Rust')).toBe('Go • Rust');
  });
});

describe('assemblePage', () => {
  it('orders lines top to bottom regardless of stream order', () => {
    const text = assemblePage([
      item('third', 72, 680),
      item('first', 72, 720),
      item('second', 72, 700),
    ]);
    expect(text).toBe('first\nsecond\nthird');
  });

  it('joins fragments on one line left to right with spaces where there is a gap', () => {
    const text = assemblePage([
      item('Acme', 72, 700),
      item('Corp', 72 + 4 * 6 + 6, 700),
      item('2019', 400, 700),
    ]);
    expect(text).toBe('Acme Corp 2019');
  });

  it('does not add a space between touching fragments', () => {
    expect(assemblePage([item('Hel', 72, 700), item('lo', 72 + 18, 700)])).toBe('Hello');
  });

  it('keeps small baseline jitter on the same line', () => {
    expect(assemblePage([item('a', 72, 700), item('b', 90, 700.8), item('c', 110, 699.4)])).toBe(
      'a b c',
    );
  });

  it('turns a separate bullet glyph item into a "- " line', () => {
    const text = assemblePage([item('•', 72, 700), item('Built things', 90, 700)]);
    expect(text).toBe('- Built things');
  });

  it('does not join a line-ending hyphen with the next line', () => {
    expect(assemblePage([item('co-', 72, 700), item('worker', 72, 684)])).toBe('co-\nworker');
  });

  it('collapses runs of blank lines and ignores empty items', () => {
    const text = assemblePage([
      item('a', 72, 700),
      item('', 72, 690, { hasEOL: true }),
      item('b', 72, 680),
    ]);
    expect(text).toBe('a\nb');
  });

  it('falls back to stream order with hasEOL when positions are unusable', () => {
    const text = assemblePage([
      item('one ', Number.NaN, 0),
      item('line', Number.NaN, 0, { hasEOL: true }),
      item('two', Number.NaN, 0, { hasEOL: true }),
    ]);
    expect(text).toBe('one line\ntwo');
  });

  describe('two columns', () => {
    const left = ['Skills', 'Go and Rust', 'Testing', 'Writing', 'Teaching'];
    const right = ['Experience', 'Built a tool', 'Ran a club', 'Wrote docs', 'Mentored people'];
    const columns = (): PdfTextItem[] => [
      ...left.map((t, i) => item(t, 72, 700 - i * 16, { width: 120 })),
      ...right.map((t, i) => item(t, 330, 700 - i * 16, { width: 120 })),
    ];

    it('reads the left column, then the right column', () => {
      expect(assemblePage(columns())).toBe([...left, ...right].join('\n'));
    });

    it('reads the same when the stream interleaves the columns', () => {
      const interleaved = columns().sort((a, b) => b.y - a.y || a.x - b.x);
      expect(assemblePage(interleaved)).toBe([...left, ...right].join('\n'));
    });

    it('treats a full-width line as a break between bands', () => {
      const banner = item('Made-up Person — made-up banner across the page', 72, 740, {
        width: 400,
      });
      const below = item('Closing line across the whole page width', 72, 600, { width: 400 });
      const text = assemblePage([below, ...columns(), banner]);
      expect(text).toBe(
        [
          'Made-up Person — made-up banner across the page',
          ...left,
          ...right,
          'Closing line across the whole page width',
        ].join('\n'),
      );
    });

    it('does not split a single column of short lines', () => {
      const lines = ['Go', 'Rust', 'C', 'Zig', 'Lua', 'Ada', 'D', 'R'];
      const single = lines.map((t, i) => item(t, 72 + (i % 3) * 20, 700 - i * 16, { width: 14 }));
      expect(assemblePage(single)).toBe(lines.join('\n'));
    });
  });
});

describe('assembleDocument', () => {
  it('separates pages with one blank line and skips empty pages', () => {
    const text = assembleDocument([
      [item('page one', 72, 700)],
      [item('', 72, 700, { hasEOL: true })],
      [item('page three', 72, 700)],
    ]);
    expect(text).toBe('page one\n\npage three');
  });

  it('is empty when no page has text', () => {
    expect(assembleDocument([[], [item(' ', 72, 700)]])).toBe('');
  });
});
