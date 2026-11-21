import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import type { ProfileMessage } from '../../schemas/profile-message';
import {
  createNativeClient,
  type NativeCall,
  type NativeClient,
  type NativePort,
} from '../native/native-client';
import { emptyProfile, makeResume, makeStory } from './fake-profile-client';
import { createProfileService } from './profile-service';

const message = (type: string, payload: object): ProfileMessage =>
  ({ v: 1, requestId: 'req-1', type, payload }) as ProfileMessage;

const done = <T>(
  value: { ok: true; value: T } | { ok: false; error: ReturnType<typeof appErrorFor> },
): NativeCall<T> => ({
  result: Promise.resolve(value),
  cancel: () => undefined,
});

type ProfileNativeFake = Pick<
  NativeClient,
  | 'getProfile'
  | 'upsertProfileItem'
  | 'setResume'
  | 'importDocument'
  | 'deleteProfileItem'
  | 'exportProfile'
  | 'deleteAllProfile'
  | 'setProvider'
  | 'acceptDisclosure'
>;

describe('createProfileService with a fake native client', () => {
  const upsertMsg = message('settings.profile.item.upsert', {
    kind: 'story',
    item: { title: 't', text: 'x' },
  });
  const resumeMsg = message('settings.profile.resume.set', { text: 'x', source: 'pasted' });
  const importMsg = message('settings.profile.import.document', { bytesBase64: 'UEsDBA==' });

  it('turns each helper result into an ok reply bound to the request id', async () => {
    const profile = {
      ...emptyProfile(),
      nextId: 2,
      resume: makeResume(),
      stories: [makeStory(1)],
    };
    const native: ProfileNativeFake = {
      getProfile: () => done({ ok: true, value: profile }),
      upsertProfileItem: () => done({ ok: true, value: { kind: 'story', item: makeStory(1) } }),
      setResume: () => done({ ok: true, value: makeResume() }),
      importDocument: () => done({ ok: true, value: { text: 'Imported', source: 'docx' } }),
      deleteProfileItem: () => done({ ok: true, value: { deleted: true } }),
      exportProfile: () => done({ ok: true, value: { file: profile } }),
      deleteAllProfile: () => done({ ok: true, value: { deleted: true } }),
      setProvider: (provider) => done({ ok: true, value: provider }),
      acceptDisclosure: () =>
        done({ ok: true, value: { disclosureAcceptedAt: '2026-11-20T10:00:00Z' } }),
    };
    const service = createProfileService(native);
    expect(await service.handle(message('settings.profile.get', {}))).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: profile,
    });
    expect(await service.handle(upsertMsg)).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { item: makeStory(1) },
    });
    expect(await service.handle(resumeMsg)).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { resume: makeResume() },
    });
    expect(await service.handle(importMsg)).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { text: 'Imported', source: 'docx' },
    });
    expect(
      await service.handle(message('settings.profile.item.delete', { kind: 'story', id: 's_1' })),
    ).toEqual({ v: 1, requestId: 'req-1', ok: true, result: { deleted: true } });
    expect(await service.handle(message('settings.profile.export', {}))).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { file: profile },
    });
    expect(
      await service.handle(message('settings.profile.deleteAll', { confirm: 'DELETE' })),
    ).toEqual({ v: 1, requestId: 'req-1', ok: true, result: { deleted: true } });
  });

  it.each(['INVALID_REQUEST', 'STORAGE_ERROR', 'HELPER_UNAVAILABLE', 'INTERNAL_ERROR'] as const)(
    'passes the helper error %s through unchanged',
    async (code) => {
      const error = appErrorFor(code);
      const service = createProfileService({
        getProfile: () => done({ ok: false, error }),
        upsertProfileItem: () => done({ ok: false, error }),
        setResume: () => done({ ok: false, error }),
        importDocument: () => done({ ok: false, error }),
        deleteProfileItem: () => done({ ok: false, error }),
        exportProfile: () => done({ ok: false, error }),
        deleteAllProfile: () => done({ ok: false, error }),
        setProvider: () => done({ ok: false, error }),
        acceptDisclosure: () => done({ ok: false, error }),
      });
      const expected = { v: 1, requestId: 'req-1', ok: false, error };
      expect(await service.handle(message('settings.profile.get', {}))).toEqual(expected);
      expect(await service.handle(upsertMsg)).toEqual(expected);
      expect(await service.handle(resumeMsg)).toEqual(expected);
      expect(await service.handle(importMsg)).toEqual(expected);
      expect(
        await service.handle(message('settings.profile.item.delete', { kind: 'story', id: 's_1' })),
      ).toEqual(expected);
      expect(await service.handle(message('settings.profile.export', {}))).toEqual(expected);
      expect(
        await service.handle(message('settings.profile.deleteAll', { confirm: 'DELETE' })),
      ).toEqual(expected);
      expect(
        await service.handle(message('settings.provider.set', { provider: 'claude' })),
      ).toEqual(expected);
      expect(await service.handle(message('settings.disclosure.accept', {}))).toEqual(expected);
    },
  );

  it('reports a client-side timeout as a storage problem, not a provider one', async () => {
    const service = createProfileService({
      getProfile: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      upsertProfileItem: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      setResume: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      importDocument: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      deleteProfileItem: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      exportProfile: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      deleteAllProfile: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      setProvider: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
      acceptDisclosure: () => done({ ok: false, error: appErrorFor('PROVIDER_TIMEOUT') }),
    });
    const r = await service.handle(message('settings.profile.get', {}));
    expect(r).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    expect(await service.handle(resumeMsg)).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_ERROR' },
    });
    expect(await service.handle(importMsg)).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_ERROR' },
    });
    const d = await service.handle(message('settings.profile.deleteAll', { confirm: 'DELETE' }));
    expect(d).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
    expect(await service.handle(message('settings.disclosure.accept', {}))).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_ERROR' },
    });
  });

  it('answers the provider choice and the disclosure with the helper result', async () => {
    const setProvider = vi.fn<ProfileNativeFake['setProvider']>((provider) =>
      done({ ok: true, value: provider }),
    );
    const acceptDisclosure = vi.fn<ProfileNativeFake['acceptDisclosure']>(() =>
      done({ ok: true, value: { disclosureAcceptedAt: '2026-11-20T10:00:00Z' } }),
    );
    const service = createProfileService({
      ...({} as ProfileNativeFake),
      setProvider,
      acceptDisclosure,
    });
    expect(await service.handle(message('settings.provider.set', { provider: 'claude' }))).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { provider: 'claude' },
    });
    expect(setProvider).toHaveBeenCalledWith('claude');
    expect(await service.handle(message('settings.disclosure.accept', {}))).toEqual({
      v: 1,
      requestId: 'req-1',
      ok: true,
      result: { disclosureAcceptedAt: '2026-11-20T10:00:00Z' },
    });
  });
});

// The same service over the real native client and a fake port: one port per
// request, one validated request out, and the helper's answer validated by Zod.
class FakePort implements NativePort {
  posted: { requestId: string; type: string; payload: unknown }[] = [];
  disconnected = 0;
  private onMsg = new Set<(m: unknown) => void>();
  private onDisc = new Set<() => void>();
  onMessage = {
    addListener: (l: (m: unknown) => void) => void this.onMsg.add(l),
    removeListener: (l: (m: unknown) => void) => void this.onMsg.delete(l),
  };
  onDisconnect = {
    addListener: (l: () => void) => void this.onDisc.add(l),
    removeListener: (l: () => void) => void this.onDisc.delete(l),
  };
  postMessage(m: unknown) {
    this.posted.push(m as FakePort['posted'][number]);
  }
  disconnect() {
    this.disconnected += 1;
  }
  reply(result: unknown) {
    const id = this.posted[0]?.requestId;
    for (const l of [...this.onMsg]) l({ protocolVersion: 1, requestId: id, ok: true, result });
  }
  fail(error: object) {
    const id = this.posted[0]?.requestId;
    for (const l of [...this.onMsg]) l({ protocolVersion: 1, requestId: id, ok: false, error });
  }
  hangUp() {
    for (const l of [...this.onDisc]) l();
  }
}

describe('createProfileService over the native client', () => {
  function setup() {
    const ports: FakePort[] = [];
    const connect = vi.fn(() => {
      const p = new FakePort();
      ports.push(p);
      return p;
    });
    return { ports, connect, service: createProfileService(createNativeClient(connect)) };
  }

  it('uses one port per request with the native type and payload, then disconnects', async () => {
    const { ports, connect, service } = setup();
    const a = service.handle(message('settings.profile.get', {}));
    const b = service.handle(
      message('settings.profile.item.delete', { kind: 'sample', id: 'w_2' }),
    );
    expect(connect).toHaveBeenCalledTimes(2);
    expect(ports[0]?.posted[0]).toMatchObject({ type: 'profile.get', payload: {} });
    expect(ports[1]?.posted[0]).toMatchObject({
      type: 'profile.item.delete',
      payload: { kind: 'sample', id: 'w_2' },
    });
    expect(ports[0]?.posted[0]?.requestId).not.toBe(ports[1]?.posted[0]?.requestId);
    ports[0]?.reply(emptyProfile());
    ports[1]?.reply({ deleted: true });
    expect(await a).toMatchObject({ ok: true, result: emptyProfile() });
    expect(await b).toMatchObject({ ok: true, result: { deleted: true } });
    expect(ports.map((p) => p.disconnected)).toEqual([1, 1]);
  });

  it('sends profile.resume.set with the text and source and validates the result', async () => {
    const { ports, service } = setup();
    const a = service.handle(message('settings.profile.resume.set', { text: 'R', source: 'docx' }));
    expect(ports[0]?.posted[0]).toMatchObject({
      type: 'profile.resume.set',
      payload: { text: 'R', source: 'docx' },
    });
    ports[0]?.reply({ resume: makeResume('R', { source: 'docx' }) });
    expect(await a).toMatchObject({
      ok: true,
      result: { resume: makeResume('R', { source: 'docx' }) },
    });
    expect(ports[0]?.disconnected).toBe(1);
    for (const bad of [
      makeResume(),
      { resume: { ...makeResume(), source: 'web' } },
      { resume: makeResume(), extra: 1 },
      { item: makeStory(1) },
    ]) {
      const b = setup();
      const r = b.service.handle(
        message('settings.profile.resume.set', { text: 'x', source: 'pasted' }),
      );
      b.ports[0]?.reply(bad);
      expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    }
  });

  it('sends profile.import.document with only the bytes and validates the result', async () => {
    const { ports, service } = setup();
    const a = service.handle(
      message('settings.profile.import.document', { bytesBase64: 'UEsDBA==' }),
    );
    expect(ports[0]?.posted[0]).toMatchObject({
      type: 'profile.import.document',
      payload: { bytesBase64: 'UEsDBA==' },
    });
    ports[0]?.reply({ text: 'Made-up text', source: 'docx' });
    expect(await a).toMatchObject({ ok: true, result: { text: 'Made-up text', source: 'docx' } });
    expect(ports[0]?.disconnected).toBe(1);
    for (const bad of [
      { text: '', source: 'docx' },
      { text: 'x', source: 'pasted' },
      { text: 'x', source: 'docx', filename: 'a.docx' },
      { resume: makeResume() },
    ]) {
      const b = setup();
      const r = b.service.handle(
        message('settings.profile.import.document', { bytesBase64: 'UEsDBA==' }),
      );
      b.ports[0]?.reply(bad);
      expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    }
  });

  it('sends profile.export with {} and profile.deleteAll with the literal confirmation', async () => {
    const { ports, service } = setup();
    const a = service.handle(message('settings.profile.export', {}));
    const b = service.handle(message('settings.profile.deleteAll', { confirm: 'DELETE' }));
    expect(ports[0]?.posted[0]).toMatchObject({ type: 'profile.export', payload: {} });
    expect(ports[1]?.posted[0]).toMatchObject({
      type: 'profile.deleteAll',
      payload: { confirm: 'DELETE' },
    });
    ports[0]?.reply({ file: emptyProfile() });
    ports[1]?.reply({ deleted: true });
    expect(await a).toMatchObject({ ok: true, result: { file: emptyProfile() } });
    expect(await b).toMatchObject({ ok: true, result: { deleted: true } });
    expect(ports.map((p) => p.disconnected)).toEqual([1, 1]);
  });

  it.each([
    ['a bare profile without the file wrapper', () => emptyProfile()],
    ['a file with an unknown field', () => ({ file: { ...emptyProfile(), x: 1 } })],
    ['an extra top-level field', () => ({ file: emptyProfile(), x: 1 })],
  ])('validates the export result: %s is INTERNAL_ERROR', async (_n, result) => {
    const { ports, service } = setup();
    const r = service.handle(message('settings.profile.export', {}));
    ports[0]?.reply(result());
    expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('validates the deleteAll result: deleted:false is INTERNAL_ERROR', async () => {
    const { ports, service } = setup();
    const r = service.handle(message('settings.profile.deleteAll', { confirm: 'DELETE' }));
    ports[0]?.reply({ deleted: false });
    expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('validates helper results: a profile with an unknown field is INTERNAL_ERROR', async () => {
    const { ports, service } = setup();
    const r = service.handle(message('settings.profile.get', {}));
    ports[0]?.reply({ ...emptyProfile(), extra: 1 });
    expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('validates upsert results by kind: a story where a sample was sent is INTERNAL_ERROR', async () => {
    const { ports, service } = setup();
    const r = service.handle(
      message('settings.profile.item.upsert', {
        kind: 'sample',
        item: { label: 'l', text: 'x' },
      }),
    );
    ports[0]?.reply({ item: makeStory(1) });
    expect(await r).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('maps a missing host to HELPER_UNAVAILABLE and passes a helper failure through', async () => {
    const a = setup();
    const r1 = a.service.handle(message('settings.profile.get', {}));
    a.ports[0]?.hangUp();
    expect(await r1).toMatchObject({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } });
    const b = setup();
    const r2 = b.service.handle(message('settings.profile.get', {}));
    b.ports[0]?.fail(appErrorFor('STORAGE_ERROR'));
    expect(await r2).toMatchObject({ ok: false, error: appErrorFor('STORAGE_ERROR') });
  });

  it('refuses to send an item the strict request schema rejects', async () => {
    const { connect, service } = setup();
    const r = await service.handle(
      message('settings.profile.item.upsert', {
        kind: 'story',
        item: { title: 't', text: 'x', tags: [] },
      }),
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(connect).not.toHaveBeenCalled();
  });
});
