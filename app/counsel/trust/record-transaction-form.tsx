'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordTrustTransactionAction } from '@/lib/trust-accounting';
import { parseAmountToCents } from '@/lib/trust-amount';
import { T, useT } from '@/components/i18n/LocaleProvider';

const KIND_LABEL: Record<string, string> = {
  deposit: 'Deposit (in)',
  earned_fee_transfer: 'Earned-fee transfer (out)',
  disbursement: 'Disbursement to third party (out)',
  refund: 'Refund to client (in)',
  bank_fee: 'Bank fee (out)',
  interest: 'Interest credit (in)',
  correction: 'Correction',
};

export function RecordTransactionForm({
  firmId,
  accountId,
}: {
  firmId: string;
  accountId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const clientLabel = String(formData.get('clientLabel') ?? '').trim();
    const kind = String(formData.get('kind') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim() || null;
    const reference = String(formData.get('reference') ?? '').trim() || null;
    if (!clientLabel) {
      setError(t('Enter the client or matter this entry belongs to.'));
      return;
    }
    // Exact cents. A ledger entry carries its sign in `kind`, so the magnitude
    // must be strictly positive; a typed "-500" is rejected rather than
    // silently posted as a positive $500.
    const parsed = parseAmountToCents(String(formData.get('amount') ?? ''));
    if (!parsed.ok) {
      setError(t(parsed.error));
      return;
    }
    const amount = parsed.cents;
    if (!Object.keys(KIND_LABEL).includes(kind)) {
      setError(t('Choose what kind of entry this is.'));
      return;
    }
    startTransition(async () => {
      const res = await recordTrustTransactionAction(firmId, accountId, {
        clientLabel,
        kind: kind as Parameters<typeof recordTrustTransactionAction>[2]['kind'],
        amountCents: amount,
        description,
        reference,
      });
      if (res.ok) router.refresh();
      else setError(res.error ?? t('Insert failed.'));
    });
  }

  return (
    <form action={submit} className="card p-5 space-y-4">
      <p className="eyebrow"><T>Record a transaction</T></p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Client / matter label</T>
          </span>
          <input
            name="clientLabel"
            required
            placeholder={t('Smith v. Acme - retainer')}
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Kind</T>
          </span>
          <select name="kind" required className="input" defaultValue="">
            <option value="" disabled>
              <T>Pick a kind</T>
            </option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                <T>{label}</T>
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Amount (USD)</T>
          </span>
          <input
            name="amount"
            inputMode="decimal"
            placeholder="2500.00"
            className="input"
            required
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Reference (optional)</T>
          </span>
          <input
            name="reference"
            placeholder={t('Wire ID / check number')}
            className="input"
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          <T>Description (optional)</T>
        </span>
        <input
          name="description"
          placeholder={t('Initial retainer per engagement letter')}
          className="input"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t('Recording...') : t('Record')}
        </button>
      </div>
    </form>
  );
}
