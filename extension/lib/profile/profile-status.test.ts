import { vi } from 'vitest';
import { appErrorFor } from '../../schemas/error';
import type { NativeCall, NativeClient, NativeResult } from '../native/native-client';
import type { Profile } from '../../schemas/profile';
import {
  createProfileStatusService,
  handleProfileStatusMessage,
  type ProfileStatusService,
} from './profile-status';
import { emptyProfile, makeResume, makeStory } from './fake-profile-client';

const ME = 'me';
const SECRET = 'MADE-UP-SECRET-FACT-TEXT';
const msg = { v: 1, requestId: 'r1', type: 'panel.profileStatus.get', payload: {} };

function native(result: NativeResult<Profile>): Pick<NativeClient, 'getProfile'> {
  const call: NativeCall<Profile> = { result: Promise.resolve(result), cancel: () => undefined };
  return { getProfile: () => call };
}

describe('createProfileStatusService', () => {
  it('returns only the status fields, whatever else the profile holds', async () => {
    const profile: Profile = {
      ...emptyProfile(),
      settings: { provider: 'claude', disclosureAcceptedAt: '2026-11-20T10:00:00Z' },
      resume: makeResume(SECRET),
      stories: [makeStory(1, { text: SECRET }), makeStory(2)],
    };
    const reply = await createProfileStatusService(native({ ok: true, value: profile })).status(
      'r1',
    );
    expect(reply).toEqual({
      v: 1,
      requestId: 'r1',
      ok: true,
      result: { hasResume: true, storyCount: 2, provider: 'claude', disclosureAccepted: true },
    });
    expect(JSON.stringify(reply)).not.toContain(SECRET);
    expect(JSON.stringify(reply)).not.toContain('2026-11-20');
  });

  it('reports no résumé but still counts stories', async () => {
    const profile: Profile = { ...emptyProfile(), stories: [makeStory(1)] };
    const reply = await createProfileStatusService(native({ ok: true, value: profile })).status(
      'r1',
    );
    expect(reply).toMatchObject({ ok: true, result: { hasResume: false, storyCount: 1 } });
  });

  it('reports nothing for an empty profile', async () => {
    const reply = await createProfileStatusService(
      native({ ok: true, value: emptyProfile() }),
    ).status('r1');
    expect(reply).toEqual({
      v: 1,
      requestId: 'r1',
      ok: true,
      result: { hasResume: false, storyCount: 0, disclosureAccepted: false },
    });
  });

  it('reports a chosen provider without the disclosure, and the reverse', async () => {
    const run = async (settings: Profile['settings']) =>
      createProfileStatusService(
        native({ ok: true, value: { ...emptyProfile(), settings } }),
      ).status('r1');
    expect(await run({ provider: 'codex' })).toMatchObject({
      result: { provider: 'codex', disclosureAccepted: false },
    });
    expect(await run({ disclosureAcceptedAt: '2026-11-20T10:00:00Z' })).toEqual({
      v: 1,
      requestId: 'r1',
      ok: true,
      result: { hasResume: false, storyCount: 0, disclosureAccepted: true },
    });
  });

  it('passes a helper error through and maps a client timeout to STORAGE_ERROR', async () => {
    const svc = (code: Parameters<typeof appErrorFor>[0]) =>
      createProfileStatusService(native({ ok: false, error: appErrorFor(code) })).status('r1');
    expect(await svc('HELPER_UNAVAILABLE')).toMatchObject({
      ok: false,
      error: { code: 'HELPER_UNAVAILABLE' },
    });
    expect(await svc('PROVIDER_TIMEOUT')).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_ERROR' },
    });
  });
});

function setup() {
  const status = vi.fn<ProfileStatusService['status']>((requestId) =>
    Promise.resolve({
      v: 1,
      requestId,
      ok: true,
      result: { hasResume: true, storyCount: 4, disclosureAccepted: true },
    }),
  );
  const respond = vi.fn<(r: unknown) => void>();
  const run = (message: unknown, sender: { id?: string; tab?: unknown; url?: string }) =>
    handleProfileStatusMessage({ runtimeId: ME, service: { status } }, message, sender, respond);
  return { status, respond, run };
}

describe('handleProfileStatusMessage', () => {
  it.each([
    ['the side panel (no tab)', { id: ME }],
    [
      'an extension page in a tab',
      { id: ME, tab: { id: 1 }, url: `chrome-extension://${ME}/sidepanel.html` },
    ],
  ])('answers %s with only the status fields', async (_n, sender) => {
    const t = setup();
    expect(t.run(msg, sender)).toBe(true);
    await vi.waitFor(() => expect(t.respond).toHaveBeenCalledTimes(1));
    expect(t.respond).toHaveBeenCalledWith({
      v: 1,
      requestId: 'r1',
      ok: true,
      result: { hasResume: true, storyCount: 4, disclosureAccepted: true },
    });
  });

  it.each([
    ['a content script', { id: ME, tab: { id: 1 }, url: 'https://example.com/apply' }],
    [
      'a content script with a lookalike url',
      { id: ME, tab: { id: 1 }, url: `chrome-extension://${ME}.evil/x` },
    ],
    ['a foreign extension', { id: 'other', url: `chrome-extension://${ME}/x` }],
    ['a sender without an id', {}],
  ])('ignores %s and never asks the helper', (_n, sender) => {
    const t = setup();
    expect(t.run(msg, sender)).toBe(false);
    expect(t.status).not.toHaveBeenCalled();
    expect(t.respond).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['a string', 'panel.profileStatus.get'],
    ['another type', { ...msg, type: 'settings.profile.get' }],
  ])('leaves %s for other handlers', (_n, message) => {
    const t = setup();
    expect(t.run(message, { id: ME })).toBe(false);
    expect(t.respond).not.toHaveBeenCalled();
  });

  it('answers INVALID_REQUEST to a malformed request from our own page, echoing nothing', () => {
    const t = setup();
    expect(t.run({ ...msg, payload: { profile: SECRET } }, { id: ME })).toBe(true);
    expect(t.status).not.toHaveBeenCalled();
    const [reply] = t.respond.mock.calls[0] ?? [];
    expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(JSON.stringify(reply)).not.toContain(SECRET);
  });

  it('stays silent when a malformed request has no usable request id', () => {
    const t = setup();
    expect(t.run({ ...msg, requestId: 'bad id!' }, { id: ME })).toBe(false);
  });

  it('answers INTERNAL_ERROR if the service itself throws', async () => {
    const respond = vi.fn<(r: unknown) => void>();
    const service: ProfileStatusService = { status: () => Promise.reject(new Error(SECRET)) };
    handleProfileStatusMessage({ runtimeId: ME, service }, msg, { id: ME }, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(JSON.stringify(respond.mock.calls[0])).not.toContain(SECRET);
  });
});

describe('the profile status reply schema cannot carry a profile', () => {
  it('rejects extra fields in the result', async () => {
    const { ProfileStatusReplySchema } = await import('../../schemas/profile-status-message');
    const base = { v: 1, requestId: 'r1', ok: true };
    expect(
      ProfileStatusReplySchema.safeParse({
        ...base,
        result: { hasResume: true, storyCount: 2, disclosureAccepted: false },
      }).success,
    ).toBe(true);
    expect(
      ProfileStatusReplySchema.safeParse({
        ...base,
        result: { hasResume: true, storyCount: 1, disclosureAccepted: true, facts: [] },
      }).success,
    ).toBe(false);
    expect(ProfileStatusReplySchema.safeParse({ ...base, result: emptyProfile() }).success).toBe(
      false,
    );
  });
});
