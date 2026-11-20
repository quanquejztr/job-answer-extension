import { DraftRequestSchema, DraftResponseSchema, isIsoUtc } from './draft';
import { AppErrorSchema, appErrorFor } from './error';
import { MESSAGE_TYPES, parseRequest } from './messages';
import { RequestIdSchema } from './request-id';
import { newRequestId } from '../lib/native/request-id';
import { parseResponse } from '../lib/native/parse-response';

const SENTINEL = 'SENTINEL-SECRET-TEXT-123';

const base = {
  question: 'Why do you want this job?',
  constraints: { maxWords: 100 },
  requestedAt: '2026-11-19T15:04:05Z',
};

describe('requestId', () => {
  it.each([
    ['a', true],
    ['A-z_0-9', true],
    ['a'.repeat(64), true],
    ['', false],
    ['a'.repeat(65), false],
    ['a b', false],
    ['é', false],
  ])('%s -> %s', (id, ok) => {
    expect(RequestIdSchema.safeParse(id).success).toBe(ok);
  });

  it('newRequestId is valid and unique', () => {
    const a = newRequestId();
    expect(RequestIdSchema.safeParse(a).success).toBe(true);
    expect(newRequestId()).not.toBe(a);
  });
});

describe('DraftRequest', () => {
  it('accepts boundary values', () => {
    expect(DraftRequestSchema.safeParse({ ...base, question: 'x'.repeat(10) }).success).toBe(true);
    expect(DraftRequestSchema.safeParse({ ...base, question: 'x'.repeat(1000) }).success).toBe(
      true,
    );
    expect(DraftRequestSchema.safeParse({ ...base, jobContext: 'j'.repeat(8000) }).success).toBe(
      true,
    );
    for (const maxWords of [20, 400]) {
      expect(DraftRequestSchema.safeParse({ ...base, constraints: { maxWords } }).success).toBe(
        true,
      );
    }
  });

  it('counts code points, not UTF-16 units', () => {
    const q = '\u{1F600}'.repeat(10);
    expect(DraftRequestSchema.safeParse({ ...base, question: q }).success).toBe(true);
  });

  it('rejects non-integer, missing, and unknown fields', () => {
    expect(
      DraftRequestSchema.safeParse({ ...base, constraints: { maxWords: 100.5 } }).success,
    ).toBe(false);
    expect(DraftRequestSchema.safeParse({ ...base, constraints: {} }).success).toBe(false);
    expect(DraftRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(DraftRequestSchema.safeParse({ ...base, jobContext: null }).success).toBe(false);
  });

  it('requires currentDraft iff shorter or direct', () => {
    const c = (constraints: object) =>
      DraftRequestSchema.safeParse({ ...base, constraints }).success;
    expect(c({ maxWords: 50, refinement: 'direct', currentDraft: 'x' })).toBe(true);
    expect(c({ maxWords: 50, refinement: 'direct' })).toBe(false);
    expect(c({ maxWords: 50, refinement: 'regenerate', currentDraft: 'x' })).toBe(false);
    expect(c({ maxWords: 50, currentDraft: 'x' })).toBe(false);
  });

  it('validates requestedAt as ISO UTC', () => {
    expect(isIsoUtc('2026-11-19T15:04:05Z')).toBe(true);
    expect(isIsoUtc('2026-11-19T15:04:05.5Z')).toBe(true);
    expect(isIsoUtc('2026-11-19T15:04:05+00:00')).toBe(false);
    expect(isIsoUtc('2026-02-30T15:04:05Z')).toBe(false);
    expect(isIsoUtc('2026-11-19T24:00:00Z')).toBe(false);
    expect(isIsoUtc('2026-11-19')).toBe(false);
  });
});

describe('DraftResponse and AppError', () => {
  it('rejects bad warnings and empty answers', () => {
    const ok = { answer: 'a', evidenceIds: [], warnings: [], usedFacts: [] };
    expect(DraftResponseSchema.safeParse(ok).success).toBe(true);
    expect(DraftResponseSchema.safeParse({ ...ok, answer: '' }).success).toBe(false);
    const warn = { code: 'MODEL_NOTE', severity: 'info', message: 'm' };
    expect(DraftResponseSchema.safeParse({ ...ok, warnings: [warn] }).success).toBe(true);
    expect(
      DraftResponseSchema.safeParse({ ...ok, warnings: [{ ...warn, severity: 'bad' }] }).success,
    ).toBe(false);
    expect(
      DraftResponseSchema.safeParse({ ...ok, warnings: [{ ...warn, message: 'm'.repeat(201) }] })
        .success,
    ).toBe(false);
  });

  it('AppError is strict', () => {
    expect(AppErrorSchema.safeParse(appErrorFor('INTERNAL_ERROR')).success).toBe(true);
    expect(AppErrorSchema.safeParse({ ...appErrorFor('INTERNAL_ERROR'), extra: 1 }).success).toBe(
      false,
    );
    expect(
      AppErrorSchema.safeParse({ ...appErrorFor('INTERNAL_ERROR'), code: 'NOPE' }).success,
    ).toBe(false);
  });
});

describe('message registry', () => {
  it('has exactly the implemented types', () => {
    expect([...MESSAGE_TYPES]).toEqual(['helper.hello', 'draft.generate', 'draft.cancel']);
    for (const type of [
      'profile.get',
      'diagnostics.run',
      'settings.setProvider',
      'constructor',
      '__proto__',
    ]) {
      const r = parseRequest({ protocolVersion: 1, requestId: 'r1', type, payload: {} });
      expect(r).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    }
  });

  it('maps versions and non-objects', () => {
    const env = { requestId: 'r1', type: 'helper.hello', payload: { extensionVersion: '1' } };
    expect(parseRequest({ ...env, protocolVersion: 1 }).ok).toBe(true);
    expect(parseRequest({ ...env, protocolVersion: 2 })).toEqual({
      ok: false,
      code: 'PROTOCOL_VERSION_UNSUPPORTED',
    });
    expect(parseRequest({ ...env, protocolVersion: '1' })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(parseRequest(null)).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(parseRequest([1])).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('never echoes input in the result', () => {
    const r = parseRequest({
      protocolVersion: 1,
      requestId: 'r1',
      type: SENTINEL,
      payload: { [SENTINEL]: SENTINEL },
    });
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    const p = parseResponse({
      protocolVersion: 1,
      requestId: 'r1',
      ok: false,
      error: { code: SENTINEL },
    });
    expect(JSON.stringify(p)).not.toContain(SENTINEL);
  });
});

describe('parseResponse', () => {
  it('returns a discriminated union', () => {
    expect(
      parseResponse({ protocolVersion: 1, requestId: 'r1', ok: true, result: { a: 1 } }),
    ).toEqual({
      kind: 'success',
      requestId: 'r1',
      result: { a: 1 },
    });
    const failure = parseResponse({
      protocolVersion: 1,
      requestId: '',
      ok: false,
      error: appErrorFor('INVALID_REQUEST'),
    });
    expect(failure).toEqual({
      kind: 'failure',
      requestId: '',
      error: appErrorFor('INVALID_REQUEST'),
    });
    expect(parseResponse('nope')).toEqual({ kind: 'invalid' });
    expect(parseResponse({ protocolVersion: 1, requestId: '', ok: true, result: {} })).toEqual({
      kind: 'invalid',
    });
    expect(parseResponse({ protocolVersion: 1, requestId: 'r1', ok: true, result: null })).toEqual({
      kind: 'invalid',
    });
    expect(
      parseResponse({
        protocolVersion: 1,
        requestId: 'r1',
        ok: false,
        result: null,
        error: appErrorFor('INVALID_REQUEST'),
      }),
    ).toEqual({ kind: 'invalid' });
  });
});

describe('helper.hello and draft.cancel results', () => {
  it('accepts the exact hello result and rejects other versions or fields', async () => {
    const { HelloResultSchema, CancelResultSchema } = await import('./messages');
    expect(
      HelloResultSchema.safeParse({ helperVersion: '0.1.0', protocolVersion: 1 }).success,
    ).toBe(true);
    for (const bad of [
      { helperVersion: '0.1.0', protocolVersion: 2 },
      { helperVersion: '', protocolVersion: 1 },
      { helperVersion: '0.1.0', protocolVersion: 1, extra: 1 },
      { helperVersion: '0.1.0' },
    ])
      expect(HelloResultSchema.safeParse(bad).success).toBe(false);
    expect(CancelResultSchema.safeParse({ cancelled: false }).success).toBe(true);
    expect(CancelResultSchema.safeParse({ cancelled: 'no' }).success).toBe(false);
  });
});
