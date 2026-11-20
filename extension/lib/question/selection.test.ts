import { normalizeSelection, validateSelection } from './selection';

describe('normalizeSelection', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSelection('  Why  do\n you\t want   this? ')).toBe('Why do you want this?');
    expect(normalizeSelection(undefined)).toBe('');
  });
});

describe('validateSelection', () => {
  it.each([
    [undefined, 'QUESTION_MISSING'],
    ['', 'QUESTION_MISSING'],
    ['   \n\t ', 'QUESTION_MISSING'],
    ['a'.repeat(9), 'QUESTION_MISSING'],
    ['  ' + 'a'.repeat(9) + '  ', 'QUESTION_MISSING'],
    ['a'.repeat(1001), 'INVALID_REQUEST'],
    ['a b '.repeat(300), 'INVALID_REQUEST'],
  ])('rejects %j with %s', (raw, code) => {
    expect(validateSelection(raw)).toEqual({ ok: false, code });
  });

  it.each([['a'.repeat(10)], ['a'.repeat(1000)], ['  Why do you want to work here?  ']])(
    'accepts boundary/normal input %#',
    (raw) => {
      const result = validateSelection(raw);
      expect(result.ok).toBe(true);
    },
  );

  it('returns the normalized question', () => {
    expect(validateSelection('  Why   Acme?\n Tell us.  ')).toEqual({
      ok: true,
      question: 'Why Acme? Tell us.',
    });
  });

  it('counts after normalization, so padding does not push a question over the limit', () => {
    expect(validateSelection('a'.repeat(1000) + ' '.repeat(50)).ok).toBe(true);
  });
});
