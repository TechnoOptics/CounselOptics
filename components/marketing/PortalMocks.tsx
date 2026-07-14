import type { ReactNode } from 'react';

/**
 * Faithful, self-contained product mockups for the marketing pages. These read
 * as screenshots of the two Advottic portals running a SIMULATED case, but are
 * rendered from the real design tokens so they stay crisp on every display and
 * never drift from the product. All copy follows the house style: calm,
 * present-tense, one number per claim, no em-dashes, no emoji.
 *
 * Personal portal mocks use the consumer forest + cream palette. Firm portal
 * mocks use explicit near-black + champagne-gold values (the counsel shell's
 * look) so they render correctly on the consumer-token marketing pages without
 * depending on the .counsel-shell class.
 */

// Shell-independent firm palette (matches .counsel-shell black-on-gold).
const F = {
  bg: '#0e0e0e',
  panel: '#161616',
  panel2: '#1d1d1d',
  line: 'rgba(245,237,214,0.10)',
  text: '#F3EEE1',
  dim: 'rgba(243,238,225,0.60)',
  faint: 'rgba(243,238,225,0.38)',
  gold: '#D5BB7E',
  goldDeep: '#B9922F',
  goldSoft: '#E8D9B5',
};

/** A calm browser window that frames a product screen. */
export function BrowserFrame({
  children,
  url,
  tone = 'personal',
  className = '',
}: {
  children: ReactNode;
  url: string;
  tone?: 'personal' | 'firm';
  className?: string;
}) {
  const firm = tone === 'firm';
  return (
    <div
      className={`overflow-hidden rounded-2xl border shadow-2xl ${className}`}
      style={{
        borderColor: firm ? F.line : 'rgba(15,45,36,0.12)',
        background: firm ? F.bg : '#ffffff',
        boxShadow: firm
          ? '0 30px 80px -20px rgba(0,0,0,0.75)'
          : '0 30px 80px -24px rgba(15,45,36,0.35)',
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{
          background: firm ? F.panel : '#f6f4ee',
          borderBottom: `1px solid ${firm ? F.line : 'rgba(15,45,36,0.08)'}`,
        }}
      >
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#e5c98b' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#d2c39a' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#b7a97f' }} />
        </div>
        <div
          className="flex-1 truncate rounded-md px-3 py-1 text-center text-[11px] font-medium"
          style={{
            background: firm ? F.panel2 : '#ffffff',
            color: firm ? F.dim : '#6b7b73',
            border: `1px solid ${firm ? F.line : 'rgba(15,45,36,0.06)'}`,
          }}
        >
          {url}
        </div>
        <div className="w-10" aria-hidden />
      </div>
      {children}
    </div>
  );
}

// ── PERSONAL: a case room (simulated deposit case) ───────────────────────────

export function PersonalCaseRoomMock() {
  return (
    <div className="bg-white dark:bg-forest-950">
      {/* Forest header band */}
      <div className="bg-forest-gradient px-5 pb-4 pt-4 text-cream-100">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-300">
          Small claims · Claimant
        </p>
        <h3 className="mt-1 font-display text-[19px] font-medium leading-tight text-cream-50">
          Security deposit not returned
        </h3>
        <p className="mt-1 text-[11.5px] text-cream-100/70">
          Ramirez v. Oakline Rentals · California
        </p>
        {/* KPI strip */}
        <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-forest-950/40 text-center backdrop-blur">
          {[
            { k: 'Exhibits', v: '12', tone: 'text-emerald-300' },
            { k: 'Hearing', v: 'Apr 18', tone: 'text-cream-50' },
            { k: 'Review', v: 'Ready', tone: 'text-emerald-300' },
            { k: 'Shared', v: '1', tone: 'text-cream-50' },
          ].map((s) => (
            <div key={s.k} className="px-1.5 py-2">
              <p className="text-[8.5px] uppercase tracking-[0.14em] text-cream-100/50">{s.k}</p>
              <p className={`mt-0.5 font-display text-[15px] font-medium tabular-nums ${s.tone}`}>{s.v}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Exhibit list */}
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/50">
            Exhibits
          </p>
          <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[9.5px] font-semibold text-gold-700 dark:text-gold-300">
            auto-numbered
          </span>
        </div>
        <ul className="divide-y divide-ink-100 dark:divide-forest-800 rounded-xl border border-ink-100 dark:border-forest-800">
          {[
            ['A', 'Signed lease agreement.pdf', 'Jan 3, 2024'],
            ['B', 'Move-out photos (kitchen).jpg', 'Mar 30, 2025'],
            ['C', 'Text: “deposit next week”.png', 'Apr 6, 2025'],
            ['D', 'Itemized deduction letter.pdf', 'Apr 9, 2025'],
          ].map(([id, name, date]) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-forest-900 text-[11px] font-semibold text-gold-300 dark:bg-gold-metal dark:text-forest-950">
                {id}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-800 dark:text-cream-100/85">{name}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-400 dark:text-cream-100/45">{date}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── PERSONAL: Advottic Review (AI issue-spotting) ────────────────────────────

export function AdvotticReviewMock() {
  return (
    <div className="bg-white p-4 dark:bg-forest-950">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gold-metal text-forest-950">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <p className="font-display text-[15px] font-medium text-forest-900 dark:text-cream-50">Advottic Review</p>
            <p className="text-[10.5px] text-ink-500 dark:text-cream-100/55">Read in 28 seconds · California</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[9.5px] font-semibold text-emerald-700 dark:text-emerald-300">
          Complete
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <ReviewRow tone="issue" label="Possible legal issue" text="Deductions may exceed statutory limits under Civ. Code 1950.5." />
        <ReviewRow tone="gap" label="Evidence gap" text="Add the dated move-out inspection to strengthen the timeline." />
        <ReviewRow tone="ask" label="Ask your attorney" text="Whether the 21-day return window was met after move-out." />
      </div>

      <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-[10px] leading-relaxed text-ink-500 dark:bg-forest-900/50 dark:text-cream-100/55">
        Informational, not legal advice. Advottic is not a law firm.
      </p>
    </div>
  );
}

function ReviewRow({ tone, label, text }: { tone: 'issue' | 'gap' | 'ask'; label: string; text: string }) {
  const map = {
    issue: { ring: 'ring-amber-400/40', dot: 'bg-amber-400', chip: 'text-amber-700 dark:text-amber-300' },
    gap: { ring: 'ring-sky-400/40', dot: 'bg-sky-400', chip: 'text-sky-700 dark:text-sky-300' },
    ask: { ring: 'ring-gold-400/40', dot: 'bg-gold-500', chip: 'text-gold-700 dark:text-gold-300' },
  }[tone];
  return (
    <div className={`rounded-lg border border-ink-100 bg-white px-3 py-2 ring-1 ${map.ring} dark:border-forest-800 dark:bg-forest-900/40`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
        <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${map.chip}`}>{label}</span>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-ink-800 dark:text-cream-100/85">{text}</p>
    </div>
  );
}

// ── PERSONAL: Safe Witness ───────────────────────────────────────────────────

export function SafeWitnessMock() {
  return (
    <div className="relative overflow-hidden bg-forest-950 p-5 text-cream-100">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: 'radial-gradient(circle at 50% 35%, rgba(213,187,126,0.18), transparent 60%)' }} />
      <div className="relative flex flex-col items-center text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-300">Safe Witness</p>
        <div className="relative mt-4 grid h-24 w-24 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-gold-metal/20" style={{ animationDuration: '2.4s' }} />
          <span className="absolute inset-2 rounded-full bg-gold-metal/15" />
          <button
            type="button"
            className="relative grid h-16 w-16 place-items-center rounded-full bg-gold-metal text-forest-950 shadow-lg"
            aria-hidden
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7Z" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </div>
        <p className="mt-4 text-[13px] font-semibold text-cream-50">Hold to share your live location</p>
        <p className="mt-1 text-[11px] leading-relaxed text-cream-100/60">
          Sends a one-time alert to your trusted contacts and keeps updating until you mark yourself safe.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-cream-100/8 px-3 py-1 text-[10px] text-cream-100/70">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          2 trusted contacts · one-tap 911
        </div>
      </div>
    </div>
  );
}

// ── FIRM: Evidence dashboard (simulated trade-secret matter) ─────────────────

export function FirmEvidenceMock() {
  return (
    <div style={{ background: F.bg, color: F.text }} className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: F.gold }}>
            Counsel · matter
          </p>
          <h3 className="mt-0.5 font-display text-[16px] font-medium" style={{ color: F.text }}>
            Northwind Materials v. departed engineer
          </h3>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold" style={{ background: 'rgba(213,187,126,0.14)', color: F.gold }}>
          Trade secret
        </span>
      </div>

      {/* KPI grid */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          ['Total items', '347'],
          ['Analyzed', '344'],
          ['High relevance', '247'],
          ['Data volume', '240 MB'],
          ['Date span', '21 yrs'],
          ['People', '530'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg px-2.5 py-2" style={{ background: F.panel, border: `1px solid ${F.line}` }}>
            <p className="font-display text-[16px] font-medium tabular-nums" style={{ color: F.text }}>{v}</p>
            <p className="mt-0.5 text-[8.5px] uppercase tracking-[0.1em]" style={{ color: F.faint }}>{k}</p>
          </div>
        ))}
      </div>

      {/* Donut + relevance */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg p-3" style={{ background: F.panel, border: `1px solid ${F.line}` }}>
          <p className="text-[9px] uppercase tracking-[0.12em]" style={{ color: F.faint }}>Processing</p>
          <div className="mt-2 flex items-center gap-3">
            <div
              className="grid h-14 w-14 place-items-center rounded-full"
              style={{ background: `conic-gradient(${F.gold} 0 356deg, rgba(245,237,214,0.10) 356deg 360deg)` }}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full" style={{ background: F.panel }}>
                <span className="font-display text-[12px] font-medium tabular-nums" style={{ color: F.text }}>99%</span>
              </div>
            </div>
            <div className="text-[10px]" style={{ color: F.dim }}>
              <p><span style={{ color: F.gold }}>344</span> analyzed</p>
              <p className="mt-0.5">3 not analyzable</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: F.panel, border: `1px solid ${F.line}` }}>
          <p className="text-[9px] uppercase tracking-[0.12em]" style={{ color: F.faint }}>Relevance to the matter</p>
          <p className="mt-1 font-display text-[18px] font-medium tabular-nums" style={{ color: F.text }}>
            74.5 <span className="text-[10px]" style={{ color: F.faint }}>/ 100</span>
          </p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full" style={{ background: 'rgba(245,237,214,0.08)' }}>
            <span style={{ width: '71%', background: F.goldDeep }} />
            <span style={{ width: '28%', background: F.goldSoft }} />
            <span style={{ width: '1%', background: 'rgba(245,237,214,0.2)' }} />
          </div>
          <div className="mt-1.5 flex gap-3 text-[8.5px]" style={{ color: F.dim }}>
            <span>High 247</span><span>Med 96</span><span>Low 4</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FIRM: Legal review with CourtListener-verified case law ──────────────────

export function LegalReviewMock() {
  return (
    <div style={{ background: F.bg, color: F.text }} className="p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'rgba(213,187,126,0.14)', color: F.gold }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 006 0L5 7Zm14 0l-3 6a3 3 0 006 0l-3-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="font-display text-[15px] font-medium" style={{ color: F.text }}>Legal review</p>
          <p className="text-[10px]" style={{ color: F.faint }}>Claim analysis · Minnesota</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg p-3" style={{ background: F.panel, border: `1px solid ${F.line}` }}>
        <p className="text-[12.5px] font-semibold" style={{ color: F.text }}>Misappropriation of trade secrets</p>
        <p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: F.dim }}>
          Elements: existence of a trade secret, reasonable secrecy measures, and acquisition by improper means.
        </p>
        {/* Verified citation */}
        <div className="mt-2.5 rounded-md px-2.5 py-2" style={{ background: F.panel2, border: `1px solid ${F.line}` }}>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: '#7CCF9A' }}>
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: '#7CCF9A' }}>
              Verified in CourtListener
            </span>
          </div>
          <p className="mt-1 text-[11.5px] font-medium" style={{ color: F.text }}>
            Electro-Craft Corp. v. Controlled Motion, Inc.
          </p>
          <p className="text-[9.5px]" style={{ color: F.faint }}>332 N.W.2d 890 (Minn. 1983)</p>
        </div>
        <p className="mt-2 text-[9px]" style={{ color: F.faint }}>
          Unverified citations are dropped, never shown.
        </p>
      </div>
    </div>
  );
}

// ── FIRM: Branded client intake ──────────────────────────────────────────────

export function IntakeMock() {
  return (
    <div style={{ background: F.bg, color: F.text }} className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: F.gold }}>
        Client intake
      </p>
      <h3 className="mt-0.5 font-display text-[15px] font-medium" style={{ color: F.text }}>New matter request</h3>
      <p className="mt-0.5 text-[10.5px]" style={{ color: F.faint }}>On your firm domain and colors. Clients never see another matter.</p>
      <div className="mt-3 space-y-2">
        {[
          ['Full name', 'Dana Whitfield'],
          ['Matter type', 'Employment · departure'],
          ['What happened', 'A former engineer took proprietary designs to a competitor...'],
        ].map(([label, val]) => (
          <div key={label} className="rounded-lg px-3 py-2" style={{ background: F.panel, border: `1px solid ${F.line}` }}>
            <p className="text-[8.5px] uppercase tracking-[0.12em]" style={{ color: F.faint }}>{label}</p>
            <p className="mt-0.5 truncate text-[12px]" style={{ color: F.dim }}>{val}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-lg px-3 py-1.5 text-[11px] font-semibold" style={{ background: F.gold, color: '#1a1400' }}>Submit request</span>
        <span className="text-[9.5px]" style={{ color: F.faint }}>Auto-populates the matter file</span>
      </div>
    </div>
  );
}
