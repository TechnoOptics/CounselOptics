/**
 * Hand-curated changelog. Drives /changelog (the rendered page),
 * /feed.xml (RSS), /atom.xml (Atom), and /sitemap-images.xml. Pick
 * notable shipped features only - the goal is freshness signal to
 * search engines + AI crawlers, not a literal commit log.
 *
 * Add new entries at the TOP (most recent first). Date format
 * YYYY-MM-DD. Keep the title under 80 chars and the summary under
 * 280 chars so the RSS feed renders cleanly in every reader.
 */

export type ChangelogEntry = {
  /** Stable slug for the entry's anchor + sitemap entry. */
  slug: string;
  /** ISO date the change shipped. */
  date: string;
  title: string;
  summary: string;
  /** Optional internal link the entry connects to. */
  link?: string;
  category: 'feature' | 'fix' | 'security' | 'brand' | 'pricing';
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    slug: 'brand-glossary-launch',
    date: '2026-06-08',
    category: 'brand',
    title: 'Advottic brand glossary now live at /glossary',
    summary:
      'Dedicated pages for Bella, Safe Witness, Advottic Counsel, Advottic Review, and Techno Optics LLC with DefinedTerm JSON-LD so AI assistants cite us cleanly.',
    link: '/glossary',
  },
  {
    slug: 'what-is-advottic-page',
    date: '2026-06-07',
    category: 'brand',
    title: 'Canonical "What is Advottic?" page',
    summary:
      'New /what-is-advottic page with one self-contained, citation-ready definition of the brand. Designed to win the knowledge-panel slot on "what is Advottic?" search queries.',
    link: '/what-is-advottic',
  },
  {
    slug: 'distress-overlay',
    date: '2026-05-23',
    category: 'feature',
    title: 'Distress detector + red alert overlay app-wide',
    summary:
      'Bella chat, Decoder, and voice transcripts now watch for high-confidence danger phrases ("I am in danger", "I want to hurt myself") and surface a one-tap overlay with 911, 988, and a press-and-hold Safe Witness trigger.',
    link: '/safe',
  },
  {
    slug: 'safe-witness-live-tracking',
    date: '2026-05-22',
    category: 'feature',
    title: 'Safe Witness live location tracking',
    summary:
      'After a Safe Witness press, the watch + web client now ping the user’s position every 30 seconds. Contacts see a moving dot + breadcrumb trail on /safe/alert/[id]. Tracking continues until the user explicitly stops it.',
    link: '/safe',
  },
  {
    slug: 'gift-advottic',
    date: '2026-05-21',
    category: 'feature',
    title: 'Gift Advottic to someone else',
    summary:
      'Buy a subscription for a friend or family member. Pay once, recipient gets a one-tap activation email, subscription runs on their account for the duration purchased. Refundable until claimed.',
    link: '/gift',
  },
  {
    slug: 'bella-tier-2-letterhead',
    date: '2026-05-20',
    category: 'feature',
    title: 'Bella tier 2: letterhead, PDF reports, email delivery',
    summary:
      'Counsel firms can now upload firm letterhead, ask Bella to draft a branded PDF report, and email it to a client in a single flow. Ships in Small Firm tier and up.',
    link: '/pricing',
  },
  {
    slug: 'safe-witness-audio',
    date: '2026-05-18',
    category: 'feature',
    title: 'Safe Witness audio capture from the watch',
    summary:
      'Pressing-and-holding the Safe Witness button on the watch now records a 60-second audio clip, transcribes it server-side, and attaches both the audio and the transcript to the recipient email.',
    link: '/safe',
  },
  {
    slug: 'action-center',
    date: '2026-05-16',
    category: 'feature',
    title: 'Action Center: War Room + Deadline Radar + Decoder + Safe Witness',
    summary:
      'Four high-leverage tools grouped under a single Action Center menu item so users find them faster.',
    link: '/action-center',
  },
  {
    slug: 'wear-os-companion',
    date: '2026-05-12',
    category: 'feature',
    title: 'Wear OS companion app',
    summary:
      'Cases list, voice notes, Safe Witness press-and-hold, courtroom mode (Do Not Disturb during a hearing), and a hearing-deadline complication on the watch face.',
    link: '/about',
  },
  {
    slug: 'public-launch',
    date: '2026-05-01',
    category: 'brand',
    title: 'Advottic public launch',
    summary:
      'Public launch of Advottic on advottic.com - personal-side legal-prep workspace plus Advottic Counsel for law firms. Built by Techno Optics LLC, Minnesota, USA.',
    link: '/about',
  },
];
