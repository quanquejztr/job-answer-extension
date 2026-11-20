import type { FieldCandidate, FieldStatus } from '../../schemas/field-target';
import { inspectUsability } from './field-state';
import { buildFingerprint } from './fingerprint';

/** PRD 15.1 "Field search region": at most 4 levels above the starting element. */
export const MAX_ANCESTOR_LEVELS = 4;
/** PRD 15.1: at most 5 candidate fields are collected. */
export const MAX_FIELD_CANDIDATES = 5;
/**
 * Upper bound on elements visited across the whole search (all levels). A
 * climb never revisits the subtree it already searched, so each element counts
 * once. When the budget runs out the search stops with what it has; this
 * bounds the work on very large pages (a pathological DOM cannot stall the
 * page) and is a safety cap, not a normal-path limit.
 */
export const MAX_NODES_INSPECTED = 500;

export interface FieldSearch {
  status: FieldStatus;
  /** 0 (not-found), 1 (found), or 2 to 5 (ambiguous, capped). */
  candidates: number;
  /** Set only when exactly one field was found. */
  field: FieldCandidate | null;
}

export interface TextareaSearch {
  status: FieldStatus;
  elements: HTMLTextAreaElement[];
}

function startElement(selection: Selection | null): Element | null {
  if (selection === null || selection.rangeCount === 0) return null;
  const container = selection.getRangeAt(0).commonAncestorContainer;
  return container instanceof Element ? container : container.parentElement;
}

/**
 * Bounded nearby-field discovery. Starts at the selection's nearest common
 * ancestor element and climbs at most 4 levels, never above `<body>`. At each
 * level only the textareas inside the CURRENT region are considered, walked
 * from the region element itself (never a document-wide query), and the
 * subtree of the previous level is skipped (it was already searched). The
 * first level with at least one usable candidate ends the climb: one candidate
 * is "found", more than one is "ambiguous" (no scoring, no guessing), and
 * reaching the top without any is "not-found". Usable means visible, enabled,
 * not readonly, not inside `[inert]`, and fingerprintable.
 */
export function findTextareas(selection: Selection | null, doc: Document): TextareaSearch {
  const body = doc.body;
  let region = startElement(selection);
  if (body === null || region === null || !body.contains(region)) {
    return { status: 'not-found', elements: [] };
  }

  let budget = MAX_NODES_INSPECTED;
  let searched: Element | null = null;
  for (let level = 0; level <= MAX_ANCESTOR_LEVELS; level++) {
    const found: HTMLTextAreaElement[] = [];
    const walker = doc.createTreeWalker(region, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (node === searched) return NodeFilter.FILTER_REJECT;
        // An inert subtree can hold no usable field; do not spend budget in it.
        if (node instanceof Element && node.hasAttribute('inert')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    // The region itself is never a textarea candidate unless the selection is
    // inside one (then its parent is the region), so start at its descendants.
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (budget-- <= 0) break;
      if (!(node instanceof HTMLTextAreaElement)) continue;
      if (inspectUsability(node) !== 'ok' || buildFingerprint(node) === undefined) continue;
      found.push(node);
      if (found.length >= MAX_FIELD_CANDIDATES) break;
    }
    if (found.length > 0) {
      return { status: found.length === 1 ? 'found' : 'ambiguous', elements: found };
    }
    if (budget <= 0 || region === body || region.parentElement === null) break;
    searched = region;
    region = region.parentElement;
  }
  return { status: 'not-found', elements: [] };
}

/** `findTextareas` plus the data the worker needs: the single candidate's label and fingerprint. */
export function locateField(selection: Selection | null, doc: Document): FieldSearch {
  const { status, elements } = findTextareas(selection, doc);
  const [only] = elements;
  if (status === 'found' && only !== undefined) {
    const fingerprint = buildFingerprint(only);
    if (fingerprint !== undefined) {
      return {
        status,
        candidates: 1,
        field: { labelText: fingerprint.labelText, fingerprint },
      };
    }
  }
  return {
    status: status === 'found' ? 'not-found' : status,
    candidates: status === 'found' ? 0 : elements.length,
    field: null,
  };
}
