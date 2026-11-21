import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import {
  describeSensitiveCategories,
  type SensitiveCategory,
} from '../../lib/profile/sensitive-text';
import type { AppError } from '../../schemas/error';
import { ErrorAlert } from './Controls';
import { DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';

const OVERLAY = 'fixed inset-0 bg-black/50';
const CONTENT =
  'bg-surface text-text border-border fixed top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4';

/**
 * Focus returns to a named element when the dialog closes. The dialogs here are
 * opened from state rather than from a trigger button, and the element that
 * opened them may be gone (a deleted row), so the caller says where focus goes.
 */
function returnFocus(id: string | undefined) {
  return (event: Event) => {
    event.preventDefault();
    if (id !== undefined) document.getElementById(id)?.focus();
  };
}

export function ConfirmDeleteDialog({
  open,
  title,
  itemLabel,
  detail,
  busy,
  error,
  onConfirm,
  onCancel,
  returnFocusId,
}: {
  open: boolean;
  /** "Delete this story?" */
  title: string;
  /** Names the item; rendered as text. */
  itemLabel: string;
  detail?: ReactNode;
  busy: boolean;
  error: AppError | null;
  onConfirm(): void;
  onCancel(): void;
  returnFocusId?: string;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Escape and the overlay cancel; a delete in flight cannot be dismissed.
        if (!next && !busy) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          role="alertdialog"
          className={CONTENT}
          onCloseAutoFocus={returnFocus(returnFocusId)}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2">
              <p>
                You are about to delete: <q className="font-medium">{itemLabel}</q>
              </p>
              <p className="text-muted mt-2">This cannot be undone.</p>
              {detail !== undefined && <p className="text-muted mt-2">{detail}</p>}
            </div>
          </Dialog.Description>
          {error !== null && <ErrorAlert error={error} />}
          <div className="mt-4 flex gap-2">
            <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={DANGER_BUTTON} disabled={busy} onClick={onConfirm}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * PRIV-008: the text looks like it holds an email address, phone number, or
 * street address. Saving is never blocked; the user must say "Save anyway".
 * Only the category names are shown, never the matched text.
 */
export function SensitiveWarningDialog({
  categories,
  noun,
  onSaveAnyway,
  onCancel,
  returnFocusId,
}: {
  categories: readonly SensitiveCategory[] | null;
  /** "story", "writing sample" */
  noun: string;
  onSaveAnyway(): void;
  onCancel(): void;
  returnFocusId: string;
}) {
  return (
    <Dialog.Root
      open={categories !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          role="alertdialog"
          className={CONTENT}
          onCloseAutoFocus={returnFocus(returnFocusId)}
        >
          <Dialog.Title className="text-lg font-semibold">
            This {noun} may contain personal details
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2">
              <p className="state state-warning">
                The text looks like it contains{' '}
                {categories === null ? '' : describeSensitiveCategories(categories)}.
              </p>
              <p className="mt-2">
                If you save it, it will be sent to the provider you choose whenever a draft uses
                this {noun}. Remove anything you do not want to share before saving.
              </p>
            </div>
          </Dialog.Description>
          <div className="mt-4 flex gap-2">
            <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={onSaveAnyway}>
              Save anyway
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
