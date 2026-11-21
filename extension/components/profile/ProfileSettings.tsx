import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ProfileClient } from '../../lib/profile/profile-client';
import { useProfile } from '../../lib/profile/use-profile';
import { ErrorAlert } from './Controls';
import { PrivacySection } from './PrivacySection';
import { ResumeSection } from './ResumeSection';
import { RulesSection } from './RulesSection';
import { SamplesSection } from './SamplesSection';
import type { SaveExport } from './YourDataSection';
import { SECONDARY_BUTTON } from './styles';
import { StoriesSection } from './StoriesSection';

const TABS = [
  { key: 'resume', label: 'Résumé' },
  { key: 'stories', label: 'Stories' },
  { key: 'samples', label: 'Writing samples' },
  { key: 'rules', label: 'Writing rules' },
  { key: 'privacy', label: 'Privacy' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/**
 * The manual profile settings: five sections in a keyboard-operable tab list
 * (arrow keys, Home, End). Every panel stays mounted so an open form keeps its
 * contents when the user looks at another tab. The Privacy tab (with Your data:
 * export and delete all) needs no loaded profile, so it works even when the
 * profile cannot be loaded.
 */
export function ProfileSettings({
  client,
  saveExport,
}: {
  client: ProfileClient;
  /** Replaces the browser download for the export file; tests only. */
  saveExport?: SaveExport;
}) {
  const uid = useId();
  const { load, retry, actions } = useProfile(client);
  const [active, setActive] = useState<TabKey>('resume');
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab = TABS[next];
    if (tab === undefined) return;
    setActive(tab.key);
    tabRefs.current[tab.key]?.focus();
  }

  const profile = load.status === 'ready' ? load.profile : null;

  return (
    <div>
      <p className="text-muted mt-1">
        Your profile stays on this Mac. Add only things that are true and that you have checked
        yourself.
      </p>
      <div
        role="tablist"
        aria-label="Profile sections"
        className="border-border mt-4 flex flex-wrap gap-1 border-b"
      >
        {TABS.map((tab, index) => (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[tab.key] = el;
            }}
            id={`${uid}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`${uid}-panel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            className={`rounded-t-md border border-b-0 px-3 py-2 font-medium ${
              active === tab.key
                ? 'border-border bg-surface text-text'
                : 'text-muted border-transparent'
            }`}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.key}
          id={`${uid}-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${tab.key}`}
          hidden={active !== tab.key}
        >
          {tab.key === 'privacy' ? (
            <PrivacySection
              client={client}
              onDataDeleted={retry}
              {...(saveExport === undefined ? {} : { saveExport })}
            />
          ) : load.status === 'loading' ? (
            <p role="status" className="state state-loading mt-4">
              Loading your profile…
            </p>
          ) : load.status === 'error' ? (
            <div className="mt-4">
              <ErrorAlert error={load.error} />
              <button type="button" className={`${SECONDARY_BUTTON} mt-3`} onClick={retry}>
                Retry
              </button>
            </div>
          ) : profile === null ? null : tab.key === 'resume' ? (
            <ResumeSection profile={profile} actions={actions} />
          ) : tab.key === 'stories' ? (
            <StoriesSection stories={profile.stories} actions={actions} />
          ) : tab.key === 'samples' ? (
            <SamplesSection samples={profile.samples} actions={actions} />
          ) : (
            <RulesSection rules={profile.rules} actions={actions} />
          )}
        </div>
      ))}
    </div>
  );
}
