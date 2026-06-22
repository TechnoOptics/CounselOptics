import Link from 'next/link';
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  PricingProductJsonLd,
} from '@/components/seo/JsonLd';
import { TechTrustStrip } from '@/components/TechTrustStrip';
import { SavingsCalculator } from '@/components/SavingsCalculator';

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

const CONSUMER_TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb:
      'Try Bella, save one case, get personal-safety alerts. No credit card.',
    features: [
      '1 case or contract (vault sized separately in GB)',
      '25K Bella tokens / month',
      'Safe Witness: 1 trusted contact, web only, 3 alerts / month',
      'Receive e-signature requests as a signer',
      'Inbox notifications',
      'Browse the public lawyer directory',
    ],
    cta: { label: 'Sign up free', href: '/sign-in?next=/cases' },
  },
  {
    id: 'pro',
    name: 'Personal Pro',
    price: '$19',
    cadence: '/ month',
    blurb:
      'Everything you need to handle a legal matter on your own, plus full Safe Witness with the Wear OS watch.',
    features: [
      '20 cases or contracts (shared budget; vault sized in GB)',
      '500K Bella tokens / month (~12 sessions)',
      'Bella drafts documents from 13+ templates',
      'Safe Witness: up to 5 contacts, SMS + email, watch press, 30s audio capture, live tracker page with browser geolocation',
      'Wear OS companion app (cases, deadlines, courtroom mode, Safe Witness)',
      'Action Center hub: War Room, Deadline Radar, Decode a document, Safe Witness',
      'E-sign as recipient (always free)',
      '3 contract reviews / month with confidence rating',
      '5 e-sign requests / month',
      '5 GB receipt vault',
      'Documents inbox + priority lawyer matching',
      'Extras: 25K tokens / item / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing?upgrade=pro' },
    // emphasized intentionally false: audit W20 flagged "Most popular"
    // badge appearing on Personal Pro AND Small Firm simultaneously,
    // which collapses the badge's signal. Small Firm is the actual
    // most-popular tier (its blurb already says "Most popular") so
    // the badge lives there. Personal Pro is anchored by being the
    // first paid tier in the consumer column, which is enough hierarchy.
  },
  {
    id: 'family',
    name: 'Personal Plus',
    price: '$29',
    cadence: '/ month',
    blurb:
      'Family share, more storage, Safe Witness for every family member, and a head start when you need real counsel.',
    features: [
      'Everything in Personal Pro, plus:',
      'Family share for up to 4 members - each gets their own Safe Witness',
      'Safe Witness: up to 15 contacts per family member',
      '50 cases or contracts (shared budget across the family)',
      '1.5M Bella tokens / month (~37 sessions) - 3x Pro',
      '10 contract reviews / month',
      '15 e-sign requests / month',
      '25 GB receipt vault',
      '$1,000 / year credit toward Advottic Counsel firms',
      'Priority response from matched firms (24h)',
      'Extras: 25K tokens / item / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing?upgrade=family' },
  },
];

const FIRM_TIERS: Tier[] = [
  {
    id: 'solo',
    name: 'Solo',
    price: '$59',
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
    price: '$99',
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
    price: '$149',
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
    price: 'From $1,800',
    cadence: '/ month',
    blurb:
      '100+ users, SSO, custom data-residency, HIPAA BAA, 99.9% SLA. Final price scales with seats, residency, support tier, and SLA.',
    features: [
      '100+ users, no per-seat ceiling',
      'Negotiated matter ceiling (typically uncapped)',
      '15M+ tokens / month per seat (firm pool)',
      'SAML / OIDC SSO + SCIM provisioning',
      'Custom data-residency (US, EU, on-prem)',
      'HIPAA Business Associate Agreement',
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
    a: 'Safe Witness is a personal-safety feature. Press and hold the button on your Wear OS watch (or trigger it from the web) and a one-time alert with your verification PIN, location, a 30-second audio recording, and a tap-to-call link goes to every trusted contact you have configured. Free tier includes 1 contact, web only, 3 alerts per month. Personal Pro and up include up to 5 contacts (15 on Personal Plus per family member), the Wear OS watch press, SMS delivery, the audio capture, and the live-tracker page contacts open to see your moving position. We gate the volume, not the safety - a single alert from Free has the same email + map quality as a single alert from Personal Plus.',
  },
  {
    q: 'Does the Wear OS app cost extra?',
    a: 'No. The Advottic Wear OS app is included free with Personal Pro, Personal Plus, and every firm tier - install it from the Play Store on the watch and pair it via a 6-digit code in the phone app or by signing in on the watch web flow. Free tier does not include the watch press for Safe Witness, but it does let the watch show cases + the next hearing once we hit that milestone in the roadmap.',
  },
  {
    q: 'What counts as an "item"?',
    a: 'One case or one contract. They share a single budget across the tier - so 20 items could be 15 cases + 5 contracts, or 20 of either kind. The vault (your receipts and uploads) is sized separately in GB and does not consume the item budget. Sandbox / archived items do not count.',
  },
  {
    q: 'What happens if I go over my item limit?',
    a: 'Items past your tier cap silently consume Bella tokens from your monthly grant - 25K tokens per extra item per month on Personal Pro / Plus, 50K on Solo / Small Firm, 30K on Growing Firm. You see the line in your billing history, and if your balance runs low you can buy a Boost pack or upgrade tiers. There are no surprise card charges.',
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

export default function PricingPage() {
  return (
    <div className="space-y-16 sm:space-y-24 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Pricing', href: '/pricing' },
        ]}
      />
      <FaqJsonLd questions={PRICING_FAQ} />
      {/* Product + AggregateOffer schema. The aggregate offer (lowPrice
          $0, highPrice $1,800) is what unlocks the price + currency
          snippet on commercial queries. AggregateRating is wired ONLY
          once we accumulate real reviews to surface - false ratings
          here would trigger Google's structured-data manual action. */}
      <PricingProductJsonLd />
      <header className="text-center space-y-3 max-w-3xl mx-auto pt-4 sm:pt-8">
        {/* Audit V2-6: promote "Built on a foundation lawyers can defend"
            from the mid-page trust strip up to the hero eyebrow. This
            is the single strongest line on the page and was wasted
            below the fold. */}
        <p className="eyebrow justify-center">
          Built on a foundation lawyers can defend
        </p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Two sides of one platform.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          People use Advottic to handle their own matters. Firms run their
          entire practice on Advottic Counsel. The pricing scales with what
          you need; the platform is the same.
        </p>
        <div className="flex justify-center gap-6 pt-4 text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <span>7-day free trial on every paid tier</span>
          <span aria-hidden>·</span>
          <span>20% off with annual prepay</span>
          <span aria-hidden>·</span>
          <span>Cancel any time</span>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          For individuals
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {CONSUMER_TIERS.map((t) => (
            <TierCard key={t.id} tier={t} />
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <TechTrustStrip />
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <SavingsCalculator />
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          For law firms
        </h2>
        <div className="grid gap-4 lg:grid-cols-4">
          {FIRM_TIERS.map((t) => (
            <TierCard key={t.id} tier={t} />
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="card p-5 sm:p-7 ring-2 ring-amber-300/60 dark:ring-amber-500/40 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/15">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex-1 space-y-1.5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300 font-semibold">
                Gift Advottic
              </p>
              <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
                Buy it for someone you care about.
              </h3>
              <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
                Pay once. They get an email with a one-tap setup link.
                Subscription activates on their account for the
                duration you choose (1, 3, 6, or 12 months) and they
                can upgrade or extend later from their billing page.
              </p>
            </div>
            <Link href="/gift" data-hide-on-ios className="btn-primary inline-flex shrink-0">
              Send a gift &rarr;
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-4">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Discounts
        </h2>
        <ul className="text-[14px] text-ink-700 dark:text-cream-100/80 leading-relaxed space-y-2 list-disc pl-5">
          <li>
            <strong>Annual prepay:</strong> 20% off any paid tier
          </li>
          <li>
            <strong>Bar-association members:</strong> 15% off Counsel tiers
            (we verify the bar number on signup)
          </li>
          <li>
            <strong>Law students:</strong> 50% off the consumer tiers
          </li>
          <li>
            <strong>Legal-aid + nonprofits:</strong> 75% off, capped at 5
            seats
          </li>
          <li>
            <strong>Multi-firm groups:</strong> 10% off each additional firm
            (M&A scenarios)
          </li>
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-4">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Add-ons (paid as you use them)
        </h2>
        <div className="grid sm:grid-cols-2 gap-3 text-[13.5px]">
          <Card title="E-sign requests beyond bundle">
            $2 / request (Solo / Personal Pro), $1 / request (Small Firm and
            up)
          </Card>
          <Card title="Contract reviews beyond bundle">
            $9.99 / contract for Personal Pro
          </Card>
          <Card title="Discovery review">
            $0.05 / document beyond the bundle
          </Card>
          <Card title="Receipt vault storage">
            $0.10 / GB / month beyond bundle
          </Card>
          <Card title="Safe Witness SMS beyond bundle">
            $0.02 / SMS segment past 50 messages / mo. Free tier has 3 alerts
            / mo, paid tiers are unlimited.
          </Card>
          <Card title="Wear OS companion app">
            Included free with Personal Pro, Personal Plus, and every firm
            tier. No add-on charge.
          </Card>
          <Card title="Marketplace lead">
            Free for first match per matter, then $50-$99 per accepted lead
          </Card>
          <Card title="Co-counsel referral fee split">
            2% platform fee on the receiving firm's payout
          </Card>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-4">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Frequently asked
        </h2>
        <Q
          q="Do I need a credit card on the Free tier?"
          a="No. Free is genuinely free; we collect a card only when you start a paid trial."
        />
        <Q
          q="What is Safe Witness and is it really free?"
          a="Safe Witness is a personal-safety feature. Press and hold the button on your Wear OS watch (or trigger it from the web) and a one-time alert with your verification PIN, location, a 30-second audio recording, and a tap-to-call link goes to every trusted contact you have configured. Free tier includes 1 contact, web only, 3 alerts per month. Personal Pro and up include up to 5 contacts (15 on Personal Plus per family member), the Wear OS watch press, SMS delivery, the audio capture, and the live-tracker page contacts open to see your moving position. We gate the volume, not the safety."
        />
        <Q
          q="Does the Wear OS app cost extra?"
          a="No. The Advottic Wear OS app is included free with Personal Pro, Personal Plus, and every firm tier - install it from the Play Store on the watch and pair it via a 6-digit code in the phone app."
        />
        <Q
          q="What is the difference between Bella tier 1 and tier 2?"
          a="Tier 1 (Solo): Bella drafts documents, runs reports, schedules meetings, posts intake messages, and operates the practice via tools. Tier 2 (Small Firm and up): everything in tier 1, plus your firm letterhead is painted across the top of every PDF Bella renders. Upload the letterhead under /counsel/settings; nothing else to wire up."
        />
        <Q
          q="What is the Employee Hub on Small Firm?"
          a="Small Firm and up includes the Employee Hub: a power-but-limited portal at /portal for non-attorney staff (paralegals, intake coordinators, billing clerks). They can submit requests, file intakes, see assigned action items, and reach the attorneys via the request thread - without exposing Trust accounting, Billing, or Firm settings. Roles & groups gate what each employee sees."
        />
        <Q
          q="What happens at the end of the 7-day trial?"
          a="You're auto-enrolled on the tier you trialed. Cancel any time before day 7 to avoid the charge; downgrade to Free with one click."
        />
        <Q
          q="Can I switch tiers later?"
          a="Yes. Upgrades are immediate; downgrades take effect at the next billing cycle. No data is deleted on downgrade - you keep read access to anything that exceeds the new tier's limits."
        />
        <Q
          q="Is the AI a black box?"
          a="No. Bella tells you what tool she's calling and what tool result she got back; the audit trail records every signature event. You can disable AI features per firm or per user."
        />
        <Q
          q="What about state-bar rules?"
          a="Whether a specific Advottic feature can be used for a specific document class in your jurisdiction is a question for your counsel. We surface the right warnings (the SOL engine reminds you about tolling and repose; the trust accounting flags negative balances; the e-sign flow reminds you about UETA carve-outs) but the legal call stays with you."
        />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-4 pt-8">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Still figuring out which tier?
        </h2>
        <p className="text-[14px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          The honest answer for most people is &ldquo;Personal Pro&rdquo;,
          and for most firms it&rsquo;s &ldquo;Small Firm.&rdquo; Try the
          tier above what you think you need; if you don&rsquo;t use it,
          downgrade for free.
        </p>
        <Link href="/sign-in" className="btn-primary inline-flex">
          Get started
        </Link>
      </section>
    </div>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const ring = tier.emphasized
    ? 'ring-2 ring-gold-metal dark:ring-amber-500/60'
    : 'ring-1 ring-white/5';
  return (
    <article
      className={`card p-5 sm:p-6 space-y-4 flex flex-col ${ring} ${
        tier.emphasized
          ? 'bg-gradient-to-b from-amber-50/30 to-transparent dark:from-amber-950/15'
          : ''
      }`}
    >
      <header className="space-y-1">
        {tier.emphasized && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
            Most popular
          </p>
        )}
        <h3 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          {tier.name}
        </h3>
        <p className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 tabular-nums">
          {tier.price}{' '}
          <span className="text-[13px] font-normal text-ink-500 dark:text-cream-100/55">
            {tier.cadence}
          </span>
        </p>
        <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed pt-1">
          {tier.blurb}
        </p>
      </header>
      <ul className="text-[12.5px] text-ink-700 dark:text-cream-100/85 space-y-1.5 leading-snug flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden>
              ✓
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={tier.cta.href}
        className={tier.emphasized ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
      >
        {tier.cta.label}
      </Link>
    </article>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-3.5">
      <p className="font-semibold text-forest-900 dark:text-cream-100 text-[12.5px]">
        {title}
      </p>
      <p className="text-ink-600 dark:text-cream-100/70 leading-relaxed mt-0.5">
        {children}
      </p>
    </div>
  );
}

function Q({ q, a }: { q: string; a: string }) {
  return (
    <div className="card p-4 space-y-1">
      <p className="font-semibold text-forest-900 dark:text-cream-100">{q}</p>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        {a}
      </p>
    </div>
  );
}
