'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type Message = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'bella-conversation';

export function Bella() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  // Restore conversation
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Persist
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Scroll to bottom on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, open]);

  const caseId = pathname?.match(/^\/cases\/([^\/?#]+)(?:\/|$)/)?.[1] ?? null;

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setStreaming(true);

    const placeholderIndex = next.length;
    setMessages([...next, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/bella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, caseId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Bella is offline.' }));
        setMessages((m) =>
          m.map((msg, i) =>
            i === placeholderIndex
              ? { role: 'assistant', content: `_${err.error || 'Something went wrong.'}_` }
              : msg,
          ),
        );
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setMessages((m) =>
          m.map((msg, i) =>
            i === placeholderIndex
              ? { role: 'assistant', content: '_Bella sent an empty response._' }
              : msg,
          ),
        );
        return;
      }
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setMessages((m) =>
          m.map((msg, i) =>
            i === placeholderIndex ? { role: 'assistant', content: snapshot } : msg,
          ),
        );
      }
    } catch (err) {
      setMessages((m) =>
        m.map((msg, i) =>
          i === placeholderIndex
            ? {
                role: 'assistant',
                content: `_Couldn't reach Bella: ${
                  err instanceof Error ? err.message : 'unknown error'
                }._`,
              }
            : msg,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }

  function reset() {
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Bella, the legal assistant"
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 brand-mark text-cream-200 px-4 py-3 rounded-full shadow-brand-glow hover:scale-[1.02] transition-transform"
        >
          <SparkleIcon />
          <span className="text-sm font-medium tracking-tight">Ask Bella</span>
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-cream-200 ml-0.5" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-end p-0 sm:p-6 pointer-events-none">
          <div
            role="dialog"
            aria-label="Bella legal assistant"
            className="pointer-events-auto w-full sm:w-[420px] h-[80vh] sm:h-[640px] flex flex-col bg-white shadow-card-hover border border-forest-200 rounded-t-2xl sm:rounded-2xl overflow-hidden"
          >
            <div className="brand-mark px-5 py-4 text-cream-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cream-200/15">
                  <SparkleIcon />
                </span>
                <div>
                  <p className="font-semibold tracking-tight text-[15px]">Bella</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-cream-200/70 flex items-center gap-1.5">
                    <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Online · Sonnet 4.6
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={reset}
                    className="text-[11px] uppercase tracking-wider text-cream-200/80 hover:text-cream-200 px-2 py-1 rounded"
                    title="Clear conversation"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close Bella"
                  className="text-cream-200/80 hover:text-cream-200 p-1"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 bg-ink-50/40 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-700 leading-relaxed">
                    Hi, I&apos;m Bella. Ask me about your case, how to use Advottic, or
                    plain-language legal concepts.
                  </p>
                  <div className="flex flex-col gap-2">
                    {[
                      'How do I use the exhibit plan feature?',
                      'What is a statute of limitations in plain English?',
                      caseId ? 'Summarize this case for me.' : 'What can Advottic help me with?',
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                        }}
                        className="text-left rounded-lg border border-forest-200 bg-white px-3 py-2 text-xs text-forest-900 hover:bg-cream-50 hover:border-forest-700"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} content={m.content} />
              ))}
              {streaming && messages[messages.length - 1]?.content === '' && (
                <div className="flex gap-1 px-1">
                  <Dot delay={0} />
                  <Dot delay={150} />
                  <Dot delay={300} />
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="border-t border-ink-200 p-3 bg-white"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Ask Bella…"
                  rows={1}
                  className="input resize-none max-h-32"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="btn-primary"
                  aria-label="Send"
                >
                  {streaming ? <Spinner /> : <SendIcon />}
                </button>
              </div>
              <p className="text-[10px] text-ink-400 mt-1.5 px-1">
                Bella provides legal information, not legal advice. Consult a licensed attorney
                before acting.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ role, content }: { role: Message['role']; content: string }) {
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
        {content || ' '}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{ animationDelay: `${delay}ms` }}
      className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-forest-700"
    />
  );
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

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 11.5L21 3l-8.5 18-2.5-8L3 11.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
