'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSigningRequestAction } from '@/lib/firm-actions';

type Signer = { email: string; name: string };

export function CreateSigningRequestForm({
  firmId,
  documentId,
}: {
  firmId: string;
  documentId: string;
}) {
  const router = useRouter();
  const [signers, setSigners] = useState<Signer[]>([{ email: '', name: '' }]);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function update(i: number, patch: Partial<Signer>) {
    setSigners((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function add() {
    if (signers.length >= 8) return;
    setSigners((cur) => [...cur, { email: '', name: '' }]);
  }
  function remove(i: number) {
    setSigners((cur) => cur.filter((_, idx) => idx !== i));
  }

  function submit() {
    setError(null);
    setOk(false);
    const payload = signers
      .map((s) => ({ email: s.email.trim().toLowerCase(), name: s.name.trim() || undefined }))
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));
    if (payload.length === 0) {
      setError('Add at least one signer with a valid email.');
      return;
    }
    startTransition(async () => {
      const res = await createSigningRequestAction(
        firmId,
        documentId,
        payload,
        message.trim() || null,
      );
      if (res.ok) {
        setOk(true);
        setSigners([{ email: '', name: '' }]);
        setMessage('');
        router.refresh();
      } else {
        setError(res.error ?? 'Could not send request.');
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">Send for signature</p>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        Each signer gets a branded, single-use link that opens the document
        inside Advottic. Outside signers also receive a one-time access code
        in a separate email and must enter it before the document is shown -
        so a forwarded link alone can&rsquo;t open it. People on your team see
        it in their portal without a code. Every signer steps through a
        UETA-aligned electronic-records disclosure before the signature pad,
        and every action lands in a tamper-evident audit chain. Jurisdictional
        fit stays with your counsel.
      </p>
      <ul className="space-y-2">
        {signers.map((s, i) => (
          <li key={i} className="grid sm:grid-cols-[1fr,1fr,auto] gap-2">
            <input
              value={s.email}
              onChange={(e) => update(i, { email: e.target.value })}
              placeholder="signer@example.com"
              className="input"
              disabled={pending}
              type="email"
            />
            <input
              value={s.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Display name (optional)"
              className="input"
              disabled={pending}
            />
            {signers.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={pending}
                className="btn-ghost text-sm px-3"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        disabled={pending || signers.length >= 8}
        className="btn-secondary text-sm"
      >
        + Add another signer
      </button>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Message (optional)
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Hey, please review and sign by Friday."
          className="input resize-y"
          disabled={pending}
        />
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? 'Sending...' : 'Send signing request'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          Signing request sent. Each signer received a branded link; outside
          signers also got a one-time access code in a separate email.
        </p>
      )}
    </section>
  );
}
