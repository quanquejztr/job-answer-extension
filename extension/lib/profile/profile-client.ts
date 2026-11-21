import { browser } from 'wxt/browser';
import { appErrorFor, type AppError } from '../../schemas/error';
import {
  DELETE_ALL_CONFIRMATION,
  type DisclosureResult,
  type ImportDocumentPayload,
  type ImportResult,
  type ItemDeletePayload,
  type ItemUpsertPayload,
  type Profile,
  type Provider,
  type Resume,
  type ResumeSetPayload,
} from '../../schemas/profile';
import {
  AcceptDisclosureReplySchema,
  SetProviderReplySchema,
  ProfileDeleteReplySchema,
  ProfileExportReplySchema,
  ProfileGetReplySchema,
  ProfileImportDocumentReplySchema,
  ProfileResumeSetReplySchema,
  ProfileUpsertReplySchemas,
} from '../../schemas/profile-message';
import type { StoredItem } from '../native/native-client';
import { newRequestId } from '../native/request-id';

export type ProfileResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { StoredItem };

/** What the settings components see. They never touch browser APIs. */
export interface ProfileClient {
  get(): Promise<ProfileResult<Profile>>;
  upsert(payload: ItemUpsertPayload): Promise<ProfileResult<StoredItem>>;
  /** Saves the reviewed résumé text; nothing is saved until the user clicks Save. */
  setResume(payload: ResumeSetPayload): Promise<ProfileResult<Resume>>;
  /** Extracts a .docx's text for the editable box. Nothing is saved by this call. */
  importDocument(payload: ImportDocumentPayload): Promise<ProfileResult<ImportResult>>;
  delete(payload: ItemDeletePayload): Promise<ProfileResult<{ deleted: true }>>;
  /** The full profile for the export file. Called only on the user's click. */
  export(): Promise<ProfileResult<Profile>>;
  /** Removes everything this app stored. The page has already had the typed confirmation. */
  deleteAll(): Promise<ProfileResult<{ deleted: true }>>;
  /** Stores the owner's provider choice (settings.setProvider). There is no default. */
  setProvider(provider: Provider): Promise<ProfileResult<Provider>>;
  /** Records that the owner accepted the first-use disclosure; the helper stamps the time. */
  acceptDisclosure(): Promise<ProfileResult<DisclosureResult>>;
}

const UNREACHABLE = Symbol('worker unreachable');

export interface ProfileApi {
  sendMessage(message: unknown): Promise<unknown>;
}

const failure = (code: Parameters<typeof appErrorFor>[0]): { ok: false; error: AppError } => ({
  ok: false,
  error: appErrorFor(code),
});

/**
 * Typed client for the settings page. Every call is one message to the worker
 * with a fresh requestId; the reply is validated and bound to that id. A worker
 * that cannot be reached is HELPER_UNAVAILABLE; a reply that is not the
 * expected shape is INTERNAL_ERROR (nothing from it is echoed).
 */
export function createProfileClient(api: ProfileApi): ProfileClient {
  async function send(message: object): Promise<unknown> {
    try {
      return await api.sendMessage(message);
    } catch {
      return UNREACHABLE;
    }
  }
  function settle<T>(
    raw: unknown,
    requestId: string,
    parse: (raw: unknown) =>
      | {
          success: true;
          data:
            | { requestId: string; ok: true; result: T }
            | { requestId: string; ok: false; error: AppError };
        }
      | { success: false },
  ): ProfileResult<T> {
    if (typeof raw === 'symbol') return failure('HELPER_UNAVAILABLE');
    const parsed = parse(raw);
    if (!parsed.success || parsed.data.requestId !== requestId) return failure('INTERNAL_ERROR');
    return parsed.data.ok
      ? { ok: true, value: parsed.data.result }
      : { ok: false, error: parsed.data.error };
  }
  return {
    async get() {
      const requestId = newRequestId();
      const raw = await send({ v: 1, requestId, type: 'settings.profile.get', payload: {} });
      return settle(raw, requestId, (r) => ProfileGetReplySchema.safeParse(r));
    },
    async upsert(payload) {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.profile.item.upsert',
        payload,
      });
      switch (payload.kind) {
        case 'story': {
          const r = settle(raw, requestId, (x) => ProfileUpsertReplySchemas.story.safeParse(x));
          return r.ok ? { ok: true, value: { kind: 'story', item: r.value.item } } : r;
        }
        case 'sample': {
          const r = settle(raw, requestId, (x) => ProfileUpsertReplySchemas.sample.safeParse(x));
          return r.ok ? { ok: true, value: { kind: 'sample', item: r.value.item } } : r;
        }
        case 'rule': {
          const r = settle(raw, requestId, (x) => ProfileUpsertReplySchemas.rule.safeParse(x));
          return r.ok ? { ok: true, value: { kind: 'rule', item: r.value.item } } : r;
        }
      }
    },
    async setResume(payload) {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.profile.resume.set',
        payload,
      });
      const r = settle(raw, requestId, (x) => ProfileResumeSetReplySchema.safeParse(x));
      return r.ok ? { ok: true, value: r.value.resume } : r;
    },
    async importDocument(payload) {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.profile.import.document',
        payload,
      });
      return settle(raw, requestId, (x) => ProfileImportDocumentReplySchema.safeParse(x));
    },
    async delete(payload) {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.profile.item.delete',
        payload,
      });
      return settle(raw, requestId, (r) => ProfileDeleteReplySchema.safeParse(r));
    },
    async export() {
      const requestId = newRequestId();
      const raw = await send({ v: 1, requestId, type: 'settings.profile.export', payload: {} });
      const r = settle(raw, requestId, (x) => ProfileExportReplySchema.safeParse(x));
      return r.ok ? { ok: true, value: r.value.file } : r;
    },
    async deleteAll() {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.profile.deleteAll',
        payload: { confirm: DELETE_ALL_CONFIRMATION },
      });
      return settle(raw, requestId, (r) => ProfileDeleteReplySchema.safeParse(r));
    },
    async setProvider(provider) {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.provider.set',
        payload: { provider },
      });
      const r = settle(raw, requestId, (x) => SetProviderReplySchema.safeParse(x));
      // The reply must name the provider that was sent.
      if (r.ok && r.value.provider !== provider) return failure('INTERNAL_ERROR');
      return r.ok ? { ok: true, value: r.value.provider } : r;
    },
    async acceptDisclosure() {
      const requestId = newRequestId();
      const raw = await send({
        v: 1,
        requestId,
        type: 'settings.disclosure.accept',
        payload: {},
      });
      return settle(raw, requestId, (x) => AcceptDisclosureReplySchema.safeParse(x));
    },
  };
}

/** The real client, for the options entrypoint. */
export function createBrowserProfileClient(): ProfileClient {
  return createProfileClient({ sendMessage: (message) => browser.runtime.sendMessage(message) });
}
