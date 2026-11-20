import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { EXTENSION_ORIGIN } from '../../extension/lib/constants/extension-key';
import { NATIVE_HOST_NAME } from '../../extension/lib/constants/native-host';

export const EXTENSION_PATH = resolve(import.meta.dirname, '../../.output/chrome-mv3');
export const FIXTURE_ORIGIN = 'http://127.0.0.1:4310';

/** Derives the extension ID from a service worker URL (chrome-extension://<id>/...). */
export function extensionIdFromWorker(worker: Worker): string {
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url());
  if (!match?.[1]) throw new Error('Service worker URL is not an extension URL');
  return match[1];
}

const HELPER_DIR = resolve(import.meta.dirname, '../../helper');

let hostBuild: Promise<string> | undefined;

/**
 * Builds the Go host once per test process into a temporary directory (never
 * into the repo or any real user location) and returns its path.
 */
export function builtHostPath(): Promise<string> {
  hostBuild ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jad-host-'));
    const out = join(dir, 'host');
    await promisify(execFile)('go', ['build', '-o', out, './cmd/host'], { cwd: HELPER_DIR });
    return out;
  })();
  return hostBuild;
}

/**
 * Registers the host for one throwaway Chromium profile only: Chromium reads
 * `<user-data-dir>/NativeMessagingHosts/` for its own profile. The real Chrome
 * directory under ~/Library is never touched.
 */
async function registerHost(userDataDir: string, hostPath: string): Promise<void> {
  const dir = join(userDataDir, 'NativeMessagingHosts');
  await mkdir(dir, { recursive: true });
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Job Answer Drafter test host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [EXTENSION_ORIGIN],
  };
  await writeFile(join(dir, `${NATIVE_HOST_NAME}.json`), JSON.stringify(manifest, null, 2));
}

interface Fixtures {
  context: BrowserContext;
  /** Register the built native host for this profile (default true). */
  installHost: boolean;
  serviceWorker: Worker;
  extensionId: string;
  /** Errors collected from the service worker console and page errors. */
  workerErrors: string[];
}

export const test = base.extend<Fixtures>({
  installHost: [true, { option: true }],
  context: async ({ browserName, installHost }, provide) => {
    expect(browserName).toBe('chromium');
    const userDataDir = await mkdtemp(join(tmpdir(), 'jad-e2e-'));
    if (installHost) await registerHost(userDataDir, await builtHostPath());
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Bundled Chromium; `--headless=new` supports extensions (headed fallback not needed).
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    try {
      await provide(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
  serviceWorker: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await provide(worker);
  },
  workerErrors: async ({ serviceWorker, context }, provide) => {
    const errors: string[] = [];
    serviceWorker.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    context.on('weberror', (err) => errors.push(err.error().message));
    await provide(errors);
  },
  extensionId: async ({ serviceWorker }, provide) => {
    await provide(extensionIdFromWorker(serviceWorker));
  },
});

export { expect };
