import Link from 'next/link';
import type { Metadata } from 'next';
import { ExampleBella } from './example-bella';

export const metadata: Metadata = {
  title: 'A look inside Advottic · Example case',
  description:
    'A read-only walkthrough of an Advottic case file: subject profile, exhibits, hearing countdown, Advottic Review, and Bella the assistant. No sign-in required.',
  alternates: { canonical: '/example' },
  openGraph: {
    title: 'A look inside Advottic · Example case',
    description:
      'See exactly what a real Advottic case file looks like. Subject, exhibits, hearing countdown, packet PDF, and Bella the assistant - read-only, no account.',
    url: '/example',
    type: 'website',
  },
  keywords: [
    'advottic example',
    'sample case file',
    'case organization tool demo',
    'pro se case prep',
  ],
};

// =====================================================================
// Public, read-only example case file. Routed at /example so the
// landing-page "See an example" CTA can show new visitors what they
// would actually be using before they sign up. Everything below is
// hand-authored mock data - no DB calls, no auth.
// =====================================================================

export default function ExamplePage() {
  return (
    <div className="space-y-12 sm:space-y-16 animate-fade-up">
      {/* Header band - warning palette (amber). Dark mode keeps the
          warm warning vibe but on a dark amber wash so text stays readable. */}
      <header className="rounded-3xl bg-gradient-to-br from-amber-50 via-cream-50 to-cream-100 ring-1 ring-amber-200 dark:bg-none dark:bg-amber-950/40 dark:ring-amber-700/40 px-6 sm:px-10 py-6 sm:py-8">
        <p className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase font-semibold text-amber-700 dark:text-amber-300">
          <span className="inline-block h-px w-6 bg-amber-700 dark:bg-amber-300" />
          Example mode · read-only
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-amber-50 mt-3">
          A look inside an Advottic case file
        </h1>
        <p className="text-sm sm:text-base text-ink-700 dark:text-amber-100/85 mt-2 max-w-2xl leading-relaxed">
          This is a fictional matter we built to walk you through what your own case will look
          like once you sign in: a hero header, hearing countdown, exhibit list, Advottic Review
          review, and Bella the assistant. Nothing here is connected to a real account.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/sign-in?next=/cases/new"
            className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-4 py-2"
          >
            Sign up &amp; build my own
          </Link>
          <Link href="/" className="btn-secondary">
            Back to overview
          </Link>
        </div>
      </header>

      <CaseHero />
      <Tabs />
      <BellaSection />
      <CtaBand />
    </div>
  );
}

// ---------------------------------------------------------------------
// Mock case hero - mirrors the real /cases/[id] dark-forest header
// ---------------------------------------------------------------------

function CaseHero() {
  return (
    <section>
      <p className="eyebrow mb-3">1 · The case header</p>
      <div className="relative overflow-hidden rounded-3xl text-cream-100 ring-1 ring-forest-700/40 shadow-card-hover hero-bg">
        <div
          aria-hidden
          className="hero-orb hero-orb--gold hero-orb--a"
          style={{ width: 260, height: 260, right: '-60px', top: '-80px' }}
        />
        <div
          aria-hidden
          className="hero-orb hero-orb--cream hero-orb--b"
          style={{ width: 200, height: 200, right: '15%', bottom: '-100px', opacity: 0.4 }}
        />
        <div className="relative px-6 sm:px-8 lg:px-10 pt-8 pb-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
                  Landlord/tenant issue
                </span>
                <span className="badge text-[10px] tracking-wide bg-cream-100/15 text-cream-100 border border-cream-100/25">
                  Claimant
                </span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl md:text-[40px] font-medium tracking-[-0.015em] leading-[1.05] drop-shadow-[0_2px_18px_rgba(15,45,36,0.45)]">
                <span className="bg-gold-shine bg-clip-text text-transparent gold-pan">
                  Apartment lease &mdash; security deposit refund
                </span>
              </h2>
              <p className="text-sm text-cream-100/85 mt-3">
                <span className="text-cream-100/55">Business: </span>
                <span className="font-medium text-cream-100">Advottic Holdings</span>
                <span className="text-cream-100/40 mx-2">·</span>
                <span className="text-cream-100/85">Shakopee, MN, USA</span>
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ring-1 bg-amber-500/15 ring-amber-300/40 text-amber-200">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-200" />
              Under Review
            </span>
          </div>
          <p className="text-cream-100/85 text-[15px] leading-relaxed mt-5 max-w-3xl">
            Vacated the unit on March 31. The 21-day Minnesota statutory window for return of
            the security deposit closed without payment, partial accounting, or itemized
            deductions. Original move-in inspection plus walk-through video on file.
          </p>
        </div>
        <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 border-t border-cream-100/10 bg-forest-950/30 backdrop-blur-sm">
          <Kpi label="Exhibits" value="7" sub="on file" tone="emerald" />
          <Kpi label="Hearing" value="9d" sub="May 4" tone="amber" />
          <Kpi label="Advottic Review" value="✓" sub="review on file" tone="emerald" />
          <Kpi label="Sharing" value="1" sub="attorney" tone="cream" />
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'emerald' | 'amber' | 'rose' | 'neutral' | 'cream';
}) {
  const accent =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'rose'
          ? 'text-rose-300'
          : tone === 'cream'
            ? 'text-cream-200'
            : 'text-cream-100/60';
  return (
    <div className="px-4 sm:px-6 py-4 border-r border-cream-100/10 last:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0">
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-cream-100/55">
        {label}
      </p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${accent}`}>
        {value}
      </p>
      <p className="text-[11px] text-cream-100/55 mt-0.5">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Tabs section: Exhibits / Hearing / Advottic Review preview
// ---------------------------------------------------------------------

function Tabs() {
  return (
    <section className="space-y-10">
      <p className="eyebrow">2 · What goes in</p>

      <div>
        <h3 className="text-xl font-semibold tracking-tight text-forest-900">Exhibits</h3>
        <p className="text-sm text-ink-500 mt-0.5">
          Every upload becomes an auto-numbered exhibit with category, source, and incident date.
        </p>
        <ul className="mt-4 card divide-y divide-ink-100">
          {EXHIBITS.map((e) => (
            <li key={e.label} className="p-5 flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="badge bg-ink-950 text-white font-mono tracking-wide">
                    {e.label}
                  </span>
                  <span className="text-sm font-medium text-ink-950 truncate">{e.fileName}</span>
                </div>
                <p className="text-sm text-ink-700 mb-1.5 leading-relaxed">{e.description}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                  <span className="badge bg-ink-100 text-ink-700">{e.category}</span>
                  <span>
                    <span className="text-ink-400">Incident:</span> {e.incidentDate}
                  </span>
                  <span>
                    <span className="text-ink-400">Source:</span> {e.source}
                  </span>
                </div>
              </div>
              <span className="btn-secondary opacity-60 cursor-not-allowed select-none">
                View
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-xl font-semibold tracking-tight text-forest-900">Hearing &amp; checklist</h3>
        <p className="text-sm text-ink-500 mt-0.5">
          A countdown card plus a prioritized to-do list keyed to your case state.
        </p>

        <div className="mt-4 rounded-2xl p-5 md:p-6 text-white bg-gradient-to-br from-amber-700 via-amber-800 to-forest-900">
          <p className="text-[10px] tracking-[0.3em] uppercase font-semibold opacity-80">
            Upcoming hearing
          </p>
          <h4 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1">In 9 days</h4>
          <p className="text-sm opacity-90 mt-1.5">Saturday, May 4, 2026, 9:30 AM</p>
          <p className="text-sm opacity-80 mt-1">
            <span className="opacity-70">Location:</span> Scott County District Court, Courtroom 4
          </p>
          <p className="text-sm opacity-80 mt-2 max-w-xl">
            Hon. J. Smith · Conciliation calendar · Bring filed Statement of Claim plus 3 copies
            and the original lease.
          </p>
        </div>

        <div className="mt-4 card p-5 space-y-3">
          <p className="eyebrow">Before your hearing</p>
          <ul className="space-y-2">
            {[
              {
                t: 'Confirm courtroom + judge',
                b: 'Hon. J. Smith, Courtroom 4. Verified via Scott County online docket.',
                tone: 'emerald',
                done: true,
              },
              {
                t: 'Calendar 30-min early arrival',
                b: 'Plan parking + security screening. Photo ID required.',
                tone: 'amber',
                done: false,
              },
              {
                t: 'Print PDF case packet × 3',
                b: 'Cover, case info, exhibits index, Advottic Review review.',
                tone: 'amber',
                done: false,
              },
              {
                t: 'Re-confirm exhibit B (move-in inspection)',
                b: 'Source field still says "phone email screenshot." Replace with PDF if available.',
                tone: 'medium',
                done: false,
              },
            ].map((it, i) => (
              <li
                key={it.t}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  it.done
                    ? 'border-emerald-200 bg-emerald-50/40 opacity-70'
                    : it.tone === 'amber'
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-ink-200 bg-cream-50/60'
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-mono font-semibold ${
                    it.done
                      ? 'bg-emerald-700 text-white'
                      : it.tone === 'amber'
                        ? 'bg-amber-700 text-white'
                        : 'bg-forest-900 text-cream-100'
                  }`}
                >
                  {it.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${
                      it.done ? 'text-ink-700 line-through' : 'text-ink-950'
                    }`}
                  >
                    {it.t}
                  </p>
                  <p className="text-xs text-ink-600 leading-relaxed mt-0.5">{it.b}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-semibold tracking-tight text-forest-900">
          Advottic Review review (excerpt)
        </h3>
        <p className="text-sm text-ink-500 mt-0.5">
          Jurisdiction-aware issue spotting and concrete evidence to gather.
        </p>
        <div className="mt-4 card p-6 space-y-4">
          <div>
            <p className="eyebrow mb-1">Summary</p>
            <p className="text-sm text-ink-800 leading-relaxed">
              Tenant vacated unit on 2026-03-31 and provided a forwarding address per Minn.
              Stat. § 504B.178. The 21-day statutory window for return of the security deposit
              with itemized deductions appears to have expired without payment or accounting.
              On the facts presented, the matter could potentially involve breach of the
              Minnesota security-deposit statute.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-1">Possible legal issues</p>
            <ul className="list-disc list-outside pl-5 text-sm text-ink-800 space-y-1.5">
              <li>
                Failure to return security deposit within statutory deadline may constitute a
                violation of Minn. Stat. § 504B.178.
              </li>
              <li>
                Statutory penalty provisions could allow recovery of the deposit plus an amount
                up to the deposit as additional damages.
              </li>
              <li>
                Documentation of the move-out condition and forwarding address may be material to
                burden-shifting at conciliation court.
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-1">Evidence to strengthen the case</p>
            <ul className="list-disc list-outside pl-5 text-sm text-ink-800 space-y-1.5">
              <li>
                Date-stamped photos of the unit at move-out, paired with the move-in inspection
                exhibit already on file.
              </li>
              <li>
                Certified-mail receipt or signed delivery proof for the forwarding-address
                notice to the landlord.
              </li>
              <li>
                Bank or money-order records establishing the original deposit amount and date.
              </li>
            </ul>
          </div>
          <p className="text-xs text-ink-500 italic leading-relaxed pt-2 border-t border-ink-100">
            This analysis is for informational purposes only and does not constitute legal
            advice. Consult a licensed attorney in your jurisdiction before taking action.
          </p>
        </div>
      </div>
    </section>
  );
}

const EXHIBITS = [
  {
    label: 'A',
    fileName: 'lease-2024.pdf',
    description: 'Original signed lease agreement for the unit.',
    category: 'Contract',
    incidentDate: '2024-04-15',
    source: 'Tenant copy',
  },
  {
    label: 'B',
    fileName: 'move-in-inspection.pdf',
    description: 'Walk-through inspection form signed by both parties at move-in.',
    category: 'Document',
    incidentDate: '2024-04-15',
    source: 'Phone email screenshot',
  },
  {
    label: 'C',
    fileName: 'move-out-walkthrough.mp4',
    description: 'Video walk-through of the unit at the time of vacating.',
    category: 'Video',
    incidentDate: '2026-03-31',
    source: 'Tenant phone',
  },
  {
    label: 'D',
    fileName: 'forwarding-address-letter.pdf',
    description: 'Certified-mail letter providing forwarding address to landlord.',
    category: 'Communication',
    incidentDate: '2026-04-02',
    source: 'USPS certified',
  },
  {
    label: 'E',
    fileName: 'deposit-receipt.pdf',
    description: 'Bank record showing the original $1,800 security-deposit transfer.',
    category: 'Receipt',
    incidentDate: '2024-04-12',
    source: 'Bank statement',
  },
];

// ---------------------------------------------------------------------
// Bella demo
// ---------------------------------------------------------------------

function BellaSection() {
  return (
    <section>
      <p className="eyebrow">3 · Ask Bella</p>
      <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
        <div>
          <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-forest-900">
            A virtual assistant that explains, never advises.
          </h3>
          <p className="text-sm sm:text-base text-ink-700 mt-2 leading-relaxed max-w-xl">
            Bella is the in-app assistant. She reads the case you&apos;re viewing, explains
            doctrines in plain English, and helps you find your way around the app. She
            won&apos;t tell you what to do legally - she&apos;ll point you to a licensed
            attorney for that.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-ink-700">
            <li className="flex items-start gap-2.5">
              <Check /> Hedged language: &quot;may&quot;, &quot;could&quot;, &quot;appears
              to&quot;.
            </li>
            <li className="flex items-start gap-2.5">
              <Check /> Knows the case context when one is open.
            </li>
            <li className="flex items-start gap-2.5">
              <Check /> Public-defender carve-out for criminal matters.
            </li>
          </ul>
        </div>
        <ExampleBella />
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="mt-0.5 flex-none text-emerald-600"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 12.5l3 3 5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------
// CTA at the bottom
// ---------------------------------------------------------------------

function CtaBand() {
  return (
    <section className="rounded-3xl hero-bg text-cream-100 px-6 sm:px-10 py-10 sm:py-14 text-center relative overflow-hidden">
      <div
        aria-hidden
        className="hero-orb hero-orb--cream hero-orb--a"
        style={{ width: 360, height: 360, left: '50%', top: '-40%', transform: 'translateX(-50%)' }}
      />
      <div className="relative max-w-2xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Want this for your matter?
          <br />
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan">
            Build your own case file.
          </span>
        </h2>
        <p className="mt-3 text-cream-100/85 text-sm sm:text-base leading-relaxed">
          Sign in, capture the basics, upload your evidence. We&apos;ll handle the structure.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/sign-in?next=/cases/new"
            className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5 animate-glow"
          >
            Sign up &amp; build my own
          </Link>
          <Link
            href="/find-counsel"
            className="btn bg-white/15 text-white border border-white/25 hover:bg-white/25 backdrop-blur px-5 py-2.5"
          >
            Find counsel near me
          </Link>
        </div>
      </div>
    </section>
  );
}
