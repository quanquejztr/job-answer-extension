import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import {
  AcceptDisclosureReplySchema,
  SetProviderReplySchema,
  ProfileDeleteReplySchema,
  ProfileExportReplySchema,
  ProfileGetReplySchema,
  ProfileImportDocumentReplySchema,
  ProfileResumeSetReplySchema,
  ProfileUpsertReplySchemas,
} from '../../schemas/profile-message';
import { emptyProfile, makeResume, makeStory } from './fake-profile-client';
import { handleProfileMessage } from './profile-messages';
import type { ProfileReply, ProfileService } from './profile-service';

const ME = 'me';
const get = { v: 1, requestId: 'r1', type: 'settings.profile.get', payload: {} };
const upsert = {
  v: 1,
  requestId: 'r2',
  type: 'settings.profile.item.upsert',
  payload: { kind: 'story', item: { title: 'Made-up', text: 'Made-up story.' } },
};
const del = {
  v: 1,
  requestId: 'r3',
  type: 'settings.profile.item.delete',
  payload: { kind: 'story', id: 's_1' },
};
const resumeSet = {
  v: 1,
  requestId: 'r6',
  type: 'settings.profile.resume.set',
  payload: { text: 'Made-up résumé.', source: 'pasted' },
};

const importDoc = {
  v: 1,
  requestId: 'r7',
  type: 'settings.profile.import.document',
  payload: { bytesBase64: 'UEsDBA==' },
};

const setProviderMsg = {
  v: 1,
  requestId: 'r8',
  type: 'settings.provider.set',
  payload: { provider: 'claude' },
};
const acceptMsg = { v: 1, requestId: 'r9', type: 'settings.disclosure.accept', payload: {} };

const exportMsg = { v: 1, requestId: 'r4', type: 'settings.profile.export', payload: {} };
const deleteAll = {
  v: 1,
  requestId: 'r5',
  type: 'settings.profile.deleteAll',
  payload: { confirm: 'DELETE' },
};

function setup(reply?: (id: string) => ProfileReply) {
  const handle = vi.fn<ProfileService['handle']>((m) =>
    Promise.resolve(
      reply?.(m.requestId) ?? { v: 1, requestId: m.requestId, ok: true, result: emptyProfile() },
    ),
  );
  const respond = vi.fn<(r: unknown) => void>();
  const run = (message: unknown, sender: { id?: string; tab?: unknown; url?: string }) =>
    handleProfileMessage({ runtimeId: ME, service: { handle } }, message, sender, respond);
  return { handle, respond, run };
}

describe('handleProfileMessage: who may send', () => {
  it.each([
    [
      'a content script (tab and a web page url)',
      { id: ME, tab: { id: 3 }, url: 'https://example.com/apply' },
    ],
    ['a content script with no url', { id: ME, tab: { id: 3 } }],
    [
      'a page that spoofs the extension prefix in a different position',
      { id: ME, tab: { id: 3 }, url: 'https://x.test/chrome-extension://me/' },
    ],
    ['a sender with no id', {}],
    ['a sender with no id but an extension url', { url: 'chrome-extension://me/options.html' }],
    ['another extension', { id: 'someone-else' }],
    [
      'another extension claiming our url',
      { id: 'someone-else', url: 'chrome-extension://me/options.html' },
    ],
  ])('ignores %s for every profile message', (_n, sender) => {
    const { handle, respond, run } = setup();
    for (const message of [
      get,
      upsert,
      del,
      resumeSet,
      exportMsg,
      deleteAll,
      setProviderMsg,
      acceptMsg,
    ]) {
      expect(run(message, sender)).toBe(false);
    }
    expect(handle).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('accepts the options page, with or without a tab (opened in a tab by the browser)', async () => {
    const { handle, respond, run } = setup();
    expect(run(get, { id: ME })).toBe(true);
    expect(run(get, { id: ME, tab: { id: 5 }, url: 'chrome-extension://me/options.html' })).toBe(
      true,
    );
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

describe('handleProfileMessage: routing and replies', () => {
  it('forwards each message to the service and answers with the validated reply', async () => {
    const profile = { ...emptyProfile(), nextId: 2, stories: [makeStory(1)] };
    const { handle, respond, run } = setup((id) => {
      if (id === 'r1') return { v: 1, requestId: id, ok: true, result: profile };
      if (id === 'r2') return { v: 1, requestId: id, ok: true, result: { item: makeStory(1) } };
      return { v: 1, requestId: id, ok: true, result: { deleted: true } };
    });
    expect(run(get, { id: ME })).toBe(true);
    expect(run(upsert, { id: ME })).toBe(true);
    expect(run(del, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(3));
    expect(handle.mock.calls.map(([m]) => m.type)).toEqual([
      'settings.profile.get',
      'settings.profile.item.upsert',
      'settings.profile.item.delete',
    ]);
    expect(ProfileGetReplySchema.safeParse(respond.mock.calls[0]?.[0]).success).toBe(true);
    expect(ProfileUpsertReplySchemas.story.safeParse(respond.mock.calls[1]?.[0]).success).toBe(
      true,
    );
    expect(ProfileDeleteReplySchema.safeParse(respond.mock.calls[2]?.[0]).success).toBe(true);
  });

  it('routes the résumé save to the service and validates the reply', async () => {
    const { handle, respond, run } = setup((id) => ({
      v: 1,
      requestId: id,
      ok: true,
      result: { resume: makeResume('Made-up résumé.') },
    }));
    expect(run(resumeSet, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
    expect(handle.mock.calls[0]?.[0].type).toBe('settings.profile.resume.set');
    expect(ProfileResumeSetReplySchema.safeParse(respond.mock.calls[0]?.[0]).success).toBe(true);
  });

  it('routes the provider choice and the disclosure acceptance and validates the replies', async () => {
    const { handle, respond, run } = setup((id) =>
      id === 'r8'
        ? { v: 1, requestId: id, ok: true, result: { provider: 'claude' } }
        : {
            v: 1,
            requestId: id,
            ok: true,
            result: { disclosureAcceptedAt: '2026-11-20T10:00:00Z' },
          },
    );
    expect(run(setProviderMsg, { id: ME })).toBe(true);
    expect(run(acceptMsg, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(handle.mock.calls.map(([m]) => m.type)).toEqual([
      'settings.provider.set',
      'settings.disclosure.accept',
    ]);
    expect(SetProviderReplySchema.safeParse(respond.mock.calls[0]?.[0]).success).toBe(true);
    expect(AcceptDisclosureReplySchema.safeParse(respond.mock.calls[1]?.[0]).success).toBe(true);
  });

  it.each([
    ['an unknown provider', { ...setProviderMsg, payload: { provider: 'gpt' } }],
    [
      'a default flag on the provider message',
      { ...setProviderMsg, payload: { provider: 'claude', default: true } },
    ],
    [
      'a chosen time on the disclosure message',
      { ...acceptMsg, payload: { at: '2026-01-01T00:00:00Z' } },
    ],
  ])('answers %s with INVALID_REQUEST and never reaches the service', (_n, message) => {
    const { handle, respond, run } = setup();
    expect(run(message, { id: ME })).toBe(true);
    expect(handle).not.toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('routes a document import to the service and validates the reply', async () => {
    const { handle, respond, run } = setup((id) => ({
      v: 1,
      requestId: id,
      ok: true,
      result: { text: 'Made-up text', source: 'docx' },
    }));
    expect(run(importDoc, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
    expect(handle.mock.calls[0]?.[0].type).toBe('settings.profile.import.document');
    expect(ProfileImportDocumentReplySchema.safeParse(respond.mock.calls[0]?.[0]).success).toBe(
      true,
    );
  });

  it('answers INVALID_REQUEST to a bad import payload and ignores a content script sender', () => {
    const { handle, respond, run } = setup();
    for (const payload of [
      {},
      { bytesBase64: 'x' },
      { bytesBase64: 'UEsDBA==', filename: 'a.docx' },
    ]) {
      expect(run({ ...importDoc, payload }, { id: ME })).toBe(true);
    }
    expect(handle).not.toHaveBeenCalled();
    for (const call of respond.mock.calls) {
      expect(call[0]).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(run(importDoc, { id: ME, tab: { id: 1 }, url: 'https://example.com' })).toBe(false);
  });

  it('answers INVALID_REQUEST to a résumé save with a bad source or an extra field', () => {
    const { handle, respond, run } = setup();
    for (const payload of [
      { text: 'SECRET-TEXT', source: 'web' },
      { text: 'SECRET-TEXT', source: 'pasted', id: 's_1' },
      { source: 'pasted' },
    ]) {
      expect(run({ ...resumeSet, payload }, { id: ME })).toBe(true);
    }
    expect(respond.mock.calls.map(([r]) => (r as { error: { code: string } }).error.code)).toEqual([
      'INVALID_REQUEST',
      'INVALID_REQUEST',
      'INVALID_REQUEST',
    ]);
    expect(JSON.stringify(respond.mock.calls)).not.toContain('SECRET-TEXT');
    expect(handle).not.toHaveBeenCalled();
  });

  it('routes export and deleteAll to the service and validates both replies', async () => {
    const { handle, respond, run } = setup((id) =>
      id === 'r4'
        ? { v: 1, requestId: id, ok: true, result: { file: emptyProfile() } }
        : { v: 1, requestId: id, ok: true, result: { deleted: true } },
    );
    expect(run(exportMsg, { id: ME })).toBe(true);
    expect(run(deleteAll, { id: ME })).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(handle.mock.calls.map(([m]) => m.type)).toEqual([
      'settings.profile.export',
      'settings.profile.deleteAll',
    ]);
    expect(ProfileExportReplySchema.safeParse(respond.mock.calls[0]?.[0]).success).toBe(true);
    expect(ProfileDeleteReplySchema.safeParse(respond.mock.calls[1]?.[0]).success).toBe(true);
  });

  it.each([
    ['wrong case', { confirm: 'delete' }],
    ['padded', { confirm: 'DELETE ' }],
    ['missing', {}],
    ['not a string', { confirm: true }],
    ['an extra field', { confirm: 'DELETE', keep: 'facts' }],
  ])(
    'answers INVALID_REQUEST to deleteAll with a bad confirmation (%s) and never calls the service',
    (_n, payload) => {
      const { handle, respond, run } = setup();
      expect(run({ ...deleteAll, payload }, { id: ME })).toBe(true);
      expect(respond.mock.calls[0]?.[0]).toEqual({
        v: 1,
        requestId: 'r5',
        ok: false,
        error: appErrorFor('INVALID_REQUEST'),
      });
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it('answers INVALID_REQUEST to an export with a payload', () => {
    const { handle, respond, run } = setup();
    expect(run({ ...exportMsg, payload: { includeDrafts: true } }, { id: ME })).toBe(true);
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('passes a helper AppError through as its own code', async () => {
    const { respond, run } = setup((id) => ({
      v: 1,
      requestId: id,
      ok: false,
      error: appErrorFor('STORAGE_ERROR'),
    }));
    run(get, { id: ME });
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]?.[0]).toEqual({
      v: 1,
      requestId: 'r1',
      ok: false,
      error: appErrorFor('STORAGE_ERROR'),
    });
  });

  it('answers INVALID_REQUEST to a malformed profile message from an extension page, echoing nothing', async () => {
    const { handle, respond, run } = setup();
    const bad = {
      ...upsert,
      payload: { kind: 'story', item: { title: 'SECRET-TEXT', text: 'x', tags: ['a'] } },
    };
    expect(run(bad, { id: ME })).toBe(true);
    expect(respond).toHaveBeenCalledOnce();
    expect(respond.mock.calls[0]?.[0]).toEqual({
      v: 1,
      requestId: 'r2',
      ok: false,
      error: appErrorFor('INVALID_REQUEST'),
    });
    expect(JSON.stringify(respond.mock.calls)).not.toContain('SECRET-TEXT');
    expect(handle).not.toHaveBeenCalled();
  });

  it('ignores a profile message with no usable requestId and every non-profile message', () => {
    const { handle, respond, run } = setup();
    expect(run({ ...get, requestId: 'bad id' }, { id: ME })).toBe(false);
    expect(run({ ...get, requestId: undefined }, { id: ME })).toBe(false);
    for (const other of [
      null,
      'text',
      42,
      { v: 1, requestId: 'x', type: 'draft.start', payload: {} },
      { v: 1, requestId: 'x', type: 'profile.get', payload: {} },
      { v: 1, requestId: 'x', type: 'panel.state.get', payload: { tabId: 1 } },
    ]) {
      expect(run(other, { id: ME })).toBe(false);
    }
    expect(handle).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('answers INTERNAL_ERROR when the service itself throws', async () => {
    const respond = vi.fn<(r: unknown) => void>();
    const service: ProfileService = { handle: () => Promise.reject(new Error('boom SECRET')) };
    handleProfileMessage({ runtimeId: ME, service }, get, { id: ME }, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]?.[0]).toEqual({
      v: 1,
      requestId: 'r1',
      ok: false,
      error: appErrorFor('INTERNAL_ERROR'),
    });
    expect(JSON.stringify(respond.mock.calls)).not.toContain('SECRET');
  });
});
