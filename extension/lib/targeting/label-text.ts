import { MAX_ATTRIBUTE_CHARS, MAX_FIELD_LABEL_CHARS } from '../../schemas/field-target';

const SKIPPED_TAGS = new Set(['textarea', 'input', 'select', 'script', 'style', 'template']);
const MAX_LABELLEDBY_IDS = 10;
// Stop collecting text once this much has been seen; the result is cut to 200 anyway.
const TEXT_SCAN_LIMIT = 2000;

/** Collapses whitespace, trims, and cuts to `max` characters without splitting a surrogate pair. */
export function cleanText(raw: string, max: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  let cut = collapsed.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trim();
}

/**
 * Visible text of a node as a plain string. Never reads form-control content
 * (a wrapping label contains the textarea, whose text is its value) and skips
 * script and style.
 */
function plainText(root: Node): string {
  let out = '';
  const visit = (node: Node): void => {
    if (out.length >= TEXT_SCAN_LIMIT) return;
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node instanceof Element && SKIPPED_TAGS.has(node.localName)) return;
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return out;
}

/** Cleans an attribute value for the fingerprint; undefined when absent or blank. */
export function attributeText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const text = cleanText(value, MAX_ATTRIBUTE_CHARS);
  return text === '' ? undefined : text;
}

/**
 * The field's label, in order: `<label for>`, a wrapping `<label>`,
 * `aria-labelledby`, `aria-label`, `placeholder`. The first non-empty one wins.
 * Plain text, whitespace-collapsed, at most 200 characters.
 */
export function getLabelText(field: HTMLTextAreaElement): string {
  // `labels` is the browser's own resolution of label[for] and wrapping labels.
  const labels = Array.from(field.labels ?? []);
  const forLabels = field.id === '' ? [] : labels.filter((l) => l.htmlFor === field.id);
  const wrapping = labels.filter((l) => !forLabels.includes(l));
  for (const label of [...forLabels, ...wrapping]) {
    const text = cleanText(plainText(label), MAX_FIELD_LABEL_CHARS);
    if (text !== '') return text;
  }

  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const ids = labelledBy.split(/\s+/).filter((id) => id !== '');
    const parts: string[] = [];
    for (const id of ids.slice(0, MAX_LABELLEDBY_IDS)) {
      const target = field.ownerDocument.getElementById(id); // id lookup, not a scan
      if (target !== null) parts.push(plainText(target));
    }
    const text = cleanText(parts.join(' '), MAX_FIELD_LABEL_CHARS);
    if (text !== '') return text;
  }

  return (
    cleanText(field.getAttribute('aria-label') ?? '', MAX_FIELD_LABEL_CHARS) ||
    cleanText(field.getAttribute('placeholder') ?? '', MAX_FIELD_LABEL_CHARS)
  );
}
