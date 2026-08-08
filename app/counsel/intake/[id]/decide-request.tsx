'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { decideIntakeAction, reopenIntakeAction } from '@/lib/firm-actions';
import { runGatedAction } from '@/lib/gated-action';

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
 * Every refusal here comes from the server. The buttons below are a
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
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        router.refresh();
      } else {
        setError(res.error ?? t('That could not be saved.'));
      }
    });
  }

  if (decision) {
    const when = new Date(decision.at);
    const shown = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString();
    return (
      <section className="card p-5 space-y-3">
        <p className="eyebrow"><T>Decision</T></p>
        <p className="text-[13px] text-foreground leading-relaxed">
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
            className="max-w-[70ch] whitespace-pre-wrap rounded-lg border border-edge bg-surface-2 p-3 text-[13px] leading-relaxed text-foreground"
          >
            {decision.reason}
          </p>
        )}
        <p className="text-[12px] text-muted leading-relaxed max-w-xl">
          <T>The person who filed it can see this on their own copy of the
          request, and it no longer counts as open for them. If this was
          decided too early, put it back.</T>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reopen}
            disabled={pending}
            className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
          >
            {pending ? <T>Reopening...</T> : <T>Reopen this request</T>}
          </button>
        </div>
        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>
        )}
        {warning && (
          <p className="text-[12px] text-amber-700 dark:text-amber-300">{warning}</p>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-3">
      <p className="eyebrow"><T>Close this request</T></p>
      <p className="max-w-xl text-[13px] leading-relaxed text-foreground">
        <T>Use this when the team is not taking the matter on, or when there is
        nothing further to do. The person who filed it is told what was decided
        and why, and the request stops counting as open for them. It can be put
        back afterwards.</T>
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('Why, in a sentence or two. Required to decline.')}
        rows={3}
        maxLength={2000}
        disabled={pending}
        data-no-translate
        className="input resize-y text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => decide('declined')}
          disabled={pending}
          className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
        >
          {pending ? <T>Saving...</T> : <T>Decline the request</T>}
        </button>
        <button
          type="button"
          onClick={() => decide('closed_out')}
          disabled={pending}
          className="btn-secondary !py-1.5 text-[13px] disabled:opacity-60"
        >
          {pending ? <T>Saving...</T> : <T>Close it out</T>}
        </button>
      </div>
      {error && (
        <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>
      )}
      {warning && (
        <p className="text-[12px] text-amber-700 dark:text-amber-300">{warning}</p>
      )}
    </section>
  );
}
