import { NATIVE_HOST_NAME } from '../constants/native-host';
import { DraftResponseSchema, type DraftRequest, type DraftResponse } from '../../schemas/draft';
import { appErrorFor, type AppError, type ErrorCode } from '../../schemas/error';
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

export interface NativeClient {
  hello(extensionVersion: string): NativeCall<HelloResult>;
  generateDraft(request: DraftRequest): NativeCall<DraftResponse>;
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
  };
}
