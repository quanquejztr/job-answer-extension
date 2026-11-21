import { useEffect, useId, useState } from 'react';
import type { DiagnosticsClient } from '../lib/diagnostics/diagnostics-client';
import type { ProfileClient } from '../lib/profile/profile-client';
import type { AppError } from '../schemas/error';
import type { Provider } from '../schemas/profile';
import { CheckboxField, ErrorAlert } from './profile/Controls';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './profile/styles';
import { ProviderCheck } from './ProviderCheck';

/** The two settings a draft needs before the résumé: PRD 16.1 `settings`. */
type Load =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; provider: Provider | undefined; acceptedAt: string | undefined };

export const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * First-use disclosure, provider choice, and "Check provider" (PRD 18, 18.1).
 * Drafting stays blocked until the disclosure is accepted and a provider is
 * chosen. Only these two settings are read out of the profile; nothing else
 * from it is kept here.
 */
export function ProviderSettings({
  client,
  diagnostics,
}: {
  client: ProfileClient;
  diagnostics: DiagnosticsClient;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void client.get().then((r) => {
      if (cancelled) return;
      setLoad(
        r.ok
          ? {
              status: 'ready',
              provider: r.value.settings.provider,
              acceptedAt: r.value.settings.disclosureAcceptedAt,
            }
          : { status: 'error', error: r.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  if (load.status === 'loading') {
    return (
      <p role="status" className="state state-loading mt-4">
        Loading provider settings…
      </p>
    );
  }
  if (load.status === 'error') {
    return (
      <div role="status" className="state state-error mt-4">
        <p className="font-medium">Provider settings could not be loaded: {load.error.message}</p>
        {load.error.userAction !== undefined && <p>Next step: {load.error.userAction}.</p>}
        <button
          type="button"
          className={`${SECONDARY_BUTTON} mt-3`}
          onClick={() => {
            setLoad({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Reload provider settings
        </button>
      </div>
    );
  }
  const { provider, acceptedAt } = load;
  return (
    <>
      <DisclosureSection
        acceptedAt={acceptedAt}
        onAccept={async () => {
          const r = await client.acceptDisclosure();
          if (r.ok) {
            const at = r.value.disclosureAcceptedAt;
            setLoad((s) => (s.status === 'ready' ? { ...s, acceptedAt: at } : s));
          }
          return r.ok ? undefined : r.error;
        }}
      />
      <ProviderChoice
        provider={provider}
        onChoose={async (next) => {
          const r = await client.setProvider(next);
          if (r.ok) setLoad((s) => (s.status === 'ready' ? { ...s, provider: next } : s));
          return r.ok ? undefined : r.error;
        }}
      />
      <ProviderCheck key={provider ?? 'none'} client={diagnostics} provider={provider} />
    </>
  );
}

/** PRD 18.1: shown in settings; Accept stays disabled until the box is checked. */
function DisclosureSection({
  acceptedAt,
  onAccept,
}: {
  acceptedAt: string | undefined;
  onAccept(): Promise<AppError | undefined>;
}) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);

  async function accept() {
    setSaving(true);
    setError(undefined);
    const failed = await onAccept();
    setSaving(false);
    if (failed !== undefined) setError(failed);
  }

  return (
    <section aria-labelledby="disclosure-heading" className="mt-6">
      <h2 id="disclosure-heading" className="text-base font-semibold">
        Before your first draft
      </h2>
      <p className="mt-2">
        Each draft sends the question, the job description, your whole résumé, all your stories, all
        your writing samples, and your enabled writing rules to the provider you chose. A résumé
        usually contains contact details, so remove them from the saved text if you do not want them
        sent.
      </p>
      <ul className="mt-2 list-disc ps-5">
        <li>
          <span className="font-medium">On your Mac:</span> this app does not save drafts or job
          descriptions. The provider command-line settings that turn off session history only affect
          files on your Mac.
        </li>
        <li>
          <span className="font-medium">On the provider’s servers:</span> when you are signed in
          with a consumer plan, your account’s privacy settings apply. If model training is on, your
          text may be used to train models and kept for years (Anthropic: up to 5 years). If it is
          off, Anthropic keeps it for up to 30 days. OpenAI’s published pages do not state a
          retention period for Codex.
        </li>
        <li>
          <span className="font-medium">Safety review:</span> content a provider flags can be kept
          longer (Anthropic: up to 2 years).
        </li>
        <li>
          <span className="font-medium">Before you draft:</span> turn off model training in your
          Claude privacy settings and your ChatGPT Data controls, and check the separate Codex
          training setting. Keep home address, phone number, visa status, health details, and other
          people’s names out of your résumé, stories, and samples.
        </li>
      </ul>
      {acceptedAt !== undefined ? (
        <p role="status" className="state state-success mt-3">
          You accepted this on {acceptedAt.slice(0, 10)}. Drafting is no longer blocked by it.
        </p>
      ) : (
        <>
          <p role="status" className="state state-warning mt-3">
            Drafting is blocked until you accept this.
          </p>
          <CheckboxField
            label="I have checked these settings."
            checked={checked}
            onChange={setChecked}
          />
          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-3`}
            disabled={!checked || saving}
            onClick={() => void accept()}
          >
            Accept
          </button>
          {error !== undefined && <ErrorAlert error={error} />}
        </>
      )}
    </section>
  );
}

/** Provider choice: no default; Codex is listed but cannot be chosen yet. */
function ProviderChoice({
  provider,
  onChoose,
}: {
  provider: Provider | undefined;
  onChoose(next: Provider): Promise<AppError | undefined>;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  async function choose(next: Provider) {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    const failed = await onChoose(next);
    setSaving(false);
    if (failed !== undefined) setError(failed);
    else setSaved(true);
  }

  return (
    <section aria-labelledby="provider-heading" className="mt-6">
      <h2 id="provider-heading" className="text-base font-semibold">
        Provider
      </h2>
      <p className="text-muted mt-1">
        Drafts use your own signed-in command-line tool. There is no default: drafting is blocked
        until you choose one, and the app never switches provider for you.
      </p>
      <fieldset className="mt-3" disabled={saving}>
        <legend className="font-medium">Provider for drafts</legend>
        <div className="mt-2 flex items-center gap-2">
          <input
            id={`${id}-claude`}
            type="radio"
            name={`${id}-provider`}
            checked={provider === 'claude'}
            onChange={() => void choose('claude')}
          />
          <label htmlFor={`${id}-claude`}>Claude Code</label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input id={`${id}-codex`} type="radio" name={`${id}-provider`} disabled checked={false} />
          <label htmlFor={`${id}-codex`} className="text-muted">
            Codex (not available yet)
          </label>
        </div>
      </fieldset>
      <div aria-live="polite">
        {provider === undefined && !saving && (
          <p className="state state-warning mt-3">
            No provider is chosen yet. Drafting is blocked until you choose one.
          </p>
        )}
        {saving && <p className="state state-loading mt-3">Saving…</p>}
        {saved && provider !== undefined && (
          <p role="status" className="state state-success mt-3">
            Provider saved: {PROVIDER_LABEL[provider]}.
          </p>
        )}
        {error !== undefined && <ErrorAlert error={error} />}
      </div>
    </section>
  );
}
