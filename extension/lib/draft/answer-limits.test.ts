import { checkAnswer, countWords } from './answer-limits';

describe('countWords', () => {
  it.each([
    ['', 0],
    ['   \n ', 0],
    ['one', 1],
    ['  one   two\nthree\tfour  ', 4],
    ['em space and nbsp word', 5],
  ])('counts %j as %d', (text, n) => expect(countWords(text)).toBe(n));
});

describe('checkAnswer', () => {
  it('accepts a trimmed answer within both limits, including exactly at them', () => {
    expect(checkAnswer('  a b c  ', { maxWords: 3, maxChars: 5 })).toBe('ok');
    expect(checkAnswer('a b c', { maxWords: 3 })).toBe('ok');
  });

  it('rejects empty and whitespace-only text', () => {
    expect(checkAnswer('', { maxWords: 20 })).toBe('empty');
    expect(checkAnswer(' \n\t', { maxWords: 20 })).toBe('empty');
  });

  it('rejects one word over and one character over', () => {
    expect(checkAnswer('a b c d', { maxWords: 3 })).toBe('too-many-words');
    expect(checkAnswer('abcdef', { maxWords: 3, maxChars: 5 })).toBe('too-many-chars');
  });
});
