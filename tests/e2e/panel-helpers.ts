import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { FIXTURE_ORIGIN, expect } from './fixtures';

// Shared helpers for the specs that drive the side panel and the settings page
// against the real helper. All profile text is made up.

export const QUESTION = 'Why do you want to work at Acme?';
// All profile text below is made up. The fake provider builds its answer from the
// start of the saved résumé ("Deterministic sample draft based on your saved
// resume: ...") and cites the start of the résumé and of the first story as
// evidence quotes, which the real helper verifies before the panel sees them.
export const RESUME = 'I want to build routing software for small logistics teams at Acme.';
export const STORY_CELLO = 'Played cello in a community orchestra every weekend for years.';
export const STORY_BIKES = 'Restored vintage bicycles in a garage workshop during long winters.';
export const DRAFT_PREFIX = 'Deterministic sample draft based on your saved resume:';

/** Saves the résumé through the real settings page and the real helper. */
export async function saveResume(page: Page, extensionId: string, text: string): Promise<void> {
  if (!page.url().startsWith(`chrome-extension://${extensionId}/options.html`)) {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
  }
  await page.getByRole('textbox', { name: 'Résumé text' }).fill(text);
  await page.getByRole('button', { name: 'Save résumé' }).click();
  await expect(page.getByText('Résumé saved.')).toBeVisible();
}

/** Adds one story through the real settings page and the real helper. */
export async function addStory(page: Page, extensionId: string, text: string): Promise<void> {
  if (!page.url().startsWith(`chrome-extension://${extensionId}/options.html`)) {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
  }
  await page.getByRole('tab', { name: 'Stories' }).click();
  await page.getByRole('button', { name: 'Add story' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('A made-up story');
  await page.getByRole('textbox', { name: 'Story', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Save story' }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

/** Names (never contents) in the real app-data directory, or null when it does not exist. */
export async function realDataDirNames(): Promise<string[] | null> {
  const dir = join(homedir(), 'Library', 'Application Support', 'JobAnswerDrafter');
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface PanelContext {
  panel: Page;
  tabId: number;
}

export async function openPanel(
  context: BrowserContext,
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
  return { panel, tabId };
}

/** Shows a captured question in the panel, as the worker's capture flow would. */
export async function pushCaptured(worker: Worker, tabId: number, text = QUESTION): Promise<void> {
  await worker.evaluate(
    async ({ tabId: id, question }) => {
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
          payload: {
            tabId: id,
            state: {
              kind: 'captured',
              question,
              source: 'menu-selection',
              captureId: 'cap-1',
              field: { status: 'not-found' },
            },
          },
        })
        .catch(() => undefined);
    },
    { tabId, question: text },
  );
}

/**
 * Chooses Claude Code and accepts the first-use disclosure through the real
 * settings page and the real helper, the way the owner does before drafting.
 */
export async function chooseProviderAndAccept(page: Page, extensionId: string): Promise<void> {
  if (!page.url().startsWith(`chrome-extension://${extensionId}/options.html`)) {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
  }
  await page.getByRole('radio', { name: 'Claude Code' }).click();
  await expect(page.getByText('Provider saved: Claude Code.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'I have checked these settings.' }).check();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(/You accepted this on /)).toBeVisible();
}

/**
 * Sends one request straight to the real helper over a native port opened by
 * the given extension page, and returns the response envelope. Used where
 * opening another tab would change the active tab the panel follows.
 */
export function sendNative(
  page: Page,
  type: string,
  payload: object,
): Promise<{ ok?: boolean; result?: unknown; error?: { code?: string } }> {
  return page.evaluate(
    ({ type: t, payload: p, requestId }) =>
      new Promise<{ ok?: boolean; result?: unknown; error?: { code?: string } }>((resolve) => {
        const chromeApi = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                connectNative(name: string): {
                  postMessage(m: object): void;
                  disconnect(): void;
                  onMessage: { addListener(l: (m: unknown) => void): void };
                };
              };
            };
          }
        ).chrome;
        const port = chromeApi.runtime.connectNative('com.jobanswerdrafter.host');
        port.onMessage.addListener((m) => {
          port.disconnect();
          resolve(m as { ok?: boolean; result?: unknown; error?: { code?: string } });
        });
        port.postMessage({ protocolVersion: 1, requestId, type: t, payload: p });
      }),
    { type, payload, requestId: `e2e-${Math.random().toString(36).slice(2, 12)}` },
  );
}
