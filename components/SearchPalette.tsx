'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type CaseHit = {
  id: string;
  title: string;
  subjectName: string;
  subjectType: string;
  status: string;
  caseType: string;
};

type SettingHit = {
  href: string;
  title: string;
  hint: string;
  keywords: string;
};

const SETTINGS: SettingHit[] = [
  { href: '/cases/new', title: 'New case', hint: 'Start a new matter', keywords: 'new case create matter start' },
  { href: '/cases', title: 'All cases', hint: 'View, filter, and reopen cases', keywords: 'cases list dashboard files' },
  { href: '/cases?filter=shared', title: 'Shared with me', hint: 'Cases collaborators invited you to', keywords: 'shared collaborator invited attorney' },
  { href: '/find-counsel', title: 'Find counsel near me', hint: 'Browse nearby law firms', keywords: 'find counsel lawyer law firm near attorney legal aid map' },
  { href: '/billing', title: 'Billing & subscription', hint: 'Tier, invoices, cancel', keywords: 'billing pay subscribe stripe upgrade plan tier price' },
  { href: '/profile', title: 'Profile', hint: 'Name, avatar, account', keywords: 'profile account settings name avatar email' },
  { href: '/welcome', title: 'Welcome & consent', hint: 'Re-read terms; restart tour', keywords: 'tour welcome consent agreement representation' },
  { href: '/privacy', title: 'Privacy policy', hint: 'How your data is handled', keywords: 'privacy data gdpr policy security' },
  { href: '/terms', title: 'Terms of use', hint: 'Service terms', keywords: 'terms agreement legal arbitration' },
  { href: '/admin', title: 'Admin dashboard', hint: 'Operator only', keywords: 'admin users staff' },
  { href: '/auth/sign-out', title: 'Sign out', hint: 'End your session', keywords: 'sign out logout exit' },
];

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cases, setCases] = useState<CaseHit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Open via Cmd/Ctrl-K or "/"
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const slash =
        e.key === '/' &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement);
      if (cmdK || slash) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function onCustom() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('advottic:search', onCustom as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('advottic:search', onCustom as EventListener);
    };
  }, []);

  // Lazy-load cases on first open
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    fetch('/api/search')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setCases(Array.isArray(data?.cases) ? data.cases : []);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
    setQuery('');
    setActive(0);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matchedCases = useMemo(() => {
    if (!q) return cases.slice(0, 6);
    return cases
      .filter((c) =>
        [c.title, c.subjectName, c.caseType, c.status, c.subjectType]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q)),
      )
      .slice(0, 12);
  }, [q, cases]);

  const matchedSettings = useMemo(() => {
    if (!q) return SETTINGS.slice(0, 4);
    return SETTINGS.filter((s) =>
      `${s.title} ${s.hint} ${s.keywords}`.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [q]);

  const flat = useMemo(
    () => [
      ...matchedCases.map((c) => ({ kind: 'case' as const, c })),
      ...matchedSettings.map((s) => ({ kind: 'setting' as const, s })),
    ],
    [matchedCases, matchedSettings],
  );

  function go(item: (typeof flat)[number]) {
    setOpen(false);
    if (item.kind === 'case') router.push(`/cases/${item.c.id}`);
    else router.push(item.s.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal
      aria-label="Search Advottic"
    >
      <div className="absolute inset-0 bg-forest-950/60 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-xl rounded-2xl border border-ink-200 bg-white shadow-card-hover overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cases or jump to settings..."
            className="flex-1 bg-transparent text-[15px] text-ink-950 placeholder:text-ink-400 outline-none"
            aria-label="Search query"
          />
          <kbd className="hidden sm:inline-block text-[10px] font-mono tracking-wide text-ink-500 border border-ink-200 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {matchedCases.length > 0 && (
            <Section label="Cases">
              {matchedCases.map((c, i) => (
                <Row
                  key={c.id}
                  active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go({ kind: 'case', c })}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-950 truncate">{c.title}</p>
                    <p className="text-xs text-ink-500 truncate">
                      {c.subjectName} · {c.caseType} · {humanStatus(c.status)}
                    </p>
                  </div>
                  <FileIcon />
                </Row>
              ))}
            </Section>
          )}

          {matchedSettings.length > 0 && (
            <Section label="Go to">
              {matchedSettings.map((s, i) => {
                const idx = matchedCases.length + i;
                return (
                  <Row
                    key={s.href}
                    active={idx === active}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go({ kind: 'setting', s })}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-950 truncate">{s.title}</p>
                      <p className="text-xs text-ink-500 truncate">{s.hint}</p>
                    </div>
                    <ArrowIcon />
                  </Row>
                );
              })}
            </Section>
          )}

          {matchedCases.length === 0 && matchedSettings.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-ink-500">
              No matches{loaded ? '' : ' yet'}. Try a different word or browse{' '}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push('/cases');
                }}
                className="underline"
              >
                all cases
              </button>
              .
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5 text-[11px] text-ink-500 bg-cream-50/50">
          <span className="font-mono tracking-tight">
            <kbd className="border border-ink-200 rounded px-1">↑</kbd>{' '}
            <kbd className="border border-ink-200 rounded px-1">↓</kbd> navigate ·{' '}
            <kbd className="border border-ink-200 rounded px-1">↵</kbd> open
          </span>
          <span className="font-mono">Advottic search</span>
        </div>
      </div>
    </div>
  );
}

export function SearchTrigger({ className = '' }: { className?: string }) {
  function open() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('advottic:search'));
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open search"
      className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-cream-100/85 hover:text-cream-100 hover:bg-forest-800 transition-colors ${className}`}
    >
      <SearchIcon />
      <span className="hidden sm:inline text-xs font-mono tracking-wide text-cream-100/60">
        ⌘K
      </span>
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-1">
      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-400">
        {label}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function Row({
  active,
  onClick,
  onMouseEnter,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
          active ? 'bg-forest-50 text-forest-900' : 'text-ink-800 hover:bg-cream-50'
        }`}
      >
        {children}
      </button>
    </li>
  );
}

function humanStatus(s: string): string {
  return s.replace(/_/g, ' ');
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-400">
      <path
        d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 3v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-400">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
