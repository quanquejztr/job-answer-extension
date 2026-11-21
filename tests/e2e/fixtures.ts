import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

let fakeClaudeBuild: Promise<string> | undefined;

/**
 * Builds the fake `claude` executable once per test process into a temporary
 * directory and returns that directory. The source is test-only
 * (helper/internal/host/testdata/fakeclaude): it reads the prompt from stdin,
 * answers according to the mode file in the helper's throwaway HOME, and
 * records only a word per call. The real `claude` is never used by any test.
 */
export function builtFakeClaudeDir(): Promise<string> {
  fakeClaudeBuild ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jad-fakeclaude-'));
    await promisify(execFile)(
      'go',
      ['build', '-o', join(dir, 'claude'), './internal/host/testdata/fakeclaude'],
      { cwd: HELPER_DIR },
    );
    return dir;
  })();
  return fakeClaudeBuild;
}

/** What the fake `claude` does next: see helper/internal/host/testdata/fakeclaude. Default `ok`. */
export async function setFakeClaudeMode(home: string, mode: string): Promise<void> {
  await writeFile(join(home, 'fake-claude-mode'), `${mode}\n`);
}

/** One word per fake `claude` run ("auth" or "draft"), never any content. */
export async function fakeClaudeCalls(home: string): Promise<string[]> {
  try {
    return (await readFile(join(home, 'fake-claude-calls.log'), 'utf8'))
      .split(/\s+/)
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** The pid the fake `claude` recorded when it started a hanging run, or undefined. */
export async function fakeClaudePid(home: string): Promise<number | undefined> {
  try {
    return Number((await readFile(join(home, 'fake-claude-pid'), 'utf8')).trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Name of the file the host wrapper writes its HOME into, inside the temp home. */
export const HOME_PROBE_FILE = 'helper-home-probe.txt';

/**
 * Registers the host for one throwaway Chromium profile only: Chromium reads
 * `<user-data-dir>/NativeMessagingHosts/` for its own profile. The real Chrome
 * directory under ~/Library is never touched.
 *
 * The manifest points at a small wrapper script (test-only, created in the
 * temp directory, never shipped) that sets HOME to a throwaway directory and
 * records it before it execs the built host. The helper keeps its profile
 * under `$HOME/Library/Application Support/JobAnswerDrafter`, so with the
 * wrapper it can never reach the real home directory, whatever environment
 * Chromium passes on.
 */
async function registerHost(
  userDataDir: string,
  hostPath: string,
  home: string,
  fakeClaudeDir: string,
): Promise<void> {
  for (const p of [home, hostPath, fakeClaudeDir]) {
    if (p.includes("'")) throw new Error('unexpected quote in a temp path');
  }
  const wrapper = join(home, 'host-wrapper.sh');
  await writeFile(
    wrapper,
    [
      '#!/bin/sh',
      `HOME='${home}'`,
      'export HOME',
      // The only `claude` the helper can find is the test's fake: it is first
      // on PATH, PATH has nothing else that could hold a claude, and the
      // wrapper refuses to start without it. The helper's own search list is
      // fixed code with no override variable, so this PATH is the whole
      // mechanism (see the host's main.go).
      `PATH='${fakeClaudeDir}:/usr/bin:/bin'`,
      'export PATH',
      `[ -x '${join(fakeClaudeDir, 'claude')}' ] || exit 97`,
      `printf '%s' "$HOME" > '${join(home, HOME_PROBE_FILE)}'`,
      `exec '${hostPath}' "$@"`,
      '',
    ].join('\n'),
  );
  await chmod(wrapper, 0o755);
  const dir = join(userDataDir, 'NativeMessagingHosts');
  await mkdir(dir, { recursive: true });
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Job Answer Drafter test host',
    path: wrapper,
    type: 'stdio',
    allowed_origins: [EXTENSION_ORIGIN],
  };
  await writeFile(join(dir, `${NATIVE_HOST_NAME}.json`), JSON.stringify(manifest, null, 2));
}

/** The helper's data directory for a given (throwaway) home. */
export function helperDataDir(home: string): string {
  return join(home, 'Library', 'Application Support', 'JobAnswerDrafter');
}

interface Fixtures {
  context: BrowserContext;
  /** Register the built native host for this profile (default true). */
  installHost: boolean;
  /** Throwaway HOME the helper runs with; the real home is never used. */
  helperHome: string;
  serviceWorker: Worker;
  extensionId: string;
  /** Errors collected from the service worker console and page errors. */
  workerErrors: string[];
}

export const test = base.extend<Fixtures>({
  installHost: [true, { option: true }],
  // Playwright requires the first argument to be a destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  helperHome: async ({}, provide) => {
    const home = await mkdtemp(join(tmpdir(), 'jad-home-'));
    try {
      await provide(home);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
  context: async ({ browserName, installHost, helperHome }, provide) => {
    expect(browserName).toBe('chromium');
    const userDataDir = await mkdtemp(join(tmpdir(), 'jad-e2e-'));
    if (installHost) {
      await registerHost(
        userDataDir,
        await builtHostPath(),
        helperHome,
        await builtFakeClaudeDir(),
      );
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Bundled Chromium; `--headless=new` supports extensions (headed fallback not needed).
      headless: false,
      // Also start the browser itself with the throwaway HOME (the wrapper sets
      // it for the helper regardless).
      env: { ...process.env, HOME: helperHome },
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
