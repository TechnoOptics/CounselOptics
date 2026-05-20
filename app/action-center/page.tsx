import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Action Center',
  description:
    'Every time-sensitive Advottic tool in one place: War Room, Deadline Radar, Document Decoder, and Safe Witness.',
};

/**
 * Action Center hub. The user asked to move four high-urgency tools
 * into one menu surface so they're easy to find from anywhere in the
 * consumer app:
 *
 *   - War Room       (/war-room)     - case status + best-next-move
 *                                       cockpit across every open case
 *   - Deadline Radar (/deadlines)    - upcoming hearings + filing dates
 *                                       sorted by urgency
 *   - Decode a doc   (/decoder)      - paste a contract / pleading and
 *                                       get plain-English breakdown
 *   - Safe Witness   (/safe)         - press to alert your trusted
 *                                       contacts with location + voice
 *
 * Each tool keeps its own page; this hub is just the entry point
 * with a live stat per card so the user can scan "do I have anything
 * urgent" before drilling in.
 */
export default async function ActionCenterHub() {
  // Tools are usable without sign-in (decoder, safe witness web page
  // can both function for unauthenticated visitors in degraded mode),
  // but the cases-aware stats want a user. Push to sign-in if storage
  // is wired up and the visitor isn't authenticated.
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect('/sign-in?next=/action-center');
  }

  // Best-effort stats. Failures fall back to "—" so the hub renders
  // even when storage hiccups.
  let openCases = 0;
  let nextHearingLabel: string | null = null;
  let hearingTone: 'rose' | 'amber' | 'emerald' | 'neutral' = 'neutral';
  if (!storageUnavailable()) {
    try {
      const cases = await listCases();
      const open = cases.filter((c) => c.status !== 'closed' && c.status !== 'archived');
      openCases = open.length;
      const withHearings = open
        .filter((c) => c.hearingAt)
        .sort(
          (a, b) =>
            Date.parse(a.hearingAt!) - Date.parse(b.hearingAt!),
        );
      const next = withHearings[0];
      if (next?.hearingAt) {
        const days = Math.round(
          (Date.parse(next.hearingAt) - Date.now()) / (1000 * 60 * 60 * 24),
        );
        if (days < 0) {
          nextHearingLabel = `${next.title} - past`;
          hearingTone = 'neutral';
        } else if (days <= 3) {
          nextHearingLabel = `${next.title} - in ${days}d`;
          hearingTone = 'rose';
        } else if (days <= 14) {
          nextHearingLabel = `${next.title} - in ${days}d`;
          hearingTone = 'amber';
        } else {
          nextHearingLabel = `${next.title} - in ${days}d`;
          hearingTone = 'emerald';
        }
      }
    } catch {
      /* swallow */
    }
  }

  const cards: HubCard[] = [
    {
      title: 'War Room',
      href: '/war-room',
      tagline:
        'The single best next move on every open case, ranked by urgency.',
      stat:
        openCases === 0
          ? 'No open cases.'
          : `${openCases} open ${openCases === 1 ? 'case' : 'cases'}.`,
      cta: 'Open War Room',
      tone: 'forest',
      icon: <WarRoomIcon />,
    },
    {
      title: 'Deadline Radar',
      href: '/deadlines',
      tagline:
        'Hearings, filings, statute-of-limitations cutoffs - sorted by what bites first.',
      stat: nextHearingLabel ?? 'No upcoming hearings on file.',
      cta: 'Open Deadline Radar',
      tone: hearingTone === 'rose' || hearingTone === 'amber' ? 'amber' : 'forest',
      attention: hearingTone === 'rose',
      icon: <RadarIcon />,
    },
    {
      title: 'Decode a Document',
      href: '/decoder',
      tagline:
        'Paste a contract, pleading, or legalese-heavy letter; get a plain-English breakdown with risk callouts.',
      stat: 'Always-on. No setup needed.',
      cta: 'Decode now',
      tone: 'forest',
      icon: <DecoderIcon />,
    },
    {
      title: 'Safe Witness',
      href: '/safe',
      tagline:
        'Trigger from web or wrist - your trusted contacts get an instant email + SMS with your location, voice memo, and one-tap actions.',
      stat: 'Configure contacts at /profile then press from any device.',
      cta: 'Open Safe Witness',
      tone: 'rose',
      icon: <SafeWitnessIcon />,
    },
  ];

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.28em] font-semibold text-gold-700 dark:text-gold-300">
          Action Center
        </p>
        <h1 className="font-display text-[36px] sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.05] text-ink-950 dark:text-cream-100 mt-2">
          What needs you right now
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/65 mt-2 max-w-xl leading-relaxed">
          Four time-sensitive tools in one place. Each card shows
          a live stat so you can decide what to open first.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <ToolCard key={c.title} {...c} />
        ))}
      </div>
    </main>
  );
}

type HubCard = {
  title: string;
  href: string;
  tagline: string;
  stat: string;
  cta: string;
  tone: 'forest' | 'amber' | 'rose';
  /** When true the card gets a soft attention pulse (e.g. a hearing
   *  in <= 3 days). */
  attention?: boolean;
  icon: React.ReactElement;
};

function ToolCard({ title, href, tagline, stat, cta, tone, attention, icon }: HubCard) {
  // Tone affects the icon chip + the primary CTA color so each card
  // reads with a distinct identity (Safe Witness rose for urgency,
  // Deadline Radar amber when something's actually close).
  const chip =
    tone === 'rose'
      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-200/60 dark:ring-rose-700/40'
      : tone === 'amber'
        ? 'bg-amber-400/15 text-amber-800 dark:text-amber-200 ring-amber-200/60 dark:ring-amber-600/30'
        : 'bg-forest-900/8 text-forest-900 dark:text-cream-100 ring-forest-900/15 dark:ring-cream-100/15';
  const cta_btn =
    tone === 'rose'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : tone === 'amber'
        ? 'bg-amber-500 hover:bg-amber-600 text-ink-950'
        : 'bg-forest-900 hover:bg-forest-800 text-cream-100';
  return (
    <Link
      href={href}
      className={`card group p-5 sm:p-6 hover:ring-forest-700 dark:hover:ring-gold-metal/40 transition-all ${
        attention ? 'ring-1 ring-rose-300/70 dark:ring-rose-500/40' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg ring-1 ${chip}`}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-medium tracking-[-0.01em] text-ink-950 dark:text-cream-100">
              {title}
            </h2>
            {attention && (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"
              />
            )}
          </div>
          <p className="text-[13px] text-ink-600 dark:text-cream-100/65 mt-1 leading-relaxed">
            {tagline}
          </p>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-700 dark:text-cream-100/75 mt-4 font-medium">
        {stat}
      </p>
      <span
        className={`mt-4 inline-flex items-center justify-center px-4 h-10 rounded-md text-sm font-medium transition-colors ${cta_btn}`}
      >
        {cta}
        <span aria-hidden="true" className="ml-1.5">→</span>
      </span>
    </Link>
  );
}

function WarRoomIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11l9-7 9 7M5 10v10h14V10M9 20v-6h6v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 3v9l6 3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DecoderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path
        d="M8 13h8M8 17h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SafeWitnessIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l3 7h7l-5.5 4.5L18.5 22 12 17.5 5.5 22l2-8.5L2 9h7z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
