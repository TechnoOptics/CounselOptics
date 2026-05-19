'use client';

import { useRef, useState } from 'react';
import { cleanLegalText } from '@/lib/legal-templates';

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
  const [text, setText] = useState(initialText);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function readFile(f: File) {
    if (f.size > 2_000_000) {
      setError('File is too large - paste the text instead.');
      return;
    }
    if (!/\.(txt|md|csv|log)$/i.test(f.name) && !f.type.startsWith('text/')) {
      setError(
        'Upload a plain-text file, or copy the document text and paste it.',
      );
      return;
    }
    setError(null);
    setText(await f.text());
  }

  async function run() {
    const body = text.trim();
    if (body.length < 50) {
      setError('Paste the full document for a meaningful analysis.');
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
          .catch(() => ({ error: 'Analysis unavailable.' }));
        setError(e.error || 'Analysis unavailable.');
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
      setError('Network error - try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={embedded ? 'space-y-3' : 'grid lg:grid-cols-2 gap-6'}>
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Document</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-[12px] underline text-ink-600 dark:text-cream-100/70"
          >
            Upload .txt
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
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={embedded ? 6 : 16}
          placeholder="Paste the full contract or document text..."
          className="input resize-y font-mono text-[12.5px]"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-400 dark:text-cream-100/45">
            {text.length.toLocaleString()} chars · stays on your firm
            workspace
          </span>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </div>

      <div className="card p-5">
        <p className="eyebrow mb-2">Analysis</p>
        {out ? (
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-800 dark:text-cream-100/90 font-sans">
            {out}
          </pre>
        ) : (
          <p className="text-[13px] italic text-ink-500 dark:text-cream-100/55">
            {busy
              ? 'Reading the document...'
              : 'The breakdown, governing-law context, bias rating, hidden consequences, and recommended changes appear here.'}
          </p>
        )}
        {out && (
          <p className="text-[11px] text-ink-400 dark:text-cream-100/45 mt-3">
            Analysis for licensed counsel, not advice to a consumer.
          </p>
        )}
      </div>
    </div>
  );
}
