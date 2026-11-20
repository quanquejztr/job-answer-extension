import { MAX_QUESTION_CHARS, MIN_QUESTION_CHARS } from '../constants/limits';
import type { ErrorCode } from '../../schemas/error';

/** Collapses every whitespace run to one space and trims (PRD 15.1). */
export function normalizeSelection(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

export type QuestionCheck = { ok: true; question: string } | { ok: false; code: ErrorCode };

/**
 * Under 10 characters is QUESTION_MISSING; over 1,000 is INVALID_REQUEST
 * (PRD 15.1 and the 17.3 layering note).
 */
export function validateSelection(raw: string | undefined): QuestionCheck {
  const question = normalizeSelection(raw);
  if (question.length < MIN_QUESTION_CHARS) return { ok: false, code: 'QUESTION_MISSING' };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, question };
}
