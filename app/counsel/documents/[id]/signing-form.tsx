'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSigningRequestAction } from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

type Signer = { email: string; name: string };

export function CreateSigningRequestForm({
  firmId,
  documentId,
}: {
  firmId: string;
  documentId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [signers, setSigners] = useState<Signer[]>([{ email: '', name: '' }]);
  const [message, setMessage] = useState('');
  // Signers keep a copy unless the firm says otherwise. Stated as the
  // default in the label below rather than left to be inferred from
  // the initial checkbox state.
  const [signerCanDownload, setSignerCanDownload] = useState(true);
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
      setError(t('Add at least one signer with a valid email.'));
      return;
    }
    startTransition(async () => {
      const res = await runGatedAction(() => createSigningRequestAction(
        firmId,
        documentId,
        payload,
        message.trim() || null,
        { signerCanDownload },
      ));
      if (res.ok) {
        setOk(true);
        setSigners([{ email: '', name: '' }]);
        setMessage('');
        setSignerCanDownload(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not send request.'));
      }
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow"><T>Send for signature</T></p>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        <T>Each signer gets a branded, single-use link that opens the document
        inside Advottic. Outside signers also receive a one-time access code
        in a separate email and must enter it before the document is shown -
        so a forwarded link alone can&rsquo;t open it. People on your team see
        it in their portal without a code. Every signer steps through a
        UETA-aligned electronic-records disclosure before the signature pad,
        and every action lands in a tamper-evident audit chain. Jurisdictional
        fit stays with your counsel.</T>
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
              placeholder={t('Display name (optional)')}
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
                <T>Remove</T>
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
        + <T>Add another signer</T>
      </button>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          <T>Message (optional)</T>
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder={t('Hey, please review and sign by Friday.')}
          className="input resize-y"
          disabled={pending}
        />
      </label>
      <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={signerCanDownload}
          onChange={(e) => setSignerCanDownload(e.currentTarget.checked)}
          disabled={pending}
          className="mt-1"
        />
        <span>
          <T>Let the signer download a copy after signing. On by default,
          because a signer keeping a copy of what they signed is the normal
          expectation. Clear it and the download is refused by the server,
          not just hidden, and the signer is told to ask you for a copy.</T>
        </span>
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? <T>Sending...</T> : <T>Send signing request</T>}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          <T>Signing request sent. Each signer received a branded link; outside
          signers also got a one-time access code in a separate email.</T>
        </p>
      )}
    </section>
  );
}
