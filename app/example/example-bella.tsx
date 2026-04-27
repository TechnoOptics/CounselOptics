'use client';

import { useEffect, useRef, useState } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

// A scripted Bella conversation that runs in-place when the user clicks
// "Replay demo." No network, no auth, no API key required - this is a
// pure visual showcase of how the real Bella reads.
const SCRIPT: Message[] = [
  {
    role: 'assistant',
    content:
      "Hi, I'm Bella. Ask me about this case, how to use Advottic, or plain-language legal concepts.",
  },
  { role: 'user', content: 'What does the 21-day Minnesota security-deposit rule actually say?' },
  {
    role: 'assistant',
    content:
      'In plain English: under Minn. Stat. § 504B.178 a landlord generally has 21 days from the date the tenant provides a forwarding address to either return the security deposit in full or send the tenant a written, itemized list of any deductions plus the balance. If they miss that window without a good-faith reason, statutory penalties may apply. **This is general information, not legal advice** - the exact deadlines and what counts as proper notice vary, so confirm with a licensed Minnesota attorney before relying on it.',
  },
  { role: 'user', content: 'Is this case strong?' },
  {
    role: 'assistant',
    content:
      "I won't predict outcomes, but here's what the file shows that **could be** helpful at conciliation: the lease (Exhibit A), a signed move-in inspection (B), a move-out video (C), and a certified-mail forwarding letter (D). The 21-day window appears to have closed. Your **Advottic Review review** flagged a few things worth strengthening - photos of the unit at move-out and proof of the deposit transfer (E covers the latter). The judge will look at evidence and the statute, not a tool's prediction - keep collecting the gaps Advottic Review named and bring printed copies to the hearing.",
  },
];

export function ExampleBella() {
  const [visible, setVisible] = useState<Message[]>([SCRIPT[0]]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on every visible / partial change.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, partial]);

  function play() {
    if (streaming) return;
    setVisible([SCRIPT[0]]);
    setPartial('');
    setStreaming(true);

    let i = 1;
    const next = () => {
      if (i >= SCRIPT.length) {
        setStreaming(false);
        return;
      }
      const msg = SCRIPT[i];
      // User messages drop in instantly.
      if (msg.role === 'user') {
        setVisible((prev) => [...prev, msg]);
        i += 1;
        setTimeout(next, 600);
        return;
      }
      // Assistant messages stream char-by-char.
      let acc = '';
      const target = msg.content;
      const tickMs = 14;
      const chunk = 3;
      const interval = setInterval(() => {
        acc = target.slice(0, acc.length + chunk);
        setPartial(acc);
        if (acc.length >= target.length) {
          clearInterval(interval);
          setVisible((prev) => [...prev, { role: 'assistant', content: target }]);
          setPartial('');
          i += 1;
          setTimeout(next, 1200);
        }
      }, tickMs);
    };
    setTimeout(next, 400);
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-200 shadow-card overflow-hidden">
      {/* Header strip mirrors the real Bella widget */}
      <div className="brand-mark px-5 py-4 text-cream-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cream-200/15">
            <SparkleIcon />
          </span>
          <div>
            <p className="font-semibold tracking-tight text-[15px]">Bella</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-200/70 flex items-center gap-1.5">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Demo · scripted
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={play}
          disabled={streaming}
          className="text-[11px] uppercase tracking-wider text-cream-200/85 hover:text-cream-200 px-2 py-1 rounded border border-cream-200/30 disabled:opacity-50"
        >
          {streaming ? 'Playing…' : visible.length > 1 ? 'Replay demo' : 'Play demo'}
        </button>
      </div>

      <div
        ref={scrollerRef}
        className="p-5 bg-ink-50/40 space-y-4 max-h-[420px] overflow-y-auto"
      >
        {visible.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {partial && <Bubble role="assistant" content={partial} streaming />}
        {!streaming && visible.length === 1 && (
          <p className="text-xs text-ink-500 leading-relaxed">
            Click <strong>Play demo</strong> to watch a scripted exchange. The real Bella
            answers in real time once you sign in.
          </p>
        )}
      </div>

      <div className="border-t border-ink-200 px-4 py-3 bg-white text-[11px] text-ink-500">
        Bella provides legal information, not legal advice. Consult a licensed attorney before
        acting.
      </div>
    </div>
  );
}

function Bubble({ role, content, streaming }: { role: Message['role']; content: string; streaming?: boolean }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md px-3.5 py-2 bg-forest-900 text-white text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2.5 bg-white border border-ink-200 text-sm text-ink-900 leading-relaxed whitespace-pre-wrap">
        <RenderRich text={content} />
        {streaming && (
          <span aria-hidden className="inline-block ml-0.5 align-baseline animate-pulse">▍</span>
        )}
      </div>
    </div>
  );
}

// Tiny markdown-ish renderer for **bold** + bare URLs.
function RenderRich({ text }: { text: string }) {
  const tokenRe = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(tokenRe)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={`b${i++}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <a
          key={`u${i++}`}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="text-forest-900 underline underline-offset-2 break-all"
        >
          {tok}
        </a>,
      );
    }
    last = start + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 15l.7 1.9L21.6 18l-1.9.6L19 21l-.7-2.4L16.4 18l1.9-.7L19 15z"
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}
