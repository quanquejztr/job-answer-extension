import { afterEach, beforeEach, vi } from 'vitest';
import { NATIVE_HOST_NAME } from '../constants/native-host';
import type { DraftRequest } from '../../schemas/draft';
import { createNativeClient, NATIVE_TIMEOUT_MS, type NativePort } from './native-client';

class FakePort implements NativePort {
  posted: unknown[] = [];
  disconnected = 0;
  throwOnPost = false;
  private messageListeners = new Set<(m: unknown) => void>();
  private disconnectListeners = new Set<() => void>();
  onMessage = {
    addListener: (l: (m: unknown) => void) => void this.messageListeners.add(l),
    removeListener: (l: (m: unknown) => void) => void this.messageListeners.delete(l),
  };
  onDisconnect = {
    addListener: (l: () => void) => void this.disconnectListeners.add(l),
    removeListener: (l: () => void) => void this.disconnectListeners.delete(l),
  };
  postMessage(m: unknown) {
    if (this.throwOnPost) throw new Error('Attempting to use a disconnected port object');
    this.posted.push(m);
  }
  disconnect() {
    this.disconnected += 1;
  }
  // Test drivers.
  reply(m: unknown) {
    for (const l of [...this.messageListeners]) l(m);
  }
  hangUp() {
    for (const l of [...this.disconnectListeners]) l();
  }
  get listenerCount() {
    return this.messageListeners.size + this.disconnectListeners.size;
  }
}

const REQUEST: DraftRequest = {
  question: 'Why do you want to work at Acme?',
  constraints: { maxWords: 150 },
  requestedAt: '2026-11-19T15:04:05Z',
};
const DRAFT = {
  answer: 'A fixed answer.',
  evidenceIds: ['f_1'],
  warnings: [],
  usedFacts: [{ id: 'f_1', text: 'Fact' }],
};
const ok = (requestId: string, result: unknown) => ({
  protocolVersion: 1,
  requestId,
  ok: true,
  result,
});

function setup() {
  const port = new FakePort();
  const connect = vi.fn<(hostName: string) => FakePort>(() => port);
  const client = createNativeClient(connect);
  return { port, connect, client };
}

function sentId(port: FakePort): string {
  const sent = port.posted[0] as { requestId: string };
  return sent.requestId;
}

describe('native client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects to the named host, sends one validated envelope, and returns the draft', async () => {
    const { port, connect, client } = setup();
    const call = client.generateDraft(REQUEST);
    expect(connect).toHaveBeenCalledExactlyOnceWith(NATIVE_HOST_NAME);
    expect(port.posted).toHaveLength(1);
    expect(port.posted[0]).toMatchObject({
      protocolVersion: 1,
      type: 'draft.generate',
      payload: REQUEST,
    });
    port.reply(ok(sentId(port), DRAFT));
    expect(await call.result).toEqual({ ok: true, value: DRAFT });
    expect(port.disconnected).toBe(1);
    expect(port.listenerCount).toBe(0);
  });

  it('sends hello and parses the hello result', async () => {
    const { port, client } = setup();
    const call = client.hello('0.0.0');
    expect(port.posted[0]).toMatchObject({
      type: 'helper.hello',
      payload: { extensionVersion: '0.0.0' },
    });
    port.reply(ok(sentId(port), { helperVersion: '0.1.0', protocolVersion: 1 }));
    expect(await call.result).toEqual({
      ok: true,
      value: { helperVersion: '0.1.0', protocolVersion: 1 },
    });
  });

  it('uses a fresh request id and port for every request', () => {
    const connect = vi.fn(() => new FakePort());
    const client = createNativeClient(connect);
    client.generateDraft(REQUEST);
    client.generateDraft(REQUEST);
    expect(connect).toHaveBeenCalledTimes(2);
    const ids = connect.mock.results.map((r) => sentId(r.value));
    expect(new Set(ids).size).toBe(2);
  });

  it('surfaces a failure envelope from the helper as its own AppError', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    const error = {
      code: 'PROVIDER_NOT_AUTHENTICATED',
      message: 'The provider is not signed in.',
      retryable: false,
      userAction: 'Sign in with the CLI yourself',
    };
    port.reply({ protocolVersion: 1, requestId: sentId(port), ok: false, error });
    expect(await call.result).toEqual({ ok: false, error });
    expect(port.disconnected).toBe(1);
  });

  it('accepts a failure envelope with an empty requestId (an unparseable request)', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    const error = {
      code: 'MESSAGE_TOO_LARGE',
      message: 'The request is too large.',
      retryable: false,
    };
    port.reply({ protocolVersion: 1, requestId: '', ok: false, error });
    expect(await call.result).toEqual({ ok: false, error });
  });

  it('maps a disconnect before any response to HELPER_UNAVAILABLE', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.hangUp();
    const r = await call.result;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('HELPER_UNAVAILABLE');
  });

  it('maps a host that is not found (immediate disconnect) to HELPER_UNAVAILABLE', async () => {
    const { port, client } = setup();
    const call = client.hello('0.0.0');
    port.hangUp();
    const r = await call.result;
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatchObject({ code: 'HELPER_UNAVAILABLE', retryable: true });
  });

  it('maps a connect exception and a post exception to HELPER_UNAVAILABLE', async () => {
    const throwing = createNativeClient(() => {
      throw new Error('Specified native messaging host not found.');
    });
    const a = await throwing.generateDraft(REQUEST).result;
    expect(a.ok === false && a.error.code).toBe('HELPER_UNAVAILABLE');

    const port = new FakePort();
    port.throwOnPost = true;
    const b = await createNativeClient(() => port).generateDraft(REQUEST).result;
    expect(b.ok === false && b.error.code).toBe('HELPER_UNAVAILABLE');
    expect(port.disconnected).toBe(1);
  });

  it('maps a response with another protocolVersion to PROTOCOL_VERSION_UNSUPPORTED', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.reply({ protocolVersion: 2, requestId: sentId(port), ok: true, result: DRAFT });
    const r = await call.result;
    expect(r.ok === false && r.error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
    expect(port.disconnected).toBe(1);
  });

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['unknown field', { ...ok('x', DRAFT), extra: 1 }],
    ['ok without result', { protocolVersion: 1, requestId: 'x', ok: true }],
    ['failure without error', { protocolVersion: 1, requestId: 'x', ok: false }],
    [
      'unknown error code',
      { protocolVersion: 1, requestId: '', ok: false, error: { code: 'NOPE' } },
    ],
  ])('maps a malformed envelope (%s) to INTERNAL_ERROR without echoing it', async (_n, raw) => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.reply(raw);
    const r = await call.result;
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r)).not.toContain('text');
  });

  it('maps a wrong requestId (success or failure) to INTERNAL_ERROR', async () => {
    for (const reply of [
      ok('someone-else', DRAFT),
      {
        protocolVersion: 1,
        requestId: 'someone-else',
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'm', retryable: false },
      },
    ]) {
      const { port, client } = setup();
      const call = client.generateDraft(REQUEST);
      port.reply(reply);
      const r = await call.result;
      expect(r.ok === false && r.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it.each([
    ['empty answer', { ...DRAFT, answer: '' }],
    ['missing usedFacts', { answer: 'a', evidenceIds: [], warnings: [] }],
    ['extra field', { ...DRAFT, extra: 1 }],
    ['bad warning', { ...DRAFT, warnings: [{ code: 'X', severity: 'info', message: 'm' }] }],
    ['not an object', 'a string'],
  ])('maps an invalid draft payload (%s) to INTERNAL_ERROR', async (_n, result) => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.reply(ok(sentId(port), result));
    const r = await call.result;
    expect(r.ok === false && r.error.code).toBe('INTERNAL_ERROR');
  });

  it('maps an invalid hello result to INTERNAL_ERROR', async () => {
    const { port, client } = setup();
    const call = client.hello('0.0.0');
    port.reply(ok(sentId(port), { helperVersion: '0.1.0', protocolVersion: 2 }));
    const r = await call.result;
    expect(r.ok === false && r.error.code).toBe('INTERNAL_ERROR');
  });

  it('times out after 100 seconds, disconnecting the port', async () => {
    expect(NATIVE_TIMEOUT_MS).toBe(100_000);
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    await vi.advanceTimersByTimeAsync(NATIVE_TIMEOUT_MS - 1);
    expect(port.disconnected).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const r = await call.result;
    expect(r.ok === false && r.error.code).toBe('PROVIDER_TIMEOUT');
    expect(port.disconnected).toBe(1);
  });

  it('cancel disconnects the port and resolves PROVIDER_CANCELLED once', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    call.cancel();
    call.cancel();
    const r = await call.result;
    expect(r.ok === false && r.error.code).toBe('PROVIDER_CANCELLED');
    expect(port.disconnected).toBe(1);
    expect(port.listenerCount).toBe(0);
    // A late response after cancel changes nothing.
    port.reply(ok(sentId(port), DRAFT));
    expect(port.disconnected).toBe(1);
  });

  it('settles only once: a response then a hang-up keeps the response', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.reply(ok(sentId(port), DRAFT));
    port.hangUp();
    expect((await call.result).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(NATIVE_TIMEOUT_MS);
    expect(port.disconnected).toBe(1);
  });

  it('refuses an invalid request without connecting', async () => {
    const connect = vi.fn(() => new FakePort());
    const client = createNativeClient(connect);
    // An invalid request (question too short) never leaves the client.
    const bad = await client.generateDraft({ ...REQUEST, question: 'short' }).result;
    expect(bad.ok === false && bad.error.code).toBe('INVALID_REQUEST');
    expect(connect).not.toHaveBeenCalled();
  });

  it('never puts helper text in an error', async () => {
    const { port, client } = setup();
    const call = client.generateDraft(REQUEST);
    port.reply({
      protocolVersion: 1,
      requestId: sentId(port),
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.', retryable: false },
    });
    const r = await call.result;
    expect(JSON.stringify(r)).not.toMatch(/\/Users|stack|exit status/);
  });
});
