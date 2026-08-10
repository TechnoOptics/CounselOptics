'use client';

import { useRef, useState } from 'react';
import { cleanLegalText } from '@/lib/legal-templates';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { PanelCard } from '@/components/counsel/patterns';

/**
 * Submit a contract/document and get a structured breakdown: what it
 * means, governing-law context, a bias rating, hidden consequences,
 * and recommended changes. Streams from /api/counsel/analyze; output
 * is run through cleanLegalText so it stays free of em-dashes and AI
 * tells. Embeddable (initialText) so the intake detail can analyze
 * what an employee submitted in one click.
 */
export function AnalyzeStudio({
  initialText = '',
  embedded = false,
}: {
  initialText?: string;
  embedded?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function readFile(f: File) {
    if (f.size > 2_000_000) {
      setError(t('File is too large - paste the text instead.'));
      return;
    }
    if (!/\.(txt|md|csv|log)$/i.test(f.name) && !f.type.startsWith('text/')) {
      setError(
        t('Upload a plain-text file, or copy the document text and paste it.'),
      );
      return;
    }
    setError(null);
    setText(await f.text());
  }

  async function run() {
    const body = text.trim();
    if (body.length < 50) {
      setError(t('Paste the full document for a meaningful analysis.'));
      return;
    }
    setBusy(true);
    setError(null);
    setOut('');
    try {
      const res = await fetch('/api/counsel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
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
      setError(t('Network error - try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={embedded ? 'space-y-3' : 'grid lg:grid-cols-2 gap-6'}>
      <PanelCard
        title={<T>Document</T>}
        bodyClassName="p-5 space-y-3"
        action={
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[12px] text-accent-text hover:underline"
            >
              <T>Upload .txt</T>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.csv,.log,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </>
        }
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={embedded ? 6 : 16}
          placeholder={t('Paste the full contract or document text...')}
          className="input resize-y font-mono text-[12.5px]"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">
            {text.length.toLocaleString()} <T>chars · stays on your firm workspace</T>
          </span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? <T>Analyzing...</T> : <T>Analyze</T>}
          </button>
        </div>
        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </PanelCard>

      <PanelCard title={<T>Analysis</T>} bodyClassName="p-5">
        {out ? (
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground font-sans">
            {out}
          </pre>
        ) : (
          <p className="text-[13px] italic text-muted">
            {busy ? (
              <T>Reading the document...</T>
            ) : (
              <T>The breakdown, governing-law context, bias rating, hidden consequences, and recommended changes appear here.</T>
            )}
          </p>
        )}
        {out && (
          <p className="text-[11px] text-muted mt-3">
            <T>Analysis for licensed counsel, not advice to a consumer.</T>
          </p>
        )}
      </PanelCard>
    </div>
  );
}
