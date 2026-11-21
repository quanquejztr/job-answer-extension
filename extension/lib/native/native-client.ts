import { NATIVE_HOST_NAME } from '../constants/native-host';
import { DiagnosticsResultSchema, type DiagnosticsResult } from '../../schemas/diagnostics';
import { DraftResponseSchema, type DraftRequest, type DraftResponse } from '../../schemas/draft';
import { appErrorFor, type AppError, type ErrorCode } from '../../schemas/error';
import {
  DELETE_ALL_CONFIRMATION,
  DeleteResultSchema,
  DisclosureResultSchema,
  ProviderResultSchema,
  type DisclosureResult,
  type Provider,
  ExportResultSchema,
  ImportResultSchema,
  ProfileSchema,
  ResumeResultSchema,
  UPSERT_RESULT_SCHEMAS,
  type ExportResult,
  type ImportDocumentPayload,
  type ImportResult,
  type ItemDeletePayload,
  type ItemUpsertPayload,
  type Profile,
  type Resume,
  type ResumeSetPayload,
  type Story,
  type WritingRule,
  type WritingSample,
} from '../../schemas/profile';
import {
  HelloResultSchema,
  PROTOCOL_VERSION,
  parseRequest,
  type HelloResult,
  type RequestEnvelope,
} from '../../schemas/messages';
import { parseResponse } from './parse-response';
import { newRequestId } from './request-id';
import { checkRequestSize } from './request-size';

/** Client-side limit for one helper round trip (the helper's own limit is 90 s). */
export const NATIVE_TIMEOUT_MS = 100_000;

/** The slice of `runtime.Port` the client uses, so tests can supply a fake. */
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}

export type ConnectNative = (hostName: string) => NativePort;

export type NativeResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** One in-flight helper request. `cancel` disconnects the port (the helper sees stdin EOF). */
export interface NativeCall<T> {
  result: Promise<NativeResult<T>>;
  cancel(): void;
}

/** The stored item a profile.item.upsert returned, tagged with the kind that was sent. */
export type StoredItem =
  | { kind: 'story'; item: Story }
  | { kind: 'sample'; item: WritingSample }
  | { kind: 'rule'; item: WritingRule };

export interface NativeClient {
  hello(extensionVersion: string): NativeCall<HelloResult>;
  generateDraft(request: DraftRequest): NativeCall<DraftResponse>;
  /** Settings only: the worker never forwards a profile to any other caller. */
  getProfile(): NativeCall<Profile>;
  upsertProfileItem(payload: ItemUpsertPayload): NativeCall<StoredItem>;
  /** Settings only: saves the reviewed résumé text (profile.resume.set). */
  setResume(payload: ResumeSetPayload): NativeCall<Resume>;
  /** Settings only: extracts a .docx's text for the editable box. The helper saves nothing. */
  importDocument(payload: ImportDocumentPayload): NativeCall<ImportResult>;
  deleteProfileItem(payload: ItemDeletePayload): NativeCall<{ deleted: true }>;
  /** Settings only: the full profile, for the user's export file. */
  exportProfile(): NativeCall<ExportResult>;
  /** Settings only: removes every stored profile file. The confirmation is the literal "DELETE". */
  deleteAllProfile(): NativeCall<{ deleted: true }>;
  /** Settings only: helper and provider checks (executable, sign-in). Starts no login. */
  runDiagnostics(): NativeCall<DiagnosticsResult>;
  /** Settings only: stores the provider choice (settings.setProvider). */
  setProvider(provider: Provider): NativeCall<Provider>;
  /** Settings only: records that the owner accepted the first-use disclosure; the helper stamps the time. */
  acceptDisclosure(): NativeCall<DisclosureResult>;
}

const failure = (code: ErrorCode): { ok: false; error: AppError } => ({
  ok: false,
  error: appErrorFor(code),
});

/** True when the raw response carries a protocol version other than ours. */
function hasOtherVersion(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const version: unknown = Reflect.get(raw, 'protocolVersion');
  return typeof version === 'number' && version !== PROTOCOL_VERSION;
}

/**
 * Typed native-messaging client: one port per request, one validated request
 * envelope out, exactly one validated response in, then disconnect.
 *
 * Failure mapping (never includes helper or process text):
 * - connect error, host not found, or disconnect before a response: HELPER_UNAVAILABLE
 * - response protocolVersion other than 1: PROTOCOL_VERSION_UNSUPPORTED
 * - malformed envelope, wrong requestId, or a result that is not the expected
 *   type: INTERNAL_ERROR (the helper broke the contract; retrying cannot help)
 * - no response within the timeout: PROVIDER_TIMEOUT (retryable)
 * - a failure envelope from the helper: that error, unchanged
 */
export function createNativeClient(
  connectNative: ConnectNative,
  timeoutMs: number = NATIVE_TIMEOUT_MS,
): NativeClient {
  function call<T>(
    request: RequestEnvelope,
    readResult: (result: unknown) => T | undefined,
  ): NativeCall<T> {
    let settle: (r: NativeResult<T>) => void = () => undefined;
    const result = new Promise<NativeResult<T>>((resolve) => {
      settle = resolve;
    });

    const checked = parseRequest(request);
    if (!checked.ok) {
      settle(failure(checked.code));
      return { result, cancel: () => undefined };
    }
    const serialized = JSON.stringify(request);
    const tooLarge = checkRequestSize(serialized);
    if (tooLarge !== null) {
      settle(failure(tooLarge));
      return { result, cancel: () => undefined };
    }

    let port: NativePort;
    try {
      port = connectNative(NATIVE_HOST_NAME);
    } catch {
      settle(failure('HELPER_UNAVAILABLE'));
      return { result, cancel: () => undefined };
    }

    let done = false;
    // `finish` runs only after this is assigned (listeners are added below it).
    const timer = setTimeout(() => finish(failure('PROVIDER_TIMEOUT')), timeoutMs);
    function finish(outcome: NativeResult<T>) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      try {
        port.disconnect();
      } catch {
        // Already closed.
      }
      settle(outcome);
    }
    function onMessage(raw: unknown) {
      if (hasOtherVersion(raw)) return finish(failure('PROTOCOL_VERSION_UNSUPPORTED'));
      const parsed = parseResponse(raw);
      if (parsed.kind === 'invalid') return finish(failure('INTERNAL_ERROR'));
      if (parsed.kind === 'failure') {
        // A helper that cannot parse a request answers with requestId "".
        if (parsed.requestId !== '' && parsed.requestId !== request.requestId) {
          return finish(failure('INTERNAL_ERROR'));
        }
        return finish({ ok: false, error: parsed.error });
      }
      if (parsed.requestId !== request.requestId) return finish(failure('INTERNAL_ERROR'));
      const value = readResult(parsed.result);
      return value === undefined ? finish(failure('INTERNAL_ERROR')) : finish({ ok: true, value });
    }
    const onDisconnect = () => finish(failure('HELPER_UNAVAILABLE'));

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    try {
      port.postMessage(request);
    } catch {
      finish(failure('HELPER_UNAVAILABLE'));
    }
    return { result, cancel: () => finish(failure('PROVIDER_CANCELLED')) };
  }

  return {
    hello: (extensionVersion) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'helper.hello',
          payload: { extensionVersion },
        },
        (r) => {
          const parsed = HelloResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    generateDraft: (payload) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'draft.generate',
          payload,
        },
        (r) => {
          const parsed = DraftResponseSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    getProfile: () =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.get',
          payload: {},
        },
        (r) => {
          const parsed = ProfileSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    upsertProfileItem: (payload) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.item.upsert',
          payload,
        },
        (r): StoredItem | undefined => {
          // The result schema is chosen by the kind that was sent, so a helper
          // answering with another kind's shape fails validation.
          switch (payload.kind) {
            case 'story': {
              const parsed = UPSERT_RESULT_SCHEMAS.story.safeParse(r);
              return parsed.success ? { kind: 'story', item: parsed.data.item } : undefined;
            }
            case 'sample': {
              const parsed = UPSERT_RESULT_SCHEMAS.sample.safeParse(r);
              return parsed.success ? { kind: 'sample', item: parsed.data.item } : undefined;
            }
            case 'rule': {
              const parsed = UPSERT_RESULT_SCHEMAS.rule.safeParse(r);
              return parsed.success ? { kind: 'rule', item: parsed.data.item } : undefined;
            }
          }
        },
      ),
    setResume: (payload) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.resume.set',
          payload,
        },
        (r) => {
          const parsed = ResumeResultSchema.safeParse(r);
          return parsed.success ? parsed.data.resume : undefined;
        },
      ),
    importDocument: (payload) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.import.document',
          payload,
        },
        (r) => {
          const parsed = ImportResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    deleteProfileItem: (payload) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.item.delete',
          payload,
        },
        (r) => {
          const parsed = DeleteResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    exportProfile: () =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.export',
          payload: {},
        },
        (r) => {
          const parsed = ExportResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    deleteAllProfile: () =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'profile.deleteAll',
          payload: { confirm: DELETE_ALL_CONFIRMATION },
        },
        (r) => {
          const parsed = DeleteResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    runDiagnostics: () =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'diagnostics.run',
          payload: {},
        },
        (r) => {
          const parsed = DiagnosticsResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
    setProvider: (provider) =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'settings.setProvider',
          payload: { provider },
        },
        (r) => {
          const parsed = ProviderResultSchema.safeParse(r);
          // The helper must echo the provider that was sent.
          return parsed.success && parsed.data.provider === provider ? provider : undefined;
        },
      ),
    acceptDisclosure: () =>
      call(
        {
          protocolVersion: PROTOCOL_VERSION,
          requestId: newRequestId(),
          type: 'settings.acceptDisclosure',
          payload: {},
        },
        (r) => {
          const parsed = DisclosureResultSchema.safeParse(r);
          return parsed.success ? parsed.data : undefined;
        },
      ),
  };
}
