import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { EXTENSION_PATH, FIXTURE_ORIGIN, expect, test } from './fixtures';

// Runs the BUILT content script in real Chromium against local fixtures, with
// only chrome.runtime stubbed (same approach as targeting.spec.ts). Playwright
// cannot click Chrome's native context menu, so the worker's capture flow and
// the panel's Insert click are covered by fake-API unit tests and the owner's
// manual run; what is proven here is everything the page can observe: that
// generation-side steps change nothing, that Insert changes exactly one
// textarea, and that no button, link, form, or navigation is ever touched.

const SENDER = 'stub-extension-id';
const ANSWER = 'I admire how Acme ships small, careful improvements every week.';

interface Reply {
  v: number;
  requestId: string;
  type: string;
  payload: Record<string, unknown>;
}

async function load(page: Page, fixture: string, selector = '#question, label'): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w['chrome'] = {
      runtime: {
        id: 'stub-extension-id',
        onMessage: { addListener: (fn: unknown) => (w['__listener'] = fn) },
      },
    };
  });
  await page.goto(`${FIXTURE_ORIGIN}/${fixture}`);
  await page.addScriptTag({
    content: await readFile(join(EXTENSION_PATH, 'content-scripts/content.js'), 'utf8'),
  });
  await page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel) as Node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, selector);
}

/** Sends one message and resolves with the first reply, however late (or undefined if the listener stayed silent). */
async function send(
  page: Page,
  type: string,
  payload: object,
  requestId = 'req-1',
): Promise<Reply | undefined> {
  return page.evaluate(
    ({ type: t, payload: p, requestId: id, senderId }) =>
      new Promise<Reply | undefined>((resolve) => {
        const listener = (window as unknown as Record<string, unknown>)['__listener'] as (
          m: unknown,
          s: unknown,
          r: (x: unknown) => void,
        ) => unknown;
        const keptOpen = listener(
          { v: 1, requestId: id, type: t, payload: p },
          { id: senderId },
          (x) => resolve(x as Reply),
        );
        if (keptOpen !== true) setTimeout(() => resolve(undefined), 50); // silent: nothing will come
      }),
    { type, payload, requestId, senderId: SENDER },
  );
}

interface Captured {
  locator: object;
  fingerprint: unknown;
}

async function capture(page: Page): Promise<{ payload: Reply['payload']; request?: Captured }> {
  const reply = await send(page, 'capture.request', {});
  if (reply === undefined) throw new Error('content script stayed silent');
  const field = reply.payload['field'] as { fingerprint: { domPath: number[] } } | null;
  if (field === null) return { payload: reply.payload };
  return {
    payload: reply.payload,
    request: {
      locator: { frameId: 0, domPath: field.fingerprint.domPath },
      fingerprint: field.fingerprint,
    },
  };
}

function insertPayload(request: Captured, over: object = {}): object {
  return {
    targetId: 'target-1',
    answer: ANSWER,
    confirmReplace: false,
    ...request,
    ...over,
  };
}

/** Records every event on every node, so "nothing else was touched" is observable. */
async function recordEverything(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as Record<string, unknown>)['__all'] = log;
    const describe = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return t === document ? '#document' : String(t);
      return t.id !== '' ? `#${t.id}` : t.tagName.toLowerCase();
    };
    for (const type of [
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'submit',
      'formdata',
      'reset',
      'focus',
      'focusin',
      'blur',
      'keydown',
      'keyup',
      'keypress',
      'input',
      'change',
      'select',
      'invalid',
      'beforeunload',
    ])
      window.addEventListener(type, (e) => log.push(`${type}@${describe(e.target)}`), true);
  });
}

const events = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Record<string, string[]>)['__all'] ?? []);

/** Everything about the form that a stray write, click, or focus could change. */
async function snapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => ({
    url: location.href,
    focus: document.activeElement?.tagName,
    html: document.body.innerHTML,
    values: Array.from(document.querySelectorAll('textarea,input')).map(
      (el) => `${el.id}=${(el as HTMLTextAreaElement).value}`,
    ),
  }));
}

test.describe('review and insert in real Chromium', () => {
  test('AC-040: capture, field discovery, and a simulated draft change nothing on the page', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    await recordEverything(page);
    const before = await snapshot(page);
    const { payload, request } = await capture(page);
    expect(payload['fieldStatus']).toBe('found');
    expect(request).toBeDefined();
    // A draft being generated and shown in the panel never reaches the page: the
    // worker sends the content script nothing between capture and Insert.
    expect(await snapshot(page)).toEqual(before);
    expect(await events(page)).toEqual([]);
    expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
    await expect(page.locator('#why')).toHaveValue('');
  });

  test('AC-041 and AC-045: insert changes exactly one of three textareas and touches no button, link, form, or navigation', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    // Three textareas, a link, and a checkbox; the other two start with text so
    // "byte-identical" is checkable. Added after capture, at the end of <body>,
    // so the captured path still points at #why.
    await page.evaluate(() => {
      const extras = document.createElement('div');
      extras.innerHTML =
        '<textarea id="b">Keep B exactly.</textarea><textarea id="c">Keep C\r\nexactly.</textarea>' +
        '<a id="link" href="/elsewhere">Elsewhere</a><input id="check" type="checkbox">' +
        '<select id="pick"><option>x</option></select>';
      document.body.append(extras);
    });
    await recordEverything(page);
    const beforeOthers = await page.evaluate(() => ({
      b: (document.getElementById('b') as HTMLTextAreaElement).value,
      c: (document.getElementById('c') as HTMLTextAreaElement).value,
      extras: document.getElementById('b')?.parentElement?.outerHTML,
      form: document.getElementById('submit')?.outerHTML,
      url: location.href,
    }));

    const reply = await send(page, 'insert.request', insertPayload(request));
    expect(reply).toMatchObject({
      v: 1,
      requestId: 'req-1',
      type: 'insert.result',
      payload: { ok: true },
    });

    await expect(page.locator('#why')).toHaveValue(ANSWER);
    const afterOthers = await page.evaluate(() => ({
      b: (document.getElementById('b') as HTMLTextAreaElement).value,
      c: (document.getElementById('c') as HTMLTextAreaElement).value,
      extras: document.getElementById('b')?.parentElement?.outerHTML,
      form: document.getElementById('submit')?.outerHTML,
      url: location.href,
    }));
    expect(afterOthers).toEqual(beforeOthers);
    // Only #why received events, and only input then change: no click, submit,
    // focus, key, or navigation event on any node (the button included).
    expect(await events(page)).toEqual(['input@#why', 'change@#why']);
    expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    expect(page.url()).toBe(`${FIXTURE_ORIGIN}/basic-question.html`);
  });

  test('the inserted value is what the page would submit, and verification saw it', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    const multiline = 'First paragraph.\n\nSecond paragraph.';
    const reply = await send(page, 'insert.request', insertPayload(request, { answer: multiline }));
    expect(reply?.payload).toEqual({ ok: true });
    // What the page would submit: the textarea's value, line breaks intact.
    expect(await page.evaluate(() => new FormData(document.forms[0]).get('why'))).toBe(multiline);
    await expect(page.locator('#why')).toHaveValue(multiline);
  });

  test('two textareas: discovery finds no single field, so there is nothing to insert into and neither changes', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'two-textareas.html');
    await recordEverything(page);
    const before = await snapshot(page);
    const { payload, request } = await capture(page);
    expect(payload).toMatchObject({ fieldStatus: 'ambiguous', field: null, candidates: 2 });
    expect(request).toBeUndefined(); // no locator exists, so the worker cannot even build an insert.request
    expect(await snapshot(page)).toEqual(before);
    expect(await events(page)).toEqual([]);
  });

  test('a nonempty textarea is never overwritten (FIELD_NONEMPTY) and nothing fires', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    await page.locator('#why').fill('Text I typed myself.');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await recordEverything(page);
    const before = await snapshot(page);
    const reply = await send(page, 'insert.request', insertPayload(request));
    expect(reply?.payload).toEqual({ ok: false, error: 'FIELD_NONEMPTY' });
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('#why')).toHaveValue('Text I typed myself.');
    expect(await events(page)).toEqual([]);
  });

  test('a whitespace-only textarea counts as empty', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    await page.locator('#why').fill('  \n ');
    const reply = await send(page, 'insert.request', insertPayload(request));
    expect(reply?.payload).toEqual({ ok: true });
    await expect(page.locator('#why')).toHaveValue(ANSWER);
  });

  for (const [name, change] of [
    [
      'removed',
      () => {
        document.getElementById('why')?.remove();
      },
    ],
    [
      'hidden',
      () => {
        (document.getElementById('why') as HTMLElement).style.display = 'none';
      },
    ],
    [
      'disabled',
      () => {
        (document.getElementById('why') as HTMLTextAreaElement).disabled = true;
      },
    ],
    [
      'read-only',
      () => {
        (document.getElementById('why') as HTMLTextAreaElement).readOnly = true;
      },
    ],
    [
      'replaced',
      () => {
        const fresh = document.createElement('textarea');
        fresh.id = 'why';
        fresh.name = 'rewritten';
        document.getElementById('why')?.replaceWith(fresh);
      },
    ],
  ] as const) {
    test(`a textarea that was ${name} after capture fails with FIELD_STALE and the page is unchanged`, async ({
      context,
    }) => {
      const page = await context.newPage();
      await load(page, 'basic-question.html');
      const { request } = await capture(page);
      if (request === undefined) throw new Error('no field');
      await page.evaluate(change);
      await recordEverything(page);
      const before = await snapshot(page);
      const reply = await send(page, 'insert.request', insertPayload(request));
      expect(reply?.payload).toEqual({ ok: false, error: 'FIELD_STALE' });
      expect(await snapshot(page)).toEqual(before);
      expect(await events(page)).toEqual([]);
      expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
    });
  }

  test('a page script that rewrites the value is reported (FIELD_UNSUPPORTED) without a second write', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    await page.evaluate(() => {
      const field = document.getElementById('why') as HTMLTextAreaElement;
      const counts = window as unknown as { __inputs: number };
      counts.__inputs = 0;
      field.addEventListener('input', () => {
        counts.__inputs += 1;
        field.value = 'Page rewrote this.';
      });
    });
    const reply = await send(page, 'insert.request', insertPayload(request));
    expect(reply?.payload).toEqual({ ok: false, error: 'FIELD_UNSUPPORTED' });
    // One input event from the single write; the extension did not retry.
    expect(
      await page.evaluate(() => (window as unknown as Record<string, number>)['__inputs']),
    ).toBe(1);
    await expect(page.locator('#why')).toHaveValue('Page rewrote this.');
  });

  test('the same target is served once: a repeated request writes nothing', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    expect((await send(page, 'insert.request', insertPayload(request)))?.payload).toEqual({
      ok: true,
    });
    await page.locator('#why').fill('');
    const second = await send(page, 'insert.request', insertPayload(request), 'req-2');
    expect(second?.payload).toEqual({ ok: false, error: 'FIELD_STALE' });
    await expect(page.locator('#why')).toHaveValue('');
  });

  test('the content script ignores another extension, extra keys, and confirmReplace:true', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const { request } = await capture(page);
    if (request === undefined) throw new Error('no field');
    for (const over of [
      { question: 'Why do you want to work at Acme?' },
      { facts: ['Led a team'] },
      { confirmReplace: true },
    ]) {
      expect(await send(page, 'insert.request', insertPayload(request, over))).toBeUndefined();
    }
    const foreign = await page.evaluate(
      ({ payload }) =>
        new Promise<unknown>((resolve) => {
          const listener = (window as unknown as Record<string, unknown>)['__listener'] as (
            m: unknown,
            s: unknown,
            r: (x: unknown) => void,
          ) => unknown;
          const kept = listener(
            { v: 1, requestId: 'req-1', type: 'insert.request', payload },
            { id: 'another-extension' },
            resolve,
          );
          if (kept !== true) setTimeout(() => resolve(undefined), 50);
        }),
      { payload: insertPayload(request) },
    );
    expect(foreign).toBeUndefined();
    await expect(page.locator('#why')).toHaveValue('');
  });
});
