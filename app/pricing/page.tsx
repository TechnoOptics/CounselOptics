import Link from 'next/link';
import { BreadcrumbJsonLd, FaqJsonLd } from '@/components/seo/JsonLd';

export const metadata = {
  title: 'Pricing - Advottic',
  description:
    'Personal plans from $19/mo and law-firm plans from $59/user/mo. AI-powered legal assistance for individuals; full practice management for firms.',
  alternates: { canonical: '/pricing' },
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
      'Try Bella, save one case, receive signing requests. No credit card.',
    features: [
      'Bella for general legal questions (limited per day)',
      '1 active case file',
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
      'Everything you need to handle a legal matter on your own; or hand it off when it gets big.',
    features: [
      'Unlimited Bella turns',
      'Unlimited cases',
      'Bella drafts documents from 13+ templates',
      'E-sign as recipient (always free)',
      '5 contract reviews / month with confidence rating',
      '10 GB receipt vault',
      'Documents inbox',
      'Priority lawyer matching on Find Counsel',
    ],
    cta: { label: 'Start 14-day trial', href: '/billing?upgrade=pro' },
    emphasized: true,
  },
  {
    id: 'family',
    name: 'Personal Plus',
    price: '$39',
    cadence: '/ month',
    blurb:
      'Family share + unlimited reviews + a head start when you need real counsel.',
    features: [
      'Everything in Personal Pro',
      'Family share for up to 4 members',
      'Unlimited contract reviews',
      '50 GB receipt vault',
      '$1,000 / year credit toward Advottic Counsel firms',
      'Priority response from matched firms (24h)',
    ],
    cta: { label: 'Start 14-day trial', href: '/billing?upgrade=family' },
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
      '100 active cases',
      'Practice management: time, invoicing, IOLTA, intake, conflict check',
      'Bella as a firm agent (operates the practice via tools)',
      'Court-form auto-fill (CA, NY, TX, FL, Federal)',
      '25 GB document storage',
      '10 e-sign requests / month',
    ],
    cta: { label: 'Start 14-day trial', href: '/counsel/onboarding' },
  },
  {
    id: 'firm',
    name: 'Small Firm',
    price: '$99',
    cadence: '/ user / month',
    blurb:
      'Most popular. Everything in Solo, plus the full marketplace, IOLTA, and a custom subdomain.',
    features: [
      'Up to 25 users',
      'Unlimited cases + matters',
      'IOLTA trust accounting with 3-way reconciliation',
      'Co-counsel referral network with fee-split tracking',
      'Marketplace lead boost (3x match rate)',
      'Custom firm subdomain (yourfirm.advottic.com)',
      '250 GB document storage',
      '100 e-sign requests / month',
      'Discovery document review (250 docs / mo)',
      'Priority email support',
    ],
    cta: { label: 'Start 14-day trial', href: '/counsel/onboarding' },
    emphasized: true,
  },
  {
    id: 'growing',
    name: 'Growing Firm',
    price: '$149',
    cadence: '/ user / month',
    blurb:
      'Analytics, dedicated CSM, and Bella tuned to your firm.',
    features: [
      '26 - 100 users',
      'Everything in Small Firm',
      'Advanced analytics (matter profitability, attorney ROI)',
      'Dedicated customer success manager',
      '1 TB document storage',
      '500 e-sign requests / month',
      'Discovery review (1,000 docs / mo)',
      'Custom Bella training on firm drafting style',
      'SAML SSO',
      'Quarterly business review',
    ],
    cta: { label: 'Start 14-day trial', href: '/counsel/request' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    cadence: 'Talk to sales',
    blurb:
      '100+ users, SSO, custom data-residency, HIPAA BAA, 99.9% SLA.',
    features: [
      '100+ users, no per-seat ceiling',
      'SAML / OIDC SSO + SCIM provisioning',
      'Custom data-residency (US, EU, on-prem)',
      'HIPAA Business Associate Agreement',
      '99.9% uptime SLA',
      'Dedicated infrastructure',
      'White-label tenant subdomain',
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
    q: 'What happens at the end of the 14-day trial?',
    a: "You're auto-enrolled on the tier you trialed. Cancel any time before day 14 to avoid the charge; downgrade to Free with one click.",
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
      <header className="text-center space-y-3 max-w-3xl mx-auto pt-4 sm:pt-8">
        <p className="eyebrow justify-center">Pricing</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Two sides of one platform.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          People use Advottic to handle their own matters. Firms run their
          entire practice on Advottic Counsel. The pricing scales with what
          you need; the platform is the same.
        </p>
        <div className="flex justify-center gap-6 pt-4 text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <span>14-day free trial on every paid tier</span>
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
          q="What happens at the end of the 14-day trial?"
          a="You're auto-enrolled on the tier you trialed. Cancel any time before day 14 to avoid the charge; downgrade to Free with one click."
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
