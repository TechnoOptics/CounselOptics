'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordTrustTransactionAction } from '@/lib/trust-accounting';

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const clientLabel = String(formData.get('clientLabel') ?? '').trim();
    const kind = String(formData.get('kind') ?? '').trim();
    const amountStr = String(formData.get('amount') ?? '').replace(
      /[^0-9.]/g,
      '',
    );
    const description = String(formData.get('description') ?? '').trim() || null;
    const reference = String(formData.get('reference') ?? '').trim() || null;
    const amount = Math.round(Number(amountStr) * 100);
    if (!clientLabel) {
      setError('Client label is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!Object.keys(KIND_LABEL).includes(kind)) {
      setError('Pick a transaction kind.');
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
      else setError(res.error ?? 'Insert failed.');
    });
  }

  return (
    <form action={submit} className="card p-5 space-y-4">
      <p className="eyebrow">Record a transaction</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Client / matter label
          </span>
          <input
            name="clientLabel"
            required
            placeholder="Smith v. Acme - retainer"
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Kind
          </span>
          <select name="kind" required className="input" defaultValue="">
            <option value="" disabled>
              Pick a kind
            </option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Amount (USD)
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
            Reference (optional)
          </span>
          <input
            name="reference"
            placeholder="Wire ID / check number"
            className="input"
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Description (optional)
        </span>
        <input
          name="description"
          placeholder="Initial retainer per engagement letter"
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
          {pending ? 'Recording...' : 'Record'}
        </button>
      </div>
    </form>
  );
}
