import type { ProfileClient } from '../../lib/profile/profile-client';
import { YourDataSection, type SaveExport } from './YourDataSection';

/**
 * Explanation (PRD 18.1 adapted for settings) followed by the Your data section
 * (export and delete all). It has no checkbox and gates nothing: the first-use
 * disclosure is accepted in the provider section at the top of settings.
 */
export function PrivacySection({
  client,
  onDataDeleted,
  saveExport,
}: {
  client: ProfileClient;
  onDataDeleted(): void;
  saveExport?: SaveExport;
}) {
  return (
    <section aria-labelledby="privacy-heading" className="mt-4">
      <h2 id="privacy-heading" tabIndex={-1} className="text-base font-semibold">
        Privacy
      </h2>
      <p className="mt-2">
        Your profile stays on this Mac. It is kept in a folder only your account can open, and this
        app does not save drafts or job descriptions.
      </p>
      <p className="mt-2">
        Each draft sends the question, the job description, your whole résumé, all your stories, all
        your writing samples, and your enabled writing rules to the provider you choose. A résumé
        usually contains contact details, so remove them from the saved text if you do not want them
        sent.
      </p>
      <ul className="mt-2 list-disc ps-5">
        <li>
          Provider-side retention and training follow your account settings with that provider.
        </li>
        <li>
          If model training is on, your text may be used to train models and kept for years
          (Anthropic: up to 5 years). If it is off, Anthropic keeps it for up to 30 days.
        </li>
        <li>OpenAI’s published pages do not state a retention period for Codex.</li>
        <li>
          Content a provider flags for safety review can be kept longer (Anthropic: up to 2 years).
        </li>
        <li>
          Before you draft, turn off model training in your Claude privacy settings and your ChatGPT
          Data controls, and check the separate Codex training setting.
        </li>
      </ul>
      <p className="mt-2">
        Keep your home address, phone number, visa status, health details, and other people’s names
        out of your résumé, stories, and samples. When you save a story or writing sample that looks
        like it contains an email address, a phone number, or a street address, you are asked to
        confirm first.
      </p>
      <YourDataSection
        client={client}
        onDeleted={onDataDeleted}
        {...(saveExport === undefined ? {} : { saveExport })}
      />
    </section>
  );
}
