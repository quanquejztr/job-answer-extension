import {
  MAX_DOCX_FILE_BYTES,
  MAX_LABEL_CHARS,
  MAX_RESUME_CHARS,
  MAX_RULE_CHARS,
  MAX_RULES,
  MAX_SAMPLE_CHARS,
  MAX_SAMPLES,
  MAX_STORIES,
  MAX_STORY_CHARS,
  MAX_TITLE_CHARS,
} from '../lib/constants/limits';
import {
  DeleteAllPayloadSchema,
  ExportResultSchema,
  ItemDeletePayloadSchema,
  ItemUpsertPayloadSchema,
  ProfileExportPayloadSchema,
  ProfileGetPayloadSchema,
  ProfileSchema,
  ResumeResultSchema,
  ResumeSchema,
  ImportDocumentPayloadSchema,
  ImportResultSchema,
  ResumeSetPayloadSchema,
  RuleInputSchema,
  StorySchema,
  UPSERT_RESULT_SCHEMAS,
} from './profile';
import {
  ProfileDeleteAllMessageSchema,
  ProfileDeleteMessageSchema,
  ProfileExportMessageSchema,
  ProfileExportReplySchema,
  ProfileGetMessageSchema,
  ProfileGetReplySchema,
  ProfileMessageSchema,
  ProfileImportDocumentMessageSchema,
  ProfileImportDocumentReplySchema,
  ProfileResumeSetMessageSchema,
  ProfileResumeSetReplySchema,
  ProfileUpsertMessageSchema,
} from './profile-message';
import { parseRequest } from './messages';
import { InternalMessageSchema } from './internal-message';

const now = '2026-11-20T10:00:00Z';
const resume = { text: 'Made-up résumé.', source: 'pasted', updatedAt: now };
const story = {
  id: 's_2',
  title: 'Made-up story',
  text: 'Story text.',
  createdAt: now,
  updatedAt: now,
};
const sample = { id: 'w_3', label: 'Sample', text: 'Sample text.', createdAt: now };
const rule = { id: 'r_4', kind: 'tone', text: 'Plain.', enabled: true };
const profile = {
  schemaVersion: 2,
  nextId: 5,
  settings: {},
  resume,
  stories: [story],
  samples: [sample],
  rules: [rule],
};

describe('ProfileSchema (schemaVersion 2)', () => {
  it('accepts a valid profile, an empty one, and the optional settings', () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...profile, resume: null, stories: [] }).success).toBe(true);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        settings: { provider: 'codex', disclosureAcceptedAt: now },
      }).success,
    ).toBe(true);
  });

  it('round-trips through JSON unchanged (the v2 round trip)', () => {
    const parsed = ProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    expect(parsed).toEqual(profile);
    expect(ExportResultSchema.parse({ file: parsed }).file).toEqual(profile);
  });

  it.each([
    ['unknown top-level field', { ...profile, extra: 1 }],
    ['a facts field', { ...profile, facts: [] }],
    ['unknown settings field', { ...profile, settings: { x: 1 } }],
    ['schemaVersion 1 (facts files are unsupported)', { ...profile, schemaVersion: 1 }],
    ['schemaVersion 3', { ...profile, schemaVersion: 3 }],
    ['unknown provider', { ...profile, settings: { provider: 'other' } }],
    [
      'a missing resume key',
      Object.fromEntries(Object.entries(profile).filter(([k]) => k !== 'resume')),
    ],
    ['resume as a string', { ...profile, resume: 'text' }],
    ['unknown resume field', { ...profile, resume: { ...resume, extra: 1 } }],
    ['resume with an id', { ...profile, resume: { ...resume, id: 's_9' } }],
    ['resume with a bad source', { ...profile, resume: { ...resume, source: 'web' } }],
    ['empty resume text', { ...profile, resume: { ...resume, text: '' } }],
    ['unknown story field', { ...profile, stories: [{ ...story, extra: 1 }] }],
    ['story tags', { ...profile, stories: [{ ...story, tags: [] }] }],
    ['story factIds', { ...profile, stories: [{ ...story, factIds: [] }] }],
    ['story id with the fact prefix', { ...profile, stories: [{ ...story, id: 'f_1' }] }],
    ['story id with a leading zero', { ...profile, stories: [{ ...story, id: 's_02' }] }],
    ['bad rule kind', { ...profile, rules: [{ ...rule, kind: 'mood' }] }],
    ['rule without enabled', { ...profile, rules: [{ id: 'r_2', kind: 'tone', text: 'x' }] }],
    ['missing collection', { schemaVersion: 2, nextId: 1, settings: {}, resume: null }],
    ['nextId zero', { ...profile, nextId: 0 }],
  ])('rejects %s', (_n, value) => {
    expect(ProfileSchema.safeParse(value).success).toBe(false);
  });

  const rep = (c: string, n: number) => c.repeat(n);
  const at = (n: number) => rep('x', n);

  it('enforces every length limit, at the limit and one over, in code points', () => {
    const withResume = (text: string) => ({ ...profile, resume: { ...resume, text } });
    expect(ProfileSchema.safeParse(withResume(at(MAX_RESUME_CHARS))).success).toBe(true);
    expect(ProfileSchema.safeParse(withResume(rep('😀', MAX_RESUME_CHARS))).success).toBe(true);
    expect(ProfileSchema.safeParse(withResume(at(MAX_RESUME_CHARS + 1))).success).toBe(false);

    const withStory = (over: object) => ({ ...profile, stories: [{ ...story, ...over }] });
    expect(ProfileSchema.safeParse(withStory({ title: at(MAX_TITLE_CHARS) })).success).toBe(true);
    expect(ProfileSchema.safeParse(withStory({ title: at(MAX_TITLE_CHARS + 1) })).success).toBe(
      false,
    );
    expect(ProfileSchema.safeParse(withStory({ text: rep('😀', MAX_STORY_CHARS) })).success).toBe(
      true,
    );
    expect(ProfileSchema.safeParse(withStory({ text: at(MAX_STORY_CHARS + 1) })).success).toBe(
      false,
    );

    const withSample = (over: object) => ({ ...profile, samples: [{ ...sample, ...over }] });
    expect(ProfileSchema.safeParse(withSample({ label: at(MAX_LABEL_CHARS) })).success).toBe(true);
    expect(ProfileSchema.safeParse(withSample({ label: at(MAX_LABEL_CHARS + 1) })).success).toBe(
      false,
    );
    expect(ProfileSchema.safeParse(withSample({ text: at(MAX_SAMPLE_CHARS) })).success).toBe(true);
    expect(ProfileSchema.safeParse(withSample({ text: at(MAX_SAMPLE_CHARS + 1) })).success).toBe(
      false,
    );

    const withRule = (text: string) => ({ ...profile, rules: [{ ...rule, text }] });
    expect(ProfileSchema.safeParse(withRule(at(MAX_RULE_CHARS))).success).toBe(true);
    expect(ProfileSchema.safeParse(withRule(at(MAX_RULE_CHARS + 1))).success).toBe(false);
  });

  it('enforces the collection counts: 30 stories, 5 samples, 20 rules', () => {
    const many = <T extends { id: string }>(make: (n: number) => T, count: number) =>
      Array.from({ length: count }, (_v, i) => make(i + 1));
    const stories = (n: number) => many((i) => ({ ...story, id: `s_${i}` }), n);
    const samples = (n: number) => many((i) => ({ ...sample, id: `w_${i}` }), n);
    const rules = (n: number) => many((i) => ({ ...rule, id: `r_${i}` }), n);
    expect(ProfileSchema.safeParse({ ...profile, stories: stories(MAX_STORIES) }).success).toBe(
      true,
    );
    expect(ProfileSchema.safeParse({ ...profile, stories: stories(MAX_STORIES + 1) }).success).toBe(
      false,
    );
    expect(ProfileSchema.safeParse({ ...profile, samples: samples(MAX_SAMPLES) }).success).toBe(
      true,
    );
    expect(ProfileSchema.safeParse({ ...profile, samples: samples(MAX_SAMPLES + 1) }).success).toBe(
      false,
    );
    expect(ProfileSchema.safeParse({ ...profile, rules: rules(MAX_RULES) }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...profile, rules: rules(MAX_RULES + 1) }).success).toBe(
      false,
    );
  });

  it('validates a résumé and a story on their own', () => {
    expect(ResumeSchema.safeParse(resume).success).toBe(true);
    for (const source of ['pasted', 'pdf', 'docx']) {
      expect(ResumeSchema.safeParse({ ...resume, source }).success).toBe(true);
    }
    expect(StorySchema.safeParse(story).success).toBe(true);
  });
});

describe('profile.import.document', () => {
  it('has a strict payload of standard padded base64 within the file cap', () => {
    const ok = (bytesBase64: string) => ImportDocumentPayloadSchema.safeParse({ bytesBase64 });
    expect(ok('UEsDBA==').success).toBe(true);
    expect(ok(btoa('x'.repeat(MAX_DOCX_FILE_BYTES))).success).toBe(true);
    expect(ok(btoa('x'.repeat(MAX_DOCX_FILE_BYTES + 1))).success).toBe(false);
    for (const bad of ['', 'UEsDBA', 'UEs=DBA=', 'not base64!', 'UE\nDBA==', '_-_-', '====']) {
      expect(ok(bad).success).toBe(false);
    }
    for (const payload of [
      {},
      { bytesBase64: 5 },
      { bytesBase64: 'UEsDBA==', filename: 'a.docx' },
    ]) {
      expect(ImportDocumentPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('has a strict result of non-empty text and source docx', () => {
    expect(ImportResultSchema.safeParse({ text: 'x', source: 'docx' }).success).toBe(true);
    for (const bad of [
      { text: '', source: 'docx' },
      { text: 'x', source: 'pasted' },
      { text: 'x', source: 'docx', filename: 'a' },
      { text: 'x' },
    ]) {
      expect(ImportResultSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('is registered natively and as a settings message', () => {
    const base = { protocolVersion: 1, requestId: 'r1' };
    expect(
      parseRequest({
        ...base,
        type: 'profile.import.document',
        payload: { bytesBase64: 'UEsDBA==' },
      }).ok,
    ).toBe(true);
    expect(
      ProfileImportDocumentMessageSchema.safeParse({
        v: 1,
        requestId: 'r1',
        type: 'settings.profile.import.document',
        payload: { bytesBase64: 'UEsDBA==' },
      }).success,
    ).toBe(true);
    expect(
      ProfileImportDocumentReplySchema.safeParse({
        v: 1,
        requestId: 'r1',
        ok: true,
        result: { text: 'x', source: 'docx' },
      }).success,
    ).toBe(true);
  });
});

describe('profile.resume.set', () => {
  it('has a strict payload: text and a source from the enum', () => {
    for (const source of ['pasted', 'pdf', 'docx']) {
      expect(ResumeSetPayloadSchema.safeParse({ text: 'x', source }).success).toBe(true);
    }
    for (const payload of [
      { text: 'x', source: 'web' },
      { text: 'x', source: 'Pasted' },
      { text: 'x' },
      { source: 'pasted' },
      { text: 1, source: 'pasted' },
      { text: 'x', source: 'pasted', id: 's_1' },
      {},
    ]) {
      expect(ResumeSetPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('is registered natively and as a settings message, never a content-script one', () => {
    const base = { protocolVersion: 1, requestId: 'r1' };
    expect(
      parseRequest({
        ...base,
        type: 'profile.resume.set',
        payload: { text: 'x', source: 'pasted' },
      }).ok,
    ).toBe(true);
    expect(
      parseRequest({ ...base, type: 'profile.resume.set', payload: { text: 'x', source: 'web' } }),
    ).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    const env = { v: 1, requestId: 'r1' };
    const message = {
      ...env,
      type: 'settings.profile.resume.set',
      payload: { text: 'x', source: 'docx' },
    };
    expect(ProfileResumeSetMessageSchema.safeParse(message).success).toBe(true);
    expect(ProfileMessageSchema.safeParse(message).success).toBe(true);
    expect(InternalMessageSchema.safeParse(message).success).toBe(false);
  });

  it('has a strict result and reply', () => {
    expect(ResumeResultSchema.safeParse({ resume }).success).toBe(true);
    expect(ResumeResultSchema.safeParse(resume).success).toBe(false);
    expect(ResumeResultSchema.safeParse({ resume, extra: 1 }).success).toBe(false);
    expect(
      ProfileResumeSetReplySchema.safeParse({ v: 1, requestId: 'r1', ok: true, result: { resume } })
        .success,
    ).toBe(true);
    expect(
      ProfileResumeSetReplySchema.safeParse({
        v: 1,
        requestId: 'r1',
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'm', retryable: false },
      }).success,
    ).toBe(true);
  });
});

describe('upsert and delete payloads', () => {
  it('accepts each kind with its own shape', () => {
    for (const payload of [
      { kind: 'story', item: { title: 't', text: 'x' } },
      { kind: 'story', item: { id: 's_3', title: 't', text: 'x' } },
      { kind: 'sample', item: { label: 'l', text: 'x' } },
      { kind: 'rule', item: { kind: 'avoid', text: 'x' } },
      { kind: 'rule', item: { id: 'r_2', kind: 'tone', text: 'x', enabled: false } },
    ]) {
      expect(ItemUpsertPayloadSchema.safeParse(payload).success).toBe(true);
    }
  });

  it.each([
    ['the removed fact kind', { kind: 'fact', item: { text: 'x', source: 'user', tags: [] } }],
    ['the résumé is not an item kind', { kind: 'resume', item: { text: 'x', source: 'pasted' } }],
    ['unknown kind', { kind: 'page', item: {} }],
    ['kind and shape disagree', { kind: 'story', item: { text: 'x', label: 'l' } }],
    ['unknown item field', { kind: 'sample', item: { label: 'l', text: 'x', verified: true } }],
    ['story tags', { kind: 'story', item: { title: 't', text: 'x', tags: [] } }],
    ['story factIds', { kind: 'story', item: { title: 't', text: 'x', factIds: ['f_1'] } }],
    ['unknown payload field', { kind: 'sample', item: { label: 'l', text: 'x' }, force: true }],
    ['id with another prefix', { kind: 'story', item: { id: 'w_1', title: 't', text: 'x' } }],
    ['empty id', { kind: 'story', item: { id: '', title: 't', text: 'x' } }],
    ['enabled not boolean', { kind: 'rule', item: { kind: 'tone', text: 'x', enabled: 'yes' } }],
    ['missing item', { kind: 'story' }],
  ])('rejects an upsert with %s', (_n, payload) => {
    expect(ItemUpsertPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('keeps the rule enabled flag optional so that an update leaves it unchanged', () => {
    const parsed = RuleInputSchema.parse({ kind: 'tone', text: 'x' });
    expect(parsed.enabled).toBeUndefined();
  });

  it('validates delete payloads strictly', () => {
    expect(ItemDeletePayloadSchema.safeParse({ kind: 'story', id: 's_7' }).success).toBe(true);
    expect(ItemDeletePayloadSchema.safeParse({ kind: 'story', id: 'w_7' }).success).toBe(false);
    expect(ItemDeletePayloadSchema.safeParse({ kind: 'story', id: 's_7', force: 1 }).success).toBe(
      false,
    );
    expect(ItemDeletePayloadSchema.safeParse({ kind: 'story', id: 's_07' }).success).toBe(false);
    expect(ItemDeletePayloadSchema.safeParse({ kind: 'fact', id: 'f_7' }).success).toBe(false);
    expect(ProfileGetPayloadSchema.safeParse({}).success).toBe(true);
    expect(ProfileGetPayloadSchema.safeParse({ all: true }).success).toBe(false);
  });

  it('chooses the result schema by kind', () => {
    expect(UPSERT_RESULT_SCHEMAS.story.safeParse({ item: story }).success).toBe(true);
    expect(UPSERT_RESULT_SCHEMAS.sample.safeParse({ item: story }).success).toBe(false);
    expect(UPSERT_RESULT_SCHEMAS.story.safeParse({ item: story, extra: 1 }).success).toBe(false);
    expect('fact' in UPSERT_RESULT_SCHEMAS).toBe(false);
  });
});

describe('native registry', () => {
  it('registers the profile types and parses them as requests', () => {
    const base = { protocolVersion: 1, requestId: 'r1' };
    expect(parseRequest({ ...base, type: 'profile.get', payload: {} }).ok).toBe(true);
    expect(
      parseRequest({
        ...base,
        type: 'profile.item.upsert',
        payload: { kind: 'sample', item: { label: 'l', text: 't' } },
      }).ok,
    ).toBe(true);
    expect(
      parseRequest({ ...base, type: 'profile.item.delete', payload: { kind: 'rule', id: 'r_1' } })
        .ok,
    ).toBe(true);
    expect(parseRequest({ ...base, type: 'profile.import.text', payload: { text: 'x' } })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(parseRequest({ ...base, type: 'profile.get', payload: { x: 1 } })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    // The rest of the PRD catalog stays unregistered.
    for (const type of ['profile.import.text', 'settings.setProvider']) {
      expect(parseRequest({ ...base, type, payload: {} })).toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
    }
  });
});

describe('settings.profile.* internal messages', () => {
  const env = { v: 1, requestId: 'r1' };

  it('parse strictly and carry the same payloads', () => {
    expect(
      ProfileGetMessageSchema.safeParse({ ...env, type: 'settings.profile.get', payload: {} })
        .success,
    ).toBe(true);
    expect(
      ProfileUpsertMessageSchema.safeParse({
        ...env,
        type: 'settings.profile.item.upsert',
        payload: { kind: 'story', item: { title: 't', text: 'x' } },
      }).success,
    ).toBe(true);
    expect(
      ProfileDeleteMessageSchema.safeParse({
        ...env,
        type: 'settings.profile.item.delete',
        payload: { kind: 'story', id: 's_1' },
      }).success,
    ).toBe(true);
    expect(
      ProfileMessageSchema.safeParse({
        ...env,
        type: 'settings.profile.get',
        payload: {},
        extra: 1,
      }).success,
    ).toBe(false);
    // The native names without the prefix are not internal messages.
    expect(
      ProfileMessageSchema.safeParse({ ...env, type: 'profile.get', payload: {} }).success,
    ).toBe(false);
  });

  it('are not part of the content-script facing InternalMessageSchema (AC-050)', () => {
    for (const message of [
      { ...env, type: 'settings.profile.get', payload: {} },
      { ...env, type: 'settings.profile.item.delete', payload: { kind: 'story', id: 's_1' } },
      { ...env, type: 'profile.get', payload: {} },
    ]) {
      expect(InternalMessageSchema.safeParse(message).success).toBe(false);
    }
  });

  it('validates the reply shape: success carries a profile, failure an AppError', () => {
    expect(ProfileGetReplySchema.safeParse({ ...env, ok: true, result: profile }).success).toBe(
      true,
    );
    expect(
      ProfileGetReplySchema.safeParse({
        ...env,
        ok: false,
        error: { code: 'STORAGE_ERROR', message: 'm', retryable: false },
      }).success,
    ).toBe(true);
    expect(
      ProfileGetReplySchema.safeParse({ ...env, ok: true, result: { ...profile, extra: 1 } })
        .success,
    ).toBe(false);
    expect(ProfileGetReplySchema.safeParse({ ...env, ok: true }).success).toBe(false);
  });
});

describe('profile.export and profile.deleteAll', () => {
  const base = { protocolVersion: 1, requestId: 'r1' };

  it('are registered natively with strict payloads', () => {
    expect(parseRequest({ ...base, type: 'profile.export', payload: {} }).ok).toBe(true);
    expect(
      parseRequest({ ...base, type: 'profile.deleteAll', payload: { confirm: 'DELETE' } }).ok,
    ).toBe(true);
    for (const payload of [{ x: 1 }, { includeDrafts: true }]) {
      expect(parseRequest({ ...base, type: 'profile.export', payload })).toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
    }
    for (const payload of [
      {},
      { confirm: 'delete' },
      { confirm: 'Delete' },
      { confirm: 'DELETE ' },
      { confirm: ' DELETE' },
      { confirm: '' },
      { confirm: true },
      { confirm: null },
      { confirm: 'DELETE', keep: 'resume' },
    ]) {
      expect(parseRequest({ ...base, type: 'profile.deleteAll', payload })).toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
    }
  });

  it('payload and result schemas are strict', () => {
    expect(ProfileExportPayloadSchema.safeParse({}).success).toBe(true);
    expect(ProfileExportPayloadSchema.safeParse({ x: 1 }).success).toBe(false);
    expect(DeleteAllPayloadSchema.safeParse({ confirm: 'DELETE' }).success).toBe(true);
    expect(DeleteAllPayloadSchema.safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(ExportResultSchema.safeParse({ file: profile }).success).toBe(true);
    expect(ExportResultSchema.safeParse(profile).success).toBe(false);
    expect(ExportResultSchema.safeParse({ file: profile, extra: 1 }).success).toBe(false);
    expect(ExportResultSchema.safeParse({ file: { ...profile, extra: 1 } }).success).toBe(false);
  });

  it('have settings.profile.* internal messages, reply schema, and no content-script path', () => {
    const env = { v: 1, requestId: 'r1' };
    expect(
      ProfileExportMessageSchema.safeParse({ ...env, type: 'settings.profile.export', payload: {} })
        .success,
    ).toBe(true);
    expect(
      ProfileDeleteAllMessageSchema.safeParse({
        ...env,
        type: 'settings.profile.deleteAll',
        payload: { confirm: 'DELETE' },
      }).success,
    ).toBe(true);
    expect(
      ProfileMessageSchema.safeParse({
        ...env,
        type: 'settings.profile.deleteAll',
        payload: { confirm: 'delete' },
      }).success,
    ).toBe(false);
    expect(
      ProfileExportReplySchema.safeParse({ ...env, ok: true, result: { file: profile } }).success,
    ).toBe(true);
    for (const message of [
      { ...env, type: 'settings.profile.export', payload: {} },
      { ...env, type: 'settings.profile.deleteAll', payload: { confirm: 'DELETE' } },
    ]) {
      expect(InternalMessageSchema.safeParse(message).success).toBe(false);
    }
  });
});
