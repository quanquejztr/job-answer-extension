import { MAX_PROFILE_TOTAL_CHARS } from '../constants/limits';
import { emptyProfile, makeResume, makeRule, makeSample, makeStory } from './fake-profile-client';
import {
  checkProfileTotal,
  checkText,
  countChars,
  hasErrors,
  profileContentChars,
  validateResume,
  validateRule,
  validateSample,
  validateStory,
} from './validation';

describe('countChars', () => {
  it('counts trimmed code points, as the helper does', () => {
    expect(countChars('  abc  ')).toBe(3);
    expect(countChars('😀😀')).toBe(2);
    expect(countChars('é')).toBe(1);
    expect(countChars('   ')).toBe(0);
  });
});

describe('checkText', () => {
  it('requires text within the limit and without control characters', () => {
    expect(checkText('ok', 5, 'a thing')).toBeUndefined();
    expect(checkText('line\nbreak\tand tab', 50, 'a thing')).toBeUndefined();
    expect(checkText('  ', 5, 'a thing')).toBe('Enter a thing.');
    expect(checkText('abcdef', 5, 'a thing')).toBe(
      'Shorten a thing to 5 characters or fewer. It is 6 now.',
    );
    expect(checkText('a\u0001b', 5, 'a thing')).toBe('Remove the control characters from a thing.');
    expect(checkText('😀'.repeat(5), 5, 'a thing')).toBeUndefined();
  });
});

describe('form validators mirror the PRD limits', () => {
  it('validateResume: 1 to 15,000 code points', () => {
    expect(validateResume({ text: 'x'.repeat(15000) })).toEqual({});
    expect(validateResume({ text: '😀'.repeat(15000) })).toEqual({});
    expect(validateResume({ text: 'x'.repeat(15001) })).toHaveProperty('text');
    expect(validateResume({ text: '   ' })).toHaveProperty('text');
    expect(validateResume({ text: 'a\u0001b' })).toHaveProperty('text');
  });

  it('validateStory: title 100, text 3000', () => {
    expect(validateStory({ title: 't'.repeat(100), text: 'x'.repeat(3000) })).toEqual({});
    expect(validateStory({ title: 't'.repeat(101), text: 'x'.repeat(3001) })).toHaveProperty(
      'title',
    );
    expect(validateStory({ title: 't', text: 'x'.repeat(3001) })).toHaveProperty('text');
    expect(validateStory({ title: 't'.repeat(101), text: 'x' })).toHaveProperty('title');
  });

  it('validateSample: label 60, text 3000', () => {
    expect(validateSample({ label: 'l'.repeat(60), text: 'x'.repeat(3000) })).toEqual({});
    expect(validateSample({ label: 'l'.repeat(61), text: '' })).toHaveProperty('label');
    expect(validateSample({ label: 'l', text: 'x'.repeat(3001) })).toHaveProperty('text');
  });

  it('validateRule: text 200', () => {
    expect(validateRule({ text: 'x'.repeat(200) })).toEqual({});
    expect(validateRule({ text: 'x'.repeat(201) })).toHaveProperty('text');
    expect(hasErrors(validateRule({ text: '' }))).toBe(true);
  });
});

describe('profile content total (40,000 code points)', () => {
  // 15,000 résumé + 5 x (1 + 3,000) stories + 3 x 3,000 samples = 39,005.
  const base = {
    ...emptyProfile(),
    resume: makeResume('r'.repeat(15000)),
    stories: [1, 2, 3, 4, 5].map((n) => makeStory(n, { title: 't', text: 's'.repeat(3000) })),
    samples: [6, 7, 8].map((n) => makeSample(n, { text: 'w'.repeat(3000) })),
  };

  it('counts résumé, story titles and texts, sample texts, and rule texts only', () => {
    expect(profileContentChars(base)).toBe(39005);
    expect(profileContentChars(emptyProfile())).toBe(0);
    // Sample labels are not counted; rules are.
    const withLabel = { ...base, samples: [makeSample(6, { label: 'L'.repeat(60), text: 'w' })] };
    expect(profileContentChars(withLabel)).toBe(15000 + 5 * 3001 + 1);
    expect(profileContentChars({ ...emptyProfile(), rules: [makeRule(1, { text: 'abc' })] })).toBe(
      3,
    );
    expect(profileContentChars({ ...emptyProfile(), resume: makeResume('😀😀') })).toBe(2);
  });

  it('is under, at, and over the cap', () => {
    const at = (room: number) => profileContentChars(base) + room;
    expect(MAX_PROFILE_TOTAL_CHARS).toBe(40000);
    expect(checkProfileTotal(at(994))).toBeUndefined(); // 39,999
    expect(checkProfileTotal(at(995))).toBeUndefined(); // 40,000
    expect(checkProfileTotal(at(996))).toMatch(/40000/); // 40,001
    expect(checkProfileTotal(0)).toBeUndefined();
  });
});
