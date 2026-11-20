import { vi } from 'vitest';
import { buildFingerprint } from '../targeting/fingerprint';
import { byId, setBody, setSize, stubLayout } from '../targeting/dom-helpers';
import { insertAnswer, type InsertEnv } from './insert-field';

const FORM = `
  <form id="application">
    <label for="why">Why Acme?</label>
    <textarea id="why" name="why"></textarea>
    <textarea id="other" name="other" aria-label="Other"></textarea>
    <button id="submit" type="submit">Submit</button>
    <a id="link" href="/x">Link</a>
    <input id="check" type="checkbox" />
  </form>`;

/** A fake frame clock: callbacks run when the test says so. */
function fakeEnv() {
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const env: InsertEnv = {
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
    setTimer: (cb) => timers.push(cb),
    clearTimer: () => undefined,
  };
  return {
    env,
    frame: () => frames.splice(0).forEach((cb) => cb()),
    timeout: () => timers.splice(0).forEach((cb) => cb()),
  };
}

function setup(html = FORM) {
  stubLayout();
  setBody(html);
  const field = byId<HTMLTextAreaElement>('why');
  const fingerprint = buildFingerprint(field);
  if (fingerprint === undefined) throw new Error('no fingerprint');
  return {
    field,
    fingerprint,
    locator: { frameId: 0, domPath: fingerprint.domPath },
  };
}

/** Runs the insert to completion by letting one frame pass. */
async function insert(
  s: ReturnType<typeof setup>,
  answer: string,
  fe = fakeEnv(),
  fingerprint = s.fingerprint,
) {
  const pending = insertAnswer(document, s.locator, fingerprint, answer, fe.env);
  fe.frame();
  return pending;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('insertAnswer success', () => {
  it('writes the answer, dispatches exactly input then change (bubbling), and verifies', async () => {
    const s = setup();
    const seen: string[] = [];
    for (const type of ['input', 'change', 'focus', 'click', 'keydown', 'keyup', 'blur'])
      document.addEventListener(type, (e) => seen.push(`${e.type}:${e.bubbles}`), true);
    await expect(insert(s, 'My answer.')).resolves.toEqual({ ok: true });
    expect(s.field.value).toBe('My answer.');
    expect(seen).toEqual(['input:true', 'change:true']);
  });

  it('does not touch any other element', async () => {
    const s = setup();
    const before = byId('application').outerHTML.replace('<textarea id="why" name="why">', '');
    const others = [byId('other'), byId('submit'), byId('link'), byId('check')];
    const targets: EventTarget[] = [];
    const original = EventTarget.prototype.dispatchEvent;
    vi.spyOn(EventTarget.prototype, 'dispatchEvent').mockImplementation(function (
      this: EventTarget,
      event,
    ) {
      targets.push(this);
      return original.call(this, event);
    });
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => undefined);
    await insert(s, 'My answer.');
    expect(targets).toEqual([s.field, s.field]);
    expect(click).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(others.map((o) => (o instanceof HTMLTextAreaElement ? o.value : ''))).toEqual([
      '',
      '',
      '',
      '',
    ]);
    expect(byId('application').outerHTML.replace('<textarea id="why" name="why">', '')).toBe(
      before,
    );
  });

  it('treats a whitespace-only field as empty', async () => {
    const s = setup();
    s.field.value = ' \n\t ';
    await expect(insert(s, 'Hello there.')).resolves.toEqual({ ok: true });
    expect(s.field.value).toBe('Hello there.');
  });

  it('uses the native setter even when the instance value property is shadowed', async () => {
    const s = setup();
    const shadowSet = vi.fn();
    Object.defineProperty(s.field, 'value', {
      configurable: true,
      get: () => 'shadowed-not-real',
      set: shadowSet,
    });
    await expect(insert(s, 'Real answer.')).resolves.toEqual({ ok: true });
    expect(shadowSet).not.toHaveBeenCalled();
    const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    expect(native?.get?.call(s.field)).toBe('Real answer.');
  });

  it('compares CRLF and LF as equal', async () => {
    const s = setup();
    await expect(insert(s, 'Line one.\r\nLine two.')).resolves.toEqual({ ok: true });
    expect(s.field.value).toBe('Line one.\nLine two.');
  });

  it('keeps leading and trailing text exactly as given', async () => {
    const s = setup();
    await expect(insert(s, 'Line.\n\nEnd.')).resolves.toEqual({ ok: true });
    expect(s.field.value).toBe('Line.\n\nEnd.');
  });

  it('waits for a frame or the timeout, then a microtask, never a fixed sleep', async () => {
    const s = setup();
    const fe = fakeEnv();
    let done = false;
    void insertAnswer(document, s.locator, s.fingerprint, 'Hi there.', fe.env).then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    fe.timeout(); // no frame ran (a background tab), the 1,000 ms bound ends the wait
    await vi.waitFor(() => expect(done).toBe(true));
  });

  it('writes once even though the frame and the timeout both fire', async () => {
    const s = setup();
    const fe = fakeEnv();
    const setter = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set');
    const pending = insertAnswer(document, s.locator, s.fingerprint, 'Hi there.', fe.env);
    fe.frame();
    fe.timeout();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(setter).toHaveBeenCalledTimes(1);
  });
});

describe('insertAnswer refusals', () => {
  it('refuses a nonempty field and writes nothing', async () => {
    const s = setup();
    s.field.value = 'The user already typed this.';
    const events = vi.fn();
    s.field.addEventListener('input', events);
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_NONEMPTY' });
    expect(s.field.value).toBe('The user already typed this.');
    expect(events).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', (el: HTMLTextAreaElement) => (el.hidden = true)],
    ['display:none', (el: HTMLTextAreaElement) => (el.style.display = 'none')],
    ['disabled', (el: HTMLTextAreaElement) => (el.disabled = true)],
    ['readonly', (el: HTMLTextAreaElement) => (el.readOnly = true)],
  ])('refuses a %s field with FIELD_STALE', async (_name, change) => {
    const s = setup();
    change(s.field);
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
    expect(s.field.value).toBe('');
  });

  it('refuses a zero-size field', async () => {
    const s = setup();
    setSize(s.field, 0, 0);
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
  });

  it('refuses when the field was removed', async () => {
    const s = setup();
    s.field.remove();
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
  });

  it('refuses when the field was replaced by a different element', async () => {
    const s = setup();
    const fresh = document.createElement('textarea');
    fresh.id = 'why';
    fresh.name = 'rewritten';
    s.field.replaceWith(fresh);
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
    expect(fresh.value).toBe('');
    expect(byId<HTMLTextAreaElement>('other').value).toBe('');
  });

  it('refuses when the path now reaches a non-textarea', async () => {
    const s = setup();
    s.field.replaceWith(document.createElement('div'));
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
  });

  it('refuses when the fingerprint changed (a changed label)', async () => {
    const s = setup();
    s.field.setAttribute('name', 'changed');
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_STALE' });
    expect(s.field.value).toBe('');
  });

  it('refuses an answer longer than the field maxlength', async () => {
    const s = setup(FORM.replace('name="why"', 'name="why" maxlength="5"'));
    await expect(insert(s, 'Far too long.')).resolves.toEqual({
      ok: false,
      error: 'FIELD_UNSUPPORTED',
    });
    expect(s.field.value).toBe('');
  });

  it('reports FIELD_UNSUPPORTED when the native value accessors are unusable', async () => {
    const s = setup();
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue(undefined);
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_UNSUPPORTED' });
  });
});

describe('insertAnswer verification', () => {
  it('reports a mismatch when a page listener resets the value, and does not write again', async () => {
    const s = setup();
    const setter = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set');
    s.field.addEventListener('input', () => {
      s.field.value = '';
    });
    setter.mockClear();
    await expect(insert(s, 'Mine.')).resolves.toEqual({ ok: false, error: 'FIELD_UNSUPPORTED' });
    // One write from us, one from the page's own listener; nothing after the mismatch.
    expect(setter).toHaveBeenCalledTimes(2);
    expect(s.field.value).toBe('');
  });

  it('reports a mismatch when the page rewrites the value in the next frame', async () => {
    const s = setup();
    const fe = fakeEnv();
    const pending = insertAnswer(document, s.locator, s.fingerprint, 'Mine.', fe.env);
    s.field.value = 'Rewritten by the page.';
    fe.frame();
    await expect(pending).resolves.toEqual({ ok: false, error: 'FIELD_UNSUPPORTED' });
  });
});
