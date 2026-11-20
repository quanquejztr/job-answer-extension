// Test helpers for jsdom, which has no layout: every element reports a 200x100
// box unless a test overrides it, so "visible" tests exercise the real checks.
import { vi } from 'vitest';

export function stubLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 200, 100),
  );
}

export function setBody(html: string): void {
  document.body.innerHTML = html;
}

export function select(node: Node): Selection {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  if (selection === null) throw new Error('no selection support');
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

export function byId<T extends Element = Element>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  // Test helper: the caller names the element type it put in the markup.
  return el as unknown as T;
}

/** Overrides one element's box (for zero-size and size-bucket tests). */
export function setSize(el: Element, width: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, height));
}
