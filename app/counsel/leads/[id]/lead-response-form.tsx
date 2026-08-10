'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondToLeadAction } from '@/lib/marketplace-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

export function LeadResponseForm({
  firmId,
  leadId,
  hasConsumerAccount,
}: {
  firmId: string;
  leadId: string;
  /**
   * Whether an account sits behind this lead. Anonymous submissions are a
   * supported path, and for those there is no inbox and no acceptance, so
   * the firm should know that before it writes a fee proposal rather than
   * after.
   */
  hasConsumerAccount: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [proposedFee, setProposedFee] = useState('');

  function respond(type: 'interested' | 'pass') {
    setError(null);
    startTransition(async () => {
      const res = await respondToLeadAction(
        firmId,
        leadId,
        type,
        message.trim() || null,
        type === 'interested' ? proposedFee.trim() || null : null,
      );
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? t('Could not send response.'));
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div>
        <p className="eyebrow"><T>Respond to this lead</T></p>
        <p className="text-[13px] text-muted mt-1 leading-relaxed">
          {hasConsumerAccount ? (
            <T>Express interest with an optional message and proposed fee, or
            pass. The consumer sees your response in their inbox and decides
            whether to accept. Their contact details are revealed only after
            they accept.</T>
          ) : (
            <T>Express interest with an optional message and proposed fee, or
            pass. This one came in without an account behind it, so your
            response is recorded for your own team: there is no inbox to send
            it to, and nobody who can accept it or release their contact
            details.</T>
          )}
        </p>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">
          <T>Message to the consumer (optional)</T>
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="input"
          maxLength={1000}
          placeholder={t('Why your firm is a good fit, what your typical engagement looks like, any specific questions you have.')}
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">
          <T>Proposed fee (optional)</T>
        </span>
        <input
          value={proposedFee}
          onChange={(e) => setProposedFee(e.target.value)}
          className="input"
          maxLength={120}
          placeholder={t('e.g. $2,500 flat for the demand letter, or $400/hr')}
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => respond('pass')}
          disabled={pending}
          className="btn-ghost"
        >
          {pending ? <T>Sending...</T> : <T>Pass</T>}
        </button>
        <button
          type="button"
          onClick={() => respond('interested')}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? <T>Sending...</T> : <T>Interested</T>}
        </button>
      </div>
    </section>
  );
}
