import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import { emptyProfile, makeResume, makeRule, makeSample, makeStory } from './fake-profile-client';
import type { ItemUpsertPayload } from '../../schemas/profile';
import { createProfileClient } from './profile-client';

function setup(reply: (sent: { requestId: string }) => unknown) {
  const sent: { v: number; requestId: string; type: string; payload: unknown }[] = [];
  const sendMessage = vi.fn((m: unknown) => {
    const message = m as (typeof sent)[number];
    sent.push(message);
    return Promise.resolve(reply(message));
  });
  return { sent, client: createProfileClient({ sendMessage }) };
}

const ok = (requestId: string, result: unknown) => ({ v: 1, requestId, ok: true, result });

describe('createProfileClient', () => {
  it('sends a typed settings message with a fresh requestId and returns the profile', async () => {
    const { sent, client } = setup((m) => ok(m.requestId, emptyProfile()));
    expect(await client.get()).toEqual({ ok: true, value: emptyProfile() });
    await client.get();
    expect(sent[0]).toMatchObject({ v: 1, type: 'settings.profile.get', payload: {} });
    expect(sent[0]?.requestId).not.toBe(sent[1]?.requestId);
  });

  it.each<[string, ItemUpsertPayload, unknown]>([
    ['story', { kind: 'story', item: { title: 't', text: 'x' } }, makeStory(2)],
    ['sample', { kind: 'sample', item: { label: 'l', text: 'x' } }, makeSample(3)],
    ['rule', { kind: 'rule', item: { kind: 'tone', text: 'x' } }, makeRule(4)],
  ] as const)(
    'upserts a %s and returns the stored item with its kind',
    async (kind, payload, item) => {
      const { sent, client } = setup((m) => ok(m.requestId, { item }));
      const r = await client.upsert(payload);
      expect(r).toEqual({ ok: true, value: { kind, item } });
      expect(sent[0]).toMatchObject({ type: 'settings.profile.item.upsert', payload });
    },
  );

  it('deletes by kind and id', async () => {
    const { sent, client } = setup((m) => ok(m.requestId, { deleted: true }));
    expect(await client.delete({ kind: 'story', id: 's_1' })).toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(sent[0]).toMatchObject({
      type: 'settings.profile.item.delete',
      payload: { kind: 'story', id: 's_1' },
    });
  });

  it('saves the résumé and returns the stored résumé', async () => {
    const resume = makeResume('Made-up résumé.', { source: 'docx' });
    const { sent, client } = setup((m) => ok(m.requestId, { resume }));
    const payload = { text: 'Made-up résumé.', source: 'docx' } as const;
    expect(await client.setResume(payload)).toEqual({ ok: true, value: resume });
    expect(sent[0]).toMatchObject({ v: 1, type: 'settings.profile.resume.set', payload });
  });

  it.each([
    ['a bare résumé', (m: { requestId: string }) => ok(m.requestId, makeResume())],
    ['a profile', (m: { requestId: string }) => ok(m.requestId, emptyProfile())],
    [
      'a bad source',
      (m: { requestId: string }) => ok(m.requestId, { resume: { ...makeResume(), source: 'web' } }),
    ],
    ['another request id', () => ok('someone-else', { resume: makeResume() })],
  ])('maps a résumé reply of %s to INTERNAL_ERROR', async (_n, reply) => {
    const { client } = setup(reply);
    expect(await client.setResume({ text: 'x', source: 'pasted' })).toEqual({
      ok: false,
      error: appErrorFor('INTERNAL_ERROR'),
    });
  });

  it('passes a résumé save error through and maps an unreachable worker', async () => {
    const error = appErrorFor('INVALID_REQUEST');
    const { client } = setup((m) => ({ v: 1, requestId: m.requestId, ok: false, error }));
    expect(await client.setResume({ text: 'x', source: 'pasted' })).toEqual({ ok: false, error });
    const gone = createProfileClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    expect(await gone.setResume({ text: 'x', source: 'pasted' })).toEqual({
      ok: false,
      error: appErrorFor('HELPER_UNAVAILABLE'),
    });
  });

  it('imports a document and returns only the extracted text', async () => {
    const { sent, client } = setup((m) =>
      ok(m.requestId, { text: 'Made-up text', source: 'docx' }),
    );
    const payload = { bytesBase64: 'UEsDBA==' };
    expect(await client.importDocument(payload)).toEqual({
      ok: true,
      value: { text: 'Made-up text', source: 'docx' },
    });
    expect(sent[0]).toMatchObject({ v: 1, type: 'settings.profile.import.document', payload });
  });

  it.each([
    ['a résumé', (m: { requestId: string }) => ok(m.requestId, { resume: makeResume() })],
    ['empty text', (m: { requestId: string }) => ok(m.requestId, { text: '', source: 'docx' })],
    ['a bad source', (m: { requestId: string }) => ok(m.requestId, { text: 'x', source: 'pdf' })],
    ['another request id', () => ok('someone-else', { text: 'x', source: 'docx' })],
  ])('maps an import reply of %s to INTERNAL_ERROR', async (_n, reply) => {
    const { client } = setup(reply);
    expect(await client.importDocument({ bytesBase64: 'UEsDBA==' })).toEqual({
      ok: false,
      error: appErrorFor('INTERNAL_ERROR'),
    });
  });

  it('passes an import error through and maps an unreachable worker', async () => {
    const error = appErrorFor('INVALID_REQUEST');
    const { client } = setup((m) => ({ v: 1, requestId: m.requestId, ok: false, error }));
    expect(await client.importDocument({ bytesBase64: 'UEsDBA==' })).toEqual({ ok: false, error });
    const gone = createProfileClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    expect(await gone.importDocument({ bytesBase64: 'UEsDBA==' })).toEqual({
      ok: false,
      error: appErrorFor('HELPER_UNAVAILABLE'),
    });
  });

  it('exports the full profile through the worker and unwraps the file', async () => {
    const profile = { ...emptyProfile(), nextId: 2, resume: makeResume(), stories: [makeStory(1)] };
    const { sent, client } = setup((m) => ok(m.requestId, { file: profile }));
    expect(await client.export()).toEqual({ ok: true, value: profile });
    expect(sent[0]).toMatchObject({ v: 1, type: 'settings.profile.export', payload: {} });
  });

  it('deleteAll sends the literal confirmation and returns the acknowledgement', async () => {
    const { sent, client } = setup((m) => ok(m.requestId, { deleted: true }));
    expect(await client.deleteAll()).toEqual({ ok: true, value: { deleted: true } });
    expect(sent[0]).toMatchObject({
      v: 1,
      type: 'settings.profile.deleteAll',
      payload: { confirm: 'DELETE' },
    });
  });

  it.each([
    ['a bare profile', (m: { requestId: string }) => ok(m.requestId, emptyProfile())],
    ['a wrapped invalid file', (m: { requestId: string }) => ok(m.requestId, { file: { x: 1 } })],
    ['another request id', () => ok('someone-else', { file: emptyProfile() })],
  ])('maps an export reply of %s to INTERNAL_ERROR', async (_n, reply) => {
    const { client } = setup(reply);
    expect(await client.export()).toEqual({ ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });

  it('passes errors through and maps an unreachable worker for export and deleteAll', async () => {
    const error = appErrorFor('STORAGE_ERROR');
    const { client } = setup((m) => ({ v: 1, requestId: m.requestId, ok: false, error }));
    expect(await client.export()).toEqual({ ok: false, error });
    expect(await client.deleteAll()).toEqual({ ok: false, error });
    const gone = createProfileClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    expect(await gone.export()).toEqual({ ok: false, error: appErrorFor('HELPER_UNAVAILABLE') });
    expect(await gone.deleteAll()).toEqual({ ok: false, error: appErrorFor('HELPER_UNAVAILABLE') });
  });

  it('setProvider sends the choice and returns the provider the helper confirmed', async () => {
    const { sent, client } = setup((m) => ok(m.requestId, { provider: 'claude' }));
    expect(await client.setProvider('claude')).toEqual({ ok: true, value: 'claude' });
    expect(sent[0]).toMatchObject({
      v: 1,
      type: 'settings.provider.set',
      payload: { provider: 'claude' },
    });
  });

  it('setProvider treats a reply naming another provider as INTERNAL_ERROR', async () => {
    const { client } = setup((m) => ok(m.requestId, { provider: 'codex' }));
    expect(await client.setProvider('claude')).toEqual({
      ok: false,
      error: appErrorFor('INTERNAL_ERROR'),
    });
  });

  it('acceptDisclosure sends an empty payload and returns the helper timestamp', async () => {
    const at = '2026-11-20T10:00:00Z';
    const { sent, client } = setup((m) => ok(m.requestId, { disclosureAcceptedAt: at }));
    expect(await client.acceptDisclosure()).toEqual({
      ok: true,
      value: { disclosureAcceptedAt: at },
    });
    expect(sent[0]).toMatchObject({ v: 1, type: 'settings.disclosure.accept', payload: {} });
  });

  it('passes errors through and maps an unreachable worker for the two settings calls', async () => {
    const error = appErrorFor('STORAGE_ERROR');
    const { client } = setup((m) => ({ v: 1, requestId: m.requestId, ok: false, error }));
    expect(await client.setProvider('claude')).toEqual({ ok: false, error });
    expect(await client.acceptDisclosure()).toEqual({ ok: false, error });
    const gone = createProfileClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    expect(await gone.setProvider('claude')).toEqual({
      ok: false,
      error: appErrorFor('HELPER_UNAVAILABLE'),
    });
    expect(await gone.acceptDisclosure()).toEqual({
      ok: false,
      error: appErrorFor('HELPER_UNAVAILABLE'),
    });
  });

  it('passes a worker-reported AppError through', async () => {
    const error = appErrorFor('STORAGE_ERROR');
    const { client } = setup((m) => ({ v: 1, requestId: m.requestId, ok: false, error }));
    expect(await client.get()).toEqual({ ok: false, error });
  });

  it('maps an unreachable worker to HELPER_UNAVAILABLE', async () => {
    const client = createProfileClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    const r = await client.get();
    expect(r).toEqual({ ok: false, error: appErrorFor('HELPER_UNAVAILABLE') });
    expect((await client.delete({ kind: 'rule', id: 'r_1' })).ok).toBe(false);
  });

  it.each([
    ['no reply', () => undefined],
    ['a string', () => 'text'],
    [
      'an unknown field',
      (m: { requestId: string }) => ({ ...ok(m.requestId, emptyProfile()), extra: 1 }),
    ],
    ['another request id', () => ok('someone-else', emptyProfile())],
    [
      'a profile with an unknown field',
      (m: { requestId: string }) => ok(m.requestId, { ...emptyProfile(), x: 1 }),
    ],
  ])('maps %s to INTERNAL_ERROR without echoing it', async (_n, reply) => {
    const { client } = setup(reply);
    expect(await client.get()).toEqual({ ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });

  it('rejects an upsert reply that carries another kind of item', async () => {
    const { client } = setup((m) => ok(m.requestId, { item: makeStory(1) }));
    const r = await client.upsert({ kind: 'sample', item: { label: 'l', text: 'x' } });
    expect(r).toEqual({ ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });
});
