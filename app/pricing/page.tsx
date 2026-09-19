import Link from 'next/link';
import { headers } from 'next/headers';
import { nativePlatformFromUserAgent } from '@/lib/platform';
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  PricingProductJsonLd,
} from '@/components/seo/JsonLd';
import { SavingsCalculator } from '@/components/SavingsCalculator';
import {
  CONSUMER_ROWS,
  CONSUMER_TIERS,
  FIRM_ROWS,
  FIRM_TIERS,
  type Tier,
} from './schedule';
import {
  BODY,
  BUTTON_INK,
  Definitions,
  FilePage,
  FOCUS,
  H1,
  H2,
  LABEL,
  Schedule,
  Section,
  type ScheduleColumn,
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

// The pricing FAQ, once. Both the visible accordion and the FaqJsonLd
// block below read this array, so the markup and the page cannot
// disagree and Google cannot demote the rich result over a mismatch.
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
        {/* The schedule is the section's content and carries no headline of
            its own, so the heading is here for a screen reader's outline. */}
        <h2 className="sr-only">For one person</h2>
        <Schedule
          columns={CONSUMER_TIERS.map(tierToColumn)}
          rows={CONSUMER_ROWS}
          stampOn="pro"
          stamp={{ line1: 'Most', line2: 'chosen' }}
        />
      </Section>

      <Section tab="II" label="For firms" id="firms">
        <h2 className="sr-only">For firms</h2>
        <Schedule columns={FIRM_TIERS.map(tierToColumn)} rows={FIRM_ROWS} />
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
        <h2 className="sr-only">Frequently asked</h2>
        <div className="border-t border-rule">
          {PRICING_FAQ.map((it) => (
            <details key={it.q} className="group border-b border-rule py-3.5">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 font-public text-[15px] font-medium ${FOCUS}`}>
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
