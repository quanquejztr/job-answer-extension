/** Whitespace-separated words, the same rule for the panel hint and the worker check. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

export interface AnswerLimits {
  maxWords: number;
  /** The field's maxlength, when it has one. Counted in UTF-16 units, like the browser. */
  maxChars?: number | undefined;
}

export type AnswerCheck = 'ok' | 'empty' | 'too-many-words' | 'too-many-chars';

/** Whether the (trimmed) draft may be inserted. Used by the panel and again by the worker. */
export function checkAnswer(text: string, limits: AnswerLimits): AnswerCheck {
  const answer = text.trim();
  if (answer === '') return 'empty';
  if (countWords(answer) > limits.maxWords) return 'too-many-words';
  if (limits.maxChars !== undefined && answer.length > limits.maxChars) return 'too-many-chars';
  return 'ok';
}
