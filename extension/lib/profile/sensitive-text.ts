// PRIV-008 (AC-057): detect text that looks like an email address, a phone
// number, or a street address so the settings page can warn before saving it.
// Detection is a heuristic for a warning only; it never blocks saving. Results
// are category names, never the matched text, so nothing detected can reach a
// log, an error, or a dialog by way of this module.

export const SENSITIVE_CATEGORIES = ['email', 'phone', 'address'] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

const EMAIL =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}-])/u;

// A run of digit groups ("555", "(555)", "123-4567", "+44 20 7946 0958").
// Not preceded by a letter, digit, currency sign, or separator (so the tail of
// "v1.2.3.4567" or "$1234567" is never a candidate) and not followed by a
// letter or digit.
const PHONE_CANDIDATE =
  /(?<![\p{L}\p{N}_$€£.+/-])\+?\(?\d+\)?(?:[ .-]\(?\d+\)?)*(?![\p{L}\p{N}_])/gu;

const ISO_DATE = /^\d{4}[ .-](?:0?[1-9]|1[0-2])[ .-](?:0?[1-9]|[12]\d|3[01])$/;
const DMY_DATE = /^(?:0?[1-9]|[12]\d|3[01])[ .-](?:0?[1-9]|1[0-2])[ .-]\d{2,4}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const YEAR = /^(?:19|20)\d{2}$/;

function looksLikePhone(candidate: string): boolean {
  const text = candidate.replace(/[()]/g, '').replace(/^\+/, '');
  const groups = text.split(/[ .-]/);
  const digits = groups.reduce((n, g) => n + g.length, 0);
  if (digits < 7 || digits > 15) return false;
  if (groups.length === 1) return true;
  if (ISO_DATE.test(text) || DMY_DATE.test(text) || IPV4.test(text)) return false;
  // "2019 2020" or "2019-2021": a list or range of years is not a number.
  if (groups.every((g) => YEAR.test(g))) return false;
  // Only a leading country code may be a single digit ("1 555 123 4567"); a
  // string of one-digit groups is not a phone number.
  if (groups.slice(1).some((g) => g.length === 1)) return false;
  // Dotted strings ("10.0.19045.1234") are version numbers unless every group
  // is short; with spaces or dashes only the last group may be long.
  const dotOnly = !/[ -]/.test(text);
  const limit = dotOnly ? groups.length : groups.length - 1;
  return (
    groups.slice(0, limit).every((g) => g.length <= 4) &&
    (!dotOnly || groups.every((g) => g.length <= 4))
  );
}

function hasPhone(text: string): boolean {
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    if (looksLikePhone(m[0])) return true;
  }
  return false;
}

const SUFFIX = '(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way)';
// A house number, one to three capitalised (or ordinal) words, then a street
// suffix written with a capital: "42 Maple Street", "7 W 5th Ave". Requiring
// capitals keeps "20 percent along the way" from matching.
const ADDRESS = new RegExp(
  `(?<![\\p{L}\\p{N}.,$€£/-])\\d{1,6}[A-Za-z]?[ \\t]+(?:(?:\\p{Lu}[\\p{L}'’.-]*|\\d+(?:st|nd|rd|th))[ \\t]+){1,3}${SUFFIX}(?![\\p{L}\\p{N}])`,
  'u',
);

/**
 * Categories of sensitive-looking text found in `texts`, in a fixed order and
 * without duplicates. The matched text is never returned.
 */
export function detectSensitiveText(texts: readonly string[]): SensitiveCategory[] {
  const found = new Set<SensitiveCategory>();
  for (const text of texts) {
    if (EMAIL.test(text)) found.add('email');
    if (hasPhone(text)) found.add('phone');
    if (ADDRESS.test(text)) found.add('address');
  }
  return SENSITIVE_CATEGORIES.filter((c) => found.has(c));
}

const CATEGORY_LABEL: Record<SensitiveCategory, string> = {
  email: 'an email address',
  phone: 'a phone number',
  address: 'a street address',
};

/** "an email address and a phone number", for the warning dialog. */
export function describeSensitiveCategories(categories: readonly SensitiveCategory[]): string {
  const labels = categories.map((c) => CATEGORY_LABEL[c]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}
