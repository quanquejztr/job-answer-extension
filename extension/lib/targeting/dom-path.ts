import { MAX_DOM_PATH_DEPTH } from '../../schemas/field-target';

/**
 * Child-index path from the frame's `<body>` to an element: at each step, the
 * element's index among its parent's element children. Returns undefined when
 * the element is not inside the body or sits deeper than the allowed depth.
 */
export function buildDomPath(body: HTMLElement, element: Element): number[] | undefined {
  const path: number[] = [];
  let node: Element = element;
  while (node !== body) {
    const parent = node.parentElement;
    if (parent === null) return undefined; // detached, or outside <body>
    path.push(Array.prototype.indexOf.call(parent.children, node));
    if (path.length > MAX_DOM_PATH_DEPTH) return undefined;
    node = parent;
  }
  return path.reverse();
}

/**
 * Follows a path from the body. Safe for any input: a too-long path, a
 * non-integer or negative index, or an index past the end resolves to null.
 */
export function resolveDomPath(body: HTMLElement | null, path: readonly number[]): Element | null {
  if (body === null || path.length > MAX_DOM_PATH_DEPTH) return null;
  let node: Element = body;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) return null;
    const next = node.children.item(index);
    if (next === null) return null;
    node = next;
  }
  return node;
}
