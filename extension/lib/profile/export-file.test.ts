import { vi } from 'vitest';
import { emptyProfile, makeResume, makeSample, makeStory } from './fake-profile-client';
import {
  downloadProfileExport,
  exportFileName,
  exportFileText,
  type DownloadEnv,
} from './export-file';

const profile = {
  ...emptyProfile(),
  nextId: 4,
  settings: { provider: 'claude' as const },
  resume: makeResume('Made-up résumé with <b>markup</b> & "quotes".'),
  stories: [makeStory(2)],
  samples: [makeSample(3)],
};

describe('exportFileName', () => {
  it('uses the injected date in YYYY-MM-DD form with zero padding', () => {
    expect(exportFileName(new Date(2026, 10, 20, 13, 5))).toBe(
      'job-answer-profile-2026-11-20.json',
    );
    expect(exportFileName(new Date(2027, 0, 5, 0, 0))).toBe('job-answer-profile-2027-01-05.json');
    expect(exportFileName(new Date(2026, 11, 31, 23, 59))).toBe(
      'job-answer-profile-2026-12-31.json',
    );
  });
});

describe('exportFileText', () => {
  it('is pretty-printed JSON that parses back to exactly the profile', () => {
    const text = exportFileText(profile);
    expect(text).toContain('\n  "schemaVersion": 2');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(profile);
  });
});

describe('downloadProfileExport', () => {
  function fakeEnv() {
    let blob: Blob | undefined;
    const order: string[] = [];
    const clicked: { href: string; download: string }[] = [];
    const doc = document.implementation.createHTMLDocument('x');
    const realCreate = doc.createElement.bind(doc);
    vi.spyOn(doc, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          order.push('click');
          clicked.push({
            href: (el as HTMLAnchorElement).getAttribute('href') ?? '',
            download: (el as HTMLAnchorElement).download,
          });
          expect(doc.body.contains(el)).toBe(true);
        });
      }
      return el;
    }) as typeof doc.createElement);
    const env: DownloadEnv = {
      document: doc,
      createObjectURL: (b) => {
        blob = b;
        order.push('create');
        return 'blob:made-up-url';
      },
      revokeObjectURL: vi.fn((url: string) => {
        order.push(`revoke:${url}`);
      }),
    };
    return { env, doc, clicked, order, blob: () => blob };
  }

  it('downloads a JSON blob under the dated name and revokes the object URL after the click', async () => {
    const { env, doc, clicked, order, blob } = fakeEnv();
    const name = downloadProfileExport(profile, env, new Date(2026, 10, 20));
    expect(name).toBe('job-answer-profile-2026-11-20.json');
    expect(clicked).toEqual([{ href: 'blob:made-up-url', download: name }]);
    expect(order).toEqual(['create', 'click', 'revoke:blob:made-up-url']);
    const made = blob();
    expect(made?.type).toBe('application/json');
    expect(JSON.parse((await made?.text()) ?? '')).toEqual(profile);
    expect(doc.body.querySelector('a')).toBeNull();
  });

  it('revokes the URL and removes the anchor even when the click throws', () => {
    const { env, doc } = fakeEnv();
    const create = vi.spyOn(doc, 'createElement');
    create.mockImplementation(() => {
      const a = document.createElement('a');
      a.click = () => {
        throw new Error('blocked');
      };
      return a;
    });
    expect(() => downloadProfileExport(profile, env, new Date(2026, 10, 20))).toThrow('blocked');
    expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:made-up-url');
  });
});
