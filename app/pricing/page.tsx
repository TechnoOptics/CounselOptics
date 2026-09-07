import Link from 'next/link';
import { headers } from 'next/headers';
import { nativePlatformFromUserAgent } from '@/lib/platform';
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  PricingProductJsonLd,
} from '@/components/seo/JsonLd';
import { SavingsCalculator } from '@/components/SavingsCalculator';
import { FIRM_TIER_PRICING, formatFirmTierPrice } from '@/lib/firm-pricing';
import {
  BODY,
  BUTTON_INK,
  Definitions,
  FilePage,
  H1,
  H2,
  LABEL,
  Schedule,
  Section,
  type ScheduleColumn,
  type ScheduleRow,
} from '@/components/marketing/file';

export const metadata = {
  // Audit CR-46: previous title was 'Pricing - Advottic' which the
  // root layout's "%s · Advottic" template then suffixed AGAIN,
  // producing 'Pricing - Advottic · Advottic' in the browser tab.
  // Use { absolute: ... } to opt out of the template and emit a
  // single, clean title.
  title: { absolute: 'Pricing · Advottic' },
  description:
    'Built on a foundation lawyers can defend. Personal plans from $19/mo and law-firm plans from $59/user/mo. AI-powered legal assistance for individuals; full practice management for firms.',
  alternates: { canonical: '/pricing' },
  keywords: [
    'advottic pricing',
    'legal software pricing',
    'AI legal assistant cost',
    'law firm software pricing',
    'pro se case software',
    'Clio alternative pricing',
    'Spellbook alternative pricing',
    'legal tech subscription',
  ],
  openGraph: {
    title: 'Advottic pricing - Built on a foundation lawyers can defend',
    description:
      'Personal plans from $19/mo, firm plans from $59/user/mo. Calm software, defensible audit trail, savings vs Clio + DocuSign + Spellbook on day one.',
    url: '/pricing',
    type: 'website',
  },
};

type Tier = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string };
  emphasized?: boolean;
};

// Consumer ("personal") ladder. Kept in lockstep with lib/personal-tiers.ts:
// case caps 1/3/8/15/40, Bella unlocks at Plus ($29), Advottic Review + invite-
// firm at Pro ($59), and the case timeline + group cases at Ultra ($99).
const CONSUMER_TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb: 'Save one case and get personal-safety alerts. No credit card.',
    features: [
      '1 case',
      'Court-ready PDF export',
      'Safe Witness personal-safety alerts',
      'Receive e-signature requests as a signer',
      'Find counsel + public defender directories',
    ],
    cta: { label: 'Sign up free', href: '/sign-in?next=/cases' },
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$19',
    cadence: '/ month',
    blurb: 'A few matters at once, with priority support.',
    features: [
      '3 cases',
      'Court-ready PDF export',
      'Safe Witness with SMS delivery',
      'E-sign as a signer, always free',
      'Priority support',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$29',
    cadence: '/ month',
    blurb: 'Bella, your AI legal assistant, unlocks here.',
    features: [
      'Everything in Starter, plus:',
      '8 cases',
      'Bella AI assistant: chat + document drafting from templates',
      '500K Bella tokens / month',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$59',
    cadence: '/ month',
    blurb: 'The full toolkit: AI review and bring your own law firm in.',
    features: [
      'Everything in Plus, plus:',
      '15 cases',
      'Advottic Review: AI plain-English document review',
      'Invite your law firm to collaborate on a case',
      '1.5M Bella tokens / month',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
    emphasized: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '$99',
    cadence: '/ month',
    blurb: 'Everything, at scale, with the case timeline and group cases.',
    features: [
      'Everything in Pro, plus:',
      '40 cases',
      'Case Timeline: turn evidence into a court-ready chronology',
      'Group / community cases',
      '3M Bella tokens / month (highest grant)',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
];

const FIRM_TIERS: Tier[] = [
  {
    id: 'solo',
    name: 'Solo',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.solo),
    cadence: '/ user / month',
    blurb:
      'Single attorney + 1 staff. Everything you need to run a practice; ~$200 / mo cheaper than Clio + DocuSign + Spellbook.',
    features: [
      'Up to 1 attorney + 1 staff',
      '30 matters per attorney (matches typical solo caseload)',
      '2.5M Bella tokens / month',
      'Practice management: time, invoicing, IOLTA, intake, conflict check',
      'Bella (tier 1): docs, search, schedule, meetings, intake, conflict check, time + invoice',
      'Branded document drafting (13+ templates) with text-banner PDF header',
      'Counsel calendar: meetings, deadlines, hearings, integrations',
      'Send-to-sign with reminders + status tracking',
      'Court-form auto-fill (CA, NY, TX, FL, Federal)',
      'CSV + bulk doc import from Clio / MyCase / PracticePanther',
      'Action Center hub: War Room, Deadline Radar, Decode a document, Safe Witness',
      '25 GB document storage',
      '10 e-sign requests / month',
      'Extras: 50K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/onboarding' },
  },
  {
    id: 'firm',
    name: 'Small Firm',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.small_firm),
    cadence: '/ user / month',
    blurb:
      'Most popular. Everything in Solo, plus letterhead PDFs, employee Hub, IOLTA, marketplace, and a custom subdomain.',
    features: [
      'Up to 25 users',
      '50 matters per attorney',
      '4M Bella tokens / month per seat (firm pool)',
      'Bella (tier 2): firm letterhead painted on every generated PDF',
      'Employee Hub: power-but-limited portal for non-attorney staff (requests, intakes, calendar, action items)',
      'Roles & groups with progressive feature unlock',
      'Customizable dashboard tiles (default + optional)',
      'IOLTA trust accounting with 3-way reconciliation',
      'Co-counsel referral network with fee-split tracking',
      'Marketplace lead boost (3x match rate)',
      'Custom firm subdomain (yourfirm.advottic.com)',
      'Branded e-sign emails with your logo',
      '250 GB document storage',
      '100 e-sign requests / month',
      'Discovery document review (250 docs / mo)',
      'Priority email support',
      'Extras: 50K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/onboarding' },
    emphasized: true,
  },
  {
    id: 'growing',
    name: 'Growing Firm',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.growing_firm),
    cadence: '/ user / month',
    blurb:
      'Analytics, dedicated CSM, custom Bella training, and full white-label control of the sidebar.',
    features: [
      '26 - 100 users',
      'Everything in Small Firm, plus:',
      '100 matters per attorney',
      '6M Bella tokens / month per seat (firm pool)',
      'Advanced analytics (matter profitability, attorney ROI)',
      'Enterprise menu customization (hide / rename / reorder the sidebar per role)',
      'Dedicated customer success manager',
      '1 TB document storage',
      '500 e-sign requests / month',
      'Discovery review (1,000 docs / mo)',
      'Custom Bella training on firm drafting style + voice',
      'SAML SSO',
      'Quarterly business review',
      'Extras: 30K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/request' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.enterprise),
    cadence: '/ month',
    blurb:
      '100+ users, SSO, 99.9% SLA. Final price scales with seats, support tier, and SLA.',
    features: [
      '100+ users, no per-seat ceiling',
      'Negotiated matter ceiling (typically uncapped)',
      '15M+ tokens / month per seat (firm pool)',
      'SAML / OIDC SSO',
      '99.9% uptime SLA',
      'Dedicated infrastructure',
      'White-label tenant subdomain + full brand override',
      'Multi-firm group billing (M&A scenarios)',
      'Sandbox + staging environments',
    ],
    cta: { label: 'Contact sales', href: '/counsel/request?tier=enterprise' },
  },
];

// Pricing FAQ - mirrors the visible accordion below. Keep both
// in sync when copy changes; mismatches risk Google demoting the
// FAQ rich result.
const PRICING_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Do I need a credit card on the Free tier?',
    a: 'No. Free is genuinely free; we collect a card only when you start a paid trial.',
  },
  {
    q: 'What is Safe Witness and is it really free?',
    a: 'Safe Witness is a personal-safety feature, and yes, it is on the Free tier. Press and hold the button on your Wear OS watch (or trigger it from the web) and a one-time alert with your verification PIN, location, a 30-second audio recording, and a tap-to-call link goes to every trusted contact you have configured. Contacts can open a live-tracker page to follow your position until you stop sharing it. We do not hold personal safety behind a paywall.',
  },
  {
    q: 'Does the Wear OS app cost extra?',
    a: 'No. The Advottic Wear OS app is included at no extra charge - install it on your Wear OS watch and pair it via a 6-digit code in the phone app or by signing in on the watch web flow.',
  },
  {
    q: 'What counts as an "item"?',
    a: 'One case or one contract. They share a single budget across the tier - so 20 items could be 15 cases + 5 contracts, or 20 of either kind. The vault (your receipts and uploads) is sized separately in GB and does not consume the item budget. Sandbox / archived items do not count.',
  },
  {
    q: 'What happens if I go over my item limit?',
    a: 'Items past your tier cap silently consume Bella tokens from your monthly grant - 25K tokens per extra item per month on the personal tiers, 50K on Solo / Small Firm, 30K on Growing Firm. You see the line in your billing history, and if your balance runs low you can buy a Boost pack or upgrade tiers. There are no surprise card charges.',
  },
  {
    q: 'What is the difference between Bella tier 1 and tier 2?',
    a: 'Tier 1 (Solo): Bella drafts documents, runs reports, schedules meetings, posts intake messages, and operates the practice via the same tools you would use yourself. Tier 2 (Small Firm and up): everything in tier 1, plus your firm letterhead is painted across the top of every PDF Bella renders - so a Bella-generated demand letter or engagement letter walks out of the system looking exactly like one your partners would put on the wire. Upload the letterhead under /counsel/settings; nothing else to wire up.',
  },
  {
    q: 'What is the Employee Hub on Small Firm?',
    a: 'Small Firm and up includes the Employee Hub: a power-but-limited portal at /portal for non-attorney staff (paralegals, intake coordinators, billing clerks). They can submit requests, file intakes, see assigned action items, and reach the attorneys via the request thread - without exposing the full counsel sidebar (Trust accounting, Billing, Firm settings) that should stay attorney-only. Roles & groups gate what each employee sees; the Enterprise menu customization on Growing Firm lets you rename or hide whole sections per role.',
  },
  {
    q: 'What happens at the end of the 7-day trial?',
    a: "You're auto-enrolled on the tier you trialed. Cancel any time before day 7 to avoid the charge; downgrade to Free with one click.",
  },
  {
    q: 'Can I switch tiers later?',
    a: "Yes. Upgrades are immediate; downgrades take effect at the next billing cycle. No data is deleted on downgrade - you keep read access to anything that exceeds the new tier's limits.",
  },
  {
    q: 'Is the AI a black box?',
    a: "No. Bella tells you what tool she's calling and what tool result she got back; the audit trail records every signature event. You can disable AI features per firm or per user.",
  },
  {
    q: 'What about state-bar rules?',
    a: 'Whether a specific Advottic feature can be used for a specific document class in your jurisdiction is a question for your counsel. We surface the right warnings (SOL tolling reminders, trust accounting negative-balance flags, UETA carve-outs in e-sign) but the legal call stays with you.',
  },
];


/** A tier as a schedule column. The CTA and price come straight from the tier. */
function tierToColumn(t: Tier): ScheduleColumn {
  return {
    id: t.id,
    name: t.name,
    price: t.price,
    cadence: t.cadence,
    cta: { label: t.cta.label, href: t.cta.href },
    emphasized: t.emphasized,
  };
}

/**
 * Feature rows for the table. Each label is matched against a tier's
 * feature strings case-insensitively; the cell shows the matching feature
 * text (with the label removed when it is a plain "included" line) or a
 * middle dot when the tier lacks it. This keeps the arrays above as the
 * single source of what a tier includes.
 */
function featureRows(tiers: Tier[], labels: string[]): ScheduleRow[] {
  return labels.map((label) => ({
    label,
    cells: tiers.map((t) => {
      const hit = t.features.find((f) => f.toLowerCase().includes(label.toLowerCase()));
      if (!hit) return '·';
      // Tolerate a plural "s" the label itself does not carry (the tier
      // arrays say "1 case" but "3 cases"): otherwise the removal leaves a
      // stranded "s" behind, e.g. "3 cases" -> "3 s".
      const short = hit
        .replace(new RegExp(`${label}(e?s)?`, 'i'), '')
        .replace(/^[\s:,-]+|[\s:,.-]+$/g, '');
      return short.length > 0 && short.length < 28 ? short : 'Yes';
    }),
  }));
}

const CONSUMER_ROWS = [
  'case',
  'PDF export',
  'Safe Witness',
  'E-sign',
  'Bella tokens',
  'Advottic Review',
  'law firm',
  'Case Timeline',
  'Priority support',
];

const FIRM_ROWS = [
  'tokens',
  'letterhead',
  'subdomain',
  'Employee Hub',
  'SSO',
  'SLA',
  'group billing',
];

export default function PricingPage() {
  // App Store Guideline 3.1.1 / 3.1.3(c): this whole route is a sell page,
  // so inside the iOS app it does not exist. middleware.ts redirects it
  // before this runs; this branch is the second, independent line of
  // defence and renders nothing purchasable, nothing priced.
  const serverPlatform = nativePlatformFromUserAgent(headers().get('user-agent'));
  if (serverPlatform === 'ios') {
    return (
      <FilePage>
        <Section label="Your account" first>
          <h1 className={H1}>Your account</h1>
          <p className={`${BODY} mt-4`}>Whatever your account includes unlocks here automatically.</p>
          <Link href="/cases" className={`${BUTTON_INK} mt-6`}>
            Go to your cases
          </Link>
        </Section>
      </FilePage>
    );
  }
  return (
    <FilePage>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Pricing', href: '/pricing' },
        ]}
      />
      <FaqJsonLd questions={PRICING_FAQ} />
      <PricingProductJsonLd />

      <Section label="Schedule of fees" first>
        <p className={LABEL}>7-day trial on every paid tier. 20% off annual. Cancel any time.</p>
        <h1 className={`${H1} mt-3`}>What it costs.</h1>
        <p className={`${BODY} mt-5`}>
          People pay for their own matter. Firms pay per seat, in writing. The platform underneath
          is the same.
        </p>
      </Section>

      <Section tab="I" label="For one person" id="individuals">
        <Schedule
          columns={CONSUMER_TIERS.map(tierToColumn)}
          rows={featureRows(CONSUMER_TIERS, CONSUMER_ROWS)}
          stampOn="pro"
          stamp={{ line1: 'Most', line2: 'chosen' }}
        />
      </Section>

      <Section tab="II" label="For firms" id="firms">
        <Schedule columns={FIRM_TIERS.map(tierToColumn)} rows={featureRows(FIRM_TIERS, FIRM_ROWS)} />
        <p className={`${BODY} mt-6 text-[15px]`}>
          Enterprise is agreed in writing: the final price scales with seats, support tier and SLA.
        </p>
      </Section>

      <Section label="Worksheet" id="savings">
        <h2 className={H2}>What does Advottic save your firm?</h2>
        <div className="mt-6">
          <SavingsCalculator />
        </div>
      </Section>

      <Section label="Discounts">
        <Definitions
          columns={2}
          items={[
            { term: 'Annual prepay', def: '20% off any paid tier.' },
            { term: 'Bar-association members', def: '15% off Counsel tiers. We verify the bar number on signup.' },
            { term: 'Law students', def: '50% off the consumer tiers.' },
            { term: 'Legal aid and nonprofits', def: '75% off, capped at 5 seats.' },
            { term: 'Multi-firm groups', def: '10% off each additional firm.' },
          ]}
        />
      </Section>

      <Section label="Add-ons, as used">
        <Definitions
          columns={2}
          items={[
            { term: 'E-sign requests beyond bundle', def: '$2 per request (Solo, Pro), $1 per request (Small Firm and up).' },
            { term: 'Contract reviews beyond bundle', def: '$9.99 per contract for Pro.' },
            { term: 'Discovery review', def: '$0.05 per document beyond the bundle.' },
            { term: 'Receipt vault storage', def: '$0.10 per GB per month beyond bundle.' },
            { term: 'Safe Witness SMS beyond bundle', def: '$0.02 per SMS segment past 50 messages a month.' },
            { term: 'Wear OS companion app', def: 'Included at no extra charge.' },
            { term: 'Marketplace lead', def: 'Free for the first match per matter, then $50 to $99 per accepted lead.' },
          ]}
        />
      </Section>

      <Section label="Gift">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className={H2}>Buy it for someone you care about.</h2>
            <p className={`${BODY} mt-3 text-[15px]`}>
              Pay once. They get an email with a one-tap setup link. The subscription activates on
              their account for the duration you choose (1, 3, 6 or 12 months) and they can upgrade
              or extend later from their billing page.
            </p>
          </div>
          <Link href="/gift" data-hide-on-ios className={BUTTON_INK}>
            Send a gift
          </Link>
        </div>
      </Section>

      <Section label="Frequently asked" id="faq">
        <div className="border-t border-rule">
          {PRICING_FAQ.map((it) => (
            <details key={it.q} className="group border-b border-rule py-3.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-public text-[15px] font-medium">
                <h3 className="m-0 text-[15px] font-medium">{it.q}</h3>
                <span aria-hidden className="font-courier text-xl leading-none text-ink-600 group-open:rotate-45 dark:text-cream-100/60">+</span>
              </summary>
              <p className={`${BODY} mt-3 text-[15px]`}>{it.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section label="Still deciding">
        <h2 className={H2}>Try the tier above what you think you need.</h2>
        <p className={`${BODY} mt-4`}>
          For most people that is Plus, where Bella unlocks, or Pro if you want Advottic Review and to
          bring your law firm in. For most firms it is Small Firm. If you do not use it, downgrade for
          free.
        </p>
        <Link href="/sign-in" className={`${BUTTON_INK} mt-6`}>
          Get started
        </Link>
      </Section>
    </FilePage>
  );
}
