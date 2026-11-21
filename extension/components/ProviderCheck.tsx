import { useState } from 'react';
import { appErrorFor, type AppError } from '../schemas/error';
import type { CheckName, DiagnosticCheck } from '../schemas/diagnostics';
import type { Provider } from '../schemas/profile';
import type { DiagnosticsClient } from '../lib/diagnostics/diagnostics-client';
import { ErrorAlert } from './profile/Controls';
import { SECONDARY_BUTTON } from './profile/styles';

const NAMES: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' };

function labelFor(name: CheckName, provider: Provider | undefined): string {
  if (name === 'helper') return 'Helper';
  const who = provider === undefined ? 'Provider' : NAMES[provider];
  return name === 'providerExecutable' ? `${who} command` : `${who} sign-in`;
}

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; checks: readonly DiagnosticCheck[] }
  | { status: 'failed'; error: AppError };

/**
 * "Check provider": asks the helper whether the provider you chose is installed
 * and signed in, and shows one row per check as text. It never signs in for
 * you; a failing row says what to do yourself. It needs a chosen provider: the
 * helper checks the one stored in settings.
 */
export function ProviderCheck({
  client,
  provider,
}: {
  client: DiagnosticsClient;
  /** The provider stored in settings; undefined until the owner chooses. */
  provider: Provider | undefined;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function check() {
    setState({ status: 'running' });
    const r = await client.run();
    setState(
      r.ok ? { status: 'done', checks: r.value.checks } : { status: 'failed', error: r.error },
    );
  }

  return (
    <section aria-labelledby="provider-check-heading" className="mt-4">
      <h3 id="provider-check-heading" className="font-medium">
        Provider check
      </h3>
      <p className="text-muted mt-1">
        {provider === undefined
          ? 'Choose a provider above, then check it here. '
          : `Checks ${NAMES[provider]}, the provider you chose. `}
        This check never signs you in; if something fails, fix it in Terminal yourself.
      </p>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} mt-3`}
        disabled={provider === undefined || state.status === 'running'}
        onClick={() => void check()}
      >
        Check provider
      </button>
      <div aria-live="polite" className="mt-3">
        {state.status === 'running' && <p>Checking…</p>}
        {state.status === 'failed' && <ErrorAlert error={state.error} />}
        {state.status === 'done' && (
          <ul className="list-none space-y-2 p-0">
            {state.checks.map((c) => (
              <li key={c.name}>
                <span className="font-medium">{labelFor(c.name, provider)}: </span>
                {c.ok || c.code === undefined ? (
                  <span>OK</span>
                ) : (
                  <span>
                    {appErrorFor(c.code).message}
                    {c.userAction !== undefined && ` Next step: ${c.userAction}.`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
