import { createCaptureListener } from './content-capture';
import { CaptureResultSchema } from '../../schemas/internal-message';
import type { FieldFingerprint } from '../../schemas/field-target';
import type { FieldSearch } from '../targeting/find-field';

const request = { v: 1, requestId: 'req-1', type: 'capture.request', payload: {} };

const NO_FIELD: FieldSearch = { status: 'not-found', candidates: 0, field: null };
const fingerprint: FieldFingerprint = {
  tag: 'textarea',
  contentEditable: false,
  labelText: 'Why Acme?',
  sizeBucket: [200, 100],
  domPath: [0, 1],
};
const FOUND: FieldSearch = {
  status: 'found',
  candidates: 1,
  field: { labelText: 'Why Acme?', fingerprint },
};

function listener(text: string, search: FieldSearch = NO_FIELD) {
  return createCaptureListener({
    runtimeId: 'me',
    getSelectionText: () => text,
    findField: () => search,
  });
}

describe('content-script capture listener', () => {
  it('replies with its own normalized selection and no field', () => {
    const reply = listener('  Why do   you want\nthis job?  ')(request, { id: 'me' });
    const parsed = CaptureResultSchema.parse(reply);
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.payload).toEqual({
      question: 'Why do you want this job?',
      fieldStatus: 'not-found',
      field: null,
      candidates: 0,
    });
    expect('labelHint' in parsed.payload).toBe(false);
  });

  it('reports a found field candidate (label and fingerprint only, no tab or origin)', () => {
    const reply = CaptureResultSchema.parse(
      listener('Why do you want this job?', FOUND)(request, { id: 'me' }),
    );
    expect(reply.payload.fieldStatus).toBe('found');
    expect(reply.payload.candidates).toBe(1);
    expect(reply.payload.field).toEqual(FOUND.field);
    expect(Object.keys(reply.payload.field ?? {}).sort()).toEqual(['fingerprint', 'labelText']);
  });

  it('reports an ambiguous search without naming a field', () => {
    const reply = CaptureResultSchema.parse(
      listener('Why do you want this job?', { status: 'ambiguous', candidates: 2, field: null })(
        request,
        { id: 'me' },
      ),
    );
    expect(reply.payload).toMatchObject({ fieldStatus: 'ambiguous', field: null, candidates: 2 });
  });

  it('does not search for a field when the selection is invalid', () => {
    let searched = false;
    const quiet = createCaptureListener({
      runtimeId: 'me',
      getSelectionText: () => 'short',
      findField: () => {
        searched = true;
        return NO_FIELD;
      },
    });
    expect(quiet(request, { id: 'me' })).toBeUndefined();
    expect(searched).toBe(false);
  });

  it('ignores a sender that is not this extension', () => {
    expect(listener('Why do you want this job?')(request, { id: 'other' })).toBeUndefined();
    expect(listener('Why do you want this job?')(request, {})).toBeUndefined();
  });

  it.each([
    ['unknown type', { ...request, type: 'insert.request' }],
    ['wrong version', { ...request, v: 2 }],
    ['bad requestId', { ...request, requestId: 'has space' }],
    ['extra payload', { ...request, payload: { answer: 'x' } }],
    ['extra key', { ...request, extra: 1 }],
    ['not an object', 'capture.request'],
  ])('ignores a message with %s', (_name, message) => {
    expect(listener('Why do you want this job?')(message, { id: 'me' })).toBeUndefined();
  });

  it.each([[''], ['short'], ['a'.repeat(1001)]])(
    'stays silent for an invalid selection %#',
    (text) => {
      expect(listener(text)(request, { id: 'me' })).toBeUndefined();
    },
  );

  it('reads a real selection from the document', () => {
    document.body.innerHTML = '<label id="q">Why do you want to work at Acme?</label>';
    const node = document.getElementById('q');
    const range = document.createRange();
    range.selectNodeContents(node as Node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const live = createCaptureListener({
      runtimeId: 'me',
      getSelectionText: () => window.getSelection()?.toString() ?? '',
      findField: () => NO_FIELD,
    });
    expect(CaptureResultSchema.parse(live(request, { id: 'me' })).payload.question).toBe(
      'Why do you want to work at Acme?',
    );
  });
});
