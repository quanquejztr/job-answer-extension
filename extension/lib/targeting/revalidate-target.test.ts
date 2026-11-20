import type { FieldCandidate } from '../../schemas/field-target';
import type { FieldRevalidateRequest } from '../../schemas/internal-message';
import { createTarget, type Clock } from './target';
import { createTargetStore } from './target-store';
import { revalidateTarget, type RevalidateDeps } from './revalidate-target';

const candidate: FieldCandidate = {
  labelText: 'Why?',
  fingerprint: {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why?',
    sizeBucket: [300, 100],
    domPath: [0],
  },
};

function setup(reply: (m: FieldRevalidateRequest) => unknown) {
  const clock: Clock & { now: number } = {
    now: 0,
    monotonicMs() {
      return this.now;
    },
    wallMs: () => 0,
  };
  const targets = createTargetStore(clock);
  targets.set(
    4,
    createTarget(
      { id: 't1', tabId: 4, frameId: 2, pageOrigin: 'https://a.example', candidate },
      clock,
    ),
  );
  const sent: { tabId: number; frameId: number; message: FieldRevalidateRequest }[] = [];
  const deps: RevalidateDeps = {
    targets,
    newRequestId: () => 'rv-1',
    sendTabMessage: (tabId, message, options) => {
      sent.push({ tabId, frameId: options.frameId, message });
      return Promise.resolve().then(() => reply(message));
    },
  };
  return { deps, targets, clock, sent };
}

const ok = (m: FieldRevalidateRequest) => ({
  v: 1,
  requestId: m.requestId,
  type: 'field.revalidate.result',
  payload: { ok: true },
});
const fail = (reason: string) => (m: FieldRevalidateRequest) => ({
  v: 1,
  requestId: m.requestId,
  type: 'field.revalidate.result',
  payload: { ok: false, reason },
});

describe('revalidateTarget', () => {
  it('asks the target frame with the stored locator and fingerprint, then marks it validated', async () => {
    const { deps, targets, sent } = setup(ok);
    await expect(revalidateTarget(deps, 4)).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tabId: 4, frameId: 2 });
    expect(sent[0]?.message.payload).toEqual({
      locator: { frameId: 2, domPath: [0] },
      fingerprint: candidate.fingerprint,
    });
    expect(targets.get(4)?.target.state).toBe('validated');
    await expect(revalidateTarget(deps, 4)).resolves.toEqual({ ok: true });
    expect(targets.get(4)?.target.state).toBe('validated');
  });

  it.each(['missing', 'changed', 'hidden', 'disabled'] as const)(
    'a %s reply invalidates the target with FIELD_STALE',
    async (reason) => {
      const { deps, targets } = setup(fail(reason));
      await expect(revalidateTarget(deps, 4)).resolves.toEqual({
        ok: false,
        code: 'FIELD_STALE',
        reason,
      });
      expect(targets.get(4)).toMatchObject({
        target: { state: 'invalidated' },
        invalidatedBy: 'revalidation-failed',
      });
    },
  );

  it.each<[string, (m: FieldRevalidateRequest) => unknown]>([
    ['garbage', () => ({ nope: 1 })],
    ['no reply', () => undefined],
    ['another request id', () => ({ ...ok({ requestId: 'x' } as FieldRevalidateRequest) })],
    ['a thrown error', () => Promise.reject(new Error('frame gone'))],
  ])('%s invalidates the target as unreachable', async (_n, reply) => {
    const { deps, targets } = setup(reply);
    deps.sendTabMessage = (_t, m) => Promise.resolve().then(() => reply(m));
    await expect(revalidateTarget(deps, 4)).resolves.toEqual({
      ok: false,
      code: 'FIELD_STALE',
      reason: 'unreachable',
    });
    expect(targets.get(4)?.target.state).toBe('invalidated');
  });

  it('refuses without contacting the page when there is no target', async () => {
    const { deps, sent } = setup(ok);
    await expect(revalidateTarget(deps, 99)).resolves.toEqual({
      ok: false,
      code: 'FIELD_STALE',
      reason: 'no-target',
    });
    expect(sent).toEqual([]);
  });

  it('refuses an expired target without contacting the page', async () => {
    const { deps, clock, sent, targets } = setup(ok);
    clock.now = 600_000;
    await expect(revalidateTarget(deps, 4)).resolves.toMatchObject({
      ok: false,
      code: 'FIELD_STALE',
    });
    expect(sent).toEqual([]);
    expect(targets.get(4)?.invalidatedBy).toBe('expired');
  });

  it('refuses an invalidated target (navigation) and never resurrects it', async () => {
    const { deps, targets, sent } = setup(ok);
    targets.invalidate(4, 'navigation');
    await expect(revalidateTarget(deps, 4)).resolves.toMatchObject({
      ok: false,
      reason: 'no-target',
    });
    expect(sent).toEqual([]);
    expect(targets.get(4)?.target.state).toBe('invalidated');
  });

  it('does not validate a target that was replaced while waiting', async () => {
    const { deps, targets } = setup(ok);
    deps.sendTabMessage = (_t, m) => {
      targets.remove(4); // new capture / navigation during the round trip
      return Promise.resolve(ok(m));
    };
    await expect(revalidateTarget(deps, 4)).resolves.toMatchObject({
      ok: false,
      reason: 'no-target',
    });
    expect(targets.get(4)).toBeUndefined();
  });
});
