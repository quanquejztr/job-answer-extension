import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { EXTENSION_PATH, FIXTURE_ORIGIN, expect, test } from './fixtures';

// Runs the BUILT content script in real Chromium against local fixtures, with
// only chrome.runtime stubbed (same approach as capture.spec.ts), so field
// discovery and revalidation use real layout, computed style, and DOM.

const SENDER = 'stub-extension-id';

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
  await selectText(page, selector);
}

async function selectText(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(node as Node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, selector);
}

async function send(
  page: Page,
  type: string,
  payload: object,
  senderId = SENDER,
): Promise<Reply[]> {
  return page.evaluate(
    ({ type: t, payload: p, senderId: sid }) => {
      const listener = (window as unknown as Record<string, unknown>)['__listener'] as (
        m: unknown,
        s: unknown,
        r: (x: unknown) => void,
      ) => unknown;
      const replies: Reply[] = [];
      listener({ v: 1, requestId: 'req-1', type: t, payload: p }, { id: sid }, (x) =>
        replies.push(x as Reply),
      );
      return replies;
    },
    { type, payload, senderId },
  );
}

async function capture(page: Page): Promise<Reply['payload']> {
  const [reply] = await send(page, 'capture.request', {});
  if (reply === undefined) throw new Error('content script stayed silent');
  return reply.payload;
}

/** Captures the single field and returns the revalidation request payload for it. */
async function captured(page: Page): Promise<{ locator: object; fingerprint: unknown }> {
  const payload = await capture(page);
  const field = payload['field'] as { fingerprint: { domPath: number[] } } | null;
  if (field === null) throw new Error('no field found');
  return {
    locator: { frameId: 0, domPath: field.fingerprint.domPath },
    fingerprint: field.fingerprint,
  };
}

async function revalidate(page: Page, request: object): Promise<unknown> {
  const [reply] = await send(page, 'field.revalidate.request', request);
  expect(reply?.type).toBe('field.revalidate.result');
  return reply?.payload;
}

test.describe('field discovery in real Chromium', () => {
  test('finds the single textarea next to the question', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const payload = await capture(page);
    expect(payload['fieldStatus']).toBe('found');
    expect(payload['candidates']).toBe(1);
    const field = payload['field'] as {
      labelText: string;
      fingerprint: {
        tag: string;
        idAttr: string;
        nameAttr: string;
        domPath: number[];
        sizeBucket: number[];
        contentEditable: boolean;
      };
    };
    expect(field.labelText).toBe('Why do you want to work at Acme?');
    expect(field.fingerprint).toMatchObject({
      tag: 'textarea',
      contentEditable: false,
      idAttr: 'why',
      nameAttr: 'why',
      domPath: [0, 1],
    });
    expect(field.fingerprint.sizeBucket.every((n) => n > 0 && n % 20 === 0)).toBe(true);
    // Discovery reads and changes nothing on the page.
    expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
    await expect(page.locator('#why')).toHaveValue('');
  });

  test('never reads the field value', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    await page.locator('#why').fill('my private draft text');
    await selectText(page, 'label'); // typing moved the selection into the field
    const payload = await capture(page);
    expect(JSON.stringify(payload)).not.toContain('private draft');
    await expect(page.locator('#why')).toHaveValue('my private draft text');
  });

  test('reports ambiguous for two textareas and names no field', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'two-textareas.html');
    const payload = await capture(page);
    expect(payload['fieldStatus']).toBe('ambiguous');
    expect(payload['candidates']).toBe(2);
    expect(payload['field']).toBeNull();
  });

  test('reports not-found when the form has no textarea', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'no-textarea.html');
    const payload = await capture(page);
    expect(payload).toMatchObject({ fieldStatus: 'not-found', candidates: 0, field: null });
  });

  test('does not find a valid textarea outside the bounded region', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'far-textarea.html', '#question');
    await expect(page.locator('#far')).toBeVisible();
    const payload = await capture(page);
    expect(payload).toMatchObject({ fieldStatus: 'not-found', candidates: 0, field: null });
  });

  test('ignores a display:none textarea', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'hidden-textarea.html');
    const payload = await capture(page);
    expect(payload).toMatchObject({ fieldStatus: 'not-found', candidates: 0, field: null });
  });

  test('answers only its own extension', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    expect(await send(page, 'capture.request', {}, 'another-extension')).toEqual([]);
    const request = await captured(page);
    expect(await send(page, 'field.revalidate.request', request, 'another-extension')).toEqual([]);
  });
});

test.describe('field revalidation in real Chromium', () => {
  test('is ok on an untouched page, even after the user typed in the field', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    expect(await revalidate(page, request)).toEqual({ ok: true });
    await page.locator('#why').fill('typing does not change identity');
    expect(await revalidate(page, request)).toEqual({ ok: true });
  });

  test('reports missing after the field and its form are removed', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => document.getElementById('application')?.remove());
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'missing' });
  });

  test('reports changed (not missing) when removing the textarea lets a sibling take its slot', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => document.getElementById('why')?.remove());
    // The submit button now sits at the stored path: a different element type.
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'changed' });
  });

  test('reports changed after the textarea is replaced by a different element', async ({
    context,
  }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => {
      const fresh = document.createElement('textarea');
      fresh.id = 'why';
      fresh.name = 'rewritten';
      fresh.rows = 6;
      fresh.cols = 60;
      document.getElementById('why')?.replaceWith(fresh);
    });
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'changed' });
  });

  test('reports changed when a sibling is inserted and shifts the path', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => {
      document.getElementById('application')?.prepend(document.createElement('div'));
    });
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'changed' });
  });

  test('reports hidden after the textarea is hidden', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => {
      const el = document.getElementById('why');
      if (el) el.style.display = 'none';
    });
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'hidden' });
  });

  test('reports disabled after the textarea is disabled', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await page.evaluate(() => {
      const el = document.getElementById('why');
      if (el instanceof HTMLTextAreaElement) el.disabled = true;
    });
    expect(await revalidate(page, request)).toEqual({ ok: false, reason: 'disabled' });
  });

  test('revalidation touches nothing on the page', async ({ context }) => {
    const page = await context.newPage();
    await load(page, 'basic-question.html');
    const request = await captured(page);
    await revalidate(page, request);
    expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
    await expect(page.locator('#why')).toHaveValue('');
  });
});
