import { useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { AppError } from '../../schemas/error';
import type { ProfileResult } from '../../lib/profile/profile-client';
import { ConfirmDeleteDialog } from './Dialogs';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './styles';

/** Shortens long stored text for a button name or a dialog, without changing what is stored. */
export function preview(text: string, max = 80): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

type Mode = { kind: 'idle' } | { kind: 'add' } | { kind: 'edit'; id: string };

export interface ItemSectionProps<T extends { id: string }> {
  /** "Stories" */
  title: string;
  /** "story" */
  singular: string;
  description: ReactNode;
  items: readonly T[];
  max: number;
  addLabel: string;
  emptyText: string;
  /** Names an item in button names and in the delete dialog. */
  labelOf(item: T): string;
  renderItem(item: T): ReactNode;
  /** The add/edit form; `onDone` closes it after a confirmed save, `onCancel` without one. */
  renderForm(args: { item: T | null; onDone(): void; onCancel(): void }): ReactNode;
  /** One line under the title: how many are used. */
  usage(count: number, max: number): string;
  /** Said when the limit is reached; the Add button is then disabled. */
  limitMessage: string;
  deleteTitle: string;
  deleteDetail?: (item: T) => ReactNode;
  onDelete(item: T): Promise<ProfileResult<unknown>>;
}

/**
 * One list with add, edit, and confirmed delete. Only one form is open at a
 * time. After a save, cancel, or delete, focus goes to a stable control (the
 * edited row's Edit button, or Add) so keyboard users never lose their place.
 */
export function ItemSection<T extends { id: string }>(props: ItemSectionProps<T>) {
  const { items, max, singular } = props;
  const uid = useId();
  const headingId = `${uid}-heading`;
  const addId = `${uid}-add`;
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [deleting, setDeleting] = useState<T | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<AppError | null>(null);
  const inFlight = useRef(false);
  const full = items.length >= max;
  const editId = (id: string) => `${uid}-edit-${id}`;

  /** Applies a state change, then moves focus to a control that still exists. */
  function updateThenFocus(update: () => void, id: string) {
    flushSync(update);
    document.getElementById(id)?.focus();
  }
  const closeForm = (restoreTo: string) =>
    updateThenFocus(() => setMode({ kind: 'idle' }), restoreTo);

  async function confirmDelete() {
    if (deleting === null || inFlight.current) return;
    inFlight.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    const result = await props.onDelete(deleting);
    inFlight.current = false;
    setDeleteBusy(false);
    if (result.ok) {
      // The deleted row is gone; focus moves to the section heading.
      updateThenFocus(() => setDeleting(null), headingId);
    } else {
      setDeleteError(result.error);
    }
  }

  const addDescribedBy = full ? `${uid}-limit` : undefined;
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} tabIndex={-1} className="text-base font-semibold">
        {props.title}
      </h2>
      <p className="text-muted mt-1">{props.description}</p>
      <p className="text-muted mt-1" role="status">
        {props.usage(items.length, max)}
      </p>
      {full && (
        <p id={`${uid}-limit`} className="state state-warning mt-2">
          {props.limitMessage}
        </p>
      )}
      {mode.kind === 'idle' && (
        <div className="mt-3">
          <button
            id={addId}
            type="button"
            className={PRIMARY_BUTTON}
            disabled={full}
            aria-describedby={addDescribedBy}
            onClick={() => setMode({ kind: 'add' })}
          >
            {props.addLabel}
          </button>
        </div>
      )}
      {mode.kind === 'add' &&
        props.renderForm({
          item: null,
          onDone: () => closeForm(addId),
          onCancel: () => closeForm(addId),
        })}
      {items.length === 0 && mode.kind !== 'add' ? (
        <p className="text-muted mt-3">{props.emptyText}</p>
      ) : (
        <ul className="mt-3 list-none ps-0">
          {items.map((item) =>
            mode.kind === 'edit' && mode.id === item.id ? (
              <li key={item.id} className="border-border border-t py-3">
                {props.renderForm({
                  item,
                  onDone: () => closeForm(editId(item.id)),
                  onCancel: () => closeForm(editId(item.id)),
                })}
              </li>
            ) : (
              <li key={item.id} className="border-border border-t py-3">
                {props.renderItem(item)}
                <div className="mt-2 flex gap-2">
                  <button
                    id={editId(item.id)}
                    type="button"
                    className={SECONDARY_BUTTON}
                    aria-label={`Edit ${singular}: ${preview(props.labelOf(item), 60)}`}
                    onClick={() => setMode({ kind: 'edit', id: item.id })}
                  >
                    Edit
                  </button>
                  <button
                    id={`${uid}-del-${item.id}`}
                    type="button"
                    className={SECONDARY_BUTTON}
                    aria-label={`Delete ${singular}: ${preview(props.labelOf(item), 60)}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(item);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={deleting !== null}
        title={props.deleteTitle}
        itemLabel={deleting === null ? '' : preview(props.labelOf(deleting), 120)}
        detail={deleting === null ? undefined : props.deleteDetail?.(deleting)}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          const target = deleting;
          updateThenFocus(
            () => {
              setDeleting(null);
              setDeleteError(null);
            },
            target === null ? headingId : `${uid}-del-${target.id}`,
          );
        }}
      />
    </section>
  );
}
