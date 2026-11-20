import {
  MAX_ANCESTOR_LEVELS,
  MAX_FIELD_CANDIDATES,
  MAX_NODES_INSPECTED,
  findTextareas,
  locateField,
} from './find-field';
import { byId, select, setBody, setSize, stubLayout } from './dom-helpers';

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

const search = (id = 'q') => findTextareas(select(byId(id)), document);

describe('findTextareas: region and levels', () => {
  it('finds the single textarea next to the selected question', () => {
    setBody('<form><label id="q" for="a">Why Acme?</label><textarea id="a"></textarea></form>');
    const result = search();
    expect(result.status).toBe('found');
    expect(result.elements.map((e) => e.id)).toEqual(['a']);
  });

  it('reports not-found when there is no textarea', () => {
    setBody('<form><p id="q">Why Acme?</p><input type="text" /></form>');
    expect(search()).toEqual({ status: 'not-found', elements: [] });
  });

  it('reports ambiguous, with no guess, for two textareas at the stopping level', () => {
    setBody(
      '<form><p id="q">Why?</p><textarea id="a"></textarea><textarea id="b"></textarea></form>',
    );
    const result = search();
    expect(result.status).toBe('ambiguous');
    expect(result.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('stops at the nearest level: an inner textarea wins over an outer one', () => {
    setBody(
      '<div><div id="inner"><p id="q">Why?</p><textarea id="near"></textarea></div><textarea id="far"></textarea></div>',
    );
    const result = search();
    expect(result.status).toBe('found');
    expect(result.elements.map((e) => e.id)).toEqual(['near']);
  });

  it('climbs when the inner level has none and finds the outer one', () => {
    setBody('<div><div><p id="q">Why?</p></div><textarea id="out"></textarea></div>');
    expect(search().elements.map((e) => e.id)).toEqual(['out']);
  });

  it('a textarea in the same region as the start element counts', () => {
    setBody('<div id="q"><span>Why?</span><textarea id="in"></textarea></div>');
    expect(search().elements.map((e) => e.id)).toEqual(['in']);
  });

  it('starts from a text selection (common ancestor is a text node)', () => {
    setBody('<div><p id="q">Why Acme?</p><textarea id="a"></textarea></div>');
    const text = byId('q').firstChild as Node;
    expect(findTextareas(select(text), document).elements.map((e) => e.id)).toEqual(['a']);
  });

  it('uses the first range only and not-found without a selection', () => {
    setBody('<textarea id="a"></textarea>');
    window.getSelection()?.removeAllRanges();
    expect(findTextareas(window.getSelection(), document).status).toBe('not-found');
    expect(findTextareas(null, document).status).toBe('not-found');
  });

  it('never searches above the 4th ancestor: a valid textarea outside the region is not found', () => {
    // p -> d5 -> d4 -> d3 -> d2 are the 5 regions; the textarea hangs off d1/body.
    setBody(
      '<section id="elsewhere"><textarea id="far"></textarea></section>' +
        '<div id="d1"><div id="d2"><div id="d3"><div id="d4"><div id="d5"><p id="q">Why?</p></div></div></div></div></div>',
    );
    expect(MAX_ANCESTOR_LEVELS).toBe(4);
    expect(search()).toEqual({ status: 'not-found', elements: [] });
  });

  it('does find it exactly 4 levels up (boundary)', () => {
    setBody(
      '<div id="d2"><textarea id="edge"></textarea><div id="d3"><div id="d4"><div id="d5"><p id="q">Why?</p></div></div></div></div>',
    );
    // q -> d5(1) -> d4(2) -> d3(3) -> d2(4)
    expect(search().elements.map((e) => e.id)).toEqual(['edge']);
  });

  it('is not found one level beyond the boundary', () => {
    setBody(
      '<div id="d1"><textarea id="late"></textarea><div id="d2"><div id="d3"><div id="d4"><div id="d5"><p id="q">Why?</p></div></div></div></div></div>',
    );
    expect(search().status).toBe('not-found');
  });

  it('never goes above <body> and ignores selections outside it', () => {
    setBody('<p id="q">Why?</p><textarea id="a"></textarea>');
    expect(search().elements.map((e) => e.id)).toEqual(['a']);
    const head = document.createElement('title');
    document.head.append(head);
    head.textContent = 'Fixture title for selection';
    expect(findTextareas(select(head), document).status).toBe('not-found');
    expect(findTextareas(select(document.documentElement), document).status).toBe('not-found');
    head.remove();
  });

  it('does not use document-wide queries on the document', () => {
    setBody('<div id="w"><p id="q">Why?</p><textarea id="a"></textarea></div>');
    const spies = [
      vi.spyOn(document, 'querySelectorAll'),
      vi.spyOn(document, 'getElementsByTagName'),
      vi.spyOn(document.body, 'querySelectorAll'),
    ];
    const selection = select(byId('q'));
    expect(findTextareas(selection, document).status).toBe('found');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('does not walk the previous region again when climbing (each element counts once)', () => {
    // Unique elements: 1 + 300 + 150 + 1 (about 452) fits in 500; re-walking the
    // 300-element inner region would not.
    const inner = '<span></span>'.repeat(300);
    const outer = '<span></span>'.repeat(150);
    setBody(
      `<div><div><p id="q">Why?</p>${inner}</div>${outer}<textarea id="ok"></textarea></div>`,
    );
    expect(search().elements.map((e) => e.id)).toEqual(['ok']);
  });
});

describe('findTextareas: usability', () => {
  const cases: [string, string][] = [
    ['display:none', '<textarea id="x" style="display:none"></textarea>'],
    ['display:none on an ancestor', '<div style="display:none"><textarea id="x"></textarea></div>'],
    ['visibility:hidden', '<textarea id="x" style="visibility:hidden"></textarea>'],
    ['the hidden attribute', '<textarea id="x" hidden></textarea>'],
    ['a hidden ancestor', '<div hidden><textarea id="x"></textarea></div>'],
    ['disabled', '<textarea id="x" disabled></textarea>'],
    ['disabled by a fieldset', '<fieldset disabled><textarea id="x"></textarea></fieldset>'],
    ['readonly', '<textarea id="x" readonly></textarea>'],
    ['an inert ancestor', '<div inert><textarea id="x"></textarea></div>'],
    ['inert itself', '<textarea id="x" inert></textarea>'],
  ];
  it.each(cases)('excludes a textarea with %s', (_name, markup) => {
    setBody(`<div><p id="q">Why?</p>${markup}</div>`);
    expect(search()).toEqual({ status: 'not-found', elements: [] });
  });

  it('excludes a zero-size textarea', () => {
    setBody('<div><p id="q">Why?</p><textarea id="x"></textarea></div>');
    setSize(byId('x'), 0, 0);
    expect(search().status).toBe('not-found');
    setSize(byId('x'), 100, 0);
    expect(search().status).toBe('not-found');
  });

  it('an unusable textarea does not make a usable one ambiguous', () => {
    setBody(
      '<div><p id="q">Why?</p><textarea id="x" hidden></textarea><textarea id="ok"></textarea></div>',
    );
    expect(search().elements.map((e) => e.id)).toEqual(['ok']);
  });

  it('skips a textarea too deep to have a valid path (over 40 levels)', () => {
    const deep = '<div>'.repeat(41) + '<textarea id="x"></textarea>' + '</div>'.repeat(41);
    setBody(`<div id="r"><p id="q">Why?</p>${deep}</div>`);
    // Reached from the shallow start only after climbing; make the start a deep node.
    const start = byId('r');
    expect(findTextareas(select(start), document).status).toBe('not-found');
  });
});

describe('findTextareas: caps', () => {
  it('caps candidates at 5 and calls the result ambiguous', () => {
    setBody(
      '<div><p id="q">Why?</p>' +
        Array.from({ length: 8 }, (_, i) => `<textarea id="t${i}"></textarea>`).join('') +
        '</div>',
    );
    const result = search();
    expect(MAX_FIELD_CANDIDATES).toBe(5);
    expect(result.status).toBe('ambiguous');
    expect(result.elements).toHaveLength(5);
    expect(locateField(select(byId('q')), document)).toEqual({
      status: 'ambiguous',
      candidates: 5,
      field: null,
    });
  });

  it('stops after the node-inspection budget and does not find a textarea beyond it', () => {
    expect(MAX_NODES_INSPECTED).toBe(500);
    const filler = '<span></span>'.repeat(MAX_NODES_INSPECTED);
    setBody(`<div><p id="q">Why?</p>${filler}<textarea id="late"></textarea></div>`);
    expect(search()).toEqual({ status: 'not-found', elements: [] });
  });

  it('finds a textarea that sits within the budget', () => {
    const filler = '<span></span>'.repeat(MAX_NODES_INSPECTED - 10);
    setBody(`<div><p id="q">Why?</p>${filler}<textarea id="ok"></textarea></div>`);
    expect(search().elements.map((e) => e.id)).toEqual(['ok']);
  });

  it('the budget is shared across levels, not reset per level', () => {
    const filler = '<span></span>'.repeat(300);
    setBody(
      `<div><div><p id="q">Why?</p>${filler}</div>${filler}<textarea id="late"></textarea></div>`,
    );
    expect(search().status).toBe('not-found');
  });
});

describe('locateField', () => {
  it('returns the label and fingerprint of the single field, never its value', () => {
    setBody(
      '<form><label id="q" for="a">Why Acme?</label><textarea id="a" name="why" maxlength="500" placeholder="Type">SECRET DRAFT</textarea></form>',
    );
    const result = locateField(select(byId('q')), document);
    expect(result.status).toBe('found');
    expect(result.candidates).toBe(1);
    expect(result.field?.labelText).toBe('Why Acme?');
    expect(result.field?.fingerprint).toEqual({
      tag: 'textarea',
      contentEditable: false,
      nameAttr: 'why',
      idAttr: 'a',
      placeholder: 'Type',
      labelText: 'Why Acme?',
      maxLength: 500,
      sizeBucket: [200, 100],
      domPath: [0, 1],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET DRAFT');
  });

  it('reports none and ambiguous counts without a field', () => {
    setBody('<div><p id="q">Why?</p></div>');
    expect(locateField(select(byId('q')), document)).toEqual({
      status: 'not-found',
      candidates: 0,
      field: null,
    });
    setBody('<div><p id="q">Why?</p><textarea></textarea><textarea></textarea></div>');
    expect(locateField(select(byId('q')), document)).toEqual({
      status: 'ambiguous',
      candidates: 2,
      field: null,
    });
  });
});
