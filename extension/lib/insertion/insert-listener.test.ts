import { vi } from 'vitest';
import { buildFingerprint } from '../targeting/fingerprint';
import { byId, setBody, stubLayout } from '../targeting/dom-helpers';
import type { InsertEnv } from './insert-field';
import { createInsertListener } from './insert-listener';

const env: InsertEnv = {
  requestFrame: (cb) => {
    queueMicrotask(cb);
    return 1;
  },
  cancelFrame: () => undefined,
  setTimer: () => 1,
  clearTimer: () => undefined,
};

function setup() {
  stubLayout();
  setBody(
    '<form><label for="why">Why Acme?</label><textarea id="why" name="why"></textarea></form>',
  );
  const field = byId<HTMLTextAreaElement>('why');
  const fingerprint = buildFingerprint(field);
  if (fingerprint === undefined) throw new Error('no fingerprint');
  const request = (over: object = {}, payload: object = {}) => ({
    v: 1,
    requestId: 'ins-1',
    type: 'insert.request',
    payload: {
      targetId: 't1',
      answer: 'My answer.',
      confirmReplace: false,
      locator: { frameId: 0, domPath: fingerprint.domPath },
      fingerprint,
      ...payload,
    },
    ...over,
  });
  const listener = createInsertListener({ runtimeId: 'me', document, env });
  const call = (message: unknown, sender: { id?: string } = { id: 'me' }) => {
    const respond = vi.fn();
    const took = listener(message, sender, respond);
    return { took, respond };
  };
  return { field, request, call };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('createInsertListener', () => {
  it('inserts and replies with an insert.result envelope carrying the request id', async () => {
    const { field, request, call } = setup();
    const { took, respond } = call(request());
    expect(took).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith({
      v: 1,
      requestId: 'ins-1',
      type: 'insert.result',
      payload: { ok: true },
    });
    expect(field.value).toBe('My answer.');
  });

  it('replies with the typed failure for a nonempty field', async () => {
    const { field, request, call } = setup();
    field.value = 'Existing.';
    const { respond } = call(request());
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith({
      v: 1,
      requestId: 'ins-1',
      type: 'insert.result',
      payload: { ok: false, error: 'FIELD_NONEMPTY' },
    });
    expect(field.value).toBe('Existing.');
  });

  it('stays silent for another extension, and writes nothing', () => {
    const { field, request, call } = setup();
    for (const sender of [{ id: 'evil' }, {}]) {
      const { took, respond } = call(request(), sender);
      expect(took).toBe(false);
      expect(respond).not.toHaveBeenCalled();
    }
    expect(field.value).toBe('');
  });

  it.each([
    ['an extra payload key (a leaked question)', { question: 'Why do you want this job?' }],
    ['an extra payload key (facts)', { facts: ['x'] }],
    ['confirmReplace true', { confirmReplace: true }],
    ['an empty answer', { answer: '' }],
    ['an oversized answer', { answer: 'x'.repeat(8001) }],
    ['a missing target id', { targetId: undefined }],
  ])('ignores a malformed request: %s', (_name, payload) => {
    const { field, request, call } = setup();
    const { took, respond } = call(request({}, payload));
    expect(took).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    expect(field.value).toBe('');
  });

  it('ignores a wrong version, an unknown type, and an extra envelope key', () => {
    const { request, call } = setup();
    for (const bad of [
      request({ v: 2 }),
      request({ type: 'insert.result' }),
      request({ extra: 1 }),
      'insert',
      null,
    ])
      expect(call(bad).took).toBe(false);
  });

  it('serves each target id once: a repeat replies FIELD_STALE and never writes again', async () => {
    const { field, request, call } = setup();
    const first = call(request());
    await vi.waitFor(() => expect(first.respond).toHaveBeenCalled());
    field.value = '';
    const second = call(request({ requestId: 'ins-2' }));
    expect(second.took).toBe(true);
    await vi.waitFor(() => expect(second.respond).toHaveBeenCalled());
    expect(second.respond).toHaveBeenCalledWith({
      v: 1,
      requestId: 'ins-2',
      type: 'insert.result',
      payload: { ok: false, error: 'FIELD_STALE' },
    });
    expect(field.value).toBe('');
  });
});
