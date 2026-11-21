import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import type { DiagnosticsResult } from '../../schemas/diagnostics';
import type { NativeClient, NativeResult } from '../native/native-client';
import {
  createDiagnosticsService,
  handleDiagnosticsMessage,
  type DiagnosticsService,
} from './diagnostics-service';

const ME = 'me';
const msg = { v: 1, requestId: 'r1', type: 'settings.diagnostics.run', payload: {} };
const RESULT: DiagnosticsResult = {
  checks: [
    { name: 'helper', ok: true },
    { name: 'providerExecutable', ok: true },
    {
      name: 'providerSignIn',
      ok: false,
      code: 'PROVIDER_NOT_AUTHENTICATED',
      userAction: 'Sign in with the CLI yourself',
    },
  ],
};

function native(result: NativeResult<DiagnosticsResult>): Pick<NativeClient, 'runDiagnostics'> {
  return { runDiagnostics: () => ({ result: Promise.resolve(result), cancel: () => undefined }) };
}

describe('createDiagnosticsService', () => {
  it('returns the validated checks unchanged', async () => {
    const reply = await createDiagnosticsService(native({ ok: true, value: RESULT })).run('r1');
    expect(reply).toEqual({ v: 1, requestId: 'r1', ok: true, result: RESULT });
  });

  it.each(['HELPER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'INTERNAL_ERROR'] as const)(
    'passes %s through as its own error',
    async (code) => {
      const reply = await createDiagnosticsService(
        native({ ok: false, error: appErrorFor(code) }),
      ).run('r1');
      expect(reply).toEqual({ v: 1, requestId: 'r1', ok: false, error: appErrorFor(code) });
    },
  );
});

function setup() {
  const run = vi.fn<DiagnosticsService['run']>((requestId) =>
    Promise.resolve({ v: 1, requestId, ok: true, result: RESULT }),
  );
  const respond = vi.fn<(r: unknown) => void>();
  const handle = (message: unknown, sender: { id?: string; tab?: unknown; url?: string }) =>
    handleDiagnosticsMessage({ runtimeId: ME, service: { run } }, message, sender, respond);
  return { run, respond, handle };
}

describe('handleDiagnosticsMessage', () => {
  it('answers the extension settings page', async () => {
    const t = setup();
    expect(t.handle(msg, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(t.respond).toHaveBeenCalledTimes(1));
    expect(t.respond).toHaveBeenCalledWith({ v: 1, requestId: 'r1', ok: true, result: RESULT });
  });

  it.each([
    ['a content script in a web page', { id: ME, tab: { id: 1 }, url: 'https://example.com/' }],
    ['another extension', { id: 'other' }],
    ['a sender with no id', {}],
  ])('ignores %s', (_n, sender) => {
    const t = setup();
    expect(t.handle(msg, sender)).toBe(false);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.respond).not.toHaveBeenCalled();
  });

  it('ignores other message types and answers INVALID_REQUEST to a malformed one', () => {
    const t = setup();
    expect(t.handle({ ...msg, type: 'settings.profile.get' }, { id: ME })).toBe(false);
    expect(t.handle('x', { id: ME })).toBe(false);
    expect(t.handle({ ...msg, payload: { provider: 'claude' } }, { id: ME })).toBe(true);
    expect(t.respond).toHaveBeenCalledWith({
      v: 1,
      requestId: 'r1',
      ok: false,
      error: appErrorFor('INVALID_REQUEST'),
    });
    expect(t.run).not.toHaveBeenCalled();
  });

  it('answers INTERNAL_ERROR when the service throws', async () => {
    const t = setup();
    t.run.mockRejectedValueOnce(new Error('boom SECRET'));
    t.handle(msg, { id: ME });
    await vi.waitFor(() => expect(t.respond).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(t.respond.mock.calls)).not.toContain('SECRET');
    expect(t.respond).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: appErrorFor('INTERNAL_ERROR') }),
    );
  });
});
