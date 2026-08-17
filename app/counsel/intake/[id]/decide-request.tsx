'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/Dialog';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { decideIntakeAction, reopenIntakeAction } from '@/lib/firm-actions';
import { runGatedAction } from '@/lib/gated-action';
import { formatDateNumeric } from '@/lib/format';

/**
 * The other end of the request lifecycle: not taking it on, or having
 * nothing further to do on it.
 *
 * There was no control here before, and the absence was not a gap in the UI
 * so much as a gap in the product: `rejected` and `closed` were declared,
 * lane-mapped and counted, and nothing anywhere wrote either one. What that
 * cost fell on the employee rather than on the firm, because the portal
 * counts a request open until it is one of those two, so "You have N requests
 * open" could only ever grow.
 *
 * Two outcomes rather than one, because they are two different facts and the
 * firm's record should not blur them. See INTAKE_DECISIONS in
 * lib/intake-lanes.ts.
 *
 * WHY THIS IS A MODAL AND NOT A PANEL. It was a standing section in the right
 * rail, opened by a separate button in the action bar that only scrolled to
 * it. The owner asked for the button to raise the reason box directly, which
 * is also the honest shape: the reason is required, so the way in and the
 * thing it asks for should not be two places. The rail keeps no copy of it.
 *
 * The reason is written to the field it was always written to,
 * intake_answers.decision.reason, and app/portal/[id]/page.tsx renders it back
 * to the employee who filed the request. Nothing new is stored.
 *
 * Every refusal here comes from the server. The button below is a
 * convenience, not a gate: `decideIntakeAction` is a public HTTP endpoint and
 * does its own authorization, so nothing is decided by what renders.
 */
export function DecideRequest({
  firmId,
  intakeId,
  decision,
}: {
  firmId: string;
  intakeId: string;
  /** Set once the firm has decided. Read from intake_answers.decision. */
  decision: {
    outcome: string;
    reason: string;
    byName: string;
    at: string;
  } | null;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function decide(outcome: 'declined' | 'closed_out') {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await runGatedAction(() =>
        decideIntakeAction(firmId, intakeId, outcome, reason),
      );
      if (res.ok) {
        setReason('');
        setWarning(res.warning ?? null);
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? t('That could not be saved.'));
      }
    });
  }

  function reopen() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await runGatedAction(() => reopenIntakeAction(firmId, intakeId));
      if (res.ok) {
        setWarning(res.warning ?? null);
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? t('That could not be saved.'));
      }
    });
  }

  const decided = decision != null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !py-1.5 whitespace-nowrap text-[13px]"
      >
        {decided ? <T>See the decision</T> : <T>Decline or close</T>}
      </button>

      {/* The warning outlives the dialog, because it reports what the save
          did rather than what the form needs, and the dialog is gone by the
          time it arrives. */}
      {warning && (
        <p className="text-[12px] text-amber-700 dark:text-amber-300">{warning}</p>
      )}

      {open && (
        <Dialog
          onClose={close}
          ariaLabel={decided ? t('The decision') : t('Decline or close this request')}
          size="sm"
        >
          <div className="p-5">
            {decision ? (
              <DecisionRecord
                decision={decision}
                pending={pending}
                error={error}
                onReopen={reopen}
                onClose={close}
              />
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) decide('declined');
                }}
              >
                <h2 className="text-[15px] font-semibold text-foreground">
                  <T>Decline or close this request</T>
                </h2>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-forest-600 dark:text-cream-100/60">
                    <T>Why, in a sentence or two</T>
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    disabled={pending}
                    autoFocus
                    data-no-translate
                    className="input resize-y text-sm"
                  />
                </label>
                <p className="text-[12px] leading-relaxed text-muted">
                  <T>The person who filed this will read it, and the request
                  stops counting as open for them. Required to decline. It can
                  be put back afterwards.</T>
                </p>
                {error && (
                  <p className="text-[12.5px] text-rose-600 dark:text-rose-300">
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
                  >
                    <T>Cancel</T>
                  </button>
                  {/* Closing out is a different fact from declining and the
                      server lets it carry no reason, so it is not gated on
                      the box the way declining is. */}
                  <button
                    type="button"
                    onClick={() => decide('closed_out')}
                    disabled={pending}
                    className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
                  >
                    {pending ? <T>Saving...</T> : <T>Close it out</T>}
                  </button>
                  <button
                    type="submit"
                    disabled={pending || !reason.trim()}
                    className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
                  >
                    {pending ? <T>Saving...</T> : <T>Decline the request</T>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** What was decided, and the way back if it was decided too early. */
function DecisionRecord({
  decision,
  pending,
  error,
  onReopen,
  onClose,
}: {
  decision: { outcome: string; reason: string; byName: string; at: string };
  pending: boolean;
  error: string | null;
  onReopen: () => void;
  onClose: () => void;
}) {
  const when = new Date(decision.at);
  const shown = Number.isNaN(when.getTime()) ? '' : formatDateNumeric(when);
  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">
        <T>The decision</T>
      </h2>
      <p className="text-[13px] leading-relaxed text-foreground">
        {decision.outcome === 'declined' ? (
          <T>This request was declined.</T>
        ) : (
          <T>This request was closed out.</T>
        )}{' '}
        <span className="text-muted">
          <span data-no-translate>{decision.byName}</span>
          {shown ? <span data-no-translate>{`, ${shown}`}</span> : null}
        </span>
      </p>
      {decision.reason && (
        <p
          data-no-translate
          className="whitespace-pre-wrap rounded-lg border border-edge bg-surface-2 p-3 text-[13px] leading-relaxed text-foreground"
        >
          {decision.reason}
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-muted">
        <T>The person who filed it can see this on their own copy of the
        request, and it no longer counts as open for them. If this was decided
        too early, put it back.</T>
      </p>
      {error && (
        <p className="text-[12.5px] text-rose-600 dark:text-rose-300">{error}</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
        >
          <T>Close</T>
        </button>
        <button
          type="button"
          onClick={onReopen}
          disabled={pending}
          className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
        >
          {pending ? <T>Reopening...</T> : <T>Reopen this request</T>}
        </button>
      </div>
    </div>
  );
}
