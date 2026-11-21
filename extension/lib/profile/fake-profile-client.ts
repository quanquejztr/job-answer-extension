import { appErrorFor, type AppError, type ErrorCode } from '../../schemas/error';
import type {
  ItemDeletePayload,
  ItemUpsertPayload,
  Profile,
  Provider,
  Resume,
  ImportDocumentPayload,
  ResumeSetPayload,
  Story,
  WritingRule,
  WritingSample,
} from '../../schemas/profile';
import { applyDelete, applyResume, applyUpsert } from './profile-state';
import type { ProfileClient, ProfileResult, StoredItem } from './profile-client';

// In-memory ProfileClient for tests. It behaves like the helper for ids,
// timestamps, and the résumé replace, records every call, and can fail or
// hold the next call. Made-up data only. Not imported by any entrypoint.

const NOW = '2026-11-20T10:00:00Z';

export const emptyProfile = (): Profile => ({
  schemaVersion: 2,
  nextId: 1,
  settings: {},
  resume: null,
  stories: [],
  samples: [],
  rules: [],
});

export function makeResume(text = 'Made-up résumé text.', over: Partial<Resume> = {}): Resume {
  return { text, source: 'pasted', updatedAt: NOW, ...over };
}

export function makeStory(n: number, over: Partial<Story> = {}): Story {
  return {
    id: `s_${n}`,
    title: `Made-up story ${n}`,
    text: `Made-up story text ${n}.`,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function makeSample(n: number, over: Partial<WritingSample> = {}): WritingSample {
  return {
    id: `w_${n}`,
    label: `Sample ${n}`,
    text: `Made-up sample ${n}.`,
    createdAt: NOW,
    ...over,
  };
}

export function makeRule(n: number, over: Partial<WritingRule> = {}): WritingRule {
  return { id: `r_${n}`, kind: 'tone', text: `Made-up rule ${n}.`, enabled: true, ...over };
}

export interface FakeCall {
  type:
    | 'get'
    | 'upsert'
    | 'resume'
    | 'import'
    | 'delete'
    | 'export'
    | 'deleteAll'
    | 'setProvider'
    | 'acceptDisclosure';
  payload?:
    | ItemUpsertPayload
    | ItemDeletePayload
    | ResumeSetPayload
    | ImportDocumentPayload
    | { provider: Provider };
}

export function createFakeProfileClient(initial: Partial<Profile> = {}) {
  let profile: Profile = { ...emptyProfile(), ...initial };
  const calls: FakeCall[] = [];
  const failures: AppError[] = [];
  let hold: Promise<void> | null = null;
  let importText = 'Made-up imported résumé text.';

  async function gate(): Promise<AppError | undefined> {
    if (hold !== null) await hold;
    return failures.shift();
  }

  const client: ProfileClient = {
    async get() {
      calls.push({ type: 'get' });
      const failed = await gate();
      return failed === undefined ? { ok: true, value: profile } : { ok: false, error: failed };
    },
    async upsert(payload): Promise<ProfileResult<StoredItem>> {
      calls.push({ type: 'upsert', payload });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      const id = (prefix: string, given: string | undefined) => {
        if (given !== undefined) return given;
        const made = `${prefix}_${profile.nextId}`;
        profile = { ...profile, nextId: profile.nextId + 1 };
        return made;
      };
      let stored: StoredItem;
      switch (payload.kind) {
        case 'story': {
          const prior = profile.stories.find((s) => s.id === payload.item.id);
          stored = {
            kind: 'story',
            item: {
              ...payload.item,
              id: id('s', payload.item.id),
              createdAt: prior?.createdAt ?? NOW,
              updatedAt: NOW,
            },
          };
          break;
        }
        case 'sample': {
          const prior = profile.samples.find((s) => s.id === payload.item.id);
          stored = {
            kind: 'sample',
            item: {
              ...payload.item,
              id: id('w', payload.item.id),
              createdAt: prior?.createdAt ?? NOW,
            },
          };
          break;
        }
        case 'rule': {
          const prior = profile.rules.find((r) => r.id === payload.item.id);
          stored = {
            kind: 'rule',
            item: {
              ...payload.item,
              id: id('r', payload.item.id),
              enabled: payload.item.enabled ?? prior?.enabled ?? true,
            },
          };
          break;
        }
      }
      profile = applyUpsert(profile, stored);
      return { ok: true, value: stored };
    },
    async setResume(payload) {
      calls.push({ type: 'resume', payload });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      const resume: Resume = { text: payload.text.trim(), source: payload.source, updatedAt: NOW };
      profile = applyResume(profile, resume);
      return { ok: true, value: resume };
    },
    async importDocument(payload) {
      calls.push({ type: 'import', payload });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      return { ok: true, value: { text: importText, source: 'docx' } };
    },
    async delete(payload) {
      calls.push({ type: 'delete', payload });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      profile = applyDelete(profile, payload);
      return { ok: true, value: { deleted: true } };
    },
    async export() {
      calls.push({ type: 'export' });
      const failed = await gate();
      return failed === undefined ? { ok: true, value: profile } : { ok: false, error: failed };
    },
    async deleteAll() {
      calls.push({ type: 'deleteAll' });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      profile = emptyProfile();
      return { ok: true, value: { deleted: true } };
    },
    async setProvider(provider) {
      calls.push({ type: 'setProvider', payload: { provider } });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      profile = { ...profile, settings: { ...profile.settings, provider } };
      return { ok: true, value: provider };
    },
    async acceptDisclosure() {
      calls.push({ type: 'acceptDisclosure' });
      const failed = await gate();
      if (failed !== undefined) return { ok: false, error: failed };
      profile = { ...profile, settings: { ...profile.settings, disclosureAcceptedAt: NOW } };
      return { ok: true, value: { disclosureAcceptedAt: NOW } };
    },
  };

  return {
    client,
    calls,
    /** Current server-side profile. */
    get profile() {
      return profile;
    },
    /** The text the next imports return. */
    setImportText(text: string) {
      importText = text;
    },
    /** The next call (of any kind) answers with this error. */
    failNext(code: ErrorCode) {
      failures.push(appErrorFor(code));
    },
    /** Holds every call until the returned function is called. */
    holdCalls(): () => void {
      let release: () => void = () => undefined;
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    callsOf(type: FakeCall['type']) {
      return calls.filter((c) => c.type === type);
    },
  };
}
