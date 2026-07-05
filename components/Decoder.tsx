'use client';

/**
 * Decoder - flagship feature.
 *
 * Paste any court notice or legal document; get back a calm,
 * plain-English explanation: what it is, what it means, what you
 * must DO, and the exact deadlines (relative ones computed to real
 * dates). Built for the moment a scary letter lands in the mailbox.
 */

import { useRef, useState } from 'react';

// Inline formatter: turn **bold** into real <strong>, leave the rest
// as text (so the "scary letter" decode never shows raw asterisks).
function inline(s: string): React.ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold text-ink-900">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function render(md: string) {
  const out: React.ReactNode[] = [];
  const lines = md.split('\n');
  let list: string[] = [];
  const flush = (key: string) => {
    if (!list.length) return;
    out.push(
      <ul key={key} className="my-2 space-y-1.5">
        {list.map((li, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink-700 leading-relaxed">
            <span className="mt-2 h-1 w-1 flex-none rounded-full bg-gold-500" />
            <span>{inline(li)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, i) => {
    const l = raw.trimEnd();
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      flush(`l${i}`);
      out.push(
        <hr key={`hr${i}`} className="my-4 border-ink-100" />,
      );
    } else if (/^#{1,3}\s+/.test(l)) {
      flush(`l${i}`);
      const t = l.replace(/^#{1,3}\s+/, '').replace(/\*\*/g, '');
      const danger = /deadline|must do|watch out/i.test(t);
      out.push(
        <h3
          key={`h${i}`}
          className={`mt-5 first:mt-0 mb-1 text-[11px] uppercase tracking-[0.18em] font-bold ${
            danger ? 'text-rose-700' : 'text-forest-700'
          }`}
        >
          {t}
        </h3>,
      );
    } else if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
      list.push(l.replace(/^\s*([-*]|\d+\.)\s+/, ''));
    } else if (l.trim()) {
      flush(`l${i}`);
      const em = /^_.*_$/.test(l.trim());
      out.push(
        <p
          key={`p${i}`}
          className={
            em
              ? 'mt-3 text-xs text-ink-500 italic leading-relaxed'
              : 'text-sm text-ink-700 leading-relaxed my-1'
          }
        >
          {em ? l.trim().replace(/^_|_$/g, '') : inline(l)}
        </p>,
      );
    }
  });
  flush('end');
  return out;
}

export function Decoder() {
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // File attach + OCR. Lets someone drop in a PDF, Word file, or a
  // phone photo of a letter instead of retyping it. The extracted text
  // lands in the textarea so they can glance at it before decoding.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [attachErr, setAttachErr] = useState('');
  const [attachNote, setAttachNote] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires change.
    e.target.value = '';
    if (!file) return;
    setAttachErr('');
    setAttachNote(null);
    setReading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/decode/extract', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.text) {
        setAttachErr(j.error || "We couldn't read that file. Try pasting the text instead.");
        return;
      }
      setText(j.text);
      const bits: string[] = [];
      const kindLabel: Record<string, string> = {
        pdf: 'PDF',
        'pdf-scan': 'scanned PDF (read with text recognition)',
        word: 'Word document',
        text: 'text file',
        image: 'photo (read with text recognition)',
      };
      bits.push(`Read your ${kindLabel[j.kind] ?? 'file'}.`);
      if (j.language) bits.push(`Looks like ${j.language}.`);
      if (j.truncated) bits.push('Long document - we kept the first part.');
      setAttachNote(bits.join(' '));
    } catch {
      setAttachErr('Something interrupted the upload. Try again, or paste the text.');
    } finally {
      setReading(false);
    }
  }

  async function decode() {
    if (text.trim().length < 20 || busy) return;
    setBusy(true);
    setOut('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          today: new Date().toISOString().slice(0, 10),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setOut(`_${j.error || 'Could not decode that right now.'}_`);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setOut((p) => p + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setOut((p) => p + '\n\n_Decoder interrupted._');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="eyebrow mb-2">Decoder</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900">
          Paste the scary letter. Breathe.
        </h1>
        <p className="text-sm text-ink-500 mt-1.5 max-w-xl leading-relaxed">
          A court notice, a demand letter, a summons - paste the text
          and get it back in plain English: what it is, what it means,
          what you must do, and exactly when.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Document text to decode"
        rows={7}
        placeholder="Paste the full text of the document here - or attach it below."
        className="w-full resize-y rounded-2xl border border-ink-200 focus:border-gold-400 focus:outline-none px-4 py-3 text-sm leading-relaxed"
      />

      {/* Attach a file instead of pasting. We read the text out of it
          (PDF / Word / plain text) and use text recognition on photos
          and scans, then drop the result into the box above. */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv,.rtf,image/*,application/pdf"
        onChange={onFile}
        className="hidden"
      />
      <div className="flex flex-wrap items-center gap-3 -mt-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={reading || busy}
          className="inline-flex items-center gap-2 rounded-full border border-ink-200 hover:border-gold-400 hover:bg-gold-50 px-4 py-2 text-sm font-medium text-forest-900 disabled:opacity-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 12.5l-6.6 6.6a4 4 0 0 1-5.66-5.66l7.07-7.07a2.5 2.5 0 0 1 3.54 3.54l-7.08 7.07a1 1 0 0 1-1.41-1.41l6.36-6.37" />
          </svg>
          {reading ? 'Reading your file...' : 'Attach a file'}
        </button>
        <span className="text-[11px] text-ink-400">
          PDF, Word, text, or a photo of the letter. We use text recognition
          on images and scans.
        </span>
      </div>
      {reading && (
        <p className="text-xs text-ink-500 animate-pulse -mt-2">
          Reading your file and pulling the text out. Photos and scans can
          take a few seconds...
        </p>
      )}
      {attachNote && !reading && (
        <p className="text-xs text-forest-700 -mt-2">{attachNote}</p>
      )}
      {attachErr && (
        <p className="text-xs text-rose-700 -mt-2">{attachErr}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={
            busy
              ? () => abortRef.current?.abort()
              : () => {
                  // Same distress-detect-on-submit pattern as
                  // Bella: scan the pasted text once at decode
                  // time so users pasting transcripts of their own
                  // events get the overlay (with full opt-in
                  // controls) rather than a silent decode.
                  import('@/lib/distress-detector').then((m) => {
                    const match = m.detectDistress(text);
                    if (match) m.emitDistress(match);
                  });
                  decode();
                }
          }
          disabled={!busy && text.trim().length < 20}
          className={`btn ${
            busy
              ? 'bg-ink-100 text-ink-700'
              : 'bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-40'
          }`}
        >
          {busy ? 'Stop' : 'Decode it'}
        </button>
        <span className="text-[11px] text-ink-400">
          Nothing is stored unless you save it to a case.
        </span>
      </div>

      {(busy || out) && (
        <div
          className="card p-5 sm:p-6"
          role="region"
          aria-live="polite"
          aria-label="Plain-English explanation"
          // The explanation streams token-by-token; leave it out of runtime
          // auto-translation so the MutationObserver doesn't re-translate
          // partial sentences on every chunk (localizing this output is a
          // source-level, generate-in-locale task, not a DOM swap).
          data-no-translate
        >
          {out ? (
            render(out)
          ) : (
            <p className="text-sm text-ink-400 animate-pulse">
              Reading it carefully...
            </p>
          )}
          {busy && out && (
            <span className="inline-block w-2 h-4 bg-gold-500 align-middle animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
