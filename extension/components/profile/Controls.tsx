import { useId, type ReactNode } from 'react';
import { appErrorFor, type AppError } from '../../schemas/error';
import { INPUT } from './styles';

/** A failed request as text: the catalog message and the one next step. */
export function ErrorAlert({ error, id }: { error: AppError; id?: string }) {
  return (
    <div role="alert" id={id} className="state state-error mt-3">
      <p className="font-medium">{error.message}</p>
      {error.userAction !== undefined && <p>Next step: {error.userAction}.</p>}
    </div>
  );
}

export function errorFor(code: Parameters<typeof appErrorFor>[0]): AppError {
  return appErrorFor(code);
}

interface FieldShell {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Shown as "<count> of <max> characters" under the control. */
  counter?: { count: number; max: number };
  /** Free text shown instead of the character counter (tags). */
  note?: string;
}

function Shell({
  label,
  error,
  hint,
  counter,
  note,
  children,
  id,
}: FieldShell & { id: string; children: (describedBy: string) => ReactNode }) {
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint !== undefined ? hintId : '',
    counter !== undefined || note !== undefined ? countId : '',
    error !== undefined ? errorId : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="text-muted">
          {hint}
        </p>
      )}
      {children(describedBy)}
      {counter !== undefined && (
        <p id={countId} className={counter.count > counter.max ? 'text-danger' : 'text-muted'}>
          {counter.count} of {counter.max} characters
        </p>
      )}
      {note !== undefined && (
        <p id={countId} className="text-muted">
          {note}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="state state-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField(
  props: FieldShell & {
    value: string;
    onChange(value: string): void;
    multiline?: boolean;
    rows?: number;
    readOnly?: boolean;
  },
) {
  const id = useId();
  const { value, onChange, multiline, rows, readOnly } = props;
  return (
    <Shell {...props} id={id}>
      {(describedBy) =>
        multiline === true ? (
          <textarea
            id={id}
            className={INPUT}
            rows={rows ?? 5}
            value={value}
            readOnly={readOnly}
            aria-invalid={props.error !== undefined}
            aria-describedby={describedBy || undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            id={id}
            type="text"
            className={INPUT}
            value={value}
            readOnly={readOnly}
            aria-invalid={props.error !== undefined}
            aria-describedby={describedBy || undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Shell>
  );
}

export function SelectField<V extends string>(
  props: FieldShell & {
    value: V;
    options: readonly { value: V; label: string }[];
    onChange(value: V): void;
  },
) {
  const id = useId();
  return (
    <Shell {...props} id={id}>
      {(describedBy) => (
        <select
          id={id}
          className={INPUT}
          value={props.value}
          aria-describedby={describedBy || undefined}
          onChange={(event) => {
            const picked = props.options.find((o) => o.value === event.target.value);
            if (picked !== undefined) props.onChange(picked.value);
          }}
        >
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Shell>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  error,
  hint,
  role,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  error?: string | undefined;
  hint?: string;
  role?: 'switch';
}) {
  const id = useId();
  const describedBy = [
    hint !== undefined ? `${id}-hint` : '',
    error !== undefined ? `${id}-error` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="mt-3">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          role={role}
          className="mt-1"
          checked={checked}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="state state-error">
          {error}
        </p>
      )}
    </div>
  );
}
