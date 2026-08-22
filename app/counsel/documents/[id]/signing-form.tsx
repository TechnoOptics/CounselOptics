'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createSigningRequestAction,
  type SigningEmailFailure,
} from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';
import type { SigningDirection } from '@/lib/signing-authorization';

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
  direction = 'outbound',
}: {
  firmId: string;
  documentId: string;
  /**
   * Which way this one runs, defaulting to the direction every caller meant
   * before there were two. 'inbound' means the other party sent this document
   * and has asked us to sign it, which creates the request with its
   * authorisation PENDING: the link is minted so the firm's own signatory can
   * reach the document, and app/sign/[token] refuses to open it until
   * somebody who may bind the firm has approved it.
   */
  direction?: SigningDirection;
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
      const res = await runGatedAction(() => createSigningRequestAction(
        firmId,
        documentId,
        payload,
        message.trim() || null,
        { signerCanDownload, direction },
      ));
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
      setSignerCanDownload(true);
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
      {/* "Single-use link" is gone from this description because it was
          not true and this is the panel that sets the firm's
          expectation. The link is not consumed by signing: the document
          cannot be signed a second time, on any path, but the address
          keeps resolving so the signer can reach the record that binds
          them, which is what 15 USC 7001(a)(1) is built around. It stops
          resolving at the end of a fixed retention window. The window is
          stated in days to the signer, on the page and in the invitation
          email, from the one constant in lib/signer-retention.ts; it is
          described here rather than quoted because <T> looks a whole
          static sentence up in a dictionary and an interpolated number
          would break that lookup. */}
      <p className="text-[11px] text-muted leading-relaxed">
        <T>Each signer gets a branded link that opens the document inside
        Advottic. Once they sign, that link cannot be used to sign again, and
        it keeps working for a limited period afterwards so they can download
        their copy. Outside signers also receive a one-time access code in a
        separate email and must enter it before the document is shown - so a
        forwarded link alone can&rsquo;t open it. People on your team see it
        in their portal without a code. Every signer steps through a
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
        <span className="block text-sm font-medium text-foreground mb-1.5">
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
      <label className="flex items-start gap-3 text-[13px] text-foreground">
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
