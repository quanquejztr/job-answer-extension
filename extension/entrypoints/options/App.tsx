import { ProfileSettings } from '../../components/profile/ProfileSettings';
import { ProviderSettings } from '../../components/ProviderSettings';
import type { DiagnosticsClient } from '../../lib/diagnostics/diagnostics-client';
import type { ProfileClient } from '../../lib/profile/profile-client';

export function App({
  client,
  diagnostics,
}: {
  client: ProfileClient;
  diagnostics: DiagnosticsClient;
}) {
  return (
    <main className="bg-background text-text mx-auto min-h-screen max-w-3xl p-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <ProviderSettings client={client} diagnostics={diagnostics} />
      <h2 className="mt-8 text-base font-semibold">Your profile</h2>
      <ProfileSettings client={client} />
    </main>
  );
}
