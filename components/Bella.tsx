'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasSafetyCue } from '@/lib/safety';
import { SafetyAdvisory } from '@/components/SafetyAdvisory';

// Marker the server emits when Bella's navigate_to tool fires. We strip
// it from the rendered text and call router.push so the user actually
// goes there. Must match NAV_MARKER_OPEN/CLOSE in lib/bella.ts.
const NAV_RE = /<<ADV-NAV:([^>]+)>>/g;
function stripNavMarkers(s: string): { clean: string; paths: string[] } {
  const paths: string[] = [];
  const clean = s.replace(NAV_RE, (_m, p1: string) => {
    const path = String(p1 || '').trim();
    if (path && path.startsWith('/')) paths.push(path);
    return '';
  });
  return { clean, paths };
}

type Message = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'bella-conversation';

export function Bella({ signedIn = true }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  // Track which nav markers we've already acted on so a re-render of
  // the streamed snapshot doesn't trigger a navigation loop.
  const navFiredRef = useRef<Set<string>>(new Set());
  // Bella is deliberately silent for the first 30 seconds. We only arm the
  // floating button after the user has shown some activity, so first-page
  // landing visitors aren't bombarded with a chat prompt before they've had
  // a chance to read anything.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armedAlready = false;
    function startCountdown() {
      if (armedAlready) return;
      armedAlready = true;
      timer = setTimeout(() => setArmed(true), 30_000);
    }
    const events: (keyof WindowEventMap)[] = ['click', 'keydown', 'scroll', 'touchstart', 'pointerdown'];
    events.forEach((ev) =>
      window.addEventListener(ev, startCountdown, { passive: true, once: true }),
    );
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, startCountdown));
    };
  }, []);

  // Restore conversation
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Inline Bella launchers (e.g. BellaPrompt on case detail tabs) fire
  // `advottic:bella-open` with an optional prompt. We force the launcher
  // armed so users don't have to wait the 30s gate, open the dock, and
  // pre-fill the input box for them.
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent<{ prompt?: string }>).detail;
      setArmed(true);
      setOpen(true);
      if (detail?.prompt) setInput(detail.prompt);
    }
    window.addEventListener('advottic:bella-open', handler as EventListener);
    return () => window.removeEventListener('advottic:bella-open', handler as EventListener);
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
        // Strip ADV-NAV markers from the displayed text. The first time
        // we see one, fire router.push so the user actually goes there.
        const { clean, paths } = stripNavMarkers(acc);
        for (const p of paths) {
          if (navFiredRef.current.has(p)) continue;
          navFiredRef.current.add(p);
          // Defer the navigation a tick so the message that announced
          // it is on screen before the route swap.
          setTimeout(() => router.push(p), 350);
        }
        setMessages((m) =>
          m.map((msg, i) =>
            i === placeholderIndex ? { role: 'assistant', content: clean } : msg,
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
    navFiredRef.current = new Set();
    sessionStorage.removeItem(STORAGE_KEY);
  }

  // Once the chat is open we keep rendering it even if `armed` flips state -
  // arming gates only the launcher.
  const showLauncher = armed && !open;

  // The smart-assist new-case wizard takes over the screen on mobile,
  // so the floating "Ask Bella" pill competes for attention. Hide the
  // launcher on /cases/new at the mobile breakpoint until the user
  // either submits or backs out. Bella is still reachable on the case
  // detail page that the wizard redirects to on completion.
  const isOnNewCase = pathname === '/cases/new';

  return (
    <>
      {showLauncher && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Bella, the legal assistant"
          className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 ${
            isOnNewCase ? 'hidden sm:inline-flex' : 'inline-flex'
          } items-center gap-2 brand-mark text-cream-200 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-full shadow-brand-glow hover:scale-[1.02] transition-transform animate-fade-in aurora ring-1 ring-gold-400/30`}
        >
          <span className="text-gold-300">
            <SparkleIcon />
          </span>
          <span className="text-sm font-medium tracking-tight">Ask Bella</span>
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 ml-0.5" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-end p-0 sm:p-6 pointer-events-none">
          <div
            role="dialog"
            aria-label="Bella legal assistant"
            className="pointer-events-auto w-full sm:w-[420px] h-[80vh] sm:h-[640px] flex flex-col bg-white dark:bg-forest-900 shadow-card-hover border border-forest-200 dark:border-forest-700/60 rounded-t-2xl sm:rounded-2xl overflow-hidden"
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
                    Here · Listening · Yours
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

            <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 bg-ink-50/40 dark:bg-forest-950/60 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-700 dark:text-cream-100/85 leading-relaxed">
                    {signedIn
                      ? "Hi, I'm Bella. Ask me about your case, how to use Advottic, or plain-language legal concepts."
                      : "Hi, I'm Bella, your guide to Advottic. I can explain what the app does, who it's for, and answer general legal questions. To run a review or build a packet, you'll need to sign in."}
                  </p>
                  <div className="flex flex-col gap-2">
                    {(signedIn
                      ? [
                          caseId ? 'Summarize this case for me.' : 'How do I create a new case?',
                          'What is a statute of limitations in plain English?',
                          'I have a billing question, who can I talk to?',
                        ]
                      : [
                          'What does Advottic do?',
                          "What's included in each tier?",
                          'What is a statute of limitations in plain English?',
                        ]
                    ).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                        }}
                        className="text-left rounded-lg border border-forest-200 bg-white px-3 py-2 text-xs text-forest-900 hover:bg-cream-50 hover:border-forest-700 dark:bg-forest-800/60 dark:border-forest-600 dark:text-cream-100 dark:hover:bg-forest-700 dark:hover:border-gold-500"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* In-chat safety advisory - if any user message in the
                  thread contains danger / injury / self-harm cues, we
                  pin a tap-to-call 911 banner above the conversation
                  so the visual nudge reaches them even when they're
                  scrolling Bella's reply. Bella's system prompt also
                  routes them, but the button is the stronger nudge. */}
              {messages.some(
                (m) => m.role === 'user' && hasSafetyCue(m.content),
              ) && (
                <SafetyAdvisory
                  text={messages
                    .filter((m) => m.role === 'user')
                    .map((m) => m.content)
                    .join('\n')}
                />
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
              className="border-t border-ink-200 dark:border-forest-700/60 p-3 bg-white dark:bg-forest-900"
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
      <div className="max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2.5 bg-white dark:bg-forest-800/70 border border-ink-200 dark:border-forest-700/60 text-sm text-ink-900 dark:text-cream-100 leading-relaxed whitespace-pre-wrap">
        {content ? <RenderRich text={content} /> : ' '}
      </div>
    </div>
  );
}

/**
 * Tiny markdown-ish renderer: handles [text](url) links, bare URLs, and
 * **bold**. Anything else falls through as plain text. Newlines are preserved
 * by the parent's `whitespace-pre-wrap`. Kept inline + dependency-free so we
 * don't pull a full markdown lib into the chat bundle.
 */
function RenderRich({ text }: { text: string }) {
  // Split on linkable + bold patterns. Order matters: parse [text](url) first
  // so bare URLs don't double-match.
  const tokenRe = /(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*)/g;
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(tokenRe)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const tok = m[0];
    if (tok.startsWith('[')) {
      const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (md) {
        parts.push(
          <a
            key={`l${i++}`}
            href={md[2]}
            target="_blank"
            rel="noreferrer"
            className="text-forest-900 underline underline-offset-2 hover:text-forest-700"
          >
            {md[1]}
          </a>,
        );
      } else {
        parts.push(tok);
      }
    } else if (tok.startsWith('**')) {
      parts.push(
        <strong key={`b${i++}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      // bare URL
      parts.push(
        <a
          key={`u${i++}`}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="text-forest-900 underline underline-offset-2 hover:text-forest-700 break-all"
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
