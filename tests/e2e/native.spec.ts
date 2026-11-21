import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EXTENSION_ORIGIN } from '../../extension/lib/constants/extension-key';
import { builtHostPath, expect, test } from './fixtures';
import {
  DRAFT_PREFIX,
  QUESTION,
  RESUME,
  STORY_BIKES,
  STORY_CELLO,
  addStory,
  chooseProviderAndAccept,
  openPanel,
  pushCaptured,
  realDataDirNames,
  saveResume,
} from './panel-helpers';

// Real native-messaging round trips. The host binary is built from helper/ into
// a temp directory and registered in the throwaway profile's own
// NativeMessagingHosts directory; the real Chrome directory is never touched.
// Drafting runs the production Claude provider against a fake `claude`
// executable (see fixtures.ts), never the real one.

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

  test('Generate draft goes through the real worker, client, and helper and shows a draft built from the saved résumé', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const setup = await context.newPage();
    await chooseProviderAndAccept(setup, extensionId);
    await saveResume(setup, extensionId, RESUME);
    await addStory(setup, extensionId, STORY_CELLO);
    await setup.close();
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const box = panel.getByRole('textbox', { name: 'Question' });
    await expect(box).toHaveValue(QUESTION);
    await box.fill(`${QUESTION} Keep it short.`);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    const draft = panel.getByRole('textbox', { name: 'Draft answer' });
    await expect(draft).toHaveValue(new RegExp(`^${DRAFT_PREFIX} ${RESUME.replace(/\./g, '\\.')}`));
    const generated = await draft.inputValue();
    expect(generated).not.toContain('cello');
    // The verified evidence quotes are listed as text, résumé first, then the story.
    await expect(panel.getByText(/Evidence: 2 quotes\./)).toBeVisible();
    await panel.getByText('Evidence', { exact: true }).click();
    const quotes = panel.getByRole('listitem');
    await expect(quotes).toHaveCount(2);
    await expect(quotes.nth(0)).toHaveText(`Résumé: \u201C${RESUME}\u201D`);
    await expect(quotes.nth(1)).toHaveText(`Story: \u201C${STORY_CELLO}\u201D`);
    // The edited question survived the round trip, and nothing is inserted.
    await expect(box).toHaveValue(`${QUESTION} Keep it short.`);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    // The draft is editable text; with no detected field (this test never ran a
    // capture) Insert is disabled with a visible reason and Generating never inserted.
    await expect(panel.getByText(/\d+ of 150 words/)).toBeVisible();
    const insert = panel.getByRole('button', { name: 'Insert answer' });
    await expect(insert).toBeDisabled();
    await expect(panel.getByText('Insert needs exactly one detected answer field.')).toBeVisible();
    await draft.fill('My own edit of the draft.');
    await expect(panel.getByText(/Edited by you\./)).toBeVisible();
    // A second draft works (a new port and helper process per request) and
    // replaces the edit with the new generated text.
    await panel.getByRole('button', { name: 'Generate again' }).click();
    await expect(draft).toHaveValue(generated);
  });

  test('the panel shows the draft and nothing else from the profile', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const before = await realDataDirNames();
    const setup = await context.newPage();
    await chooseProviderAndAccept(setup, extensionId);
    await saveResume(setup, extensionId, RESUME);
    await addStory(setup, extensionId, STORY_CELLO);
    await addStory(setup, extensionId, STORY_BIKES);
    await setup.close();
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId, 'Describe your experience building compilers.');
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    const draft = panel.getByRole('textbox', { name: 'Draft answer' });
    await expect(draft).toHaveValue(/^Deterministic sample draft based on your saved resume:/);
    const everything = await panel.locator('body').innerText();
    const fields = await panel
      .locator('textarea')
      .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value).join('\n'));
    // Only the quotes the helper cited (résumé start, first story start) may
    // appear; the second story is sent to the provider but never shown.
    await panel.getByText('Evidence', { exact: true }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    for (const other of ['bicycles', 'garage', 'winters']) {
      expect(everything.toLowerCase()).not.toContain(other);
      expect(fields.toLowerCase()).not.toContain(other);
    }
    expect(await realDataDirNames()).toEqual(before);
  });

  test('with no résumé the panel shows the hint and Generate draft is disabled until one is saved', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const setup = await context.newPage();
    await chooseProviderAndAccept(setup, extensionId);
    await setup.close();
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    await expect(
      panel.getByText("Add your résumé in the extension's settings before drafting."),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
    // A story alone does not enable drafting (the story is added straight to
    // the helper, so the active tab stays put).
    const send = (payload: object, requestId: string, type: string) =>
      panel.evaluate(
        ({ payload: p, requestId: id, type: t }) =>
          new Promise<{ ok?: boolean }>((resolve) => {
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
              resolve(m as { ok?: boolean });
            });
            port.postMessage({ protocolVersion: 1, requestId: id, type: t, payload: p });
          }),
        { payload, requestId, type },
      );
    const storyReply = await send(
      { kind: 'story', item: { title: 'Made-up', text: STORY_CELLO } },
      'add-story-e2e',
      'profile.item.upsert',
    );
    expect(storyReply.ok).toBe(true);
    await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
    // The résumé is saved and the panel regains focus, as the real side panel
    // does when the user clicks back into it after saving in settings.
    const resumeReply = await send(
      { text: RESUME, source: 'pasted' },
      'add-resume-e2e',
      'profile.resume.set',
    );
    expect(resumeReply.ok).toBe(true);
    await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
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
