'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createSigningRequestAction,
  type SigningEmailFailure,
} from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

type Signer = { email: string; name: string };

/**
 * What the last submission actually achieved. A request whose emails
 * never left has to look different from one that went out cleanly: the
 * signers cannot act on a link they were never sent, and the firm has no
 * way to know that from a green banner.
 */
type Result =
  | { kind: 'sent'; requestId: string }
  | { kind: 'partial'; requestId: string; failures: SigningEmailFailure[] };

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
  const [pending, startTransition] = useTransition();
  // The sentence, plus whether we wrote it. Our own copy goes through
  // t() at render time so it lands in the reader's language once the
  // translation does; a mail-provider or store diagnostic is shown
  // verbatim, since translating it destroys the one thing it is good
  // for.
  const [error, setError] = useState<{ text: string; ours: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

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
    setResult(null);
    const payload = signers
      .map((s) => ({ email: s.email.trim().toLowerCase(), name: s.name.trim() || undefined }))
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));
    if (payload.length === 0) {
      setError({ text: 'Add at least one signer with a valid email.', ours: true });
      return;
    }
    startTransition(async () => {
      const res = await createSigningRequestAction(
        firmId,
        documentId,
        payload,
        message.trim() || null,
      );
      if (!res.ok || !res.requestId) {
        setError(
          res.error
            ? { text: res.error, ours: res.errorSource === 'app' }
            : { text: 'Could not send request.', ours: true },
        );
        return;
      }
      // The request row and its sign tokens exist either way, so the
      // fields are cleared to stop a duplicate request being sent. A
      // failed email is recovered from the request page, not from here.
      setSigners([{ email: '', name: '' }]);
      setMessage('');
      setResult(
        res.emailFailures && res.emailFailures.length > 0
          ? { kind: 'partial', requestId: res.requestId, failures: res.emailFailures }
          : { kind: 'sent', requestId: res.requestId },
      );
      router.refresh();
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
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">
          {pending ? <T>Sending...</T> : <T>Send signing request</T>}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error.ours ? (
            <span>{t(error.text)}</span>
          ) : (
            <span data-no-translate>{error.text}</span>
          )}
        </p>
      )}
      {result?.kind === 'sent' && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          <T>Signing request sent. Each signer received a branded link; outside
          signers also got a one-time access code in a separate email.</T>
        </p>
      )}
      {result?.kind === 'partial' && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-950/25 px-3 py-3 text-sm text-amber-900 dark:text-amber-100 space-y-2">
          <p className="font-semibold">
            <T>The request was created, but some email did not go out.</T>
          </p>
          <p className="text-[12.5px] leading-relaxed">
            <T>These signers have not been contacted and cannot sign until
            they are. Their sign links are valid, so use Resend on the
            request page once mail delivery is working.</T>
          </p>
          <ul className="space-y-1 text-[12.5px]">
            {result.failures.map((f, i) => (
              <li key={`${f.email}-${f.kind}-${i}`} className="font-mono break-all">
                <span data-no-translate>{f.email}</span>
                {' - '}
                {f.kind === 'link' ? (
                  <T>sign link not sent</T>
                ) : (
                  <T>access code not sent</T>
                )}
                {': '}
                {f.source === 'app' ? (
                  <span>{t(f.error)}</span>
                ) : (
                  <span data-no-translate>{f.error}</span>
                )}
              </li>
            ))}
          </ul>
          <p>
            <Link
              href={`/counsel/signing/${result.requestId}`}
              className="underline underline-offset-2 font-semibold"
            >
              <T>Open the request to resend</T>
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
