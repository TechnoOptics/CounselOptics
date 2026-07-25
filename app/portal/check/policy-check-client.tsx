'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  checkAgainstPoliciesAction,
  type PolicyCheckResult,
} from '@/lib/firm-policies';

const LEVEL_STYLES: Record<string, string> = {
  blocked: 'border-rose-300 bg-rose-50 dark:border-rose-700/50 dark:bg-rose-950/30',
  caution: 'border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30',
  ok: 'border-forest-200 bg-forest-50 dark:border-forest-700/50 dark:bg-forest-900/40',
};
const LEVEL_LABEL: Record<string, string> = {
  blocked: 'Against policy',
  caution: 'Needs caution',
  ok: 'Explicitly allowed',
};
const LEVEL_TEXT: Record<string, string> = {
  blocked: 'text-rose-700 dark:text-rose-300',
  caution: 'text-amber-700 dark:text-amber-300',
  ok: 'text-forest-700 dark:text-cream-100/85',
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
    if (file.type === 'text/plain' || /\.(txt|md)$/i.test(file.name)) {
      setText((await file.text()).slice(0, 40000));
      setLabel(file.name);
    } else {
      setError('For now, paste the document text (or upload a .txt file). PDF upload is coming.');
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
      <header>
        <h1 className="font-display text-2xl font-medium text-forest-900 dark:text-cream-100">Check a document</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-cream-100/70">
          Paste a draft or ask a question, and it is compared against your company&apos;s own
          policies — with a confidence score and the passages legal has said no to. A quick
          self-check, not legal advice: when in doubt,{' '}
          <Link href="/portal/new" className="text-gold-700 underline dark:text-gold-300">
            file a request
          </Link>
          .
        </p>
      </header>

      {policyCount === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center dark:border-forest-700/40">
          <p className="text-2xl" aria-hidden>📋</p>
          <p className="mt-1 text-[14px] font-medium text-forest-900 dark:text-cream-100">No policies to check against yet</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-500 dark:text-cream-100/55">
            Your legal team hasn&apos;t added company policies yet. File a request and they&apos;ll
            help directly.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your draft document here, or ask a question like: “Can I accept a $200 gift card from a vendor?”"
              className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
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
              <label className="cursor-pointer text-[13px] text-ink-500 underline dark:text-cream-100/55">
                Upload a .txt file
                <input
                  type="file"
                  accept=".txt,.md,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-[12px] text-ink-400 dark:text-cream-100/40">
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
            <section className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 dark:border-forest-700/50 dark:bg-forest-900/40">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className={`font-display text-4xl font-semibold tabular-nums ${scoreTone}`}>{result.score}</p>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
                    Confidence
                  </p>
                </div>
                <p className="flex-1 text-[13.5px] leading-relaxed text-ink-700 dark:text-cream-100/85">
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
                        <blockquote className="mt-1 border-l-2 border-current pl-2 text-[12.5px] italic text-ink-600 dark:text-cream-100/70">
                          “{f.quote}”
                        </blockquote>
                      )}
                      <p className="mt-1 text-[12.5px] text-ink-700 dark:text-cream-100/80">{f.note}</p>
                    </div>
                  ))}
                </div>
              )}

              <p className="border-t border-ink-100 pt-3 text-[12px] text-ink-500 dark:border-forest-800/50 dark:text-cream-100/55">
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
