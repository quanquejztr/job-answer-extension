import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { DiagnosticsClient, DiagnosticsOutcome } from '../lib/diagnostics/diagnostics-client';
import { appErrorFor } from '../schemas/error';
import type { Provider } from '../schemas/profile';
import { ProviderCheck } from './ProviderCheck';

function setup(outcome: DiagnosticsOutcome, provider: Provider | 'none' = 'claude') {
  const run = vi.fn<DiagnosticsClient['run']>(() => Promise.resolve(outcome));
  render(<ProviderCheck client={{ run }} provider={provider === 'none' ? undefined : provider} />);
  return { run, user: userEvent.setup() };
}

describe('ProviderCheck', () => {
  it('runs nothing until the button is pressed, and names the chosen provider', () => {
    const { run } = setup({ ok: true, value: { checks: [{ name: 'helper', ok: true }] } });
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(/Checks Claude Code, the provider you chose/)).toBeInTheDocument();
  });

  it('needs a chosen provider: the button is disabled and the text says to choose one', async () => {
    const { run, user } = setup(
      { ok: true, value: { checks: [{ name: 'helper', ok: true }] } },
      'none',
    );
    expect(screen.getByText(/Choose a provider above/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Check provider' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(run).not.toHaveBeenCalled();
  });

  it('labels the rows with the chosen provider', async () => {
    const { user } = setup(
      {
        ok: true,
        value: {
          checks: [
            { name: 'helper', ok: true },
            { name: 'providerExecutable', ok: true },
          ],
        },
      },
      'codex',
    );
    await user.click(screen.getByRole('button', { name: 'Check provider' }));
    expect(await screen.findByText('Codex command:')).toBeInTheDocument();
  });

  it('shows every check as OK when all pass', async () => {
    const { run, user } = setup({
      ok: true,
      value: {
        checks: [
          { name: 'helper', ok: true },
          { name: 'providerExecutable', ok: true },
          { name: 'providerSignIn', ok: true },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Check provider' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Claude Code sign-in:')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(3);
  });

  it('shows a failing row with the catalog message and the one next step', async () => {
    const { user } = setup({
      ok: true,
      value: {
        checks: [
          { name: 'helper', ok: true },
          {
            name: 'providerExecutable',
            ok: false,
            code: 'PROVIDER_NOT_FOUND',
            userAction: 'Install the selected provider CLI',
          },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Check provider' }));
    expect(
      await screen.findByText(
        `${appErrorFor('PROVIDER_NOT_FOUND').message} Next step: Install the selected provider CLI.`,
      ),
    ).toBeInTheDocument();
  });

  it('shows a request failure as an alert with its next step', async () => {
    const { user } = setup({ ok: false, error: appErrorFor('HELPER_UNAVAILABLE') });
    await user.click(screen.getByRole('button', { name: 'Check provider' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The native helper is unavailable.');
    expect(alert).toHaveTextContent('Next step: Run the installer, then retry.');
  });

  it('disables the button while checking', async () => {
    let finish: (o: DiagnosticsOutcome) => void = () => undefined;
    const run = vi.fn<DiagnosticsClient['run']>(() => new Promise((resolve) => (finish = resolve)));
    render(<ProviderCheck client={{ run }} provider="claude" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Check provider' }));
    expect(screen.getByRole('button', { name: 'Check provider' })).toBeDisabled();
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    finish({ ok: true, value: { checks: [{ name: 'helper', ok: true }] } });
    expect(await screen.findByText('Helper:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check provider' })).toBeEnabled();
  });
});
