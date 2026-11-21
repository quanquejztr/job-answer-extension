import { appErrorFor } from '../../schemas/error';
import {
  DiagnosticsRunMessageSchema,
  type DiagnosticsReply,
} from '../../schemas/diagnostics-message';
import { RequestIdSchema } from '../../schemas/request-id';
import { isTrustedExtensionPage, type Sender } from '../messaging/panel-messages';
import type { NativeClient } from '../native/native-client';

/** Client-side limit for one diagnostics round trip (the helper bounds its own checks to 15 s). */
export const DIAGNOSTICS_TIMEOUT_MS = 30_000;

export interface DiagnosticsService {
  run(requestId: string): Promise<DiagnosticsReply>;
}

/**
 * Worker-side diagnostics: one `diagnostics.run` per request. A helper error
 * (including HELPER_UNAVAILABLE when the helper is missing) passes through as
 * its own AppError. Nothing here reads credentials or starts a login.
 */
export function createDiagnosticsService(
  native: Pick<NativeClient, 'runDiagnostics'>,
): DiagnosticsService {
  return {
    async run(requestId) {
      const r = await native.runDiagnostics().result;
      return r.ok
        ? { v: 1, requestId, ok: true, result: r.value }
        : { v: 1, requestId, ok: false, error: r.error };
    },
  };
}

/**
 * Worker-side handler for `settings.diagnostics.run`. Returns true when it took
 * the message and will answer through `sendResponse`. Extension pages only.
 */
export function handleDiagnosticsMessage(
  deps: { runtimeId: string; service: DiagnosticsService },
  message: unknown,
  sender: Sender,
  sendResponse: (reply: unknown) => void,
): boolean {
  if (!isTrustedExtensionPage(sender, deps.runtimeId)) return false;
  if (typeof message !== 'object' || message === null) return false;
  if (Reflect.get(message, 'type') !== 'settings.diagnostics.run') return false;
  const parsed = DiagnosticsRunMessageSchema.safeParse(message);
  if (!parsed.success) {
    const id = RequestIdSchema.safeParse(Reflect.get(message, 'requestId'));
    if (!id.success) return false;
    sendResponse({ v: 1, requestId: id.data, ok: false, error: appErrorFor('INVALID_REQUEST') });
    return true;
  }
  const { requestId } = parsed.data;
  deps.service.run(requestId).then(sendResponse, () => {
    sendResponse({ v: 1, requestId, ok: false, error: appErrorFor('INTERNAL_ERROR') });
  });
  return true;
}
