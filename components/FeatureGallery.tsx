'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * Visual feature gallery for the public landing page. Replaces the
 * old text-heavy "personas" + "outcomes" + "flow" sections with an
 * interactive grid of nine capability tiles. Each tile has a one-
 * line tagline; clicking one expands an inline detail panel with
 * a longer description + a "see it" link to the relevant in-app
 * surface.
 *
 * Built around plain SVG iconography (no emoji - this is a serious
 * legal tool) and brand gradients. The design language echoes
 * Stripe / Linear / Vercel feature pages: dense, scannable,
 * visually anchored, low text density per tile.
 */

type FeatureKey =
  | 'case-rooms'
  | 'exhibits'
  | 'review'
  | 'bella'
  | 'signing'
  | 'vault'
  | 'efile'
  | 'pd'
  | 'collab';

type Feature = {
  key: FeatureKey;
  title: string;
  tagline: string;
  description: string;
  link: string;
  linkLabel: string;
  icon: () => JSX.Element;
  tone: 'forest' | 'gold' | 'emerald';
};

const FEATURES: Feature[] = [
  {
    key: 'case-rooms',
    title: 'Case rooms',
    tagline: 'Every matter, one calm workspace.',
    description:
      'Capture the parties, jurisdiction, posture, and the story in your own words. Each case is a private room with its own evidence vault, hearings, and notes - separate from every other matter you are tracking.',
    link: '/cases/new',
    linkLabel: 'Start a case',
    icon: FolderIcon,
    tone: 'forest',
  },
  {
    key: 'exhibits',
    title: 'Auto-numbered exhibits',
    tagline: 'Drop a screenshot. Walk in with a binder.',
    description:
      'Photos of citations, screenshots of texts, PDFs of forms, voice memos - drop them in and Advottic auto-numbers them, captures the date from the file, and tags the source. Your camera roll becomes a real exhibit list.',
    link: '/example',
    linkLabel: 'See an exhibit list',
    icon: GridIcon,
    tone: 'gold',
  },
  {
    key: 'review',
    title: 'Advottic Review',
    tagline: 'AI-assisted issue spotting in 30 seconds.',
    description:
      'Surfaces possible legal issues, evidentiary gaps, applicable doctrines, and the questions worth asking your attorney. Plain language. Jurisdiction-aware. Never a substitute for a licensed lawyer - but it gives you a calm starting point.',
    link: '/about',
    linkLabel: 'How Review works',
    icon: SparkIcon,
    tone: 'forest',
  },
  {
    key: 'bella',
    title: 'Bella',
    tagline: 'Plain-English answers, on demand.',
    description:
      'The in-app assistant explains legal terms in everyday language and helps you find what you are looking for inside your own case file. Search every matter you have, jump to a specific case, ask what jurisdiction means, all without leaving the page.',
    link: '/about',
    linkLabel: 'Meet Bella',
    icon: ChatIcon,
    tone: 'gold',
  },
  {
    key: 'signing',
    title: 'In-portal signing',
    tagline: 'Sign documents inside the encrypted vault.',
    description:
      'Engagement letters, retainers, releases - signed inside Advottic. Documents never leave the encrypted vault, never sit in a third-party signing service, never expose privileged content to outside processors.',
    link: '/security',
    linkLabel: 'Security details',
    icon: PenIcon,
    tone: 'emerald',
  },
  {
    key: 'vault',
    title: 'Encrypted vault',
    tagline: 'AES-256 at rest. TLS 1.3 in transit.',
    description:
      'Every byte you upload is encrypted on disk. Every request between your browser and our servers is protected. Storage runs on private VPCs in the United States. Export your full archive (JSON + files) any time. Delete in one tap.',
    link: '/security',
    linkLabel: 'Security overview',
    icon: ShieldIcon,
    tone: 'forest',
  },
  {
    key: 'efile',
    title: 'Court e-filing directory',
    tagline: 'Every state portal, one map.',
    description:
      'A curated directory of every state court e-filing portal, with whether pro se litigants can file there, accepted formats, fee-waiver pointers, and a link to each portal. No more guessing which vendor your county uses.',
    link: '/file-exhibits',
    linkLabel: 'Browse portals',
    icon: BuildingIcon,
    tone: 'gold',
  },
  {
    key: 'pd',
    title: 'Public defender directory',
    tagline: 'A free constitutional right, mapped.',
    description:
      'If you face possible incarceration, a public defender is your right at no cost. We maintain a state-by-state directory pointing to the office that handles your jurisdiction, with civil legal-aid backup links for non-criminal matters.',
    link: '/public-defender',
    linkLabel: 'Find a defender',
    icon: ScalesIcon,
    tone: 'emerald',
  },
  {
    key: 'collab',
    title: 'Collaborate by invite',
    tagline: 'Bring your attorney into the room.',
    description:
      'Invite your attorney, paralegal, witness, or co-counsel to a single matter by email. Each one gets the role-scoped view their permissions grant - viewer, editor, attorney, or witness. Time-limited links. Audited. Revocable in one click.',
    link: '/about',
    linkLabel: 'How collaboration works',
    icon: UsersIcon,
    tone: 'forest',
  },
];

export function FeatureGallery() {
  const [active, setActive] = useState<FeatureKey | null>(null);
  const activeFeature = FEATURES.find((f) => f.key === active) ?? null;

  return (
    <section id="feature-gallery" className="space-y-8">
      <header className="text-center max-w-2xl mx-auto">
        <p className="eyebrow justify-center mb-3">What Advottic actually does</p>
        <h2 className="font-display text-3xl sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Nine quiet tools that <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">make the work easier.</span>
        </h2>
        <p className="text-sm sm:text-base text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed">
          Tap any tile to see how it works. Or skip the tour and start a case file - everything below is one tap away once you sign up.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Tile
            key={f.key}
            feature={f}
            active={active === f.key}
            onClick={() => setActive((cur) => (cur === f.key ? null : f.key))}
          />
        ))}
      </div>

      {activeFeature && (
        <div
          role="dialog"
          aria-label={activeFeature.title}
          className="rounded-3xl border border-gold-300/40 bg-gradient-to-br from-cream-50 via-white to-cream-50 dark:from-forest-900/60 dark:via-forest-950 dark:to-forest-900/60 p-7 sm:p-10 shadow-card-hover animate-fade-up"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-700 dark:text-gold-300">
              {activeFeature.title}
            </p>
            <button
              type="button"
              onClick={() => setActive(null)}
              className="text-[11px] text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100 underline-offset-4 hover:underline"
              aria-label="Close detail"
            >
              Close
            </button>
          </div>
          <h3 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {activeFeature.tagline}
          </h3>
          <p className="mt-4 text-[15px] sm:text-base leading-relaxed text-ink-700 dark:text-cream-100/80 max-w-3xl">
            {activeFeature.description}
          </p>
          <Link
            href={activeFeature.link}
            className="mt-6 inline-flex items-center gap-2 btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
          >
            {activeFeature.linkLabel}
            <ArrowRight />
          </Link>
        </div>
      )}
    </section>
  );
}

function Tile({
  feature,
  active,
  onClick,
}: {
  feature: Feature;
  active: boolean;
  onClick: () => void;
}) {
  const { title, tagline, icon: Icon, tone } = feature;
  const toneRing =
    tone === 'forest'
      ? 'hover:ring-forest-500/40'
      : tone === 'gold'
        ? 'hover:ring-gold-500/50'
        : 'hover:ring-emerald-500/40';
  const iconBg =
    tone === 'forest'
      ? 'bg-forest-100 text-forest-900 dark:bg-forest-700/40 dark:text-cream-100'
      : tone === 'gold'
        ? 'bg-gold-100 text-gold-800 dark:bg-gold-400/15 dark:text-gold-300'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-700/30 dark:text-emerald-200';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`group relative text-left rounded-2xl border p-6 transition-all duration-300 ${
        active
          ? 'border-gold-500 bg-gradient-to-br from-cream-50 to-white dark:from-forest-900/60 dark:to-forest-950 shadow-card-hover'
          : `border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-900/30 ring-1 ring-transparent ${toneRing} hover:border-gold-400/50 hover:shadow-card-hover hover:-translate-y-0.5`
      }`}
    >
      <div className="flex items-start gap-3 mb-4">
        <span
          aria-hidden
          className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${iconBg}`}
        >
          <Icon />
        </span>
        <h3 className="text-base font-semibold tracking-tight text-forest-900 dark:text-cream-100 leading-snug pt-1.5">
          {title}
        </h3>
      </div>
      <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
        {tagline}
      </p>
      <span
        aria-hidden
        className={`absolute bottom-3 right-4 text-[11px] tracking-[0.18em] uppercase font-semibold transition-colors ${
          active ? 'text-gold-700 dark:text-gold-300' : 'text-ink-400 dark:text-cream-100/35 group-hover:text-gold-700 dark:group-hover:text-gold-300'
        }`}
      >
        {active ? '— Open' : 'Learn →'}
      </span>
    </button>
  );
}

// =====================================================================
// Iconography - tight in-house SVG set, no emoji
// =====================================================================

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M19 17l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4l6 6-9.5 9.5L4 21l1.5-6.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 6l6 6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M13 21V11a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v10M3 21h18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 8h2M7 12h2M7 16h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ScalesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v16M5 8l3-4 3 4h-6zM13 8l3-4 3 4h-6zM5 8l-2 7a4 4 0 0 0 8 0zM19 8l2 7a4 4 0 0 1-8 0zM8 22h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3 19c0-3 2.5-5 6-5s6 2 6 5M14 19c0-2 2-4 5-4s2 4 2 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-6-6m6 6l-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
