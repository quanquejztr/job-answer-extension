import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { EXTENSION_ORIGIN } from '../../extension/lib/constants/extension-key';
import { FIXTURE_ORIGIN, builtHostPath, expect, test } from './fixtures';

// Real native-messaging round trips. The host binary is built from helper/ into
// a temp directory and registered in the throwaway profile's own
// NativeMessagingHosts directory; the real Chrome directory is never touched.

const QUESTION = 'Why do you want to work at Acme?';
// helper/internal/provider/fake: FakeProvider answer (fixed text).
const FAKE_ANSWER =
  'Deterministic sample draft from the fake provider. Replace this text with your own words before using it.';

interface PanelContext {
  panel: Page;
  tabId: number;
}

async function openPanel(
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
async function pushCaptured(worker: Worker, tabId: number): Promise<void> {
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
    { tabId, question: QUESTION },
  );
}

test.describe('with the host registered for the test profile', () => {
  test('helper.hello over a real native port returns the helper and protocol version', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel } = await openPanel(context, extensionId, serviceWorker);
    const reply = await panel.evaluate(
      (requestId) =>
        new Promise<unknown>((resolve) => {
          const chromeApi = (
            globalThis as unknown as {
              chrome: {
                runtime: {
                  connectNative(name: string): {
                    postMessage(m: object): void;
                    disconnect(): void;
                    onMessage: { addListener(l: (m: unknown) => void): void };
                    onDisconnect: { addListener(l: () => void): void };
                  };
                };
              };
            }
          ).chrome;
          const port = chromeApi.runtime.connectNative('com.jobanswerdrafter.host');
          port.onMessage.addListener((m) => {
            port.disconnect();
            resolve(m);
          });
          port.onDisconnect.addListener(() => resolve('disconnected'));
          port.postMessage({
            protocolVersion: 1,
            requestId,
            type: 'helper.hello',
            payload: { extensionVersion: '0.0.0' },
          });
        }),
      'hello-e2e-1',
    );
    expect(reply).toEqual({
      protocolVersion: 1,
      requestId: 'hello-e2e-1',
      ok: true,
      result: { helperVersion: '0.1.0', protocolVersion: 1 },
    });
  });

  test('Generate draft goes through the real worker, client, and helper and shows the fixed answer', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const box = panel.getByRole('textbox', { name: 'Question' });
    await expect(box).toHaveValue(QUESTION);
    await box.fill(`${QUESTION} Keep it short.`);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    await expect(panel.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(FAKE_ANSWER);
    await expect(panel.getByText(/Facts used: 2/)).toBeVisible();
    // The edited question survived the round trip, and nothing is inserted.
    await expect(box).toHaveValue(`${QUESTION} Keep it short.`);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    // The draft is editable text; with no detected field (this test never ran a
    // capture) Insert is disabled with a visible reason and Generating never inserted.
    const draft = panel.getByRole('textbox', { name: 'Draft answer' });
    await expect(draft).toHaveValue(FAKE_ANSWER);
    await expect(panel.getByText('17 of 150 words')).toBeVisible();
    const insert = panel.getByRole('button', { name: 'Insert answer' });
    await expect(insert).toBeDisabled();
    await expect(panel.getByText('Insert needs exactly one detected answer field.')).toBeVisible();
    await draft.fill('My own edit of the draft.');
    await expect(panel.getByText(/Edited by you\./)).toBeVisible();
    // A second draft works (a new port and helper process per request) and
    // replaces the edit with the new generated text.
    await panel.getByRole('button', { name: 'Generate again' }).click();
    await expect(draft).toHaveValue(FAKE_ANSWER);
  });
});

test.describe('with no host registered', () => {
  test.use({ installHost: false });

  test('Generate draft shows the typed helper-unavailable error and keeps the question', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const box = panel.getByRole('textbox', { name: 'Question' });
    await box.fill(`${QUESTION} My edit.`);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('The native helper is unavailable.');
    await expect(alert).toContainText('Run the installer, then retry');
    await expect(box).toHaveValue(`${QUESTION} My edit.`);
    await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
  });
});

// The built binary itself, without a browser: the caller-origin check and one
// framed hello over real pipes.
test.describe('built host binary', () => {
  function frame(body: object): Buffer {
    const json = Buffer.from(JSON.stringify(body));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(json.length); // Chrome on this (little-endian) Mac uses native order
    return Buffer.concat([prefix, json]);
  }

  test('exits non-zero with empty stdout when the origin is missing or wrong', async () => {
    const host = await builtHostPath();
    for (const args of [[], ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']]) {
      const child = spawn(host, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = 0;
      child.stdout.on('data', (d: Buffer) => (stdout += d.length));
      const [code] = (await once(child, 'exit')) as [number | null];
      expect(code).not.toBe(0);
      expect(stdout).toBe(0);
    }
  });

  test('answers one hello for the pinned origin and exits 0 when stdin closes', async () => {
    const host = await builtHostPath();
    const child = spawn(host, [EXTENSION_ORIGIN], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stdin.write(
      frame({
        protocolVersion: 1,
        requestId: 'bin-1',
        type: 'helper.hello',
        payload: { extensionVersion: '0.0.0' },
      }),
    );
    child.stdin.end();
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code).toBe(0);
    const out = Buffer.concat(chunks);
    const length = out.readUInt32LE(0);
    expect(out.length).toBe(4 + length);
    expect(JSON.parse(out.subarray(4).toString('utf8'))).toEqual({
      protocolVersion: 1,
      requestId: 'bin-1',
      ok: true,
      result: { helperVersion: '0.1.0', protocolVersion: 1 },
    });
  });
});
