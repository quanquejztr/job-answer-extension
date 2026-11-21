import { emptyProfile, makeResume, makeRule, makeSample, makeStory } from './fake-profile-client';
import { applyDelete, applyResume, applyUpsert } from './profile-state';

describe('applyUpsert', () => {
  it('appends a new item and replaces an existing one by id, per kind', () => {
    let p = emptyProfile();
    p = applyUpsert(p, { kind: 'story', item: makeStory(1, { text: 'one' }) });
    p = applyUpsert(p, { kind: 'story', item: makeStory(2, { text: 'two' }) });
    p = applyUpsert(p, { kind: 'story', item: makeStory(1, { text: 'one, edited' }) });
    expect(p.stories.map((s) => s.text)).toEqual(['one, edited', 'two']);
    p = applyUpsert(p, { kind: 'sample', item: makeSample(4) });
    p = applyUpsert(p, { kind: 'rule', item: makeRule(5) });
    expect([p.stories.length, p.samples.length, p.rules.length]).toEqual([2, 1, 1]);
  });

  it('does not mutate its input', () => {
    const p = emptyProfile();
    applyUpsert(p, { kind: 'story', item: makeStory(1) });
    expect(p.stories).toEqual([]);
  });
});

describe('applyResume', () => {
  it('replaces the single résumé and does not mutate its input', () => {
    const p = { ...emptyProfile(), resume: makeResume('old') };
    const after = applyResume(p, makeResume('new', { source: 'docx' }));
    expect(after.resume).toEqual(makeResume('new', { source: 'docx' }));
    expect(p.resume?.text).toBe('old');
    expect(applyResume(emptyProfile(), makeResume()).resume).toEqual(makeResume());
  });
});

describe('applyDelete', () => {
  it('removes one item by kind and id', () => {
    const p = {
      ...emptyProfile(),
      samples: [makeSample(1), makeSample(2)],
      rules: [makeRule(3)],
      stories: [makeStory(4)],
    };
    expect(applyDelete(p, { kind: 'sample', id: 'w_1' }).samples.map((s) => s.id)).toEqual(['w_2']);
    expect(applyDelete(p, { kind: 'rule', id: 'r_3' }).rules).toEqual([]);
    expect(applyDelete(p, { kind: 'story', id: 's_4' }).stories).toEqual([]);
  });
});
