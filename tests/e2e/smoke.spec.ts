import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTENSION_ID } from '../../extension/lib/constants/extension-key';
import { EXTENSION_PATH, FIXTURE_ORIGIN, expect, test } from './fixtures';

interface Manifest {
  content_scripts?: unknown;
  host_permissions?: unknown;
  optional_host_permissions?: unknown;
  permissions?: string[];
  content_security_policy?: unknown;
  web_accessible_resources?: unknown;
}

test('extension loads with a registered service worker and no errors', async ({
  context,
  serviceWorker,
  workerErrors,
}) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
  expect(context.serviceWorkers()).toHaveLength(1);
  // Errors surface as console errors on the worker; give registration an observable
  // event (a trivial evaluate round-trip) rather than sleeping.
  const version = await serviceWorker.evaluate(
    () =>
      (
        globalThis as unknown as {
          chrome: { runtime: { getManifest(): { manifest_version: number } } };
        }
      ).chrome.runtime.getManifest().manifest_version,
  );
  expect(version).toBe(3);
  expect(workerErrors).toEqual([]);
});

test('extension ID equals the pinned EXTENSION_ID', async ({ extensionId }) => {
  expect(extensionId).toBe(EXTENSION_ID);
});

test('side panel page renders the heading and empty state', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { level: 1, name: 'Job Answer Drafter' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Select a question on the page, then choose Draft answer.',
  );
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
});

test('fixture page is untouched: empty textarea, no events, no injected script', async ({
  context,
  serviceWorker,
}) => {
  expect(serviceWorker.url()).toContain('chrome-extension://');
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/basic-question.html`);
  await expect(page.getByLabel('Why do you want to work at Acme?')).toBeVisible();
  await expect(page.locator('#why')).toHaveValue('');
  expect(await page.evaluate(() => window.__fixtureEvents)).toEqual([]);
  // Registration is runtime-only: no extension effect on the page DOM or its scripts.
  const effects = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script').length,
    extensionNodes: document.querySelectorAll('[id*="job-answer" i], [class*="job-answer" i]')
      .length,
    bodyChildren: document.body.children.length,
    formChildren: document.getElementById('application')?.children.length,
  }));
  expect(effects).toEqual({ scripts: 1, extensionNodes: 0, bodyChildren: 2, formChildren: 3 });
  expect(page.url()).toBe(`${FIXTURE_ORIGIN}/basic-question.html`);
});

test('built manifest has no content scripts or host permissions', async () => {
  const manifest = JSON.parse(
    await readFile(join(EXTENSION_PATH, 'manifest.json'), 'utf8'),
  ) as Manifest;
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toBeUndefined();
  // Owner-approved set (nativeMessaging added for Slice 1.3); any further permission
  // needs a new approval.
  expect([...(manifest.permissions ?? [])].sort()).toEqual([
    'activeTab',
    'contextMenus',
    'nativeMessaging',
    'scripting',
    'sidePanel',
  ]);
  // PDF import (ADR 0004) must not loosen anything: the default extension-page
  // CSP stays (so no 'wasm-unsafe-eval'), and no page or file is made web-accessible.
  expect(manifest.content_security_policy).toBeUndefined();
  expect(manifest.web_accessible_resources).toBeUndefined();
});
