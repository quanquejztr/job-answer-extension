import { CaptureRequestSchema, CaptureResultSchema } from '../../schemas/internal-message';
import { validateSelection } from '../question/selection';
import type { Sender } from '../messaging/panel-messages';
import type { FieldSearch } from '../targeting/find-field';

/**
 * Content-script side of `capture.request`. It reads the page's current
 * selection, looks for one textarea near it (bounded search, no field values
 * read), and replies with both; it never sees profile, provider, or job data.
 * It reports a field candidate only: the worker builds the FieldTarget.
 * Returns the reply, or undefined to stay silent (wrong sender, unknown or
 * malformed message, or a selection that is not a valid question).
 */
export function createCaptureListener(deps: {
  runtimeId: string;
  getSelectionText(): string;
  findField(): FieldSearch;
}) {
  return (message: unknown, sender: Sender): unknown => {
    if (sender.id !== deps.runtimeId) return undefined;
    const request = CaptureRequestSchema.safeParse(message);
    if (!request.success) return undefined;
    const check = validateSelection(deps.getSelectionText());
    if (!check.ok) return undefined;
    const search = deps.findField();
    return CaptureResultSchema.parse({
      v: 1,
      requestId: request.data.requestId,
      type: 'capture.result',
      payload: {
        question: check.question,
        fieldStatus: search.status,
        field: search.field,
        candidates: search.candidates,
      },
    });
  };
}
