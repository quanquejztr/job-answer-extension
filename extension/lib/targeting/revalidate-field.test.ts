import { buildFingerprint } from './fingerprint';
import { createRevalidateListener, revalidateField } from './revalidate-field';
import { FieldRevalidateResultSchema } from '../../schemas/internal-message';
import type { FieldFingerprint, FieldLocator } from '../../schemas/field-target';
import { byId, setBody, setSize, stubLayout } from './dom-helpers';

beforeEach(() => {
  stubLayout();
  setBody(
    '<form><label for="a">Why Acme?</label><textarea id="a" name="why">my draft</textarea></form>',
  );
});
afterEach(() => vi.restoreAllMocks());

const area = () => byId<HTMLTextAreaElement>('a');

function captured(): { locator: FieldLocator; fingerprint: FieldFingerprint } {
  const fingerprint = buildFingerprint(area());
  if (fingerprint === undefined) throw new Error('no fingerprint');
  return { locator: { frameId: 0, domPath: fingerprint.domPath }, fingerprint };
}

const run = () => {
  const { locator, fingerprint } = captured();
  return (mutate: () => void) => {
    mutate();
    return revalidateField(document, locator, fingerprint);
  };
};

describe('revalidateField', () => {
  it('is ok when nothing changed', () => {
    expect(run()(() => undefined)).toEqual({ ok: true });
  });

  it('is ok when the size moved by one bucket', () => {
    expect(run()(() => setSize(area(), 220, 100))).toEqual({ ok: true });
  });

  it('missing: the element was removed (path no longer resolves)', () => {
    expect(run()(() => area().remove())).toEqual({ ok: false, reason: 'missing' });
  });

  it('missing: the container was emptied', () => {
    expect(run()(() => document.querySelector('form')?.replaceChildren())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('changed: the element was replaced by a different one at the same position', () => {
    expect(
      run()(() => {
        const fresh = document.createElement('textarea');
        fresh.id = 'a';
        fresh.name = 'renamed';
        area().replaceWith(fresh);
      }),
    ).toEqual({ ok: false, reason: 'changed' });
  });

  it('changed: the node at the path is no longer a textarea', () => {
    expect(
      run()(() => {
        const div = document.createElement('div');
        area().replaceWith(div);
      }),
    ).toEqual({ ok: false, reason: 'changed' });
  });

  it('changed: the label changed', () => {
    expect(
      run()(() => {
        const label = document.querySelector('label');
        if (label !== null) label.textContent = 'Something else?';
      }),
    ).toEqual({ ok: false, reason: 'changed' });
  });

  it('changed: a sibling was inserted before it (the path shifts)', () => {
    expect(
      run()(() => document.querySelector('form')?.prepend(document.createElement('div'))),
    ).toEqual({ ok: false, reason: 'changed' });
  });

  it('changed: the size grew by two buckets', () => {
    expect(run()(() => setSize(area(), 260, 100))).toEqual({ ok: false, reason: 'changed' });
  });

  it.each([
    ['display:none', () => (area().style.display = 'none')],
    ['hidden attribute', () => area().setAttribute('hidden', '')],
    ['visibility:hidden', () => (area().style.visibility = 'hidden')],
    ['a hidden ancestor', () => document.querySelector('form')?.setAttribute('hidden', '')],
    ['zero size', () => setSize(area(), 0, 0)],
  ])('hidden: %s', (_name, mutate) => {
    expect(run()(mutate)).toEqual({ ok: false, reason: 'hidden' });
  });

  it.each([
    ['disabled', () => (area().disabled = true)],
    ['readonly', () => (area().readOnly = true)],
    ['inert ancestor', () => document.querySelector('form')?.setAttribute('inert', '')],
  ])('disabled: %s', (_name, mutate) => {
    expect(run()(mutate)).toEqual({ ok: false, reason: 'disabled' });
  });

  it('never reads or changes the field value', () => {
    const { locator, fingerprint } = captured();
    area().value = 'untouched text';
    revalidateField(document, locator, fingerprint);
    expect(area().value).toBe('untouched text');
  });

  it('survives hostile locators', () => {
    const { fingerprint } = captured();
    expect(revalidateField(document, { frameId: 0, domPath: [99, 99] }, fingerprint)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('createRevalidateListener', () => {
  const listener = createRevalidateListener({ runtimeId: 'me', document });
  const message = () => ({
    v: 1,
    requestId: 'r1',
    type: 'field.revalidate.request',
    payload: captured(),
  });

  it('replies with a validated result to its own extension', () => {
    const request = message();
    const reply = FieldRevalidateResultSchema.parse(listener(request, { id: 'me' }));
    expect(reply).toEqual({
      v: 1,
      requestId: 'r1',
      type: 'field.revalidate.result',
      payload: { ok: true },
    });
    area().remove();
    expect(listener(request, { id: 'me' })).toMatchObject({
      payload: { ok: false, reason: 'missing' },
    });
  });

  it.each([
    ['another extension', { id: 'evil' }, 'field.revalidate.request'],
    ['no sender id', {}, 'field.revalidate.request'],
    ['a different type', { id: 'me' }, 'capture.request'],
  ])('stays silent for %s', (_n, sender, type) => {
    expect(listener({ ...message(), type }, sender)).toBeUndefined();
  });

  it('stays silent for malformed payloads', () => {
    expect(listener({ ...message(), payload: { locator: {} } }, { id: 'me' })).toBeUndefined();
    expect(listener('x', { id: 'me' })).toBeUndefined();
  });
});
