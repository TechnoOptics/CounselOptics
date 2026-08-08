'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  checkAgainstPoliciesAction,
  extractCheckTextAction,
  type PolicyCheckResult,
} from '@/lib/firm-policies';
import { PageHeader, EmptyState } from '@/components/counsel/ui';

const LEVEL_STYLES: Record<string, string> = {
  blocked: 'border-rose-300 bg-rose-50 dark:border-rose-700/50 dark:bg-rose-950/30',
  caution: 'border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30',
  ok: 'border-edge-bright bg-surface-2',
};
const LEVEL_LABEL: Record<string, string> = {
  blocked: 'Against policy',
  caution: 'Needs caution',
  ok: 'Explicitly allowed',
};
const LEVEL_TEXT: Record<string, string> = {
  blocked: 'text-rose-700 dark:text-rose-300',
  caution: 'text-amber-700 dark:text-amber-300',
  ok: 'text-foreground',
};

export function PolicyCheckClient({ firmId, policyCount }: { firmId: string; policyCount: number }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PolicyCheckResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await checkAgainstPoliciesAction(firmId, { text, label });
    setBusy(false);
    if (!res.ok || !res.result) setError(res.error ?? 'Could not complete the check.');
    else setResult(res.result);
  };

  const onFile = async (file: File) => {
    setError(null);
    if (file.type === 'text/plain' || /\.(txt|md)$/i.test(file.name)) {
      setText((await file.text()).slice(0, 40000));
      setLabel(file.name);
      return;
    }
    // PDF, Word, spreadsheets, and photos go through the server reader
    // (OCR for pictures), then land in the text box ready to check.
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await extractCheckTextAction(firmId, fd);
      if (!res.ok || !res.text) {
        setError(res.error ?? 'Could not read that file.');
        return;
      }
      setText(res.text);
      setLabel(file.name);
    } finally {
      setBusy(false);
    }
  };

  const scoreTone =
    (result?.score ?? 0) >= 75
      ? 'text-forest-700 dark:text-emerald-300'
      : (result?.score ?? 0) >= 45
        ? 'text-amber-600 dark:text-amber-300'
        : 'text-rose-600 dark:text-rose-300';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check a document"
        subtitle={
          <>
            Paste a draft or ask a question, and it is compared against your
            company&apos;s own policies, with a confidence score and the passages
            legal has said no to. A quick self-check, not legal advice: when in
            doubt,{' '}
            <Link href="/portal/new" className="text-gold-700 underline dark:text-gold-300">
              file a request
            </Link>
            .
          </>
        }
      />

      {policyCount === 0 ? (
        <EmptyState
          title="No policies to check against yet"
          sub={
            <>
              Your legal team hasn&apos;t added company policies yet. File a
              request and they&apos;ll help directly.
            </>
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            <textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your draft document here, or ask a question like: “Can I accept a $200 gift card from a vendor?”"
              className="w-full rounded-xl border border-edge bg-surface px-4 py-3 text-[14px] text-foreground outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || text.trim().length < 20}
                onClick={() => void run()}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Checking against your policies…' : 'Check it'}
              </button>
              <label className="cursor-pointer text-[13px] text-muted underline">
                Upload a file (PDF, Word, text, or a photo)
                <input
                  type="file"
                  accept=".txt,.md,.pdf,.docx,.csv,.xlsx,image/*,text/plain,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-[12px] text-muted">
                Checked against {policyCount} company polic{policyCount === 1 ? 'y' : 'ies'}.
              </span>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </p>
          )}

          {result && (
            <section className="space-y-4 rounded-xl border border-edge bg-surface p-5">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className={`text-4xl font-semibold tabular-nums ${scoreTone}`}>{result.score}</p>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                    Confidence
                  </p>
                </div>
                <p className="flex-1 text-[13.5px] leading-relaxed text-foreground">
                  {result.verdict}
                </p>
              </div>

              {result.flags.length > 0 && (
                <div className="space-y-2">
                  {result.flags.map((f, i) => (
                    <div key={i} className={`rounded-lg border p-3 ${LEVEL_STYLES[f.level]}`}>
                      <p className={`text-[11px] font-semibold uppercase tracking-wider ${LEVEL_TEXT[f.level]}`}>
                        {LEVEL_LABEL[f.level]} · {f.policy}
                      </p>
                      {f.quote && (
                        <blockquote className="mt-1 border-l-2 border-current pl-2 text-[12.5px] italic text-muted">
                          “{f.quote}”
                        </blockquote>
                      )}
                      <p className="mt-1 text-[12.5px] text-foreground">{f.note}</p>
                    </div>
                  ))}
                </div>
              )}

              <p className="border-t border-edge pt-3 text-[12px] text-muted">
                Still unsure?{' '}
                <Link href="/portal/new" className="text-gold-700 underline dark:text-gold-300">
                  File a request
                </Link>{' '}
                and your legal team will take it from here.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
