import { browser } from 'wxt/browser';
import { appErrorFor, type AppError } from '../../schemas/error';
import type { DiagnosticsResult } from '../../schemas/diagnostics';
import { DiagnosticsReplySchema } from '../../schemas/diagnostics-message';
import { newRequestId } from '../native/request-id';

export type DiagnosticsOutcome =
  { ok: true; value: DiagnosticsResult } | { ok: false; error: AppError };

/** What the settings components see. They never touch browser APIs. */
export interface DiagnosticsClient {
  run(): Promise<DiagnosticsOutcome>;
}

export interface DiagnosticsApi {
  sendMessage(message: unknown): Promise<unknown>;
}

/**
 * Typed client for the settings page: one message to the worker, a validated
 * reply bound to the request id. A worker that cannot be reached is
 * HELPER_UNAVAILABLE; a reply of the wrong shape is INTERNAL_ERROR.
 */
export function createDiagnosticsClient(api: DiagnosticsApi): DiagnosticsClient {
  return {
    async run() {
      const requestId = newRequestId();
      let raw: unknown;
      try {
        raw = await api.sendMessage({
          v: 1,
          requestId,
          type: 'settings.diagnostics.run',
          payload: {},
        });
      } catch {
        return { ok: false, error: appErrorFor('HELPER_UNAVAILABLE') };
      }
      const parsed = DiagnosticsReplySchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId) {
        return { ok: false, error: appErrorFor('INTERNAL_ERROR') };
      }
      return parsed.data.ok
        ? { ok: true, value: parsed.data.result }
        : { ok: false, error: parsed.data.error };
    },
  };
}

/** The real client, for the options entrypoint. */
export function createBrowserDiagnosticsClient(): DiagnosticsClient {
  return createDiagnosticsClient({ sendMessage: (m) => browser.runtime.sendMessage(m) });
}
