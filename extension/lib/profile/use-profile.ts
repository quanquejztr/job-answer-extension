import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppError } from '../../schemas/error';
import type {
  ImportDocumentPayload,
  ImportResult,
  ItemDeletePayload,
  ItemUpsertPayload,
  Profile,
  Resume,
  ResumeSetPayload,
} from '../../schemas/profile';
import { applyDelete, applyResume, applyUpsert } from './profile-state';
import type { ProfileClient, ProfileResult, StoredItem } from './profile-client';

export type ProfileLoad =
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; profile: Profile };

/** What the section components may do with the profile. */
export interface ProfileActions {
  save(payload: ItemUpsertPayload): Promise<ProfileResult<StoredItem>>;
  saveResume(payload: ResumeSetPayload): Promise<ProfileResult<Resume>>;
  /** Extracts text for the editable box; the profile is not changed. */
  importDocument(payload: ImportDocumentPayload): Promise<ProfileResult<ImportResult>>;
  remove(target: ItemDeletePayload): Promise<ProfileResult<{ deleted: true }>>;
}

/**
 * Loads the profile once (and again on retry) and keeps it in step with
 * confirmed changes: a stored item replaces or joins its list, a deleted item
 * leaves it. Nothing is shown as saved until the helper has confirmed it.
 */
export function useProfile(client: ProfileClient): {
  load: ProfileLoad;
  retry(): void;
  actions: ProfileActions;
} {
  const [load, setLoad] = useState<ProfileLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void client.get().then((r) => {
      if (cancelled) return;
      setLoad(r.ok ? { status: 'ready', profile: r.value } : { status: 'error', error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const actions = useMemo<ProfileActions>(
    () => ({
      async save(payload) {
        const r = await client.upsert(payload);
        if (r.ok) {
          const stored = r.value;
          setLoad((s) =>
            s.status === 'ready' ? { status: 'ready', profile: applyUpsert(s.profile, stored) } : s,
          );
        }
        return r;
      },
      async saveResume(payload) {
        const r = await client.setResume(payload);
        if (r.ok) {
          const resume = r.value;
          setLoad((s) =>
            s.status === 'ready' ? { status: 'ready', profile: applyResume(s.profile, resume) } : s,
          );
        }
        return r;
      },
      importDocument: (payload) => client.importDocument(payload),
      async remove(target) {
        const r = await client.delete(target);
        if (r.ok) {
          setLoad((s) =>
            s.status === 'ready' ? { status: 'ready', profile: applyDelete(s.profile, target) } : s,
          );
        }
        return r;
      },
    }),
    [client],
  );

  return { load, retry, actions };
}
