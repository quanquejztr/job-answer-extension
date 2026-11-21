import * as Dialog from '@radix-ui/react-dialog';
import { useId, useRef, useState } from 'react';
import { browserDownloadEnv, downloadProfileExport } from '../../lib/profile/export-file';
import type { ProfileClient } from '../../lib/profile/profile-client';
import type { AppError } from '../../schemas/error';
import { DELETE_ALL_CONFIRMATION, type Profile } from '../../schemas/profile';
import { ErrorAlert } from './Controls';
import { DANGER_BUTTON, INPUT, SECONDARY_BUTTON } from './styles';

/** Saves the profile as a file and returns its name. Replaceable in tests. */
export type SaveExport = (profile: Profile) => string;

const defaultSave: SaveExport = (profile) =>
  downloadProfileExport(profile, browserDownloadEnv(), new Date());

const OVERLAY = 'fixed inset-0 bg-black/50';
const CONTENT =
  'bg-surface text-text border-border fixed top-1/2 left-1/2 max-h-[90vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border p-4';

type Exported = { state: 'idle' } | { state: 'busy' } | { state: 'done'; filename: string };

/**
 * Export and delete-all (FR-015, AC-013). Nothing here runs by itself: the
 * profile is fetched and saved only on the Export click, and data is deleted
 * only after the dialog's typed confirmation. It works without the profile
 * having loaded, so a damaged profile can still be removed (the recovery path
 * behind the storage error hint).
 */
export function YourDataSection({
  client,
  onDeleted,
  saveExport = defaultSave,
}: {
  client: ProfileClient;
  /** Called after the helper confirms deletion, so the lists can reload. */
  onDeleted(): void;
  saveExport?: SaveExport;
}) {
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [exported, setExported] = useState<Exported>({ state: 'idle' });
  const [exportError, setExportError] = useState<AppError | null>(null);
  const [deleted, setDeleted] = useState(false);
  const exporting = useRef(false);

  async function doExport() {
    if (exporting.current) return;
    exporting.current = true;
    setExportError(null);
    setExported({ state: 'busy' });
    try {
      const r = await client.export();
      if (!r.ok) {
        setExported({ state: 'idle' });
        setExportError(r.error);
        return;
      }
      try {
        setExported({ state: 'done', filename: saveExport(r.value) });
      } catch {
        // The browser refused the download; say so without any detail.
        setExported({ state: 'idle' });
        setExportError({
          code: 'INTERNAL_ERROR',
          message: 'The file could not be saved.',
          retryable: false,
          userAction: 'Try again',
        });
      }
    } finally {
      exporting.current = false;
    }
  }

  return (
    <section aria-labelledby={`${uid}-heading`} className="border-border mt-6 border-t pt-4">
      <h3 id={`${uid}-heading`} ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        Your data
      </h3>

      <h4 className="mt-3 font-medium">Export</h4>
      <p className="mt-1">
        The export file holds your full profile in readable form: your résumé, every story, writing
        sample, and writing rule, plus your settings. It is not encrypted, so store it privately.
      </p>
      <div className="mt-2">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={exported.state === 'busy'}
          onClick={() => void doExport()}
        >
          {exported.state === 'busy' ? 'Exporting…' : 'Export my data'}
        </button>
      </div>
      {exported.state === 'done' && (
        <p role="status" className="state state-success mt-2">
          Exported: {exported.filename}
        </p>
      )}
      {exportError !== null && <ErrorAlert error={exportError} />}

      <h4 className="mt-4 font-medium">Delete all data</h4>
      <p className="mt-1">
        Removes the résumé, stories, writing samples, writing rules, and settings this app stores on
        this Mac. It cannot be undone, so export first if you want a copy.
      </p>
      <div className="mt-2">
        <DeleteAllDialog
          client={client}
          triggerRef={triggerRef}
          afterClose={(didDelete) => {
            if (didDelete) {
              setDeleted(true);
              setExported({ state: 'idle' });
              setExportError(null);
              onDeleted();
              headingRef.current?.focus();
            } else triggerRef.current?.focus();
          }}
        />
      </div>
      {deleted && (
        <p role="status" className="state state-success mt-2">
          All data stored by this app on this Mac was deleted. Your lists are now empty.
        </p>
      )}
    </section>
  );
}

function DeleteAllDialog({
  client,
  triggerRef,
  afterClose,
}: {
  client: ProfileClient;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  afterClose(didDelete: boolean): void;
}) {
  const uid = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const succeeded = useRef(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  function show() {
    setTyped('');
    setError(null);
    succeeded.current = false;
    setOpen(true);
  }

  async function confirm() {
    if (inFlight.current || typed !== DELETE_ALL_CONFIRMATION) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await client.deleteAll();
      if (r.ok) {
        succeeded.current = true;
        setOpen(false);
      } else {
        setError(r.error);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className={DANGER_BUTTON} onClick={show}>
        Delete all data…
      </button>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          // Escape and the overlay cancel; a delete in flight cannot be dismissed.
          if (!next && !busy) setOpen(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={OVERLAY} />
          <Dialog.Content
            role="alertdialog"
            className={CONTENT}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRef.current?.focus(); // the safe choice has focus first
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              afterClose(succeeded.current);
            }}
          >
            <Dialog.Title className="text-lg font-semibold">Delete all data?</Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-2">
                <p>
                  This removes everything this app stores on this Mac: your résumé, stories, writing
                  samples, writing rules, and settings. It cannot be undone.
                </p>
                <p className="mt-2 font-medium">This does not remove:</p>
                <ul className="mt-1 list-disc ps-5">
                  <li>Files you exported earlier.</li>
                  <li>Your browser, or this extension’s installation.</li>
                  <li>
                    Your Claude or ChatGPT account, or anything those providers kept from earlier
                    drafts.
                  </li>
                  <li>Anything on employer sites.</li>
                  <li>Backups of this Mac, or anything macOS keeps.</li>
                </ul>
                <p className="text-muted mt-2">The helper program and its folder stay installed.</p>
              </div>
            </Dialog.Description>
            <label htmlFor={`${uid}-confirm`} className="mt-3 block font-medium">
              Type {DELETE_ALL_CONFIRMATION} to confirm
            </label>
            <input
              id={`${uid}-confirm`}
              type="text"
              className={INPUT}
              value={typed}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void confirm();
                }
              }}
            />
            {error !== null && <ErrorAlert error={error} />}
            <div className="mt-4 flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                className={SECONDARY_BUTTON}
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DANGER_BUTTON}
                disabled={busy || typed !== DELETE_ALL_CONFIRMATION}
                onClick={() => void confirm()}
              >
                {busy ? 'Deleting…' : 'Delete all data'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
