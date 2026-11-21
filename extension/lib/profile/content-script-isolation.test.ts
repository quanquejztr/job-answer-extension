import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCaptureListener } from '../capture/content-capture';
import { createInsertListener } from '../insertion/insert-listener';
import { createRevalidateListener } from '../targeting/revalidate-field';
import {
  InsertRequestSchema,
  InternalMessageSchema,
  CaptureRequestSchema,
  CaptureResultSchema,
} from '../../schemas/internal-message';
import { emptyProfile, makeResume, makeStory } from './fake-profile-client';

// AC-050 / SEC-001 / invariant 10: the content script never receives profile
// data. Three independent pieces of evidence: (1) its module graph never reaches
// profile, native, draft, or UI code; (2) the schemas of everything sent to it
// are strict and carry no profile field; (3) its listeners ignore the profile
// messages even from the extension's own id.

const EXTENSION_DIR = resolve(process.cwd(), 'extension');

/** Every extension source file a module imports, followed transitively (relative imports only). */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = resolve(dirname(file), m[1] ?? '');
      const found = ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((ext) => base + ext)
        .find((candidate) => existsSync(candidate));
      if (found !== undefined) queue.push(found);
    }
  }
  return seen;
}

describe('content script isolation (AC-050)', () => {
  const graph = [...moduleGraph(resolve(EXTENSION_DIR, 'entrypoints/content.ts'))].map((f) =>
    f.slice(EXTENSION_DIR.length + 1),
  );

  it('walks a real module graph', () => {
    expect(graph).toContain('entrypoints/content.ts');
    expect(graph).toContain('lib/capture/content-capture.ts');
    expect(graph).toContain('lib/insertion/insert-listener.ts');
    expect(graph).toContain('schemas/internal-message.ts');
    expect(graph.length).toBeGreaterThan(8);
  });

  it('never imports profile, native-messaging, draft-controller, provider, or UI modules', () => {
    const forbidden =
      /^(lib\/(profile|native|draft|messaging\/panel-client)|components|entrypoints\/(options|sidepanel|background))(\/|\.)|profile|provider/;
    expect(graph.filter((f) => forbidden.test(f))).toEqual([]);
  });

  it('only imports schemas that cannot describe a profile or a helper message', () => {
    // schemas/draft.ts is reached through DraftWarning (a note's code, severity, text).
    const schemas = graph.filter((f) => f.startsWith('schemas/'));
    expect(schemas.filter((f) => /profile|messages\.ts|envelope/.test(f))).toEqual([]);
    expect(schemas).toContain('schemas/internal-message.ts');
  });
});

describe('messages that reach the content script carry no profile field', () => {
  const locator = { frameId: 0, domPath: [0] };
  const fingerprint = {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why?',
    sizeBucket: [200, 100],
    domPath: [0],
  };
  const insert = {
    v: 1,
    requestId: 'r1',
    type: 'insert.request',
    payload: { targetId: 't1', answer: 'My answer', confirmReplace: false, locator, fingerprint },
  };

  it('insert.request accepts only the approved answer and target information', () => {
    expect(InsertRequestSchema.safeParse(insert).success).toBe(true);
    for (const extra of [
      { resume: makeResume() },
      { stories: [makeStory(1)] },
      { profile: emptyProfile() },
      { evidence: [] },
      { question: 'Why?' },
      { jobContext: 'x' },
    ]) {
      const message = { ...insert, payload: { ...insert.payload, ...extra } };
      expect(InsertRequestSchema.safeParse(message).success).toBe(false);
    }
  });

  it('capture.request is empty and capture.result has no place for the profile', () => {
    expect(
      CaptureRequestSchema.safeParse({ v: 1, requestId: 'r', type: 'capture.request', payload: {} })
        .success,
    ).toBe(true);
    expect(
      CaptureRequestSchema.safeParse({
        v: 1,
        requestId: 'r',
        type: 'capture.request',
        payload: { stories: [makeStory(1)] },
      }).success,
    ).toBe(false);
    expect(
      CaptureResultSchema.safeParse({
        v: 1,
        requestId: 'r',
        type: 'capture.result',
        payload: {
          question: 'Why do you want to work here?',
          fieldStatus: 'not-found',
          field: null,
          candidates: 0,
          profile: emptyProfile(),
        },
      }).success,
    ).toBe(false);
  });

  it('the shared internal union has no profile message type', () => {
    for (const type of [
      'settings.profile.get',
      'settings.profile.item.upsert',
      'settings.profile.item.delete',
      'settings.profile.resume.set',
      'settings.profile.export',
      'settings.profile.deleteAll',
      'settings.profile.import.document',
      'profile.import.document',
      'profile.get',
      'profile.export',
      'profile.resume.set',
      'profile.deleteAll',
      'panel.profileStatus.get',
    ]) {
      expect(
        InternalMessageSchema.safeParse({ v: 1, requestId: 'r', type, payload: {} }).success,
      ).toBe(false);
    }
  });
});

describe('content-script listeners ignore profile messages', () => {
  const messages = [
    { v: 1, requestId: 'r1', type: 'settings.profile.get', payload: {} },
    {
      v: 1,
      requestId: 'r2',
      type: 'settings.profile.item.upsert',
      payload: { kind: 'story', item: { title: 't', text: 'x' } },
    },
    {
      v: 1,
      requestId: 'r3',
      type: 'settings.profile.item.delete',
      payload: { kind: 'story', id: 's_1' },
    },
    {
      v: 1,
      requestId: 'r6',
      type: 'settings.profile.resume.set',
      payload: { text: 'x', source: 'pasted' },
    },
    { v: 1, requestId: 'r4', type: 'settings.profile.export', payload: {} },
    { v: 1, requestId: 'r5', type: 'settings.profile.deleteAll', payload: { confirm: 'DELETE' } },
    {
      v: 1,
      requestId: 'r7',
      type: 'settings.profile.import.document',
      payload: { bytesBase64: 'UEsDBA==' },
    },
  ];

  it('stay silent, even for a sender with the extension id', () => {
    const capture = createCaptureListener({
      runtimeId: 'me',
      getSelectionText: () => 'Why do you want to work at Acme?',
      findField: () => ({ status: 'not-found', candidates: 0 }) as never,
    });
    const revalidate = createRevalidateListener({ runtimeId: 'me', document });
    const insert = createInsertListener({ runtimeId: 'me', document });
    for (const message of messages) {
      expect(capture(message, { id: 'me' })).toBeUndefined();
      expect(revalidate(message, { id: 'me' })).toBeUndefined();
      const reply = vi.fn();
      expect(insert(message, { id: 'me' }, reply)).toBe(false);
      expect(reply).not.toHaveBeenCalled();
    }
  });
});
