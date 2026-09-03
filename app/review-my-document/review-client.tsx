'use client';

import { useRef, useState } from 'react';
import { stripBellaMarkdown } from '@/lib/bella-markdown';
import { SafetyAdvisory } from '@/components/SafetyAdvisory';
import { formatNumber } from '@/lib/format';

const MAX_CHARS = 30_000;

export function ReviewDocumentClient() {
  const [text, setText] = useState('');
  const [response, setResponse] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responseRef = useRef<HTMLDivElement | null>(null);

  async function submit() {
    const document = text.trim();
    if (!document) {
      setError('Paste the document first.');
      return;
    }
    if (document.length < 50) {
      setError('That looks too short. Paste the full document text.');
      return;
    }
    setError(null);
    setResponse('');
    setPending(true);
    try {
      const res = await fetch('/api/review-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document }),
      });
      if (!res.ok) {
        // Surface known failure modes with specific copy so the user
        // understands what to do next instead of seeing "something
        // went wrong" and bouncing.
        const data = await res
          .json()
          .catch(() => ({ error: null as string | null }));
        let msg: string;
        if (res.status === 429) {
          msg =
            data.error ||
            'Slow down - too many reviews in a short window. Try again in a minute.';
        } else if (res.status === 402 || res.status === 403) {
          // Plain-limit copy: see the note in lib/ai.ts.
          msg =
            data.error ||
            'Your plan is out of review credits for this period, so a new review cannot start right now.';
        } else if (res.status === 503 || res.status === 504) {
          msg =
            data.error ||
            'Bella is overloaded right now. Try again in 30 seconds.';
        } else {
          msg = data.error || `Could not start the review (HTTP ${res.status}).`;
        }
        setError(msg);
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setError('Empty response from the server.');
        return;
      }
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setResponse(acc);
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 sm:p-6">
        <label htmlFor="doc" className="label">
          Paste your document text
        </label>
        <textarea
          id="doc"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          placeholder="Drop the full text here. Contracts, leases, demand letters, retainer agreements, court orders all welcome."
          rows={10}
          className="input resize-y mt-1.5 text-[13px] leading-relaxed font-mono"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500 dark:text-cream-100/55">
          <span>{formatNumber(text.length)} / {formatNumber(MAX_CHARS)} characters</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            We do not retain or train on your text.
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setText('');
              setResponse('');
              setError(null);
            }}
            className="btn-ghost text-sm"
            disabled={pending}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !text.trim()}
            className="btn-primary px-5 py-2.5"
          >
            {pending ? 'Reviewing...' : 'Review my document'}
          </button>
        </div>
      </div>

      {/* Same on-device danger/medical-emergency detection used in the
          case wizard. Someone pasting a threatening letter or typing
          "he is hurting me right now" on this public page should see
          real help (911 + region hotlines) before anything else. */}
      <SafetyAdvisory text={text} />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
        >
          {error}
        </div>
      )}

      {(response || pending) && (
        <div className="card p-5 sm:p-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="aurora inline-flex items-center justify-center h-7 w-7 rounded-full bg-forest-950 ring-1 ring-gold-400/40 text-gold-300">
              <SparkleIcon />
            </span>
            <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
              Bella · Powerful and informed assistant
            </p>
          </div>
          {/*
            Audit P1-2: Bella's stream used to render literal
            asterisks (**bold**) and a no-op `[text](#)` anchor
            because this surface bypassed the floating-widget
            sanitiser. We now run the canonical
            `stripBellaMarkdown` over the live stream before paint,
            which collapses the markdown chrome to readable prose
            without pulling a full markdown renderer (and the
            associated CSP allowlist) into the public review page.
          */}
          <div
            ref={responseRef}
            className="prose prose-sm max-w-none text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed"
          >
            {response ? (
              stripBellaMarkdown(response)
            ) : (
              <span className="text-ink-500 dark:text-cream-100/55 italic">
                Reading the document...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
    </svg>
  );
}
