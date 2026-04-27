'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { deleteCaseAction } from '@/lib/actions';
import { FormLoadingOverlay } from '@/components/LoadingOverlay';

/**
 * Inline danger-zone control for the case settings tab. Opens a modal,
 * requires the user to type "delete" verbatim, then fires the server
 * action which permanently drops the case + cascades exhibits, AI
 * reviews, collaborators, and the storage folder.
 */
export function DeleteCaseButton({
  caseId,
  caseTitle,
}: {
  caseId: string;
  caseTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, formAction] = useFormState<{ ok: boolean; error?: string } | null, FormData>(
    deleteCaseAction,
    null,
  );
  const canSubmit = confirm.trim().toLowerCase() === 'delete';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn bg-rose-600 text-white hover:bg-rose-700 font-semibold px-4 py-2 shadow-sm"
      >
        <TrashIcon />
        Delete this case
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-forest-950/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <form
            action={formAction}
            className="relative w-full sm:max-w-md bg-white dark:bg-forest-900 rounded-t-2xl sm:rounded-2xl shadow-card-hover ring-1 ring-rose-200 dark:ring-rose-900/40 overflow-hidden animate-fade-up"
          >
            <input type="hidden" name="caseId" value={caseId} />

            <div className="px-6 py-5 border-b border-rose-100 dark:border-rose-900/30 flex items-start gap-3">
              <span className="flex-none inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200">
                <WarnIcon />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-rose-700 dark:text-rose-200">
                  Delete this case?
                </h2>
                <p className="text-[13px] text-ink-700 dark:text-cream-100/80 mt-1 leading-relaxed">
                  This permanently removes <strong className="text-ink-950 dark:text-cream-100">{caseTitle}</strong>,
                  every exhibit, every Advottic Review review, and any collaborator access.
                  <strong className="block mt-1.5 text-rose-700 dark:text-rose-200">Once deleted, the case cannot be recovered.</strong>
                </p>
              </div>
            </div>

            <div className="px-6 py-5 space-y-3">
              <label className="block">
                <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-700 dark:text-cream-100/80">
                  Type <code className="font-mono text-rose-700 dark:text-rose-200">delete</code> to confirm
                </span>
                <input
                  type="text"
                  name="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="delete"
                  className="input mt-1.5 font-mono"
                  aria-required="true"
                />
              </label>
              {state?.error && (
                <p className="text-[12.5px] text-rose-700 dark:text-rose-200 leading-snug">
                  {state.error}
                </p>
              )}
            </div>

            <div className="px-6 py-4 bg-ink-50/60 dark:bg-forest-950/60 flex items-center justify-end gap-3 border-t border-ink-100 dark:border-forest-700/40">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirm('');
                }}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
              <SubmitButton disabled={!canSubmit} />
            </div>
            {/* Same glowing-icon veil the new-case wizard uses, so the
                3 seconds between "Delete permanently" and the redirect
                feel intentional instead of a frozen UI. Must live INSIDE
                the form because useFormStatus only reports pending for
                its enclosing form. */}
            <FormLoadingOverlay label="Deleting your case file" />
          </form>
        </div>
      )}
    </>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="btn bg-rose-600 text-white hover:bg-rose-700 font-semibold px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? 'Deleting...' : 'Delete permanently'}
    </button>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16m-12 0V5a2 2 0 012-2h4a2 2 0 012 2v2m-9 0v12a2 2 0 002 2h6a2 2 0 002-2V7M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l10 17H2L12 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v5M12 17.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
