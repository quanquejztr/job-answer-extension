import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createFakeProfileClient,
  makeResume,
  makeRule,
  makeSample,
  makeStory,
} from '../../lib/profile/fake-profile-client';
import type { Profile } from '../../schemas/profile';
import { ERROR_CATALOG } from '../../schemas/error';
import { ProfileSettings } from './ProfileSettings';

// pdf.js is mocked here (jsdom cannot run it): the fake runtime serves the
// configured lines or error. The real pdf.js is covered by pdf-extract.test.ts
// (Node) and the Playwright test (Chromium).
const fakePdf = vi.hoisted(() => ({
  pages: [] as string[][],
  openError: null as string | null,
  opened: 0,
  destroyed: 0,
}));
vi.mock('../../lib/profile/pdf-runtime', () => ({
  loadBrowserPdfRuntime: async () => ({
    open: () => {
      fakePdf.opened++;
      const promise =
        fakePdf.openError === null
          ? Promise.resolve({
              numPages: fakePdf.pages.length,
              getPage: async (n: number) => ({
                getTextContent: async () => ({
                  items: (fakePdf.pages[n - 1] ?? []).map((str, i) => ({
                    str,
                    transform: [1, 0, 0, 1, 72, 720 - i * 16],
                    width: str.length * 6,
                    height: 12,
                    hasEOL: true,
                  })),
                }),
                cleanup: () => undefined,
              }),
            })
          : Promise.reject(Object.assign(new Error('x'), { name: fakePdf.openError }));
      promise.catch(() => undefined);
      return {
        promise,
        destroy: async () => {
          fakePdf.destroyed++;
        },
      };
    },
    dispose: () => undefined,
  }),
}));

async function setup(initial: Partial<Profile> = {}) {
  const fake = createFakeProfileClient(initial);
  const user = userEvent.setup();
  const view = render(<ProfileSettings client={fake.client} />);
  await screen.findByRole('button', { name: 'Save résumé' });
  return { fake, user, ...view };
}

const panel = () => screen.getByRole('tabpanel');
const tab = (name: string) => screen.getByRole('tab', { name });

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(tab(name));
}

/** Opens the Stories tab of a freshly set up page. */
async function setupStories(initial: Partial<Profile> = {}) {
  const r = await setup(initial);
  await openTab(r.user, 'Stories');
  return r;
}

describe('ProfileSettings: loading, empty, error', () => {
  it('shows loading text, then the empty résumé editor with one primary action', async () => {
    const fake = createFakeProfileClient();
    render(<ProfileSettings client={fake.client} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your profile…');
    await screen.findByRole('button', { name: 'Save résumé' });
    expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('');
    expect(panel()).toHaveTextContent('0 of 15000 characters');
    expect(within(panel()).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Résumé' })).toBeInTheDocument();
  });

  it('shows a load failure as an alert with the catalog text and a Retry that reloads', async () => {
    const fake = createFakeProfileClient({ resume: makeResume('Loaded after retry.') });
    fake.failNext('STORAGE_ERROR');
    const user = userEvent.setup();
    render(<ProfileSettings client={fake.client} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.STORAGE_ERROR.message);
    expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG.STORAGE_ERROR.userAction}.`);
    const release = fake.holdCalls();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading your profile…');
    release();
    expect(await screen.findByDisplayValue('Loaded after retry.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fake.callsOf('get')).toHaveLength(2);
  });

  it('keeps the Privacy tab readable when the profile cannot load', async () => {
    const fake = createFakeProfileClient();
    fake.failNext('HELPER_UNAVAILABLE');
    const user = userEvent.setup();
    render(<ProfileSettings client={fake.client} />);
    await screen.findByRole('alert');
    await user.click(tab('Privacy'));
    expect(panel()).toHaveTextContent('Your profile stays on this Mac.');
  });
});

describe('ProfileSettings: tabs', () => {
  it('has five tabs, one visible panel, and arrow, Home, and End keys', async () => {
    const { user } = await setup();
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Résumé', 'Stories', 'Writing samples', 'Writing rules', 'Privacy']);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(tab('Résumé')).toHaveAttribute('aria-selected', 'true');
    tab('Résumé').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Stories')).toHaveFocus();
    expect(tab('Stories')).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveAccessibleName('Stories');
    await user.keyboard('{End}');
    expect(tab('Privacy')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Résumé')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Privacy')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Résumé')).toHaveFocus();
    // Roving tabindex: only the selected tab is in the tab order.
    expect(tab('Stories')).toHaveAttribute('tabindex', '-1');
    expect(tab('Résumé')).toHaveAttribute('tabindex', '0');
  });

  it('keeps typed text and an open form when another tab is shown', async () => {
    const { user } = await setup();
    await user.type(screen.getByRole('textbox', { name: 'Résumé text' }), 'Half typed résumé');
    await openTab(user, 'Stories');
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Half typed story');
    await openTab(user, 'Privacy');
    await openTab(user, 'Stories');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Half typed story');
    await openTab(user, 'Résumé');
    expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue('Half typed résumé');
  });
});

describe('ProfileSettings: résumé', () => {
  it('saves only on Save, as pasted text, trimmed, and shows the counter and the result', async () => {
    const { fake, user } = await setup();
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    await user.click(text);
    await user.paste('  Built routing software in Go.  ');
    expect(panel()).toHaveTextContent('29 of 15000 characters');
    expect(fake.callsOf('resume')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toEqual([
      { type: 'resume', payload: { text: 'Built routing software in Go.', source: 'pasted' } },
    ]);
    expect(fake.profile.resume?.text).toBe('Built routing software in Go.');
  });

  it('shows the saved résumé when the page loads and replaces it on a second save', async () => {
    const { fake, user } = await setup({ resume: makeResume('Original résumé.') });
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    expect(text).toHaveValue('Original résumé.');
    await user.clear(text);
    await user.type(text, 'Replacement résumé.');
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await screen.findByText('Résumé saved.');
    expect(fake.profile.resume?.text).toBe('Replacement résumé.');
    expect(fake.callsOf('resume')).toHaveLength(1);
  });

  it('shows inline errors before sending: empty and over the limit, counting code points', async () => {
    const { fake, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    expect(text).toHaveAccessibleDescription(/Enter your résumé text\./);
    expect(text).toHaveAttribute('aria-invalid', 'true');
    expect(fake.callsOf('resume')).toHaveLength(0);

    await user.click(text);
    await user.paste('x'.repeat(15001));
    expect(text).toHaveAccessibleDescription(/15001 of 15000 characters/);
    expect(text).toHaveAccessibleDescription(
      /Shorten your résumé text to 15000 characters or fewer\. It is 15001 now\./,
    );
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    expect(fake.callsOf('resume')).toHaveLength(0);

    await user.clear(text);
    await user.click(text);
    await user.paste('😀'.repeat(15000));
    expect(text).toHaveAccessibleDescription(/15000 of 15000 characters/);
    expect(text).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a save that would push the profile over 40,000 characters, before sending', async () => {
    const { fake, user } = await setup({
      resume: makeResume('r'.repeat(10)),
      stories: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
        makeStory(n, { title: 't', text: 's'.repeat(3000) }),
      ),
      samples: [makeSample(10, { text: 'w'.repeat(3000) })],
      nextId: 11,
    });
    // Others: 9 x 3,001 + 3,000 = 30,009. A 9,992-character résumé lands on 40,001.
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    await user.clear(text);
    await user.click(text);
    await user.paste('r'.repeat(9992));
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    expect(text).toHaveAccessibleDescription(/over the 40000 limit/);
    expect(fake.callsOf('resume')).toHaveLength(0);
    await user.clear(text);
    await user.click(text);
    await user.paste('r'.repeat(9991)); // exactly 40,000
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toHaveLength(1);
  });

  it('shows a helper refusal as an alert, keeps the text, and lets the user retry', async () => {
    const { fake, user } = await setup();
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    await user.type(text, 'Kept after an error.');
    fake.failNext('INVALID_REQUEST');
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      `${ERROR_CATALOG.INVALID_REQUEST.message}Next step: Correct the input.`,
    );
    expect(text).toHaveValue('Kept after an error.');
    expect(screen.queryByText('Résumé saved.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await screen.findByText('Résumé saved.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends one request when Save is activated twice while one is in flight', async () => {
    const { fake, user } = await setup();
    await user.type(screen.getByRole('textbox', { name: 'Résumé text' }), 'Only once.');
    const release = fake.holdCalls();
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByText('Saving your résumé.')).toHaveAttribute('role', 'status');
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(fake.callsOf('resume')).toHaveLength(1);
    release();
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toHaveLength(1);
  });

  it('renders the saved résumé as text, never as HTML', async () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { container } = await setup({ resume: makeResume(html) });
    expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(html);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('is operable with the keyboard alone', async () => {
    const { fake, user } = await setup();
    screen.getByRole('textbox', { name: 'Résumé text' }).focus();
    await user.keyboard('A keyboard-only résumé.');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save résumé' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toHaveLength(1);
  });
});

describe('ProfileSettings: stories', () => {
  it('creates a story with counters, then edits it with the same id', async () => {
    const { fake, user } = await setupStories();
    expect(panel()).toHaveTextContent('No stories yet.');
    expect(panel()).toHaveTextContent('0 of 30 stories saved.');
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    expect(screen.getByRole('form', { name: 'Add a story' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Tags (optional)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Linked facts/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Club tool');
    expect(panel()).toHaveTextContent('9 of 100 characters');
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'We built it together.');
    expect(panel()).toHaveTextContent('21 of 3000 characters');
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    await screen.findByText('We built it together.');
    expect(fake.callsOf('upsert')[0]?.payload).toEqual({
      kind: 'story',
      item: { title: 'Club tool', text: 'We built it together.' },
    });
    expect(panel()).toHaveTextContent('1 of 30 stories saved.');
    expect(screen.getByRole('button', { name: 'Add story' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /^Edit story: Club tool/ }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Club tool');
    const story = screen.getByRole('textbox', { name: 'Story' });
    await user.clear(story);
    await user.type(story, 'Edited story.');
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    await screen.findByText('Edited story.');
    expect(fake.callsOf('upsert')[1]?.payload).toEqual({
      kind: 'story',
      item: { id: 's_1', title: 'Club tool', text: 'Edited story.' },
    });
    expect(screen.queryByText('We built it together.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit story: Club tool/ })).toHaveFocus();
  });

  it('validates title and text with live counters before sending', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveAccessibleDescription(/Enter a title\./);
    expect(title).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Story' })).toHaveAccessibleDescription(
      /Enter the story text\./,
    );
    expect(fake.callsOf('upsert')).toHaveLength(0);
    await user.type(title, 'T');
    const text = screen.getByRole('textbox', { name: 'Story' });
    await user.click(text);
    await user.paste('y'.repeat(3001));
    expect(text).toHaveAccessibleDescription(/3001 of 3000 characters/);
    expect(text).toHaveAccessibleDescription(
      /Shorten the story text to 3000 characters or fewer\./,
    );
    await user.clear(text);
    await user.click(text);
    await user.paste('😀'.repeat(3000));
    expect(text).toHaveAccessibleDescription(/3000 of 3000 characters/);
    expect(text).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('disables Add at the limit of 30, says why, and still allows editing', async () => {
    const stories = Array.from({ length: 30 }, (_, i) => makeStory(i + 1));
    await setupStories({ stories, nextId: 31 });
    const add = screen.getByRole('button', { name: 'Add story' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(/reached the limit of 30 stories/);
    expect(panel()).toHaveTextContent('30 of 30 stories saved.');
    expect(
      screen.getByRole('button', { name: /^Edit story: Made-up story 1(?!\d)/ }),
    ).toBeEnabled();
  });

  it('cancelling an edit changes nothing and restores focus', async () => {
    const { fake, user } = await setupStories({
      stories: [makeStory(1, { title: 'Keep me.' })],
      nextId: 2,
    });
    await user.click(screen.getByRole('button', { name: /^Edit story/ }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Keep me.')).toBeInTheDocument();
    expect(fake.callsOf('upsert')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Edit story/ })).toHaveFocus();
  });

  it('renders stored text as text, never as HTML', async () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { container } = await setupStories({
      stories: [makeStory(1, { title: html })],
      nextId: 2,
    });
    expect(screen.getAllByText(html).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('is operable with the keyboard alone and submits with Enter from the title', async () => {
    const { fake, user } = await setupStories();
    screen.getByRole('button', { name: 'Add story' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
    await user.keyboard('Keyboard story');
    await user.tab();
    await user.keyboard('Body of the story.');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save story' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByText('Body of the story.');
    expect(fake.callsOf('upsert')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'Second body.');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Via enter{Enter}');
    await screen.findByText('Second body.');
    expect(fake.callsOf('upsert')).toHaveLength(2);
  });
});

describe('ProfileSettings: delete confirmation', () => {
  const twoStories = {
    stories: [makeStory(1, { title: 'First story.' }), makeStory(2, { title: 'Second story.' })],
    nextId: 3,
  };

  it('names the item, cancels without changes, and returns focus to the Delete button', async () => {
    const { fake, user } = await setupStories(twoStories);
    const trigger = screen.getByRole('button', { name: /^Delete story: First story\./ });
    await user.click(trigger);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this story?' });
    expect(dialog).toHaveTextContent('First story.');
    expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
    // Focus starts on the safe choice, and Delete is a distinct, explicit button.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.callsOf('delete')).toHaveLength(0);
    expect(screen.getByText('First story.')).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape cancels the dialog', async () => {
    const { fake, user } = await setupStories(twoStories);
    await user.click(screen.getByRole('button', { name: /^Delete story: Second story\./ }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.callsOf('delete')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Delete story: Second story\./ })).toHaveFocus();
  });

  it('deletes only after the explicit Delete button and moves focus to the heading', async () => {
    const { fake, user } = await setupStories(twoStories);
    await user.click(screen.getByRole('button', { name: /^Delete story: First story\./ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('delete')).toEqual([
      { type: 'delete', payload: { kind: 'story', id: 's_1' } },
    ]);
    expect(screen.queryByText('First story.')).not.toBeInTheDocument();
    expect(screen.getByText('Second story.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Stories' })).toHaveFocus();
  });

  it('keeps the dialog open with an alert when the delete fails, and Cancel still works', async () => {
    const { fake, user } = await setupStories(twoStories);
    await user.click(screen.getByRole('button', { name: /^Delete story: First story\./ }));
    const dialog = await screen.findByRole('alertdialog');
    fake.failNext('STORAGE_ERROR');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.STORAGE_ERROR.message);
    expect(screen.queryByRole('alertdialog')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('First story.')).toBeInTheDocument();
  });

  it('sends one delete when Delete is activated twice', async () => {
    const { fake, user } = await setupStories({
      stories: [makeStory(1, { title: 'Gone once.' })],
      nextId: 2,
    });
    await user.click(screen.getByRole('button', { name: /^Delete story/ }));
    const dialog = await screen.findByRole('alertdialog');
    const release = fake.holdCalls();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    // The busy dialog cannot be dismissed.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('delete')).toHaveLength(1);
  });
});

describe('ProfileSettings: writing samples', () => {
  it('shows the remaining count, creates a sample, and edits it', async () => {
    const { fake, user } = await setup({ samples: [makeSample(1)], nextId: 2 });
    await openTab(user, 'Writing samples');
    expect(panel()).toHaveTextContent('1 of 5 writing samples saved. 4 remaining.');
    await user.click(screen.getByRole('button', { name: 'Add writing sample' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Cover note');
    expect(panel()).toHaveTextContent('10 of 60 characters');
    await user.type(screen.getByRole('textbox', { name: 'Sample text' }), 'Plain words.');
    expect(panel()).toHaveTextContent('12 of 3000 characters');
    await user.click(screen.getByRole('button', { name: 'Save writing sample' }));
    await screen.findByText('Plain words.');
    expect(fake.callsOf('upsert')[0]?.payload).toEqual({
      kind: 'sample',
      item: { label: 'Cover note', text: 'Plain words.' },
    });
    expect(panel()).toHaveTextContent('2 of 5 writing samples saved. 3 remaining.');
    await user.click(screen.getByRole('button', { name: /^Edit writing sample: Cover note/ }));
    const label = screen.getByRole('textbox', { name: 'Label' });
    await user.clear(label);
    await user.type(label, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save writing sample' }));
    await screen.findByText('Renamed');
    expect(fake.callsOf('upsert')[1]?.payload).toMatchObject({
      item: { id: 'w_2', label: 'Renamed' },
    });
  });

  it('disables Add at the limit of five, says why, and still allows editing and deleting', async () => {
    const { user } = await setup({
      samples: [1, 2, 3, 4, 5].map((n) => makeSample(n)),
      nextId: 6,
    });
    await openTab(user, 'Writing samples');
    const add = screen.getByRole('button', { name: 'Add writing sample' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(/reached the limit of 5 writing samples/);
    expect(panel()).toHaveTextContent('5 of 5 writing samples saved. 0 remaining.');
    expect(screen.getByRole('button', { name: /^Edit writing sample: Sample 1/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^Delete writing sample: Sample 5/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add writing sample' })).toBeEnabled(),
    );
  });
});

describe('ProfileSettings: writing rules', () => {
  it('creates a rule with a kind and the enabled switch, and explains length rules', async () => {
    const { fake, user } = await setup();
    await openTab(user, 'Writing rules');
    expect(panel()).toHaveTextContent(
      'numeric word limit for an answer comes from the draft’s own maximum',
    );
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const kind = screen.getByRole('combobox', { name: 'Kind' });
    expect(
      within(kind)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Length', 'Tone', 'Style', 'Avoid']);
    await user.selectOptions(kind, 'length');
    const text = screen.getByRole('textbox', { name: 'Rule' });
    expect(text).toHaveAccessibleDescription(/free text here and are not checked/);
    await user.type(text, 'Keep it brief.');
    expect(panel()).toHaveTextContent('14 of 200 characters');
    const enabled = screen.getByRole('switch', { name: 'Rule is enabled' });
    expect(enabled).toBeChecked();
    await user.click(enabled);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await screen.findByText('Keep it brief.');
    expect(fake.callsOf('upsert')[0]?.payload).toEqual({
      kind: 'rule',
      item: { kind: 'length', text: 'Keep it brief.', enabled: false },
    });
    expect(panel()).toHaveTextContent('Length: Keep it brief.');
    expect(panel()).toHaveTextContent('Disabled');
  });

  it('edits a rule and enforces the limit of twenty', async () => {
    const rules = Array.from({ length: 20 }, (_, i) => makeRule(i + 1));
    const { fake, user } = await setup({ rules, nextId: 21 });
    await openTab(user, 'Writing rules');
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    expect(panel()).toHaveTextContent('20 of 20 rules saved.');
    await user.click(screen.getByRole('button', { name: /^Edit rule: Made-up rule 3\./ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'avoid');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
    expect(fake.callsOf('upsert')[0]?.payload).toEqual({
      kind: 'rule',
      item: { id: 'r_3', kind: 'avoid', text: 'Made-up rule 3.', enabled: true },
    });
  });

  it('rejects an empty or over-long rule inline', async () => {
    const { fake, user } = await setup();
    await openTab(user, 'Writing rules');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(screen.getByRole('textbox', { name: 'Rule' })).toHaveAccessibleDescription(
      /Enter the rule text\./,
    );
    await user.click(screen.getByRole('textbox', { name: 'Rule' }));
    await user.paste('r'.repeat(201));
    expect(screen.getByRole('textbox', { name: 'Rule' })).toHaveAccessibleDescription(
      /201 of 200 characters/,
    );
    expect(fake.callsOf('upsert')).toHaveLength(0);
  });
});

describe('ProfileSettings: privacy', () => {
  it('explains local storage and what a draft may send, with no acceptance control', async () => {
    const { user } = await setup();
    await openTab(user, 'Privacy');
    const p = panel();
    expect(within(p).getByRole('heading', { level: 2, name: 'Privacy' })).toBeInTheDocument();
    expect(p).toHaveTextContent('Your profile stays on this Mac.');
    expect(p).toHaveTextContent(
      'the question, the job description, your whole résumé, all your stories, all your writing samples, and your enabled writing rules',
    );
    expect(p).toHaveTextContent('A résumé usually contains contact details');
    expect(p).toHaveTextContent(
      'Provider-side retention and training follow your account settings',
    );
    expect(p).toHaveTextContent('Anthropic: up to 5 years');
    expect(p).toHaveTextContent('up to 30 days');
    expect(p).toHaveTextContent('do not state a retention period for Codex');
    expect(p).toHaveTextContent(
      'flags for safety review can be kept longer (Anthropic: up to 2 years)',
    );
    expect(p).toHaveTextContent('turn off model training in your Claude privacy settings');
    expect(p).toHaveTextContent(
      'home address, phone number, visa status, health details, and other people’s names',
    );
    expect(within(p).queryByRole('checkbox')).not.toBeInTheDocument();
    // The only controls are the two Your data actions (Step 2.3); nothing accepts or gates.
    expect(
      within(p)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Export my data', 'Delete all data…']);
  });
});

describe('ProfileSettings: personal-detail warning (PRIV-008)', () => {
  it('warns by category, never shows the matched text, and Cancel returns to the form', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Contact story');
    await user.type(
      screen.getByRole('textbox', { name: 'Story' }),
      'Reach me at sam.example@example.com or 555-123-4567.',
    );
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This story may contain personal details',
    });
    expect(dialog).toHaveTextContent('an email address and a phone number');
    expect(dialog).toHaveTextContent('sent to the provider you choose');
    expect(dialog.textContent).not.toContain('sam.example@example.com');
    expect(dialog.textContent).not.toContain('555-123-4567');
    expect(fake.callsOf('upsert')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Back on the form, contents intact, focus on Save, nothing saved.
    expect(screen.getByRole('textbox', { name: 'Story' })).toHaveValue(
      'Reach me at sam.example@example.com or 555-123-4567.',
    );
    expect(screen.getByRole('button', { name: 'Save story' })).toHaveFocus();
    expect(fake.callsOf('upsert')).toHaveLength(0);
  });

  it('saves after Save anyway, and never blocks', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Home');
    await user.type(
      screen.getByRole('textbox', { name: 'Story' }),
      'Lived at 42 Maple Street once.',
    );
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('a street address');
    await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }));
    await screen.findByText('Lived at 42 Maple Street once.');
    expect(fake.callsOf('upsert')).toHaveLength(1);
  });

  it('warns on a résumé with contact details, saves nothing until Save anyway, and keeps the text', async () => {
    const { fake, user } = await setup();
    const text = screen.getByRole('textbox', { name: 'Résumé text' });
    const resume = 'Sam Example. sam.example@example.com. Built routing software in Go.';
    await user.click(text);
    await user.paste(resume);
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This résumé may contain personal details',
    });
    expect(dialog).toHaveTextContent('an email address');
    expect(dialog.textContent).not.toContain('sam.example@example.com');
    expect(fake.callsOf('resume')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(resume);
    expect(screen.getByRole('button', { name: 'Save résumé' })).toHaveFocus();
    expect(fake.callsOf('resume')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save anyway' }),
    );
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toEqual([
      { type: 'resume', payload: { text: resume, source: 'pasted' } },
    ]);
  });

  it('does not warn for a résumé without contact details', async () => {
    const { fake, user } = await setup();
    await user.click(screen.getByRole('textbox', { name: 'Résumé text' }));
    await user.paste('Built routing software in Go from 2019 to 2022.');
    await user.click(screen.getByRole('button', { name: 'Save résumé' }));
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toHaveLength(1);
  });

  it('applies to writing samples, but not to a clean text', async () => {
    const { fake, user } = await setup();
    await openTab(user, 'Writing samples');
    await user.click(screen.getByRole('button', { name: 'Add writing sample' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Note');
    await user.type(
      screen.getByRole('textbox', { name: 'Sample text' }),
      'Call +44 20 7946 0958 any time.',
    );
    await user.click(screen.getByRole('button', { name: 'Save writing sample' }));
    expect(
      await screen.findByRole('alertdialog', {
        name: 'This writing sample may contain personal details',
      }),
    ).toHaveTextContent('a phone number');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.callsOf('upsert')).toHaveLength(0);
    const text = screen.getByRole('textbox', { name: 'Sample text' });
    await user.clear(text);
    await user.type(text, 'Joined in 2021 and led 3 projects.');
    await user.click(screen.getByRole('button', { name: 'Save writing sample' }));
    await screen.findByText('Joined in 2021 and led 3 projects.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.callsOf('upsert')).toHaveLength(1);
  });
});

describe('ProfileSettings: errors and double submit', () => {
  it('shows a server refusal as an alert, keeps the form contents, and lets the user retry', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Kept title');
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'Kept after an error.');
    fake.failNext('STORAGE_ERROR');
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.STORAGE_ERROR.message);
    expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG.STORAGE_ERROR.userAction}.`);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Kept title');
    expect(screen.getByRole('textbox', { name: 'Story' })).toHaveValue('Kept after an error.');
    expect(screen.getByRole('button', { name: 'Save story' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    await screen.findByText('Kept after an error.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders INVALID_REQUEST from the helper with its catalog message', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Something');
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'Something.');
    fake.failNext('INVALID_REQUEST');
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${ERROR_CATALOG.INVALID_REQUEST.message}Next step: Correct the input.`,
    );
  });

  it('sends one request when Save is activated twice while one is in flight', async () => {
    const { fake, user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Once');
    await user.type(screen.getByRole('textbox', { name: 'Story' }), 'Only once.');
    const release = fake.holdCalls();
    await user.click(screen.getByRole('button', { name: 'Save story' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByText('Saving your changes.')).toHaveAttribute('role', 'status');
    // Enter in a field cannot start a second save either.
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '{Enter}');
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(fake.callsOf('upsert')).toHaveLength(1);
    release();
    await screen.findByText('Only once.');
    expect(fake.callsOf('upsert')).toHaveLength(1);
  });
});

describe('ProfileSettings: roles and labels', () => {
  it('gives every control a programmatic name and associates counters and hints', async () => {
    const { user } = await setupStories();
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    const story = screen.getByRole('textbox', { name: 'Story' });
    expect(story).toHaveAccessibleDescription(/A project or work story.*0 of 3000 characters/s);
    const form = screen.getByRole('form', { name: 'Add a story' });
    for (const control of within(form).getAllByRole('textbox')) {
      expect(control).toHaveAccessibleName();
    }
    expect(
      within(form)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Save story', 'Cancel']);
  });
});

describe('ProfileSettings: résumé upload (.docx)', () => {
  const docxFile = (bytes: BlobPart = 'PK\u0003\u0004 made-up bytes', name = 'cv.docx') =>
    new File([bytes], name, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  const picker = () => screen.getByLabelText('Upload résumé (.pdf or .docx)');
  const box = () => screen.getByRole('textbox', { name: 'Résumé text' });
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Save résumé' }));

  it('offers a picker for .pdf and .docx and no longer says PDF is pending', async () => {
    await setup();
    expect(picker()).toHaveAttribute('type', 'file');
    expect(picker()).toHaveAttribute('accept', expect.stringContaining('.docx'));
    expect(picker()).toHaveAttribute('accept', expect.stringContaining('.pdf'));
    expect(panel()).not.toHaveTextContent('pending');
    expect(panel()).toHaveTextContent('PDF files up to 5 MiB');
  });

  it('puts the extracted text in the box and saves nothing until Save, then saves as docx', async () => {
    const { fake, user } = await setup();
    fake.setImportText('Made-up Person\n- Built made-up things');
    await user.upload(picker(), docxFile());
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
    expect(fake.callsOf('import')).toHaveLength(1);
    const sent = fake.callsOf('import')[0]?.payload;
    expect(sent).toEqual({ bytesBase64: btoa('PK\u0003\u0004 made-up bytes') });
    expect(fake.callsOf('resume')).toHaveLength(0);
    expect(fake.profile.resume).toBeNull();
    expect(panel()).toHaveTextContent('Nothing is saved yet');
    await save(user);
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toEqual([
      {
        type: 'resume',
        payload: { text: 'Made-up Person\n- Built made-up things', source: 'docx' },
      },
    ]);
  });

  it('keeps source docx after the user edits the imported text, and resets it when the box is emptied', async () => {
    const { fake, user } = await setup();
    fake.setImportText('Imported résumé.');
    await user.upload(picker(), docxFile());
    await waitFor(() => expect(box()).toHaveValue('Imported résumé.'));
    await user.type(box(), ' Edited.');
    await save(user);
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')[0]?.payload).toEqual({
      text: 'Imported résumé. Edited.',
      source: 'docx',
    });
    await user.clear(box());
    await user.type(box(), 'Typed fresh.');
    await save(user);
    await waitFor(() => expect(fake.callsOf('resume')).toHaveLength(2));
    expect(fake.callsOf('resume')[1]?.payload).toEqual({ text: 'Typed fresh.', source: 'pasted' });
  });

  it('asks before replacing unsaved edits, and Keep leaves the box untouched', async () => {
    const { fake, user } = await setup();
    await user.type(box(), 'My unsaved typing');
    fake.setImportText('Uploaded text.');
    await user.upload(picker(), docxFile());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Replace the text in the box with the uploaded document?');
    expect(box()).toHaveValue('My unsaved typing');
    await user.click(screen.getByRole('button', { name: 'Keep my text' }));
    expect(box()).toHaveValue('My unsaved typing');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.upload(picker(), docxFile());
    await user.click(await screen.findByRole('button', { name: 'Replace with uploaded text' }));
    expect(box()).toHaveValue('Uploaded text.');
    expect(fake.callsOf('resume')).toHaveLength(0);
  });

  it('replaces the box without asking when it only holds the saved text', async () => {
    const { fake, user } = await setup({ resume: makeResume('Saved résumé.') });
    fake.setImportText('Uploaded text.');
    await user.upload(picker(), docxFile());
    await waitFor(() => expect(box()).toHaveValue('Uploaded text.'));
    expect(screen.queryByRole('button', { name: 'Keep my text' })).not.toBeInTheDocument();
    expect(fake.profile.resume?.text).toBe('Saved résumé.');
  });

  it('shows the paste fallback when the helper cannot read the document and leaves the box alone', async () => {
    const { fake, user } = await setup();
    await user.type(box(), 'Typed text');
    fake.failNext('INVALID_REQUEST');
    await user.upload(picker(), docxFile());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Paste your résumé text into the box instead.');
    expect(alert).toHaveTextContent('password-protected');
    expect(box()).toHaveValue('Typed text');
    expect(fake.callsOf('resume')).toHaveLength(0);
  });

  it('shows the catalog error plus the paste fallback when the helper is unavailable', async () => {
    const { fake, user } = await setup();
    fake.failNext('HELPER_UNAVAILABLE');
    await user.upload(picker(), docxFile());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.HELPER_UNAVAILABLE.message);
    expect(alert).toHaveTextContent('paste your résumé text');
  });

  it.each([
    ['too large', () => docxFile(new Uint8Array(190 * 1024 + 1)), 'too large to import'],
    ['far too large', () => docxFile(new Uint8Array(5 * 1024 * 1024 + 1)), 'too large to import'],
    ['empty', () => docxFile(''), 'file is empty'],
  ])('refuses %s without contacting the helper', async (_name, make, message) => {
    const { fake } = await setup();
    // fireEvent skips the picker's accept filter, as choosing "All files" does.
    fireEvent.change(picker(), { target: { files: [make()] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).toHaveTextContent('Paste your résumé text');
    expect(fake.callsOf('import')).toHaveLength(0);
    expect(box()).toHaveValue('');
  });

  it('accepts a file exactly at the size limit', async () => {
    const { fake, user } = await setup();
    await user.upload(picker(), docxFile(new Uint8Array(190 * 1024)));
    await waitFor(() => expect(fake.callsOf('import')).toHaveLength(1));
  });

  it('never shows the file name or the file content in the page', async () => {
    const { fake, user, container } = await setup();
    fake.setImportText('Made-up résumé text.');
    await user.upload(picker(), docxFile('PK\u0003\u0004 SECRETCONTENT', 'secret-name.docx'));
    await waitFor(() => expect(box()).toHaveValue('Made-up résumé text.'));
    expect(container.textContent).not.toContain('secret-name');
    expect(container.textContent).not.toContain('SECRETCONTENT');
    expect(JSON.stringify(fake.calls)).not.toContain('secret-name');
  });

  it('imports a document with unicode text and a long box without saving', async () => {
    const { fake, user } = await setup();
    fake.setImportText('Résumé — 東京大学 😀');
    await user.upload(picker(), docxFile());
    await waitFor(() => expect(box()).toHaveValue('Résumé — 東京大学 😀'));
    expect(fake.profile.resume).toBeNull();
  });
});

describe('ProfileSettings: résumé upload (.pdf)', () => {
  const pdfFile = (bytes: BlobPart = '%PDF-1.4 made-up', name = 'cv.pdf') =>
    new File([bytes], name, { type: 'application/pdf' });
  const picker = () => screen.getByLabelText('Upload résumé (.pdf or .docx)');
  const box = () => screen.getByRole('textbox', { name: 'Résumé text' });
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Save résumé' }));

  beforeEach(() => {
    fakePdf.pages = [['Made-up Person', '• Built made-up things']];
    fakePdf.openError = null;
    fakePdf.opened = 0;
    fakePdf.destroyed = 0;
  });

  it('puts the extracted text in the box, sends nothing to the helper, and saves as pdf only on Save', async () => {
    const { fake, user } = await setup();
    await user.upload(picker(), pdfFile());
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
    expect(fake.callsOf('import')).toHaveLength(0);
    expect(fake.callsOf('resume')).toHaveLength(0);
    expect(fake.profile.resume).toBeNull();
    expect(panel()).toHaveTextContent('Nothing is saved yet');
    expect(panel()).toHaveTextContent('Check the line order');
    expect(fakePdf.destroyed).toBe(1);
    await save(user);
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')).toEqual([
      {
        type: 'resume',
        payload: { text: 'Made-up Person\n- Built made-up things', source: 'pdf' },
      },
    ]);
  });

  it('keeps source pdf after edits, resets to pasted when the box is emptied', async () => {
    const { fake, user } = await setup();
    await user.upload(picker(), pdfFile());
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
    await user.type(box(), ' Edited.');
    await save(user);
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')[0]?.payload).toMatchObject({ source: 'pdf' });
    await user.clear(box());
    await user.type(box(), 'Typed fresh.');
    await save(user);
    await waitFor(() => expect(fake.callsOf('resume')).toHaveLength(2));
    expect(fake.callsOf('resume')[1]?.payload).toEqual({ text: 'Typed fresh.', source: 'pasted' });
  });

  it('routes a PDF by its bytes even when the type is missing', async () => {
    await setup();
    // fireEvent skips the picker's accept filter, as choosing "All files" does.
    fireEvent.change(picker(), { target: { files: [new File(['%PDF-1.4 made-up'], 'cv.bin')] } });
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
  });

  it('asks before replacing unsaved edits, and Keep leaves the box untouched', async () => {
    const { fake, user } = await setup();
    await user.type(box(), 'My unsaved typing');
    await user.upload(picker(), pdfFile());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Replace the text in the box with the uploaded document?');
    expect(box()).toHaveValue('My unsaved typing');
    await user.click(screen.getByRole('button', { name: 'Keep my text' }));
    expect(box()).toHaveValue('My unsaved typing');
    await user.upload(picker(), pdfFile());
    await user.click(await screen.findByRole('button', { name: 'Replace with uploaded text' }));
    expect(box()).toHaveValue('Made-up Person\n- Built made-up things');
    expect(fake.callsOf('resume')).toHaveLength(0);
    await save(user);
    await screen.findByText('Résumé saved.');
    expect(fake.callsOf('resume')[0]?.payload).toMatchObject({ source: 'pdf' });
  });

  it('replaces the box without asking when it only holds the saved text', async () => {
    const { fake, user } = await setup({ resume: makeResume('Saved résumé.') });
    await user.upload(picker(), pdfFile());
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
    expect(screen.queryByRole('button', { name: 'Keep my text' })).not.toBeInTheDocument();
    expect(fake.profile.resume?.text).toBe('Saved résumé.');
  });

  it.each([
    [
      'a scan with no text',
      () => (fakePdf.pages = [[], []]),
      'no selectable text (it may be a scan)',
    ],
    [
      'a password-protected file',
      () => (fakePdf.openError = 'PasswordException'),
      'password-protected',
    ],
    ['a damaged file', () => (fakePdf.openError = 'InvalidPDFException'), 'could not be read'],
    [
      'too many pages',
      () => (fakePdf.pages = Array.from({ length: 11 }, () => ['x'])),
      'more than 10 pages',
    ],
  ])(
    'refuses %s with the paste fallback and leaves the box alone',
    async (_n, arrange, message) => {
      const { fake, user } = await setup();
      await user.type(box(), 'Typed text');
      arrange();
      await user.upload(picker(), pdfFile());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).toHaveTextContent(/paste your résumé text/i);
      expect(box()).toHaveValue('Typed text');
      expect(fake.callsOf('import')).toHaveLength(0);
      expect(fake.callsOf('resume')).toHaveLength(0);
    },
  );

  it('refuses an oversize PDF before reading it', async () => {
    const { user } = await setup();
    fireEvent.change(picker(), {
      target: { files: [pdfFile(new Uint8Array(5 * 1024 * 1024 + 1))] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('too large to import');
    expect(fakePdf.opened).toBe(0);
    expect(box()).toHaveValue('');
    expect(user).toBeDefined();
  });

  it('shows text over the 15,000 limit with the limit error so the user can trim it', async () => {
    fakePdf.pages = [['x'.repeat(15001)]];
    const { fake, user } = await setup();
    await user.upload(picker(), pdfFile());
    await waitFor(() => expect(box()).toHaveValue('x'.repeat(15001)));
    expect(panel()).toHaveTextContent('15001 of 15000 characters');
    expect(box()).toBeInvalid();
    await save(user);
    expect(fake.callsOf('resume')).toHaveLength(0);
  });

  it('never shows the file name or file content in the page', async () => {
    const { user, container } = await setup();
    await user.upload(picker(), pdfFile('%PDF-1.4 SECRETCONTENT', 'secret-name.pdf'));
    await waitFor(() => expect(box()).toHaveValue('Made-up Person\n- Built made-up things'));
    expect(container.textContent).not.toContain('secret-name');
    expect(container.textContent).not.toContain('SECRETCONTENT');
  });
});
