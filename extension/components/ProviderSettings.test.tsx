import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { DiagnosticsClient } from '../lib/diagnostics/diagnostics-client';
import { createFakeProfileClient } from '../lib/profile/fake-profile-client';
import type { Profile } from '../schemas/profile';
import { ProviderSettings } from './ProviderSettings';

function setup(initial: Partial<Profile> = {}) {
  const fake = createFakeProfileClient(initial);
  const run = vi.fn<DiagnosticsClient['run']>(() =>
    Promise.resolve({ ok: true, value: { checks: [{ name: 'helper', ok: true }] } }),
  );
  render(<ProviderSettings client={fake.client} diagnostics={{ run }} />);
  return { fake, run, user: userEvent.setup() };
}

describe('ProviderSettings: provider choice', () => {
  it('has no default: nothing is chosen, Codex is disabled and says not available yet', async () => {
    setup();
    const claude = await screen.findByRole('radio', { name: 'Claude Code' });
    const codex = screen.getByRole('radio', { name: 'Codex (not available yet)' });
    expect(claude).not.toBeChecked();
    expect(codex).not.toBeChecked();
    expect(codex).toBeDisabled();
    expect(screen.getByText(/No provider is chosen yet/)).toBeInTheDocument();
    // The provider check needs a choice first.
    expect(screen.getByRole('button', { name: 'Check provider' })).toBeDisabled();
  });

  it('saves the choice through the helper and shows it, then enables Check provider', async () => {
    const { fake, user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    expect(await screen.findByText('Provider saved: Claude Code.')).toBeInTheDocument();
    expect(fake.callsOf('setProvider')).toEqual([
      { type: 'setProvider', payload: { provider: 'claude' } },
    ]);
    expect(fake.profile.settings.provider).toBe('claude');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(screen.queryByText(/No provider is chosen yet/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check provider' })).toBeEnabled();
  });

  it('shows a stored choice on load', async () => {
    setup({ settings: { provider: 'claude' } });
    expect(await screen.findByRole('radio', { name: 'Claude Code' })).toBeChecked();
  });

  it('never sends Codex: the option cannot be chosen', async () => {
    const { fake, user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'Codex (not available yet)' }));
    expect(fake.callsOf('setProvider')).toHaveLength(0);
  });

  it('shows the typed error when saving fails and keeps nothing chosen', async () => {
    const { fake, user } = setup();
    const claude = await screen.findByRole('radio', { name: 'Claude Code' });
    fake.failNext('STORAGE_ERROR');
    await user.click(claude);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The profile could not be read or saved.');
    expect(alert).toHaveTextContent('Next step: Export if possible, then repair or reset.');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).not.toBeChecked();
  });

  it('runs Check provider for the chosen provider', async () => {
    const { run, user } = setup({ settings: { provider: 'claude' } });
    await user.click(await screen.findByRole('button', { name: 'Check provider' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Helper:')).toBeInTheDocument();
  });
});

describe('ProviderSettings: first-use disclosure', () => {
  it('shows the PRD 18.1 text and blocks Accept until the box is checked', async () => {
    const { fake, user } = setup();
    expect(await screen.findByRole('heading', { name: 'Before your first draft' })).toBeVisible();
    expect(
      screen.getByText(/Each draft sends the question, the job description, your whole résumé/),
    ).toBeInTheDocument();
    expect(screen.getByText(/up to 5 years/)).toBeInTheDocument();
    expect(screen.getByText(/up to 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/up to 2 years/)).toBeInTheDocument();
    expect(screen.getByText(/Drafting is blocked until you accept this/)).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    await user.click(accept);
    expect(fake.callsOf('acceptDisclosure')).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: 'I have checked these settings.' }));
    expect(accept).toBeEnabled();
    await user.click(accept);
    expect(await screen.findByText(/You accepted this on 2026-11-20/)).toBeInTheDocument();
    expect(fake.callsOf('acceptDisclosure')).toHaveLength(1);
    expect(fake.profile.settings.disclosureAcceptedAt).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('shows an accepted disclosure as accepted on load, with no Accept button', async () => {
    setup({ settings: { disclosureAcceptedAt: '2026-11-19T08:00:00Z' } });
    expect(await screen.findByText(/You accepted this on 2026-11-19/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('shows a typed error when accepting fails and leaves Accept available', async () => {
    const { fake, user } = setup();
    await user.click(
      await screen.findByRole('checkbox', { name: 'I have checked these settings.' }),
    );
    fake.failNext('STORAGE_ERROR');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The profile could not be read or saved.',
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled());
  });
});

describe('ProviderSettings: loading', () => {
  it('shows a retryable error when the settings cannot be loaded', async () => {
    const fake = createFakeProfileClient();
    fake.failNext('STORAGE_ERROR');
    const run = vi.fn<DiagnosticsClient['run']>();
    render(<ProviderSettings client={fake.client} diagnostics={{ run }} />);
    expect(await screen.findByText(/Provider settings could not be loaded/)).toHaveTextContent(
      'The profile could not be read or saved.',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload provider settings' }));
    expect(await screen.findByRole('heading', { name: 'Before your first draft' })).toBeVisible();
  });
});
