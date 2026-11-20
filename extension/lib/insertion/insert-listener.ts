import { InsertRequestSchema, InsertResultSchema } from '../../schemas/internal-message';
import type { InsertResult } from '../../schemas/internal-message';
import type { Sender } from '../messaging/panel-messages';
import { insertAnswer, type InsertEnv } from './insert-field';

/**
 * Content-script side of `insert.request`. Returns true when it took the
 * message and will reply later through `sendResponse`; false to stay silent
 * for a foreign sender or a malformed message. Each target id is served once
 * per page, so a repeated request can never write a second time.
 */
export function createInsertListener(deps: {
  runtimeId: string;
  document: Document;
  env?: InsertEnv;
}) {
  const served = new Set<string>();
  return (message: unknown, sender: Sender, sendResponse: (reply: unknown) => void): boolean => {
    if (sender.id !== deps.runtimeId) return false;
    const request = InsertRequestSchema.safeParse(message);
    if (!request.success) return false;
    const { targetId, answer, locator, fingerprint } = request.data.payload;
    const reply = (payload: InsertResult['payload']) =>
      sendResponse(
        InsertResultSchema.parse({
          v: 1,
          requestId: request.data.requestId,
          type: 'insert.result',
          payload,
        }),
      );
    if (served.has(targetId)) {
      reply({ ok: false, error: 'FIELD_STALE' });
      return true;
    }
    served.add(targetId);
    insertAnswer(deps.document, locator, fingerprint, answer, deps.env).then(
      (outcome) => reply(outcome.ok ? { ok: true } : { ok: false, error: outcome.error }),
      () => reply({ ok: false, error: 'FIELD_UNSUPPORTED' }),
    );
    return true;
  };
}
