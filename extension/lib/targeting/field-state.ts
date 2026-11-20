/** Why a textarea cannot be the answer field right now; 'ok' when it can. */
export type FieldUsability = 'ok' | 'hidden' | 'disabled';

/**
 * Visibility and editability of a textarea. Reads only geometry, computed
 * style, and attributes; never the field's value.
 *
 * hidden: no layout size, or it or an ancestor is `hidden`, display:none, or
 * visibility:hidden/collapse.
 * disabled: disabled (including via a fieldset), readonly, or inside `[inert]`.
 * Hidden is checked first.
 */
export function inspectUsability(field: HTMLTextAreaElement): FieldUsability {
  const view = field.ownerDocument.defaultView;
  if (view === null) return 'hidden';

  for (let node: Element | null = field; node !== null; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return 'hidden';
    if (view.getComputedStyle(node).display === 'none') return 'hidden';
  }
  const visibility = view.getComputedStyle(field).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return 'hidden';
  const rect = field.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 'hidden';

  if (field.disabled || field.matches(':disabled') || field.readOnly) return 'disabled';
  if (field.closest('[inert]') !== null) return 'disabled';
  return 'ok';
}
