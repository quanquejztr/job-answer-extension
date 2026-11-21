import {
  MAX_LABEL_CHARS,
  MAX_PROFILE_TOTAL_CHARS,
  MAX_RESUME_CHARS,
  MAX_RULE_CHARS,
  MAX_SAMPLE_CHARS,
  MAX_STORY_CHARS,
  MAX_TITLE_CHARS,
} from '../constants/limits';
import type { Profile } from '../../schemas/profile';

// Inline validation for the settings forms. It mirrors the helper's store rules
// (trimmed, non-empty, length in code points, no control characters other than
// newline and tab) so the user
// sees a problem before anything is sent. The helper still enforces them.

/** Length in Unicode code points of the trimmed text, as the helper counts it. */
export function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/** Returns an error message for a required text field, or undefined when it is fine. */
export function checkText(value: string, max: number, noun: string): string | undefined {
  const n = countChars(value);
  if (n === 0) return `Enter ${noun}.`;
  if (n > max) return `Shorten ${noun} to ${max} characters or fewer. It is ${n} now.`;
  if (CONTROL.test(value)) return `Remove the control characters from ${noun}.`;
  return undefined;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateResume(v: { text: string }): FieldErrors<'text'> {
  const text = checkText(v.text, MAX_RESUME_CHARS, 'your résumé text');
  return text === undefined ? {} : { text };
}

export function validateStory(v: { title: string; text: string }): FieldErrors<'title' | 'text'> {
  const errors: FieldErrors<'title' | 'text'> = {};
  const title = checkText(v.title, MAX_TITLE_CHARS, 'a title');
  if (title !== undefined) errors.title = title;
  const text = checkText(v.text, MAX_STORY_CHARS, 'the story text');
  if (text !== undefined) errors.text = text;
  return errors;
}

export function validateSample(v: { label: string; text: string }): FieldErrors<'label' | 'text'> {
  const errors: FieldErrors<'label' | 'text'> = {};
  const label = checkText(v.label, MAX_LABEL_CHARS, 'a label');
  if (label !== undefined) errors.label = label;
  const text = checkText(v.text, MAX_SAMPLE_CHARS, 'the sample text');
  if (text !== undefined) errors.text = text;
  return errors;
}

export function validateRule(v: { text: string }): FieldErrors<'text'> {
  const text = checkText(v.text, MAX_RULE_CHARS, 'the rule text');
  return text === undefined ? {} : { text };
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Profile content in code points, as the helper counts it for the 40,000 cap:
 * résumé text, story titles and texts, sample texts, and rule texts. Sample
 * labels are not counted.
 */
export function profileContentChars(
  p: Pick<Profile, 'resume' | 'stories' | 'samples' | 'rules'>,
): number {
  const n = (t: string): number => Array.from(t).length;
  let total = p.resume === null ? 0 : n(p.resume.text);
  for (const s of p.stories) total += n(s.title) + n(s.text);
  for (const w of p.samples) total += n(w.text);
  for (const r of p.rules) total += n(r.text);
  return total;
}

/** An error message when a content total is over the 40,000 cap, else undefined. */
export function checkProfileTotal(total: number): string | undefined {
  return total > MAX_PROFILE_TOTAL_CHARS
    ? `Your profile would hold ${total} characters, over the ${MAX_PROFILE_TOTAL_CHARS} limit. Shorten something first.`
    : undefined;
}
