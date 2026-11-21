import type { ItemDeletePayload, Profile, Resume } from '../../schemas/profile';
import type { StoredItem } from '../native/native-client';

function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];
}

/** Applies a saved résumé the helper returned: it replaces the single résumé. */
export function applyResume(profile: Profile, resume: Resume): Profile {
  return { ...profile, resume };
}

/** Applies a stored item the helper returned: replaces the same id, else appends. */
export function applyUpsert(profile: Profile, stored: StoredItem): Profile {
  switch (stored.kind) {
    case 'story':
      return { ...profile, stories: upsertById(profile.stories, stored.item) };
    case 'sample':
      return { ...profile, samples: upsertById(profile.samples, stored.item) };
    case 'rule':
      return { ...profile, rules: upsertById(profile.rules, stored.item) };
  }
}

/** Applies a confirmed delete. */
export function applyDelete(profile: Profile, target: ItemDeletePayload): Profile {
  switch (target.kind) {
    case 'story':
      return { ...profile, stories: profile.stories.filter((s) => s.id !== target.id) };
    case 'sample':
      return { ...profile, samples: profile.samples.filter((s) => s.id !== target.id) };
    case 'rule':
      return { ...profile, rules: profile.rules.filter((r) => r.id !== target.id) };
  }
}
