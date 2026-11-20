import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkRequestSize } from '../lib/native/request-size';
import { parseResponse } from '../lib/native/parse-response';
import { DraftResponseSchema } from './draft';
import { ERROR_CATALOG, ERROR_CODES, appErrorFor } from './error';
import { parseRequest } from './messages';

const dir = resolve(process.cwd(), 'tests/protocol-fixtures');

type Case = {
  file: string;
  direction: 'request' | 'response';
  valid: boolean;
  errorCode?: string;
  generated?: string;
  note: string;
};

const cases = JSON.parse(readFileSync(resolve(dir, 'cases.json'), 'utf8')) as Case[];

function generatedBody(kind: string): string {
  const sizes: Record<string, number> = {
    'oversize-request': 256 * 1024 + 1,
    'ac052-300kib': 300 * 1024,
  };
  const size = sizes[kind];
  if (size === undefined) throw new Error('unknown generated kind');
  const head =
    '{"protocolVersion":1,"requestId":"gen-1","type":"draft.generate","payload":{"question":"Why do you want this role?","constraints":{"maxWords":150},"requestedAt":"2026-11-19T15:04:05Z","jobContext":"';
  const tail = '"}}';
  return head + 'a'.repeat(size - head.length - tail.length) + tail;
}

describe('shared protocol fixtures', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(30);
  });

  it.each(cases)('$file: $note', (c) => {
    const text = c.generated
      ? generatedBody(c.generated)
      : readFileSync(resolve(dir, c.file), 'utf8');
    let outcome: { accepted: boolean; code?: string };
    if (c.direction === 'request') {
      const sizeCode = checkRequestSize(text);
      if (sizeCode) {
        outcome = { accepted: false, code: sizeCode };
      } else {
        const r = parseRequest(JSON.parse(text));
        outcome = r.ok ? { accepted: true } : { accepted: false, code: r.code };
      }
    } else {
      const r = parseResponse(JSON.parse(text));
      outcome =
        r.kind === 'invalid' ? { accepted: false, code: 'INVALID_REQUEST' } : { accepted: true };
    }
    expect(outcome.accepted).toBe(c.valid);
    if (!c.valid) expect(outcome.code).toBe(c.errorCode);
  });

  it('matches the error catalog fixture', () => {
    const fixture = JSON.parse(readFileSync(resolve(dir, 'errors.json'), 'utf8')) as unknown[];
    expect(fixture).toHaveLength(20);
    expect(ERROR_CODES.map((code) => appErrorFor(code))).toEqual(fixture);
    expect(Object.keys(ERROR_CATALOG)).toHaveLength(20);
  });

  it('parses the success fixture result as a DraftResponse', () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(dir, 'valid/response-success.json'), 'utf8'),
    );
    const r = parseResponse(raw);
    expect(r.kind).toBe('success');
    if (r.kind === 'success') expect(DraftResponseSchema.safeParse(r.result).success).toBe(true);
  });
});
