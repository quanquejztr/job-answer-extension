import type { FieldFingerprint } from '../../schemas/field-target';
import { buildFingerprint, compareFingerprints } from './fingerprint';
import { buildDomPath, resolveDomPath } from './dom-path';
import { getLabelText, cleanText } from './label-text';
import { byId, setBody, setSize, stubLayout } from './dom-helpers';

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

const area = (id = 'a') => byId<HTMLTextAreaElement>(id);

describe('buildFingerprint', () => {
  it('captures the PRD 16.2 attributes', () => {
    setBody(
      '<div></div><form><textarea id="a" name="n" placeholder="p" maxlength="250"></textarea></form>',
    );
    expect(buildFingerprint(area())).toEqual({
      tag: 'textarea',
      contentEditable: false,
      nameAttr: 'n',
      idAttr: 'a',
      placeholder: 'p',
      labelText: 'p',
      maxLength: 250,
      sizeBucket: [200, 100],
      domPath: [1, 0],
    });
  });

  it('omits absent optional attributes (including maxlength) and blank values', () => {
    setBody('<textarea id="a" name="  " placeholder=""></textarea>');
    const fp = buildFingerprint(area());
    expect(fp).toBeDefined();
    for (const key of ['nameAttr', 'placeholder', 'maxLength']) expect(fp).not.toHaveProperty(key);
    expect(fp?.idAttr).toBe('a');
  });

  it('rounds the size to 20 px buckets', () => {
    setBody('<textarea id="a"></textarea>');
    setSize(area(), 309, 91);
    expect(buildFingerprint(area())?.sizeBucket).toEqual([300, 100]);
    setSize(area(), 310, 89);
    expect(buildFingerprint(area())?.sizeBucket).toEqual([320, 80]);
  });

  it('truncates long attribute text to 200 characters', () => {
    setBody(`<textarea id="a" name="${'n'.repeat(500)}"></textarea>`);
    expect(buildFingerprint(area())?.nameAttr).toHaveLength(200);
  });

  it('returns undefined for a field outside the body or deeper than 40 levels', () => {
    const detached = document.createElement('textarea');
    expect(buildFingerprint(detached)).toBeUndefined();
    setBody('<div>'.repeat(41) + '<textarea id="a"></textarea>' + '</div>'.repeat(41));
    expect(buildFingerprint(area())).toBeUndefined();
    setBody('<div>'.repeat(40) + '<textarea id="a"></textarea>' + '</div>'.repeat(40));
    expect(buildFingerprint(area())).toBeUndefined(); // path length 41
    setBody('<div>'.repeat(39) + '<textarea id="a"></textarea>' + '</div>'.repeat(39));
    expect(buildFingerprint(area())?.domPath).toHaveLength(40);
  });

  it('never includes the field value', () => {
    setBody('<textarea id="a">my private draft</textarea>');
    expect(JSON.stringify(buildFingerprint(area()))).not.toContain('private');
  });
});

const base: FieldFingerprint = {
  tag: 'textarea',
  contentEditable: false,
  nameAttr: 'n',
  idAttr: 'a',
  placeholder: 'p',
  labelText: 'Why?',
  maxLength: 100,
  sizeBucket: [300, 100],
  domPath: [1, 0, 2],
};

describe('compareFingerprints', () => {
  it('is equal for identical and cloned fingerprints', () => {
    expect(compareFingerprints(base, base)).toBe(true);
    expect(compareFingerprints(base, structuredClone(base))).toBe(true);
  });

  it.each([
    ['tag', { tag: 'input' }],
    ['contentEditable', { contentEditable: true }],
    ['nameAttr', { nameAttr: 'other' }],
    ['idAttr', { idAttr: 'other' }],
    ['placeholder', { placeholder: 'other' }],
    ['labelText', { labelText: 'Other?' }],
    ['maxLength', { maxLength: 101 }],
    ['domPath', { domPath: [1, 0, 3] }],
    ['a longer domPath', { domPath: [1, 0, 2, 0] }],
  ] as [string, Partial<FieldFingerprint>][])('differs when %s differs', (_name, over) => {
    expect(compareFingerprints(base, { ...base, ...over })).toBe(false);
  });

  it('differs when an optional attribute appears or disappears', () => {
    const without: FieldFingerprint = { ...base };
    delete without.nameAttr;
    expect(compareFingerprints(base, without)).toBe(false);
    expect(compareFingerprints(without, base)).toBe(false);
    expect(compareFingerprints(without, structuredClone(without))).toBe(true);
  });

  it('tolerates one 20 px bucket per axis, not two', () => {
    expect(compareFingerprints(base, { ...base, sizeBucket: [320, 80] })).toBe(true);
    expect(compareFingerprints(base, { ...base, sizeBucket: [280, 120] })).toBe(true);
    expect(compareFingerprints(base, { ...base, sizeBucket: [340, 100] })).toBe(false);
    expect(compareFingerprints(base, { ...base, sizeBucket: [300, 140] })).toBe(false);
    expect(compareFingerprints(base, { ...base, sizeBucket: [0, 0] })).toBe(false);
  });

  it('is symmetric', () => {
    const other = { ...base, sizeBucket: [320, 100] as [number, number] };
    expect(compareFingerprints(base, other)).toBe(compareFingerprints(other, base));
  });
});

describe('domPath', () => {
  it('builds child indexes from the body and resolves them back', () => {
    setBody('<p></p><div><span></span><textarea id="a"></textarea></div>');
    const path = buildDomPath(document.body, area());
    expect(path).toEqual([1, 1]);
    expect(resolveDomPath(document.body, path ?? [])).toBe(area());
  });

  it('counts element children only (text and comments are ignored)', () => {
    setBody('text<!-- c --><div id="a"></div> more <div id="b"></div>');
    expect(buildDomPath(document.body, byId('b'))).toEqual([1]);
  });

  it('resolves the empty path to the body', () => {
    expect(resolveDomPath(document.body, [])).toBe(document.body);
  });

  it.each([
    ['past the end', [5]],
    ['negative', [-1]],
    ['fractional', [0.5]],
    ['NaN', [Number.NaN]],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['too deep a path', Array(41).fill(0)],
    ['through a leaf', [0, 0, 0]],
  ])('resolves a %s path to null without throwing', (_name, path) => {
    setBody('<div><p></p></div>');
    expect(() => resolveDomPath(document.body, path)).not.toThrow();
    expect(resolveDomPath(document.body, path)).toBeNull();
  });

  it('resolves to null when there is no body', () => {
    expect(resolveDomPath(null, [0])).toBeNull();
  });

  it('refuses an element outside the body', () => {
    expect(buildDomPath(document.body, document.head)).toBeUndefined();
  });
});

describe('label text', () => {
  const label = (markup: string) => {
    setBody(markup);
    return getLabelText(area());
  };

  it('uses <label for>', () => {
    expect(label('<label for="a"> Why   <b>Acme</b>?\n</label><textarea id="a"></textarea>')).toBe(
      'Why Acme?',
    );
  });

  it('uses a wrapping label, without reading the textarea value', () => {
    expect(label('<label>Cover note <textarea id="a">SECRET VALUE</textarea></label>')).toBe(
      'Cover note',
    );
  });

  it('prefers label[for] over a wrapping label', () => {
    expect(
      label('<label for="a">For label</label><label>Wrap <textarea id="a"></textarea></label>'),
    ).toBe('For label');
  });

  it('uses aria-labelledby (several ids, in order)', () => {
    expect(
      label(
        '<span id="x">Part one</span><span id="y">part two</span><textarea id="a" aria-labelledby="x missing y" aria-label="no"></textarea>',
      ),
    ).toBe('Part one part two');
  });

  it('uses aria-label, then placeholder', () => {
    expect(label('<textarea id="a" aria-label=" Aria text " placeholder="ph"></textarea>')).toBe(
      'Aria text',
    );
    expect(label('<textarea id="a" placeholder="  Type   here "></textarea>')).toBe('Type here');
  });

  it('skips an empty higher-priority source', () => {
    expect(
      label('<label for="a">  </label><textarea id="a" aria-label="Fallback"></textarea>'),
    ).toBe('Fallback');
  });

  it('is empty when nothing labels the field', () => {
    expect(label('<textarea id="a"></textarea>')).toBe('');
  });

  it('cuts to 200 characters', () => {
    const text = label(`<label for="a">${'word '.repeat(100)}</label><textarea id="a"></textarea>`);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text.length).toBeGreaterThan(190);
    expect(buildFingerprint(area())?.labelText).toBe(text);
  });

  it('does not split a surrogate pair when cutting', () => {
    const cut = cleanText('a'.repeat(199) + '😀😀', 200);
    expect(cut).toBe('a'.repeat(199));
  });

  it('keeps hostile markup as plain text and ignores scripts', () => {
    const text = label(
      '<label for="a"><img src=x onerror="window.__p=1"><script>window.__p=2</script>&lt;b&gt;Hi&lt;/b&gt;</label><textarea id="a"></textarea>',
    );
    expect(text).toBe('<b>Hi</b>');
    expect(document.querySelector('b')).toBeNull();
  });
});
