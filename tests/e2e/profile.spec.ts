import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { makePdf, simplePdf } from '../support/make-pdf';
import { makeDocx, makeZip } from './docx';
import { EXTENSION_PATH, HOME_PROBE_FILE, expect, helperDataDir, test } from './fixtures';

// Settings page against the real worker and the real Go helper. The helper runs
// through a test-only wrapper with a throwaway HOME (see fixtures.ts), so its
// profile lives in a temp directory and never in the real Application Support.
// All text below is made up.

const RESUME = 'Built a small budgeting tool for a student club.';
const RESUME_EDITED = 'Built a small budgeting tool for a student club in Go.';

async function openOptions(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

/**
 * Proves, before anything is written, that the helper's HOME is the throwaway
 * directory: the wrapper recorded it when the helper started for the first
 * profile.get, and the data directory it implies is under the temp directory
 * and not under the real home.
 */
async function assertHelperIsIsolated(home: string): Promise<void> {
  const probe = await readFile(join(home, HOME_PROBE_FILE), 'utf8');
  expect(probe).toBe(home);
  expect(helperDataDir(probe).startsWith(tmpdir())).toBe(true);
  expect(helperDataDir(probe).startsWith(homedir())).toBe(false);
  // Nothing has been written yet: a read creates no directory.
  await expect(stat(helperDataDir(probe))).rejects.toMatchObject({ code: 'ENOENT' });
}

test.describe('settings with a helper whose home is a temp directory', () => {
  test('save and replace the résumé, add, edit, and delete a story, all persisted', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('');
    await assertHelperIsIsolated(helperHome);

    // Résumé: nothing is saved until Save; an empty one is refused inline.
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Enter your résumé text.')).toBeVisible();
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    await page.getByRole('textbox', { name: 'Résumé text' }).fill(`  ${RESUME}  `);
    await expect(page.getByText(`${RESUME.length} of 15000 characters`)).toBeVisible();
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();

    // The helper wrote an owner-only v2 file under the throwaway home.
    const file = join(helperDataDir(helperHome), 'profile.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(helperDataDir(helperHome))).mode & 0o777).toBe(0o700);
    type Stored = {
      schemaVersion: number;
      nextId: number;
      resume: { text: string; source: string } | null;
      stories: { id: string; title: string; text: string }[];
    };
    const stored = JSON.parse(await readFile(file, 'utf8')) as Stored;
    expect(stored.schemaVersion).toBe(2);
    expect(stored.resume).toMatchObject({ text: RESUME, source: 'pasted' });
    expect(stored.stories).toEqual([]);

    // Persisted: a fresh page load shows it, and a replacement overwrites it.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(RESUME);
    await page.getByRole('textbox', { name: 'Résumé text' }).fill(RESUME_EDITED);
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(RESUME_EDITED);

    // A story: IDs come from the shared counter, so the first story is s_1.
    await page.getByRole('tab', { name: 'Stories' }).click();
    await expect(page.getByText('No stories yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Add story' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Club budgeting tool');
    await page
      .getByRole('textbox', { name: 'Story', exact: true })
      .fill('We tracked club spending together.');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('We tracked club spending together.')).toBeVisible();
    await expect(page.getByText('1 of 30 stories saved.')).toBeVisible();
    const withStory = JSON.parse(await readFile(file, 'utf8')) as Stored;
    expect(withStory.stories).toMatchObject([{ id: 's_1', title: 'Club budgeting tool' }]);

    // Edit keeps the same id.
    await page.getByRole('button', { name: /^Edit story: Club budgeting tool/ }).click();
    await page.getByRole('textbox', { name: 'Story', exact: true }).fill('Edited story text.');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('Edited story text.')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Stories' }).click();
    await expect(page.getByText('Edited story text.')).toBeVisible();
    expect((JSON.parse(await readFile(file, 'utf8')) as Stored).stories.map((s) => s.id)).toEqual([
      's_1',
    ]);

    // Delete needs confirmation: Cancel and Escape change nothing.
    const deleteButton = page.getByRole('button', { name: /^Delete story: Club budgeting tool/ });
    await deleteButton.click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete this story?' });
    await expect(dialog).toContainText('Club budgeting tool');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Edited story text.')).toBeVisible();
    // Confirmed delete.
    await deleteButton.click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Edited story text.')).toHaveCount(0);
    await expect(page.getByText('No stories yet.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Stories' })).toBeFocused();
    const after = JSON.parse(await readFile(file, 'utf8')) as Stored;
    expect(after.stories).toEqual([]);
    expect(after.resume?.text).toBe(RESUME_EDITED);
    // The deleted ID is never reused: the next story is s_2.
    await page.getByRole('button', { name: 'Add story' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Second');
    await page.getByRole('textbox', { name: 'Story', exact: true }).fill('Second story body.');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('1 of 30 stories saved.')).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(0);
    expect((JSON.parse(await readFile(file, 'utf8')) as Stored).stories.map((s) => s.id)).toEqual([
      's_2',
    ]);
    expect(workerErrors).toEqual([]);
  });

  test('imports a synthetic .docx into the box, saves nothing until Save, then export and delete all cover it', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    const picker = page.getByLabel('Upload résumé (.pdf or .docx)');
    await expect(page.getByText('PDF support is pending')).toHaveCount(0);

    await picker.setInputFiles({
      name: 'made-up-resume.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: makeDocx([
        'Made-up Person',
        'Résumé 東京 — Zoë 😀',
        '- Built a small budgeting tool for a student club.',
        '- Ran the club newsletter.',
      ]),
    });
    await expect(box).toHaveValue(
      'Made-up Person\nRésumé 東京 — Zoë 😀\n- Built a small budgeting tool for a student club.\n- Ran the club newsletter.',
    );
    await expect(page.getByText('Nothing is saved yet')).toBeVisible();
    await expect(page.getByText('made-up-resume')).toHaveCount(0);
    // Import wrote nothing: the helper's data directory still does not exist.
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });

    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    const file = join(helperDataDir(helperHome), 'profile.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      resume: { text: string; source: string };
    };
    expect(stored.resume.source).toBe('docx');
    expect(stored.resume.text).toContain('Ran the club newsletter.');
    await page.reload();
    await expect(box).toHaveValue(stored.resume.text);

    // Export carries the saved résumé and its source; delete all removes it.
    await page.getByRole('tab', { name: 'Privacy' }).click();
    const section = page.getByRole('region', { name: 'Your data' });
    const downloadPromise = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Export my data' }).click();
    const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8')) as {
      resume: { text: string; source: string };
    };
    expect(exported.resume).toMatchObject({ source: 'docx', text: stored.resume.text });
    await section.getByRole('button', { name: 'Delete all data…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all data?' });
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete all data' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readdir(helperDataDir(helperHome))).sort()).toEqual(['.profile.lock']);
    expect(workerErrors).toEqual([]);
  });

  test('a document the helper cannot read shows the paste fallback and saves nothing', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    const picker = page.getByLabel('Upload résumé (.pdf or .docx)');
    const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const bad = [
      { name: 'a.docx', buffer: Buffer.from('this is plain text, not a document') },
      { name: 'b.docx', buffer: makeZip({ 'readme.txt': 'a zip that is not a Word file' }) },
      { name: 'c.docx', buffer: makeDocx(['   ']) },
      { name: 'd.docx', buffer: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64)]) },
    ];
    for (const { name, buffer } of bad) {
      await picker.setInputFiles({ name, mimeType: wordType, buffer });
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('Paste your résumé text into the box instead.');
      await expect(box).toHaveValue('');
      await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    // Over the size limit: refused in the page before anything is sent.
    await picker.setInputFiles({
      name: 'big.docx',
      mimeType: wordType,
      buffer: Buffer.alloc(190 * 1024 + 1),
    });
    await expect(page.getByRole('alert')).toContainText('too large to import');
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(workerErrors).toEqual([]);
  });

  test('imports a synthetic PDF in the page, saves nothing until Save, then export and delete all cover it', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const page = await context.newPage();
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(`chrome-extension://${extensionId}/`) && !url.startsWith('data:')) {
        outside.push(url);
      }
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    const picker = page.getByLabel('Upload résumé (.pdf or .docx)');

    await picker.setInputFiles({
      name: 'made-up-resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        simplePdf([
          'Made-up Person',
          'Résumé — Zoë’s “notes”',
          '• Built a small budgeting tool for a student club.',
          '• Ran the club newsletter.',
        ]),
      ),
    });
    await expect(box).toHaveValue(
      'Made-up Person\nRésumé — Zoë’s “notes”\n- Built a small budgeting tool for a student club.\n- Ran the club newsletter.',
    );
    await expect(page.getByText('Nothing is saved yet')).toBeVisible();
    await expect(page.getByText('made-up-resume')).toHaveCount(0);
    // Reading the PDF wrote nothing and made no request outside the extension.
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(outside).toEqual([]);

    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    const file = join(helperDataDir(helperHome), 'profile.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      resume: { text: string; source: string };
    };
    expect(stored.resume.source).toBe('pdf');
    expect(stored.resume.text).toContain('- Ran the club newsletter.');
    await page.reload();
    await expect(box).toHaveValue(stored.resume.text);

    await page.getByRole('tab', { name: 'Privacy' }).click();
    const section = page.getByRole('region', { name: 'Your data' });
    const downloadPromise = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Export my data' }).click();
    const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8')) as {
      resume: { text: string; source: string };
    };
    expect(exported.resume).toMatchObject({ source: 'pdf', text: stored.resume.text });
    await section.getByRole('button', { name: 'Delete all data…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all data?' });
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete all data' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readdir(helperDataDir(helperHome))).sort()).toEqual(['.profile.lock']);
    expect(pageErrors).toEqual([]);
    expect(workerErrors).toEqual([]);
  });

  test('a PDF with a JavaScript action is read as text and the script never runs', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    await page.getByLabel('Upload résumé (.pdf or .docx)').setInputFiles({
      name: 'js.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(simplePdf(['Harmless made-up text'], { javascript: true })),
    });
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(
      'Harmless made-up text',
    );
    expect(
      await page.evaluate(() => (globalThis as { __pdfScriptRan?: unknown }).__pdfScriptRan),
    ).toBe(undefined);
    expect(dialogs).toEqual([]);
  });

  test('PDFs that cannot be read show the paste fallback and save nothing', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    const picker = page.getByLabel('Upload résumé (.pdf or .docx)');
    const manyPages = makePdf(
      Array.from({ length: 11 }, (_, i) => ({ texts: [{ x: 72, y: 700, text: `Page ${i + 1}` }] })),
    );
    const cases: Array<{ name: string; buffer: Buffer; message: string }> = [
      {
        name: 'scan.pdf',
        buffer: Buffer.from(makePdf([{ texts: [] }])),
        message:
          'This PDF has no selectable text (it may be a scan). Paste your résumé text instead.',
      },
      {
        name: 'locked.pdf',
        buffer: Buffer.from(simplePdf(['Hidden'], { encrypt: true })),
        message: 'password-protected or encrypted',
      },
      {
        name: 'broken.pdf',
        buffer: Buffer.from('%PDF-1.4\nthis is not a real document'),
        message: 'could not be read',
      },
      { name: 'long.pdf', buffer: Buffer.from(manyPages), message: 'more than 10 pages' },
      {
        name: 'big.pdf',
        buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]),
        message: 'too large to import',
      },
    ];
    for (const { name, buffer, message } of cases) {
      await picker.setInputFiles({ name, mimeType: 'application/pdf', buffer });
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('alert')).toContainText(/paste your résumé text/i);
      await expect(box).toHaveValue('');
      await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(workerErrors).toEqual([]);
  });

  test('a résumé that would push the profile over 40,000 characters is refused and nothing is written', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    // Fill the profile through the real helper: nine 3,000-character stories,
    // then a résumé that fits only up to the cap.
    await page.getByRole('tab', { name: 'Stories' }).click();
    for (let i = 1; i <= 9; i++) {
      await page.getByRole('button', { name: 'Add story' }).click();
      await page.getByRole('textbox', { name: 'Title' }).fill('t');
      await page.getByRole('textbox', { name: 'Story', exact: true }).fill('s'.repeat(3000));
      await page.getByRole('button', { name: 'Save story' }).click();
      await expect(page.getByText(`${i} of 30 stories saved.`)).toBeVisible();
    }
    // 9 x 3,001 = 27,009 used; a 12,992-character résumé is exactly 40,001.
    await page.getByRole('tab', { name: 'Résumé' }).click();
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    await box.fill('r'.repeat(12992));
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText(/over the 40000 limit/)).toBeVisible();
    const file = join(helperDataDir(helperHome), 'profile.json');
    const before = await readFile(file, 'utf8');
    expect((JSON.parse(before) as { resume: unknown }).resume).toBeNull();
    // One character less is exactly the cap and is saved.
    await box.fill('r'.repeat(12991));
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    expect(
      (JSON.parse(await readFile(file, 'utf8')) as { resume: { text: string } }).resume.text,
    ).toHaveLength(12991);
  });

  test('a résumé over 15,000 characters is refused, and contact details only warn before Save anyway', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    const box = page.getByRole('textbox', { name: 'Résumé text' });
    await box.fill('r'.repeat(15001));
    await expect(page.getByText('15001 of 15000 characters')).toBeVisible();
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(
      page.getByText(/Shorten your résumé text to 15000 characters or fewer/),
    ).toBeVisible();
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    // Typed text survives the error; contact details raise a warning, not a block.
    const withEmail = `${RESUME} Contact: sam.example@example.com`;
    await box.fill(withEmail);
    await page.getByRole('button', { name: 'Save résumé' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'This résumé may contain personal details',
    });
    await expect(dialog).toContainText('an email address');
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveValue(withEmail);
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    const file = join(helperDataDir(helperHome), 'profile.json');
    expect(
      (JSON.parse(await readFile(file, 'utf8')) as { resume: { text: string } }).resume.text,
    ).toBe(withEmail);
  });

  test('a version 1 profile file is rejected, left untouched, and delete all clears it', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const dataDir = helperDataDir(helperHome);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const v1 =
      '{"schemaVersion":1,"nextId":2,"settings":{},"facts":[{"id":"f_1","text":"Made-up old fact.","source":"user","verified":true,"tags":[],"createdAt":"2026-11-20T10:00:00Z","updatedAt":"2026-11-20T10:00:00Z"}],"stories":[],"samples":[],"rules":[]}';
    await writeFile(join(dataDir, 'profile.json'), v1, { mode: 0o600 });
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('alert')).toContainText('The profile could not be read or saved.');
    expect(await readFile(join(dataDir, 'profile.json'), 'utf8')).toBe(v1);
    await page.getByRole('tab', { name: 'Privacy' }).click();
    const section = page.getByRole('region', { name: 'Your data' });
    await section.getByRole('button', { name: 'Delete all data…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all data?' });
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete all data' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await readdir(dataDir)).sort()).toEqual(['.profile.lock']);
    await page.getByRole('tab', { name: 'Résumé' }).click();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('');
  });

  test('warns about an email address before saving a story, and saves only on Save anyway', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible();
    await assertHelperIsIsolated(helperHome);
    await page.getByRole('tab', { name: 'Stories' }).click();
    await page.getByRole('button', { name: 'Add story' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Club contact');
    await page
      .getByRole('textbox', { name: 'Story', exact: true })
      .fill('Contact for the club project: sam.example@example.com');
    await page.getByRole('button', { name: 'Save story' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'This story may contain personal details',
    });
    await expect(dialog).toContainText('an email address');
    await expect(dialog).not.toContainText('sam.example@example.com');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Save story' })).toBeFocused();
    await page.reload();
    await page.getByRole('tab', { name: 'Stories' }).click();
    await expect(page.getByText('No stories yet.')).toBeVisible();
    // Nothing was stored by Cancel.
    await expect(stat(helperDataDir(helperHome))).rejects.toMatchObject({ code: 'ENOENT' });

    await page.getByRole('button', { name: 'Add story' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Club contact');
    await page
      .getByRole('textbox', { name: 'Story', exact: true })
      .fill('Contact for the club project: sam.example@example.com');
    await page.getByRole('button', { name: 'Save story' }).click();
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(page.getByText('Contact for the club project:', { exact: false })).toBeVisible();
  });

  test('samples and rules respect their limits through the real helper', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.getByRole('tab', { name: 'Writing samples' }).click();
    for (let i = 1; i <= 5; i++) {
      await page.getByRole('button', { name: 'Add writing sample' }).click();
      await page.getByRole('textbox', { name: 'Label' }).fill(`Sample ${i}`);
      await page.getByRole('textbox', { name: 'Sample text' }).fill(`Made-up sample text ${i}.`);
      await page.getByRole('button', { name: 'Save writing sample' }).click();
      await expect(page.getByText(`${i} of 5 writing samples saved.`)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add writing sample' })).toBeDisabled();
    await expect(page.getByText('You have reached the limit of 5 writing samples.')).toBeVisible();
    await page.getByRole('tab', { name: 'Writing rules' }).click();
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('combobox', { name: 'Kind' }).selectOption('avoid');
    await page.getByRole('textbox', { name: 'Rule' }).fill('No buzzwords.');
    await page.getByRole('switch', { name: 'Rule is enabled' }).uncheck();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByText('Avoid: No buzzwords.')).toBeVisible();
    await expect(page.getByText('Disabled')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Writing samples' }).click();
    await expect(page.getByText('5 of 5 writing samples saved.')).toBeVisible();
    await page.getByRole('tab', { name: 'Writing rules' }).click();
    await expect(page.getByText('Avoid: No buzzwords.')).toBeVisible();
  });
});

/** Names (never contents) in the real app-data directory, or null when it does not exist. */
async function realDataDirNames(): Promise<string[] | null> {
  const dir = join(homedir(), 'Library', 'Application Support', 'JobAnswerDrafter');
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function localDateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test.describe('your data: export and delete all', () => {
  test('exports the profile as a file, then deletes everything after the typed confirmation', async ({
    context,
    extensionId,
    helperHome,
    workerErrors,
  }) => {
    const realBefore = await realDataDirNames();
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('button', { name: 'Save résumé' })).toBeVisible(); // the helper has answered
    await assertHelperIsIsolated(helperHome);

    // Add a résumé and a story (made-up text).
    await page.getByRole('textbox', { name: 'Résumé text' }).fill(RESUME);
    await page.getByRole('button', { name: 'Save résumé' }).click();
    await expect(page.getByText('Résumé saved.')).toBeVisible();
    await page.getByRole('tab', { name: 'Stories' }).click();
    await page.getByRole('button', { name: 'Add story' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Club budgeting tool');
    await page
      .getByRole('textbox', { name: 'Story', exact: true })
      .fill('We tracked club spending together.');
    await page.getByRole('button', { name: 'Save story' }).click();
    await expect(page.getByText('1 of 30 stories saved.')).toBeVisible();

    const dataDir = helperDataDir(helperHome);
    const storedText = await readFile(join(dataDir, 'profile.json'), 'utf8');

    // Export happens only on the click: opening the tab downloads nothing.
    await page.getByRole('tab', { name: 'Privacy' }).click();
    const section = page.getByRole('region', { name: 'Your data' });
    await expect(section).toContainText('full profile in readable form');
    const downloadPromise = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Export my data' }).click();
    const download = await downloadPromise;
    const expectedName = `job-answer-profile-${localDateStamp(new Date())}.json`;
    expect(download.suggestedFilename()).toBe(expectedName);
    await expect(section.getByRole('status')).toContainText(`Exported: ${expectedName}`);
    const downloadedPath = await download.path();
    const exported = JSON.parse(await readFile(downloadedPath, 'utf8')) as {
      schemaVersion: number;
      resume: { text: string; source: string } | null;
      stories: { id: string; title: string; text: string }[];
      samples: unknown[];
      rules: unknown[];
    };
    expect(exported.schemaVersion).toBe(2);
    expect(exported).not.toHaveProperty('facts');
    expect(exported.resume).toMatchObject({ text: RESUME, source: 'pasted' });
    expect(exported.stories).toMatchObject([
      {
        id: 's_1',
        title: 'Club budgeting tool',
        text: 'We tracked club spending together.',
      },
    ]);
    expect(exported.samples).toEqual([]);
    expect(exported.rules).toEqual([]);
    // The export is the stored profile, and exporting changed nothing on disk.
    expect(exported).toEqual(JSON.parse(storedText));
    expect(await readFile(join(dataDir, 'profile.json'), 'utf8')).toBe(storedText);

    // Delete all: the confirm button needs the exact word.
    await section.getByRole('button', { name: 'Delete all data…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all data?' });
    await expect(dialog).toContainText('This does not remove');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    const confirm = dialog.getByRole('button', { name: 'Delete all data' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('delete');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await expect(confirm).toBeEnabled();

    // Things the helper must not touch, and a leftover temp file it must remove.
    await mkdir(join(dataDir, 'bin'), { recursive: true });
    await writeFile(join(dataDir, 'bin', 'marker'), 'keep');
    await writeFile(join(dataDir, '.profile.json.tmp-left'), 'leftover');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(section.getByRole('status').last()).toContainText(
      'All data stored by this app on this Mac was deleted.',
    );

    // The lists are empty after a reload.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('');
    await page.getByRole('tab', { name: 'Stories' }).click();
    await expect(page.getByText('No stories yet.')).toBeVisible();

    // On disk: no profile, no temp files, no content anywhere; the empty lock
    // file, bin/, and nothing else remain.
    expect((await readdir(dataDir)).sort()).toEqual(['.profile.lock', 'bin']);
    expect(await readFile(join(dataDir, 'bin', 'marker'), 'utf8')).toBe('keep');
    expect((await stat(join(dataDir, '.profile.lock'))).size).toBe(0);

    // The real home was never touched (directory names only, before and after).
    expect(await realDataDirNames()).toEqual(realBefore);
    expect(workerErrors).toEqual([]);
  });

  test('delete all removes an unreadable profile and the lists load again', async ({
    context,
    extensionId,
    helperHome,
  }) => {
    const dataDir = helperDataDir(helperHome);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(join(dataDir, 'profile.json'), '{"schemaVersion":', { mode: 0o600 });
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.getByRole('alert')).toContainText('The profile could not be read or saved.');
    await page.getByRole('tab', { name: 'Privacy' }).click();
    const section = page.getByRole('region', { name: 'Your data' });
    await section.getByRole('button', { name: 'Delete all data…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all data?' });
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete all data' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('tab', { name: 'Résumé' }).click();
    await expect(page.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('');
    expect((await readdir(dataDir)).sort()).toEqual(['.profile.lock']);
  });
});

test.describe('with no host registered', () => {
  test.use({ installHost: false });

  test('shows the typed helper-unavailable error with Retry, and the Privacy tab still works', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The native helper is unavailable.');
    await expect(alert).toContainText('Run the installer, then retry');
    // The provider settings section reports its own load failure as a status.
    await expect(page.getByText(/Provider settings could not be loaded/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(alert).toContainText('The native helper is unavailable.');
    await page.getByRole('tab', { name: 'Privacy' }).click();
    await expect(
      page.getByText('Your profile stays on this Mac.', { exact: false }).first(),
    ).toBeVisible();
  });
});

test('the built content script contains no profile code or message names (AC-050)', async () => {
  const content = await readFile(join(EXTENSION_PATH, 'content-scripts/content.js'), 'utf8');
  for (const needle of [
    'settings.profile',
    'profile.get',
    'profile.item',
    'profile.resume',
    'factIds',
    'Verified',
  ]) {
    expect(content).not.toContain(needle);
  }
});
