import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AppError } from '../../schemas/error';
import type { ItemUpsertPayload } from '../../schemas/profile';
import type { ProfileResult, StoredItem } from '../../lib/profile/profile-client';
import { detectSensitiveText, type SensitiveCategory } from '../../lib/profile/sensitive-text';
import { ErrorAlert } from './Controls';
import { SensitiveWarningDialog } from './Dialogs';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';

interface SubmitOptions {
  /** Shows inline errors and returns true when the form may be sent. */
  validate(): boolean;
  /** Text to scan for email, phone, and address patterns before saving. */
  sensitiveTexts(): string[];
  build(): ItemUpsertPayload;
  save(payload: ItemUpsertPayload): Promise<ProfileResult<StoredItem>>;
  onSaved(stored: StoredItem): void;
}

/**
 * Submit flow shared by the four item forms: validate inline, warn once about
 * personal details (PRIV-008), send, and keep the form contents if the helper
 * refuses. A second submit while one is in flight is ignored.
 */
export function useItemSubmit(options: SubmitOptions) {
  const { validate, sensitiveTexts, build, save, onSaved } = options;
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<AppError | null>(null);
  const [warning, setWarning] = useState<SensitiveCategory[] | null>(null);

  const send = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    const result = await save(build());
    inFlight.current = false;
    setSaving(false);
    if (result.ok) onSaved(result.value);
    else setServerError(result.error);
  }, [save, build, onSaved]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (inFlight.current || warning !== null) return;
      if (!validate()) return;
      const found = detectSensitiveText(sensitiveTexts());
      if (found.length > 0) {
        setWarning(found);
        return;
      }
      void send();
    },
    [validate, sensitiveTexts, send, warning],
  );

  const saveAnyway = useCallback(() => {
    setWarning(null);
    void send();
  }, [send]);

  const cancelWarning = useCallback(() => setWarning(null), []);

  return { saving, serverError, warning, submit, saveAnyway, cancelWarning };
}

/**
 * Inline errors appear only after the first failed submit, then stay live. On a
 * failed submit, focus moves to the first field marked aria-invalid.
 */
export function useValidationFocus() {
  const formRef = useRef<HTMLFormElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [, bump] = useState(0);
  const pending = useRef(false);
  // Opening a form moves focus into it (the control that opened it is gone).
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, []);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
  const reportInvalid = useCallback(() => {
    pending.current = true;
    setAttempted(true);
    bump((n) => n + 1);
  }, []);
  return { formRef, attempted, reportInvalid };
}

/**
 * The form chrome: heading, fields, the server error alert, and the buttons.
 * Save is the one primary action; Cancel closes without changing anything.
 */
export function ItemForm({
  title,
  noun,
  saveLabel,
  submitState,
  onCancel,
  children,
  formRef,
}: {
  title: string;
  /** For the personal-details warning: "story", "writing sample". */
  noun: string;
  saveLabel: string;
  submitState: ReturnType<typeof useItemSubmit>;
  onCancel(): void;
  children: ReactNode;
  formRef?: React.Ref<HTMLFormElement>;
}) {
  const id = useId();
  const state = submitState;
  const saveId = `${id}-save`;
  return (
    <form
      ref={formRef}
      noValidate
      aria-labelledby={`${id}-title`}
      className="border-border mt-3 border-t pt-3"
      onSubmit={state.submit}
    >
      <h3 id={`${id}-title`} className="text-base font-semibold">
        {title}
      </h3>
      {children}
      {state.serverError !== null && <ErrorAlert error={state.serverError} />}
      <div className="mt-4 flex gap-2">
        <button id={saveId} type="submit" className={PRIMARY_BUTTON} disabled={state.saving}>
          {state.saving ? 'Saving…' : saveLabel}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {state.saving && (
        <p role="status" className="state state-loading mt-2">
          Saving your changes.
        </p>
      )}
      <SensitiveWarningDialog
        categories={state.warning}
        noun={noun}
        onSaveAnyway={state.saveAnyway}
        onCancel={state.cancelWarning}
        returnFocusId={saveId}
      />
    </form>
  );
}
