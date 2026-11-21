import type { Profile } from '../../schemas/profile';

/**
 * The user's export file (Step 2.3). It is built in the page from the profile
 * the helper returned, as a Blob behind a throwaway object URL, and handed to
 * the browser through an anchor with the download attribute: no `downloads`
 * permission, nothing written by the helper, nothing sent anywhere.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** `job-answer-profile-YYYY-MM-DD.json`, using the date in the user's own time zone. */
export function exportFileName(date: Date): string {
  return `job-answer-profile-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** The profile exactly as the helper stored it, pretty-printed, with a final newline. */
export function exportFileText(profile: Profile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** The browser pieces the download needs; tests pass fakes. */
export interface DownloadEnv {
  document: Pick<Document, 'createElement' | 'body'>;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Downloads the profile as a file named for `now` and returns that name. The
 * object URL is revoked right after the click, even if the click throws.
 */
export function downloadProfileExport(profile: Profile, env: DownloadEnv, now: Date): string {
  const filename = exportFileName(now);
  const blob = new Blob([exportFileText(profile)], { type: 'application/json' });
  const url = env.createObjectURL(blob);
  try {
    const anchor = env.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    env.document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  } finally {
    env.revokeObjectURL(url);
  }
  return filename;
}

/** The real browser environment for the settings page. */
export function browserDownloadEnv(): DownloadEnv {
  return {
    document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}
