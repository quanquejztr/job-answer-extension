import { CaptureResultSchema, InternalMessageSchema, PanelStateSchema } from './internal-message';

const result = (payload: Record<string, unknown>) => ({
  v: 1,
  requestId: 'r',
  type: 'capture.result',
  payload: {
    question: 'Why do you want this job?',
    fieldStatus: 'not-found',
    field: null,
    candidates: 0,
    ...payload,
  },
});

const fingerprint = (over: object = {}) => ({
  tag: 'textarea',
  contentEditable: false,
  labelText: 'Why Acme?',
  sizeBucket: [200, 100],
  domPath: [0, 1],
  ...over,
});
const found = (fieldOver: object = {}, fpOver: object = {}) => ({
  fieldStatus: 'found',
  candidates: 1,
  field: { labelText: 'Why Acme?', fingerprint: fingerprint(fpOver), ...fieldOver },
});

const revalidateRequest = (payload: object) => ({
  v: 1,
  requestId: 'r',
  type: 'field.revalidate.request',
  payload,
});
const revalidateResult = (payload: object) => ({
  v: 1,
  requestId: 'r',
  type: 'field.revalidate.result',
  payload,
});

describe('internal message schemas', () => {
  it('parses a valid capture.result with optional labelHint', () => {
    expect(CaptureResultSchema.safeParse(result({ labelHint: 'Why Acme?' })).success).toBe(true);
  });

  it.each([
    ['found', found()],
    [
      'found with every optional attribute',
      found(
        {},
        {
          nameAttr: 'why',
          idAttr: 'why',
          placeholder: 'Type here',
          maxLength: 500,
        },
      ),
    ],
    ['ambiguous (2)', { fieldStatus: 'ambiguous', candidates: 2, field: null }],
    ['ambiguous (5, the cap)', { fieldStatus: 'ambiguous', candidates: 5, field: null }],
  ])('parses a capture.result that is %s', (_n, payload) => {
    expect(CaptureResultSchema.safeParse(result(payload)).success).toBe(true);
  });

  it('parses field.revalidate messages and rejects bad ones', () => {
    const request = { locator: { frameId: 0, domPath: [0, 1] }, fingerprint: fingerprint() };
    expect(InternalMessageSchema.safeParse(revalidateRequest(request)).success).toBe(true);
    expect(InternalMessageSchema.safeParse(revalidateResult({ ok: true })).success).toBe(true);
    for (const reason of ['missing', 'changed', 'hidden', 'disabled'])
      expect(InternalMessageSchema.safeParse(revalidateResult({ ok: false, reason })).success).toBe(
        true,
      );
    for (const bad of [
      revalidateRequest({ ...request, extra: 1 }),
      revalidateRequest({ locator: request.locator }),
      revalidateRequest({ ...request, locator: { frameId: -1, domPath: [] } }),
      revalidateRequest({ ...request, locator: { frameId: 0, domPath: Array(41).fill(0) } }),
      revalidateResult({ ok: false }),
      revalidateResult({ ok: false, reason: 'gone' }),
      revalidateResult({ ok: true, reason: 'missing' }),
      revalidateResult({}),
    ])
      expect(InternalMessageSchema.safeParse(bad).success).toBe(false);
  });

  it.each([
    ['unknown payload key', result({ extra: 1 })],
    ['missing field', result({ field: undefined })],
    ['missing fieldStatus', result({ fieldStatus: undefined })],
    ['unknown fieldStatus', result({ fieldStatus: 'maybe' })],
    ['a worker-side target key', result({ target: null })],
    ['found without a field', result({ fieldStatus: 'found', candidates: 1 })],
    ['found with 2 candidates', result({ ...found(), candidates: 2 })],
    ['not-found with candidates', result({ candidates: 1 })],
    ['ambiguous with 1 candidate', result({ fieldStatus: 'ambiguous', candidates: 1 })],
    ['ambiguous naming a field', result({ ...found(), fieldStatus: 'ambiguous', candidates: 2 })],
    ['more than 5 candidates', result({ fieldStatus: 'ambiguous', candidates: 6 })],
    ['field with an extra key', result({ ...found({ tabId: 3 }) })],
    ['fingerprint with an extra key', result({ ...found({}, { origin: 'x' }) })],
    ['label over 200 chars', result({ ...found({ labelText: 'a'.repeat(201) }) })],
    ['domPath deeper than 40', result({ ...found({}, { domPath: Array(41).fill(0) }) })],
    ['negative domPath index', result({ ...found({}, { domPath: [0, -1] }) })],
    ['fractional domPath index', result({ ...found({}, { domPath: [0.5] }) })],
    ['unknown tag', result({ ...found({}, { tag: 'span' }) })],
    ['jobContext set', result({ jobContext: { text: 't', source: 'nearby', confidence: 1 } })],
    ['empty question', result({ question: '' })],
    ['too-long question', result({ question: 'a'.repeat(1001) })],
    ['negative candidates', result({ candidates: -1 })],
  ])('rejects %s', (_n, message) => {
    expect(CaptureResultSchema.safeParse(message).success).toBe(false);
  });

  it('rejects unknown message types and unknown envelope keys', () => {
    expect(
      InternalMessageSchema.safeParse({ v: 1, requestId: 'r', type: 'insert.request', payload: {} })
        .success,
    ).toBe(false);
    expect(
      InternalMessageSchema.safeParse({
        v: 1,
        requestId: 'r',
        type: 'capture.request',
        payload: {},
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('validates the panel state union', () => {
    for (const state of [
      { kind: 'empty' },
      { kind: 'unsupported-domain' },
      {
        kind: 'captured',
        question: 'Why do you want this?',
        source: 'menu-selection',
        captureId: 'c1',
        field: { status: 'found', label: 'Why Acme?' },
      },
      {
        kind: 'captured',
        question: 'Why do you want this?',
        source: 'menu-selection',
        captureId: 'c1',
        field: { status: 'ambiguous' },
      },
      { kind: 'error', code: 'INVALID_REQUEST' },
    ])
      expect(PanelStateSchema.safeParse(state).success).toBe(true);
    for (const state of [
      { kind: 'error', code: 'NOPE' },
      { kind: 'captured', question: 'Why do you want this?', source: 'x', captureId: 'c1' },
      {
        kind: 'captured',
        question: 'Why do you want this?',
        source: 'content-script',
        captureId: 'c1',
      },
      ...[
        { status: 'maybe' },
        { status: 'found', label: '' },
        { status: 'found', label: 'a'.repeat(201) },
        { status: 'found', fingerprint: {} },
        { status: 'found', locator: { frameId: 0, domPath: [] } },
      ].map((field) => ({
        kind: 'captured',
        question: 'Why do you want this?',
        source: 'content-script',
        captureId: 'c1',
        field,
      })),
      { kind: 'empty', extra: 1 },
      { kind: 'other' },
    ])
      expect(PanelStateSchema.safeParse(state).success).toBe(false);
  });
});

describe('draft states and messages (step 1.3)', () => {
  const base = {
    question: 'Why do you want this?',
    source: 'content-script',
    captureId: 'c1',
    field: { status: 'found', label: 'Why Acme?' },
  };
  const generated = {
    kind: 'generated',
    ...base,
    answer: 'An answer.',
    usedFactCount: 2,
    warnings: [{ code: 'MODEL_NOTE', severity: 'info', message: 'Note.' }],
    draftId: 1,
    maxWords: 150,
  };

  it('accepts generating, generated, and a captured state with a draft error', () => {
    for (const state of [
      { kind: 'generating', ...base },
      generated,
      {
        kind: 'generated',
        ...base,
        answer: 'x',
        usedFactCount: 0,
        warnings: [],
        draftId: 1,
        maxWords: 150,
      },
      { kind: 'captured', ...base, error: 'HELPER_UNAVAILABLE' },
    ])
      expect(PanelStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    ['generating without a question', { kind: 'generating', ...base, question: undefined }],
    ['generating with an answer', { kind: 'generating', ...base, answer: 'x' }],
    ['generated without an answer', { ...generated, answer: undefined }],
    ['generated with an empty answer', { ...generated, answer: '' }],
    ['generated with a negative fact count', { ...generated, usedFactCount: -1 }],
    ['generated with a fractional fact count', { ...generated, usedFactCount: 1.5 }],
    ['generated with a bad warning', { ...generated, warnings: [{ code: 'X' }] }],
    ['generated with usedFacts text leaking in', { ...generated, usedFacts: [] }],
    ['captured with an unknown error code', { kind: 'captured', ...base, error: 'NOPE' }],
  ])('rejects %s', (_n, state) => {
    expect(PanelStateSchema.safeParse(state).success).toBe(false);
  });

  const q = 'Why do you want to work at Acme?';
  const start = (payload: object = {}) => ({
    v: 1,
    requestId: 'r',
    type: 'draft.start',
    payload: { tabId: 1, captureId: 'c1', question: q, ...payload },
  });

  it('accepts draft.start and draft.cancel and rejects malformed ones', () => {
    expect(InternalMessageSchema.safeParse(start()).success).toBe(true);
    expect(
      InternalMessageSchema.safeParse({
        v: 1,
        requestId: 'r',
        type: 'draft.cancel',
        payload: { tabId: 0 },
      }).success,
    ).toBe(true);
    for (const bad of [
      start({ question: 'short' }),
      start({ question: ' '.repeat(30) }),
      start({ question: 'x'.repeat(1001) }),
      start({ tabId: -1 }),
      start({ captureId: '' }),
      start({ captureId: undefined }),
      start({ extra: 1 }),
      { v: 1, requestId: 'r', type: 'draft.cancel', payload: {} },
      { v: 1, requestId: 'r', type: 'draft.cancel', payload: { tabId: 1, extra: 1 } },
      { ...start(), v: 2 },
    ])
      expect(InternalMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe('insert states and messages (step 1.4)', () => {
  const base = {
    question: 'Why do you want to work at Acme?',
    source: 'content-script',
    captureId: 'c1',
    field: { status: 'found', label: 'Why Acme?' },
  };
  const review = {
    ...base,
    answer: 'An answer.',
    usedFactCount: 2,
    warnings: [],
    draftId: 1,
    maxWords: 150,
  };
  const fingerprint = {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why Acme?',
    sizeBucket: [200, 100],
    domPath: [0, 1],
  };
  const insertRequest = (payload: object = {}, over: object = {}) => ({
    v: 1,
    requestId: 'r',
    type: 'insert.request',
    payload: {
      targetId: 't1',
      answer: 'My answer.',
      confirmReplace: false,
      locator: { frameId: 0, domPath: [0, 1] },
      fingerprint,
      ...payload,
    },
    ...over,
  });

  it('accepts review, inserting, inserted, and failed-insert panel states', () => {
    for (const state of [
      { kind: 'generated', ...review },
      { kind: 'generated', ...review, maxChars: 500, editedAnswer: 'Mine.' },
      { kind: 'generated', ...review, editedAnswer: 'Mine.', insertError: 'FIELD_NONEMPTY' },
      { kind: 'inserting', ...review, editedAnswer: 'Mine.' },
      { kind: 'inserted', ...base },
    ])
      expect(PanelStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    ['generated without maxWords', { kind: 'generated', ...review, maxWords: undefined }],
    ['maxWords out of range', { kind: 'generated', ...review, maxWords: 5 }],
    ['maxChars zero', { kind: 'generated', ...review, maxChars: 0 }],
    [
      'an insertError outside the insert codes',
      { kind: 'generated', ...review, insertError: 'INTERNAL_ERROR' },
    ],
    ['inserting with an insertError', { kind: 'inserting', ...review, insertError: 'FIELD_STALE' }],
    ['inserted with an answer', { kind: 'inserted', ...base, answer: 'x' }],
    [
      'an oversized edited answer',
      { kind: 'generated', ...review, editedAnswer: 'x'.repeat(8001) },
    ],
  ])('rejects %s', (_n, state) => {
    expect(PanelStateSchema.safeParse(state).success).toBe(false);
  });

  it('accepts insert.start, insert.request, and insert.result', () => {
    for (const m of [
      {
        v: 1,
        requestId: 'r',
        type: 'insert.start',
        payload: { tabId: 1, captureId: 'c1', answer: 'Hello there.' },
      },
      insertRequest(),
      { v: 1, requestId: 'r', type: 'insert.result', payload: { ok: true } },
      { v: 1, requestId: 'r', type: 'insert.result', payload: { ok: false, error: 'FIELD_STALE' } },
    ])
      expect(InternalMessageSchema.safeParse(m).success).toBe(true);
  });

  it.each([
    ['a leaked question', insertRequest({ question: 'Why?' })],
    ['leaked facts', insertRequest({ facts: [] })],
    ['a leaked prompt', insertRequest({ prompt: 'x' })],
    ['confirmReplace true', insertRequest({ confirmReplace: true })],
    ['no confirmReplace', insertRequest({ confirmReplace: undefined })],
    ['an empty answer', insertRequest({ answer: '' })],
    ['an oversized answer', insertRequest({ answer: 'x'.repeat(8001) })],
    ['no fingerprint', insertRequest({ fingerprint: undefined })],
    ['an extra envelope key', insertRequest({}, { extra: 1 })],
    [
      'start with a blank answer',
      {
        v: 1,
        requestId: 'r',
        type: 'insert.start',
        payload: { tabId: 1, captureId: 'c', answer: '  ' },
      },
    ],
    [
      'start with an extra key',
      {
        v: 1,
        requestId: 'r',
        type: 'insert.start',
        payload: { tabId: 1, captureId: 'c', answer: 'ok', question: 'leak' },
      },
    ],
    [
      'result with an unknown code',
      { v: 1, requestId: 'r', type: 'insert.result', payload: { ok: false, error: 'NOPE' } },
    ],
    [
      'result ok with an error',
      { v: 1, requestId: 'r', type: 'insert.result', payload: { ok: true, error: 'FIELD_STALE' } },
    ],
    [
      'result failure without a code',
      { v: 1, requestId: 'r', type: 'insert.result', payload: { ok: false } },
    ],
  ])('rejects %s', (_n, message) => {
    expect(InternalMessageSchema.safeParse(message).success).toBe(false);
  });
});
