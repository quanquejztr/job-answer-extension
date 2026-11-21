import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  expect,
  fakeClaudeCalls,
  fakeClaudePid,
  helperDataDir,
  setFakeClaudeMode,
  test,
} from './fixtures';
import {
  DRAFT_PREFIX,
  QUESTION,
  RESUME,
  STORY_CELLO,
  addStory,
  chooseProviderAndAccept,
  openPanel,
  pushCaptured,
  saveResume,
  sendNative,
} from './panel-helpers';

// Drafting through the production Claude provider and the real helper, against
// a fake `claude` executable. The fake is the only `claude` on the helper's
// PATH (see fixtures.ts), its behavior comes from a mode file in the helper's
// throwaway HOME, and it records only "auth" or "draft" per run. The real
// `claude` is never started. All profile text is made up.

const PROVIDER_ERRORS = [
  {
    mode: 'not-authenticated',
    message: 'The provider is not signed in.',
    action: 'Sign in with the CLI yourself',
  },
  {
    mode: 'usage-limit',
    message: 'The provider usage limit was reached.',
    action: 'Wait or switch provider in settings',
  },
  {
    mode: 'malformed',
    message: 'The provider output was not usable.',
    action: 'Regenerate',
  },
  {
    mode: 'bad-quote',
    message: 'The draft was not supported by your résumé and stories.',
    action: 'Regenerate, or add the missing detail to your résumé or stories',
  },
  {
    mode: 'bad-number',
    message: 'The draft was not supported by your résumé and stories.',
    action: 'Regenerate, or add the missing detail to your résumé or stories',
  },
] as const;

/** Provider, disclosure, résumé, and one story, all through the real settings page. */
async function setUp(page: Page, extensionId: string): Promise<void> {
  await chooseProviderAndAccept(page, extensionId);
  await saveResume(page, extensionId, RESUME);
  await addStory(page, extensionId, STORY_CELLO);
}

test.describe('drafting with Claude through the real helper and a fake claude', () => {
  test('is blocked until a provider is chosen, the disclosure accepted, and a résumé saved', async ({
    context,
    extensionId,
    serviceWorker,
    helperHome,
  }) => {
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const generate = panel.getByRole('button', { name: 'Generate draft' });
    // The settings are changed straight on the helper (as the settings page
    // does) so the active tab, which the panel follows, stays put; the focus
    // event is what the real panel gets when the owner clicks back into it.
    const refresh = () => panel.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(
      panel.getByText('Choose Claude Code or Codex in settings before drafting.'),
    ).toBeVisible();
    await expect(generate).toBeDisabled();

    expect((await sendNative(panel, 'settings.setProvider', { provider: 'claude' })).ok).toBe(true);
    await refresh();
    await expect(
      panel.getByText('Read and accept the first-use disclosure in settings before drafting.'),
    ).toBeVisible();
    await expect(generate).toBeDisabled();

    expect((await sendNative(panel, 'settings.acceptDisclosure', {})).ok).toBe(true);
    await refresh();
    await expect(
      panel.getByText("Add your résumé in the extension's settings before drafting."),
    ).toBeVisible();
    await expect(generate).toBeDisabled();

    expect(
      (await sendNative(panel, 'profile.resume.set', { text: RESUME, source: 'pasted' })).ok,
    ).toBe(true);
    await refresh();
    await expect(generate).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Open settings' })).toHaveCount(0);

    // The helper wrote both settings under the throwaway home only.
    const stored = JSON.parse(
      await readFile(join(helperDataDir(helperHome), 'profile.json'), 'utf8'),
    ) as { settings: { provider?: string; disclosureAcceptedAt?: string } };
    expect(stored.settings.provider).toBe('claude');
    expect(stored.settings.disclosureAcceptedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    // Nothing started claude yet.
    expect(await fakeClaudeCalls(helperHome)).toEqual([]);
  });

  test('the blocked panel offers a link that opens the settings page', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const opened = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Open settings' }).click();
    const settings = await opened;
    await expect(settings.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(settings.url()).toBe(`chrome-extension://${extensionId}/options.html`);
    // Nothing is chosen by default, and Codex is listed but cannot be chosen.
    await expect(settings.getByRole('radio', { name: 'Claude Code' })).not.toBeChecked();
    await expect(settings.getByRole('radio', { name: 'Codex (not available yet)' })).toBeDisabled();
    await expect(settings.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  test('the helper itself refuses to draft with no provider or no disclosure, whatever the panel shows', async ({
    context,
    extensionId,
    serviceWorker,
    helperHome,
  }) => {
    const setup = await context.newPage();
    await saveResume(setup, extensionId, RESUME);
    const { panel } = await openPanel(context, extensionId, serviceWorker);
    const draft = () =>
      panel.evaluate(
        (requestId) =>
          new Promise<{ ok?: boolean; error?: { code?: string } }>((resolve) => {
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
              resolve(m as { ok?: boolean; error?: { code?: string } });
            });
            port.postMessage({
              protocolVersion: 1,
              requestId,
              type: 'draft.generate',
              payload: {
                question: 'Why do you want to work at Acme?',
                constraints: { maxWords: 100 },
                requestedAt: new Date().toISOString(),
              },
            });
          }),
        `blocked-${Math.random().toString(36).slice(2, 10)}`,
      );
    expect((await draft()).error?.code).toBe('INVALID_REQUEST');
    // A provider without the disclosure is still blocked.
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await setup.getByRole('radio', { name: 'Claude Code' }).click();
    await expect(setup.getByText('Provider saved: Claude Code.')).toBeVisible();
    expect((await draft()).error?.code).toBe('INVALID_REQUEST');
    expect(await fakeClaudeCalls(helperHome)).toEqual([]);
  });

  test('Check provider follows the chosen provider and runs only the fake claude', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    // Nothing chosen yet: the check is disabled and says why.
    await expect(page.getByRole('button', { name: 'Check provider' })).toBeDisabled();
    await expect(page.getByText(/Choose a provider above/)).toBeVisible();
    await chooseProviderAndAccept(page, extensionId);
    await page.getByRole('button', { name: 'Check provider' }).click();
    await expect(page.getByText('Claude Code command:')).toBeVisible();
    await expect(page.getByText('Claude Code sign-in:')).toBeVisible();
    await expect(page.getByText('OK', { exact: true })).toHaveCount(3);
    expect(await fakeClaudeCalls(helperHome)).toEqual(['auth']);

    await setFakeClaudeMode(helperHome, 'not-authenticated');
    await page.getByRole('button', { name: 'Check provider' }).click();
    await expect(
      page.getByText('The provider is not signed in. Next step: Sign in with the CLI yourself.'),
    ).toBeVisible();
  });

  test('choose provider, accept the disclosure, draft, and review the evidence', async ({
    context,
    extensionId,
    serviceWorker,
    helperHome,
  }) => {
    const setup = await context.newPage();
    await setUp(setup, extensionId);
    await setup.close();
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const box = panel.getByRole('textbox', { name: 'Question' });
    await box.fill(`${QUESTION} Keep it short.`);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    const draft = panel.getByRole('textbox', { name: 'Draft answer' });
    await expect(draft).toHaveValue(new RegExp(`^${DRAFT_PREFIX} ${RESUME.replace(/\./g, '\\.')}`));
    await expect(panel.getByText(/Evidence: 2 quotes\./)).toBeVisible();
    await panel.getByText('Evidence', { exact: true }).click();
    const quotes = panel.getByRole('listitem');
    await expect(quotes).toHaveCount(2);
    await expect(quotes.nth(0)).toHaveText(`Résumé: “${RESUME}”`);
    await expect(quotes.nth(1)).toHaveText(`Story: “${STORY_CELLO}”`);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(box).toHaveValue(`${QUESTION} Keep it short.`);
    expect(await fakeClaudeCalls(helperHome)).toEqual(['draft']);
  });

  test('warnings are shown as notes next to a draft that still has verified evidence', async ({
    context,
    extensionId,
    serviceWorker,
    helperHome,
  }) => {
    const setup = await context.newPage();
    await setUp(setup, extensionId);
    await setup.close();
    await setFakeClaudeMode(helperHome, 'ok-warnings');
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    await expect(panel.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(
      /Zorblax Industries/,
    );
    await expect(panel.getByText(/Warning: Check these names/)).toBeVisible();
    await expect(panel.getByText('Note: Check every detail yourself.')).toBeVisible();
    await expect(panel.getByText(/Evidence: 2 quotes\./)).toBeVisible();
  });

  for (const failure of PROVIDER_ERRORS) {
    test(`${failure.mode}: a typed error with one next step, no answer, and the edited question kept`, async ({
      context,
      extensionId,
      serviceWorker,
      helperHome,
    }) => {
      const setup = await context.newPage();
      await setUp(setup, extensionId);
      await setup.close();
      await setFakeClaudeMode(helperHome, failure.mode);
      const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
      await pushCaptured(serviceWorker, tabId);
      const box = panel.getByRole('textbox', { name: 'Question' });
      await box.fill(`${QUESTION} My edit.`);
      await panel.getByRole('button', { name: 'Generate draft' }).click();
      const alert = panel.getByRole('alert');
      await expect(alert).toContainText(failure.message);
      await expect(alert).toContainText(`Next step: ${failure.action}.`);
      // No answer, evidence, or provider text reached the panel.
      await expect(panel.getByRole('textbox', { name: 'Draft answer' })).toHaveCount(0);
      const shown = await panel.locator('body').innerText();
      for (const leak of ['Deterministic sample draft', 'SECRET-PROVIDER-TEXT', '87%']) {
        expect(shown).not.toContain(leak);
      }
      await expect(box).toHaveValue(`${QUESTION} My edit.`);
      await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
      // Fixing the cause and trying again works without retyping the question.
      await setFakeClaudeMode(helperHome, 'ok');
      await panel.getByRole('button', { name: 'Generate draft' }).click();
      await expect(panel.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(
        new RegExp(`^${DRAFT_PREFIX}`),
      );
      await expect(box).toHaveValue(`${QUESTION} My edit.`);
    });
  }

  test('Cancel while generating stops claude and returns to the captured question', async ({
    context,
    extensionId,
    serviceWorker,
    helperHome,
  }) => {
    const setup = await context.newPage();
    await setUp(setup, extensionId);
    await setup.close();
    await setFakeClaudeMode(helperHome, 'hang');
    const { panel, tabId } = await openPanel(context, extensionId, serviceWorker);
    await pushCaptured(serviceWorker, tabId);
    const box = panel.getByRole('textbox', { name: 'Question' });
    await box.fill(`${QUESTION} Cancel me.`);
    await panel.getByRole('button', { name: 'Generate draft' }).click();
    await expect(panel.getByText(/Generating with Claude Code… \d+ s elapsed/)).toBeVisible();
    // The fake records its pid once it is running (an observable event).
    await expect.poll(() => fakeClaudePid(helperHome), { timeout: 10_000 }).toBeGreaterThan(0);
    const pid = (await fakeClaudePid(helperHome)) ?? -1;
    expect(() => process.kill(pid, 0)).not.toThrow();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(box).toHaveValue(`${QUESTION} Cancel me.`);
    // Closing the port ended the helper, which killed claude.
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return 'running';
          } catch {
            return 'gone';
          }
        },
        { timeout: 10_000 },
      )
      .toBe('gone');
  });
});
