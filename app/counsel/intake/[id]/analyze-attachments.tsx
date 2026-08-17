'use client';

import { useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { cleanLegalText } from '@/lib/legal-templates';

/**
 * Analyze the documents submitted with this ticket.
 *
 * What this replaced, because it is the point of the change: the ticket
 * embedded AnalyzeStudio, whose textarea was seeded with the request summary
 * and could be replaced with anything, plus a local file picker. So the
 * control read as "analyse whatever you like" and the endpoint behind it
 * accepted exactly that.
 *
 * There is no input here on purpose. The button names what will be read and
 * the server decides what that is, so there is nothing for a reader to fill in
 * and nothing for a caller to substitute.
 */
export function AnalyzeAttachments({
  intakeId,
  documentNames,
}: {
  intakeId: string;
  /** The attachments this will read, named so the reader knows before spending. */
  documentNames: string[];
}) {
  const t = useT();
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setOut('');
    try {
      const res = await fetch(
        `/api/counsel/intake/${encodeURIComponent(intakeId)}/analyze`,
        { method: 'POST' },
      );
      if (!res.ok || !res.body) {
        const e = await res
          .json()
          .catch(() => ({ error: t('Analysis unavailable.') }));
        setError(e.error || t('Analysis unavailable.'));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setOut(cleanLegalText(acc));
      }
    } catch {
      setError(t('Network error, try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted leading-relaxed">
        <T>
          Reads the documents attached to this request and reports what they
          mean, how the law applies, which side they favor, and the clauses
          worth changing.
        </T>
      </p>

      <ul className="space-y-1">
        {documentNames.map((name) => (
          <li key={name} className="flex items-start gap-1.5 text-[12.5px] text-foreground">
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M11.5 2.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5z" />
              <path d="M11.5 2.5v4h4" />
            </svg>
            <span className="min-w-0 break-words" data-no-translate>
              {name}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn-secondary disabled:opacity-60"
      >
        {busy ? <T>Reading the documents...</T> : <T>Analyze the attachments</T>}
      </button>

      {/* The way to the firm's policies from the ticket. It is the existing
          Policy library and not a second store: the same rows this analysis
          is measured against, and the same ones the employee document checker
          reads. */}
      <p className="text-[12px] text-muted">
        <T>Measured against your</T>{' '}
        <a
          href="/counsel/policies"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          <T>Policy library</T>
        </a>
        <T>. Keep it current and every analysis follows.</T>
      </p>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </p>
      )}

      {out && (
        <div className="overflow-x-auto rounded-lg border border-edge bg-surface-2 p-3">
          <pre
            data-no-translate
            className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-foreground"
          >
            {out}
          </pre>
        </div>
      )}
    </div>
  );
}
