import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  createFakeProfileClient,
  makeResume,
  makeStory,
} from '../../lib/profile/fake-profile-client';
import { ERROR_CATALOG } from '../../schemas/error';
import type { Profile } from '../../schemas/profile';
import { ProfileSettings } from './ProfileSettings';
import type { SaveExport } from './YourDataSection';

async function setup(initial: Partial<Profile> = {}, saveExport?: SaveExport) {
  const fake = createFakeProfileClient(initial);
  const save = vi.fn<SaveExport>(saveExport ?? (() => 'job-answer-profile-2026-11-20.json'));
  const user = userEvent.setup();
  render(<ProfileSettings client={fake.client} saveExport={save} />);
  await screen.findByRole('button', { name: 'Save résumé' });
  await user.click(screen.getByRole('tab', { name: 'Privacy' }));
  return { fake, save, user };
}

const trigger = () => screen.getByRole('button', { name: 'Delete all data…' });
const dialog = () => screen.getByRole('alertdialog');
const confirmButton = () => within(dialog()).getByRole('button', { name: 'Delete all data' });
const cancelButton = () => within(dialog()).getByRole('button', { name: 'Cancel' });
const typedBox = () => within(dialog()).getByRole('textbox', { name: 'Type DELETE to confirm' });

const FACTS = { nextId: 3, resume: makeResume('Made-up résumé one.'), stories: [makeStory(2)] };

describe('Your data: export', () => {
  it('exports only on the click, saves the full profile, and shows the file name', async () => {
    const { fake, save, user } = await setup(FACTS);
    expect(fake.callsOf('export')).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Exported: job-answer-profile-2026-11-20.json',
    );
    expect(fake.callsOf('export')).toHaveLength(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toEqual(fake.profile);
  });

  it('warns in plain text that the file holds the full profile readably and should be kept private', async () => {
    await setup();
    const section = screen.getByRole('region', { name: 'Your data' });
    expect(section).toHaveTextContent('full profile in readable form');
    expect(section).toHaveTextContent('not encrypted');
    expect(section).toHaveTextContent('store it privately');
  });

  it('shows a failure as an alert with the catalog message and next step, and saves nothing', async () => {
    const { fake, save, user } = await setup(FACTS);
    fake.failNext('STORAGE_ERROR');
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.STORAGE_ERROR.message);
    expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG.STORAGE_ERROR.userAction}.`);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Exported/)).not.toBeInTheDocument();
    // Try again works and clears the alert.
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Exported:');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a browser that refuses the download without detail', async () => {
    const { user } = await setup(FACTS, () => {
      throw new Error('SECRET-INTERNALS');
    });
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The file could not be saved.');
    expect(alert).not.toHaveTextContent('SECRET-INTERNALS');
  });

  it('exports once when the button is activated twice while one is in flight', async () => {
    const { fake, user } = await setup(FACTS);
    const release = fake.holdCalls();
    const button = screen.getByRole('button', { name: 'Export my data' });
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Exporting…' }));
    release();
    await screen.findByRole('status');
    expect(fake.callsOf('export')).toHaveLength(1);
  });

  it('is available when the profile could not be loaded', async () => {
    const fake = createFakeProfileClient(FACTS);
    fake.failNext('STORAGE_ERROR');
    const save = vi.fn<SaveExport>(() => 'f.json');
    const user = userEvent.setup();
    render(<ProfileSettings client={fake.client} saveExport={save} />);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('tab', { name: 'Privacy' }));
    await user.click(screen.getByRole('button', { name: 'Export my data' }));
    await screen.findByText('Exported: f.json');
  });
});

describe('Your data: delete all', () => {
  it('opens an alertdialog with Cancel focused first and the confirm button disabled', async () => {
    const { user } = await setup(FACTS);
    await user.click(trigger());
    expect(dialog()).toHaveAccessibleName('Delete all data?');
    expect(dialog()).toHaveAccessibleDescription(/removes everything this app stores on this Mac/);
    expect(cancelButton()).toHaveFocus();
    expect(confirmButton()).toBeDisabled();
  });

  it('states what is removed and what is not removed or claimed', async () => {
    const { user } = await setup(FACTS);
    await user.click(trigger());
    const text = dialog().textContent ?? '';
    for (const removed of ['résumé', 'stories', 'writing samples', 'writing rules', 'settings']) {
      expect(text).toContain(removed);
    }
    expect(text).toContain('on this Mac');
    expect(text).toContain('This does not remove');
    for (const kept of [
      'Files you exported earlier',
      'Your browser',
      'Your Claude or ChatGPT account',
      'anything those providers kept',
      'employer sites',
      'Backups of this Mac',
      'anything macOS keeps',
    ]) {
      expect(text).toContain(kept);
    }
    expect(text).not.toMatch(/securely|permanently erased|guarantee|completely/i);
  });

  it.each(['delete', 'Delete', 'DELETE ', ' DELETE', 'DELET', 'DELETEE', 'D E L E T E', ''])(
    'keeps the confirm button disabled for %j',
    async (typed) => {
      const { fake, user } = await setup(FACTS);
      await user.click(trigger());
      if (typed !== '') await user.type(typedBox(), typed);
      expect(confirmButton()).toBeDisabled();
      await user.type(typedBox(), '{Enter}');
      expect(fake.callsOf('deleteAll')).toHaveLength(0);
    },
  );

  it('enables confirm only for exactly DELETE', async () => {
    const { user } = await setup(FACTS);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    expect(confirmButton()).toBeEnabled();
    await user.type(typedBox(), ' ');
    expect(confirmButton()).toBeDisabled();
  });

  it('Cancel closes without deleting, returns focus to the trigger, and clears the typed text', async () => {
    const { fake, user } = await setup(FACTS);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    await user.click(cancelButton());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('deleteAll')).toHaveLength(0);
    expect(trigger()).toHaveFocus();
    await user.click(trigger());
    expect(typedBox()).toHaveValue('');
  });

  it('Escape cancels and returns focus to the trigger', async () => {
    const { fake, user } = await setup(FACTS);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('deleteAll')).toHaveLength(0);
    expect(trigger()).toHaveFocus();
  });

  it('cannot be dismissed or submitted twice while the delete is in flight', async () => {
    const { fake, user } = await setup(FACTS);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    const release = fake.holdCalls();
    await user.click(confirmButton());
    expect(within(dialog()).getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(typedBox()).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'Deleting…' }));
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('deleteAll')).toHaveLength(1);
  });

  it('keeps the dialog open on failure with the catalog message and next step, then allows a retry', async () => {
    const { fake, user } = await setup(FACTS);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    fake.failNext('STORAGE_ERROR');
    await user.click(confirmButton());
    const alert = await within(dialog()).findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.STORAGE_ERROR.message);
    expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG.STORAGE_ERROR.userAction}.`);
    expect(typedBox()).toHaveValue('DELETE');
    expect(confirmButton()).toBeEnabled();
    expect(fake.profile.resume).not.toBeNull();
    expect(screen.queryByText(/^All data stored/)).not.toBeInTheDocument();
    await user.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('deleteAll')).toHaveLength(2);
    expect(fake.profile.resume).toBeNull();
  });

  it('on success closes, announces it, moves focus to the heading, and reloads empty lists', async () => {
    const { fake, user } = await setup(FACTS);
    expect(fake.callsOf('get')).toHaveLength(1);
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    await user.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(
      'All data stored by this app on this Mac was deleted. Your lists are now empty.',
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Your data' })).toHaveFocus();
    await waitFor(() => expect(fake.callsOf('get')).toHaveLength(2)); // reloaded from the helper
    await user.click(screen.getByRole('tab', { name: 'Résumé' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(''),
    );
    await user.click(screen.getByRole('tab', { name: 'Stories' }));
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent('No stories yet.'));
  });

  it('is operable with the keyboard alone', async () => {
    const { fake, user } = await setup(FACTS);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(cancelButton()).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(typedBox()).toHaveFocus();
    await user.keyboard('DELETE');
    await user.keyboard('{Tab}'); // Cancel
    expect(cancelButton()).toHaveFocus();
    await user.keyboard('{Tab}'); // confirm, now enabled
    expect(confirmButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fake.callsOf('deleteAll')).toHaveLength(1);
  });

  it('works when the profile could not be loaded, and the lists then load', async () => {
    const fake = createFakeProfileClient(FACTS);
    fake.failNext('STORAGE_ERROR');
    const user = userEvent.setup();
    render(<ProfileSettings client={fake.client} />);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('tab', { name: 'Privacy' }));
    await user.click(trigger());
    await user.type(typedBox(), 'DELETE');
    await user.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'Résumé' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Résumé text' })).toHaveValue(''),
    );
  });
});
