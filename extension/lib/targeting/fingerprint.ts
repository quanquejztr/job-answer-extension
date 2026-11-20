import {
  MAX_FIELD_LABEL_CHARS,
  SIZE_BUCKET_PX,
  type FieldFingerprint,
} from '../../schemas/field-target';
import { buildDomPath } from './dom-path';
import { attributeText, getLabelText } from './label-text';

const roundToBucket = (px: number): number => Math.round(px / SIZE_BUCKET_PX) * SIZE_BUCKET_PX;

/**
 * Fingerprint of a textarea per PRD 16.2. Returns undefined when the field has
 * no valid path from `<body>` (outside the body, or deeper than 40 levels).
 * Never reads the field's value.
 */
export function buildFingerprint(field: HTMLTextAreaElement): FieldFingerprint | undefined {
  const body = field.ownerDocument.body;
  if (body === null) return undefined;
  const domPath = buildDomPath(body, field);
  if (domPath === undefined) return undefined;

  const rect = field.getBoundingClientRect();
  const fingerprint: FieldFingerprint = {
    tag: 'textarea',
    contentEditable: false,
    labelText: getLabelText(field).slice(0, MAX_FIELD_LABEL_CHARS),
    sizeBucket: [roundToBucket(rect.width), roundToBucket(rect.height)],
    domPath,
  };
  const nameAttr = attributeText(field.getAttribute('name'));
  if (nameAttr !== undefined) fingerprint.nameAttr = nameAttr;
  const idAttr = attributeText(field.getAttribute('id'));
  if (idAttr !== undefined) fingerprint.idAttr = idAttr;
  const placeholder = attributeText(field.getAttribute('placeholder'));
  if (placeholder !== undefined) fingerprint.placeholder = placeholder;
  if (field.maxLength >= 0) fingerprint.maxLength = field.maxLength;
  return fingerprint;
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Whether two fingerprints describe the same field: identity attributes and
 * path are equal; each size-bucket axis may differ by at most one bucket
 * (20 px), so small layout shifts do not invalidate a target.
 */
export function compareFingerprints(a: FieldFingerprint, b: FieldFingerprint): boolean {
  return (
    a.tag === b.tag &&
    a.contentEditable === b.contentEditable &&
    a.nameAttr === b.nameAttr &&
    a.idAttr === b.idAttr &&
    a.placeholder === b.placeholder &&
    a.labelText === b.labelText &&
    a.maxLength === b.maxLength &&
    samePath(a.domPath, b.domPath) &&
    Math.abs(a.sizeBucket[0] - b.sizeBucket[0]) <= SIZE_BUCKET_PX &&
    Math.abs(a.sizeBucket[1] - b.sizeBucket[1]) <= SIZE_BUCKET_PX
  );
}
