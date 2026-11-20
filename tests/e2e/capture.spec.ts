import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { EXTENSION_PATH, FIXTURE_ORIGIN, expect, test } from './fixtures';

// Playwright cannot click Chrome's native context menu, and without that user
// gesture `activeTab` is never granted, so the worker cannot inject into a page
// (the manifest has no host_permissions by design). These tests therefore cover
// what is automatable without any test-only code in the product bundle:
//  1. the side panel renders each state when the worker pushes it over the real
//     runtime messaging channel (the same message the real click handler sends);
//  2. the panel's pull path against the real worker;
//  3. injection without a gesture is refused by Chrome (the real trigger of the
//     menu-selection fallback);
//  4. the built content script, loaded into a real fixture page with only a
//     stubbed `chrome.runtime`, reads the page's real selection.
// The click handler itself is covered by fake-API unit tests, and the real menu
// by the manual checklist in the Slice 1.1 report.

const QUESTION = 'Why do you want to work at Acme?';

interface PanelContext {
  panel: Page;
  fixture: Page;
  tabId: number;
}

/** Opens the fixture tab and a panel page, then makes the fixture tab active. */
async function openPanelFor(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  serviceWorker: Worker,
): Promise<PanelContext> {
  const fixture = await context.newPage();
  await fixture.goto(`${FIXTURE_ORIGIN}/basic-question.html`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText('Select a question on the page')).toBeVisible();
  await fixture.bringToFront();
  const tabId = await serviceWorker.evaluate(async () => {
    const chromeApi = (
      globalThis as unknown as {
        chrome: { tabs: { query(q: object): Promise<{ id?: number }[]> } };
      }
    ).chrome;
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });
  expect(tabId).toBeGreaterThanOrEqual(0);
  return { panel, fixture, tabId };
}

async function pushState(worker: Worker, tabId: number, state: object): Promise<void> {
  await worker.evaluate(
    async ({ tabId: id, state: s }) => {
      const chromeApi = (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: object): Promise<unknown> } };
        }
      ).chrome;
      await chromeApi.runtime
        .sendMessage({
          v: 1,
          requestId: crypto.randomUUID(),
          type: 'panel.state',
          payload: { tabId: id, state: s },
        })
        .catch(() => undefined);
    },
    { tabId, state },
  );
}

test.describe('side panel states over the real messaging channel', () => {
  test('pull on load returns Empty from the worker', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel } = await openPanelFor(context, extensionId, serviceWorker);
    await expect(panel.getByRole('status')).toContainText(
      'Select a question on the page, then choose Draft answer.',
    );
  });

  test('renders unsupported-domain, captured (editable), and error states', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel, tabId } = await openPanelFor(context, extensionId, serviceWorker);

    await pushState(serviceWorker, tabId, { kind: 'unsupported-domain' });
    await expect(panel.getByText('This site is not supported.')).toBeVisible();
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(panel.getByRole('textbox')).toHaveCount(0);

    await pushState(serviceWorker, tabId, {
      kind: 'captured',
      question: QUESTION,
      source: 'content-script',
      captureId: 'cap-1',
      field: { status: 'found', label: 'Why Acme?' },
    });
    const box = panel.getByRole('textbox', { name: 'Question' });
    await expect(box).toHaveValue(QUESTION);
    await expect(panel.getByText('Captured from the page.')).toBeVisible();
    await expect(panel.getByText('Answer field: found (Why Acme?)')).toBeVisible();
    await box.fill(`${QUESTION} Edited.`);
    await expect(box).toHaveValue(`${QUESTION} Edited.`);

    await pushState(serviceWorker, tabId, { kind: 'error', code: 'QUESTION_MISSING' });
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('No question was selected.');
    await expect(alert).toContainText('Select the full question and retry');

    await pushState(serviceWorker, tabId, { kind: 'error', code: 'INVALID_REQUEST' });
    await expect(alert).toContainText('The request was not valid.');
  });

  test('renders an HTML-like question as text only', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel, tabId } = await openPanelFor(context, extensionId, serviceWorker);
    const html = '<img src=x onerror="document.title=\'pwned\'"><b>Why</b> this job, really?';
    await pushState(serviceWorker, tabId, {
      kind: 'captured',
      question: html,
      source: 'menu-selection',
      captureId: 'cap-2',
      field: { status: 'found', label: html },
    });
    await expect(panel.getByRole('textbox', { name: 'Question' })).toHaveValue(html);
    await expect(panel.locator('main img, main b')).toHaveCount(0);
    await expect(panel.getByText(`Answer field: found (${html})`)).toBeVisible();
    expect(await panel.title()).toBe('Job Answer Drafter');
  });

  test('state for another tab is not shown', async ({ context, extensionId, serviceWorker }) => {
    const { panel, tabId } = await openPanelFor(context, extensionId, serviceWorker);
    await pushState(serviceWorker, tabId + 1000, { kind: 'error', code: 'QUESTION_MISSING' });
    await pushState(serviceWorker, tabId, { kind: 'unsupported-domain' });
    await expect(panel.getByText('This site is not supported.')).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
});

test('injection without a user gesture is refused (the menu-selection fallback trigger)', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/basic-question.html`);
  await page.bringToFront();
  const outcome = await serviceWorker.evaluate(async () => {
    const chromeApi = (
      globalThis as unknown as {
        chrome: {
          tabs: { query(q: object): Promise<{ id?: number }[]> };
          scripting: { executeScript(o: object): Promise<unknown> };
        };
      }
    ).chrome;
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    try {
      await chromeApi.scripting.executeScript({
        target: { tabId: tab?.id, frameIds: [0] },
        files: ['/content-scripts/content.js'],
      });
      return 'injected';
    } catch (error) {
      return String(error);
    }
  });
  expect(outcome).toContain('Cannot access contents of the page');
  expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
});

test('built content script reads the fixture selection and answers only its own extension', async ({
  context,
}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w['chrome'] = {
      runtime: {
        id: 'stub-extension-id',
        onMessage: { addListener: (fn: unknown) => (w['__listener'] = fn) },
      },
    };
  });
  await page.goto(`${FIXTURE_ORIGIN}/basic-question.html`);
  await page.addScriptTag({
    content: await readFile(join(EXTENSION_PATH, 'content-scripts/content.js'), 'utf8'),
  });
  await page.evaluate(() => {
    const label = document.querySelector('label');
    const range = document.createRange();
    range.selectNodeContents(label as Node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });

  const ask = (senderId: string | undefined, type = 'capture.request') =>
    page.evaluate(
      ({ senderId: sid, type: t }) => {
        const listener = (window as unknown as Record<string, unknown>)['__listener'] as (
          m: unknown,
          s: unknown,
          r: (x: unknown) => void,
        ) => unknown;
        const replies: unknown[] = [];
        listener({ v: 1, requestId: 'req-9', type: t, payload: {} }, { id: sid }, (x) =>
          replies.push(x),
        );
        return replies;
      },
      { senderId, type },
    );

  expect(await ask('stub-extension-id')).toEqual([
    {
      v: 1,
      requestId: 'req-9',
      type: 'capture.result',
      payload: {
        question: QUESTION,
        fieldStatus: 'found',
        field: {
          labelText: QUESTION,
          fingerprint: expect.objectContaining({ tag: 'textarea', idAttr: 'why' }),
        },
        candidates: 1,
      },
    },
  ]);
  expect(await ask('another-extension')).toEqual([]);
  expect(await ask(undefined)).toEqual([]);
  expect(await ask('stub-extension-id', 'insert.request')).toEqual([]);
  // Reading a selection touches nothing on the page.
  expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
  await expect(page.locator('#why')).toHaveValue('');
});
