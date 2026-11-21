import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import { createDiagnosticsClient } from './diagnostics-client';

const CHECKS = { checks: [{ name: 'helper', ok: true }] };

function clientReplying(build: (sent: { requestId: string }) => unknown) {
  const sendMessage = vi.fn((m: unknown) => Promise.resolve(build(m as { requestId: string })));
  return { client: createDiagnosticsClient({ sendMessage }), sendMessage };
}

describe('diagnostics client', () => {
  it('sends one settings.diagnostics.run and returns the result', async () => {
    const { client, sendMessage } = clientReplying((s) => ({
      v: 1,
      requestId: s.requestId,
      ok: true,
      result: CHECKS,
    }));
    expect(await client.run()).toEqual({ ok: true, value: CHECKS });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ v: 1, type: 'settings.diagnostics.run', payload: {} }),
    );
  });

  it('returns a worker error unchanged', async () => {
    const error = appErrorFor('HELPER_UNAVAILABLE');
    const { client } = clientReplying((s) => ({ v: 1, requestId: s.requestId, ok: false, error }));
    expect(await client.run()).toEqual({ ok: false, error });
  });

  it('maps an unreachable worker to HELPER_UNAVAILABLE', async () => {
    const client = createDiagnosticsClient({ sendMessage: () => Promise.reject(new Error('x')) });
    expect(await client.run()).toEqual({ ok: false, error: appErrorFor('HELPER_UNAVAILABLE') });
  });

  it.each([
    ['a reply for another request', () => ({ v: 1, requestId: 'other', ok: true, result: CHECKS })],
    [
      'a malformed result',
      (s: { requestId: string }) => ({
        v: 1,
        requestId: s.requestId,
        ok: true,
        result: { checks: [] },
      }),
    ],
    ['no reply', () => undefined],
  ])('maps %s to INTERNAL_ERROR', async (_n, build) => {
    const { client } = clientReplying(build);
    expect(await client.run()).toEqual({ ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });
});
