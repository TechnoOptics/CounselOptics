import Link from 'next/link';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { TestimonialMarquee } from '@/components/TestimonialMarquee';

export default async function HomePage() {
  let cases: Awaited<ReturnType<typeof listCases>> = [];
  if (!storageUnavailable()) {
    try {
      cases = await listCases();
    } catch {
      cases = [];
    }
  }

  return (
    <div className="space-y-20 sm:space-y-28">
      <Hero existingCases={cases.length} />
      <FlowTimeline />
      <Personas />
      <Outcomes />
      <TestimonialMarquee />
      <PricingCta />
      <Faq />
      <FinalCta />
    </div>
  );
}

// =====================================================================
// Hero - editorial, asymmetric, product-forward
// =====================================================================

function Hero({ existingCases }: { existingCases: number }) {
  return (
    <section className="relative -mt-2 animate-fade-up">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 items-center">
        {/* Left: editorial copy block */}
        <div className="lg:col-span-7">
          <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-700">
            <span className="inline-block h-px w-8 bg-gold-500" />
            Strategic advocacy · trusted results
          </p>
          <h1 className="mt-5 font-display text-[44px] sm:text-[56px] lg:text-[72px] font-medium tracking-[-0.02em] leading-[0.98] text-forest-900">
            Your case,
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              ready to be heard.
            </span>
          </h1>
          <p className="mt-6 text-[16px] sm:text-lg leading-relaxed text-ink-700 max-w-xl">
            Advottic turns the chaos of a real-life legal matter into a clean, structured case
            file. Capture every piece of evidence, surface the issues that matter, and walk in
            with a packet your attorney can read in five minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/cases/new"
              className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-5 py-2.5"
            >
              Start your case file
              <ArrowRight />
            </Link>
            <Link
              href={existingCases > 0 ? '/cases' : '/example'}
              className="btn bg-white text-forest-900 border border-ink-200 hover:border-gold-500 hover:bg-cream-50 px-5 py-2.5"
            >
              {existingCases > 0
                ? `View ${existingCases} case${existingCases === 1 ? '' : 's'}`
                : 'See an example'}
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> 7-day free trial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> Cancel any time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> No card to start
            </span>
          </div>

          {/* Numeric proof strip. Anchors the abstract pitch above with
              concrete benchmarks. Borrowed from Stripe / Mercury, where
              every claim is paired with a specific number. */}
          <dl className="mt-10 grid grid-cols-3 gap-6 max-w-lg border-t border-forest-700/30 dark:border-forest-700/40 pt-6">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-forest-700 dark:text-gold-300">
                Avg. packet
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                23 min
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">to ready-for-counsel</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-forest-700 dark:text-gold-300">
                Issues spotted
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                7-12
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">per case, on average</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-forest-700 dark:text-gold-300">
                Training data
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                0
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">your case never trains AI</p>
            </div>
          </dl>
        </div>

        {/* Right: floating product preview "card stack" */}
        <div className="lg:col-span-5 relative">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  // When NEXT_PUBLIC_HERO_SCREENSHOT_URL is set we render a real product
  // screenshot here instead of the layered mock. Drop the PNG/JPG into
  // public/marketing/ (e.g. public/marketing/case-detail-hero.png) and
  // set NEXT_PUBLIC_HERO_SCREENSHOT_URL=/marketing/case-detail-hero.png
  // in .env.local. Recommended source: a real /cases/[id] page populated
  // with the Advottic Holdings sample, captured at 1440x1080 in light
  // mode (or both modes - see the dark variant block below).
  const heroUrl = process.env.NEXT_PUBLIC_HERO_SCREENSHOT_URL;
  if (heroUrl) {
    return (
      <div className="relative aspect-[4/5] sm:aspect-[5/6] lg:aspect-[4/5]">
        <div
          aria-hidden
          className="absolute -inset-6 rounded-[3rem] opacity-60 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(60% 50% at 60% 40%, rgba(213,187,126,0.45), transparent 70%)',
          }}
        />
        <picture>
          <source
            media="(prefers-color-scheme: dark)"
            srcSet={
              process.env.NEXT_PUBLIC_HERO_SCREENSHOT_URL_DARK ?? heroUrl
            }
          />
          <img
            src={heroUrl}
            alt="Advottic case file with exhibits, Legal Eye review, and an upcoming hearing in five days"
            className="relative w-full h-full object-cover rounded-2xl ring-1 ring-forest-700/30 shadow-card-hover"
            loading="eager"
            fetchPriority="high"
          />
        </picture>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/5] sm:aspect-[5/6] lg:aspect-[4/5]">
      {/* Soft glow halo */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[3rem] opacity-60 blur-3xl pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 50% at 60% 40%, rgba(213,187,126,0.45), transparent 70%)',
        }}
      />

      {/* Back card: case detail mock */}
      <div className="absolute right-0 top-0 w-[78%] rotate-[3deg] rounded-2xl bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 ring-1 ring-forest-700/40 shadow-card-hover p-5 text-cream-100 hidden sm:block">
        <p className="text-[9px] tracking-[0.28em] uppercase font-semibold text-gold-300">
          Civil dispute
        </p>
        <p className="mt-2 text-[15px] font-semibold leading-tight">Apartment lease - 2026</p>
        <div className="mt-4 grid grid-cols-3 text-[10px] gap-2 border-t border-cream-100/10 pt-3">
          <Tile label="Exhibits" value="12" tone="emerald" />
          <Tile label="Hearing" value="5d" tone="amber" />
          <Tile label="Legal Eye" value="✓" tone="emerald" />
        </div>
      </div>

      {/* Front card: dashboard / timeline mock */}
      <div className="absolute left-0 bottom-0 w-[88%] -rotate-[2deg] rounded-2xl bg-white ring-1 ring-ink-200 shadow-card-hover p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Dashboard</p>
          <span className="text-[10px] font-mono text-ink-400">advottic.com</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Active cases" value="12" delta="+2 this week" tone="emerald" />
          <Stat label="Exhibits" value="245" delta="+18 this week" tone="emerald" />
        </div>
        <div className="mt-3 rounded-lg bg-cream-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-forest-700">
            Case strength
          </p>
          <Sparkline />
        </div>
      </div>

      {/* Small floating note */}
      <div className="absolute right-2 -bottom-3 w-[58%] sm:w-[52%] rotate-[-4deg] rounded-xl bg-white ring-1 ring-ink-200 shadow-card p-3.5 hidden md:block">
        <p className="text-[10px] tracking-[0.18em] uppercase font-semibold text-emerald-700">
          Hearing
        </p>
        <p className="text-sm font-semibold text-forest-900 mt-0.5">In 5 days</p>
        <p className="text-[10.5px] text-ink-500 mt-0.5">7 of 8 prep items complete</p>
      </div>
    </div>
  );
}

function Sparkline() {
  // Static SVG line chart inspired by the dashboard mockup.
  return (
    <svg className="mt-2 w-full h-16" viewBox="0 0 200 60" fill="none" aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 50 L20 46 L40 38 L60 30 L80 32 L100 24 L120 20 L140 26 L160 14 L180 10 L200 6"
        stroke="#10b981"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M0 50 L20 46 L40 38 L60 30 L80 32 L100 24 L120 20 L140 26 L160 14 L180 10 L200 6 L200 60 L0 60 Z"
        fill="url(#spark-fill)"
      />
    </svg>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' }) {
  const accent = tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300';
  return (
    <div>
      <p className="text-[9px] tracking-[0.18em] uppercase font-semibold text-cream-100/55">
        {label}
      </p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${accent}`}>{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'emerald';
}) {
  const accent = tone === 'emerald' ? 'text-emerald-700' : 'text-ink-700';
  return (
    <div className="rounded-lg bg-cream-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-forest-700">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums text-ink-950">
        {value}
      </p>
      <p className={`text-[10.5px] ${accent}`}>{delta}</p>
    </div>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotEmerald() {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />;
}

// =====================================================================
// Flow timeline - vertical numbered steps with rich content per step
// =====================================================================

function FlowTimeline() {
  const steps = [
    {
      n: '01',
      title: 'Capture',
      eyebrow: 'Subject + jurisdiction',
      body: 'One case file per matter. Tell us who or what is at the center, where the matter sits, and your posture - claimant or defendant. Done in under a minute.',
      bullets: [
        'Person · Business · Government · Entity · Matter',
        'Country / state / city jurisdiction',
        'Posture, status, and case type tagging',
      ],
    },
    {
      n: '02',
      title: 'Attach',
      eyebrow: 'Every piece of evidence',
      body: 'Photos, PDFs, audio, video, screenshots, communications. Each upload is auto-numbered as an exhibit with category, source, and incident date captured.',
      bullets: [
        'Auto-labeled Exhibit A → Z and beyond',
        'Up to 50 MB per file, every common format',
        'Searchable + filterable, never lost',
      ],
    },
    {
      n: '03',
      title: 'Strategize',
      eyebrow: 'Legal Eye + Bella',
      body: 'Run a Claude-backed Legal Eye review for jurisdiction-aware issue spotting, evidence gaps, and possible subpoena targets. Ask Bella anything. Export a packet your attorney can read in five minutes.',
      bullets: [
        'Hedged legal info, never legal advice',
        'Public-defender carve-out for criminal matters',
        'PDF case packet with cover, exhibits, and review',
      ],
    },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-12">
        <p className="eyebrow justify-center mb-3">How it works</p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900">
          Three steps. The dignity stays with you.
        </h2>
        <p className="text-sm sm:text-base text-ink-600 mt-3 leading-relaxed">
          Most legal-tech buries you in features. Advottic gives you a path: capture, attach,
          strategize. The system stays out of your way until it&apos;s useful.
        </p>
      </header>

      <ol className="relative space-y-12 sm:space-y-16 max-w-4xl mx-auto">
        {/* connecting rail */}
        <span
          aria-hidden
          className="hidden sm:block absolute left-[2.25rem] top-2 bottom-2 w-px bg-gradient-to-b from-gold-300 via-gold-500/60 to-gold-300"
        />
        {steps.map((s, i) => (
          <li
            key={s.n}
            className="relative grid gap-4 sm:grid-cols-[4.5rem_1fr] items-start"
          >
            <div className="flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-2">
              <span className="relative inline-flex h-12 w-12 sm:h-[4.5rem] sm:w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-forest-900 to-forest-950 text-cream-100 ring-1 ring-gold-400/40 shadow-card font-mono text-sm sm:text-base">
                {s.n}
                {i === 0 && (
                  <span
                    aria-hidden
                    className="absolute -inset-1 rounded-full ring-1 ring-gold-400/30 animate-glow"
                  />
                )}
              </span>
              <p className="text-[10px] tracking-[0.22em] uppercase font-semibold text-gold-700 sm:text-center">
                {s.eyebrow}
              </p>
            </div>
            <div className="card p-6 sm:p-7">
              <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-forest-900">
                {s.title}
              </h3>
              <p className="text-sm sm:text-[15px] leading-relaxed text-ink-700 mt-2">
                {s.body}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <Check />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 flex-none text-emerald-600">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.5l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// =====================================================================
// Personas
// =====================================================================

function Personas() {
  const personas = [
    {
      title: 'Self-represented',
      body: 'Walk into court with a binder, a plan, and the language to use. The system holds the structure so you can focus on the truth.',
      tag: 'Most common',
    },
    {
      title: 'Defendant prep',
      body: 'Reading a complaint cold is brutal. Capture the facts, surface possible defenses, and never miss your Answer deadline.',
      tag: '',
    },
    {
      title: 'Counsel intake',
      body: 'Your client uploads every exhibit and types up the timeline before your first call. You get back hours of intake.',
      tag: 'Attorney POV',
    },
    {
      title: 'Small business',
      body: 'Vendor disputes, employment matters, contract breaches - keep the paper trail organized so your lawyer hits the ground running.',
      tag: '',
    },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow justify-center mb-3">Built for the moments that matter</p>
        <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.05] text-forest-900">
          Designed for whoever&apos;s actually in the chair.
        </h2>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
        {personas.map((p) => (
          <article
            key={p.title}
            className="card-hover p-6 relative overflow-hidden"
          >
            {p.tag && (
              <span className="absolute top-3 right-3 text-[9px] tracking-[0.18em] uppercase font-semibold text-gold-700 bg-cream-50 border border-gold-200 rounded-full px-2 py-0.5">
                {p.tag}
              </span>
            )}
            <h3 className="font-semibold tracking-tight text-forest-900 text-[15px] mb-2">
              {p.title}
            </h3>
            <p className="text-sm text-ink-600 leading-relaxed">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// =====================================================================
// Outcomes / numbers strip
// =====================================================================

function Outcomes() {
  return (
    <section className="rounded-3xl bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 ring-1 ring-forest-700/40 text-cream-100 px-6 sm:px-10 py-10 sm:py-14 relative overflow-hidden">
      <div aria-hidden className="hero-orb hero-orb--gold hero-orb--a" style={{ width: 280, height: 280, right: '-60px', top: '-60px' }} />
      <div className="relative grid gap-6 sm:gap-10 sm:grid-cols-3">
        <Outcome
          big="5 min"
          label="To brief your attorney from a single packet"
          sub="Cover · case info · exhibits · Legal Eye review"
        />
        <Outcome
          big="A→Z+"
          label="Auto-numbered exhibits per case"
          sub="With category, source, incident date"
        />
        <Outcome
          big="100%"
          label="Your data, exportable any time"
          sub="JSON export from Profile, never used to train AI models"
        />
      </div>
    </section>
  );
}

function Outcome({ big, label, sub }: { big: string; label: string; sub: string }) {
  return (
    <div>
      <p className="text-4xl sm:text-5xl font-semibold tracking-tight bg-gold-shine bg-clip-text text-transparent gold-pan">
        {big}
      </p>
      <p className="mt-2 text-cream-100 font-medium">{label}</p>
      <p className="text-cream-100/65 text-xs mt-1">{sub}</p>
    </div>
  );
}

// =====================================================================
// Pricing CTA
// =====================================================================

function PricingCta() {
  return (
    <section>
      <div className="card p-7 sm:p-10 grid gap-6 sm:grid-cols-[1fr_auto] items-end">
        <div>
          <p className="eyebrow mb-2">Subscription</p>
          <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900">
            Three tiers, monthly billing, 7-day free trial.
          </h2>
          <p className="text-sm text-ink-600 mt-2 max-w-xl">
            Basic for one matter, Standard adds Legal Eye and Bella, Pro is unlimited cases with
            collaborator sharing for your attorney. Cancel any time from the customer portal.
          </p>
        </div>
        <Link href="/billing" className="btn-primary justify-self-start sm:justify-self-end">
          See pricing
          <ArrowRight />
        </Link>
      </div>
    </section>
  );
}

// =====================================================================
// FAQ - accordion (native <details>)
// =====================================================================

function Faq() {
  const items = [
    {
      q: 'Is Advottic legal advice?',
      a: 'No. Advottic is information, structure, and organization. We are not a law firm and do not create an attorney-client relationship. Legal Eye outputs may be incomplete, outdated, or wrong. Always consult a licensed attorney before acting.',
    },
    {
      q: 'I am facing criminal charges. Can Advottic help?',
      a: 'You can use Advottic to organize evidence and your account of events, but if there is any possibility of incarceration you should request a public defender at your first court appearance. That is a free constitutional right and a public defender is more useful than any tool.',
    },
    {
      q: 'Where is my data?',
      a: 'Your case data lives in Supabase Postgres (encrypted at rest, AES-256), your file uploads in Supabase Storage (private bucket, RLS-scoped). Legal Eye and Bella send your case content to Anthropic for processing under their commercial terms (no training on your inputs).',
    },
    {
      q: 'Can my attorney see my case?',
      a: 'Yes - on the Pro tier, invite them by email. They get read access plus the ability to add exhibits, but cannot edit case metadata or invite others.',
    },
    {
      q: 'What happens when I close a case?',
      a: 'It moves to your "Closed cases" section, stays searchable, and the PDF export remains accessible. We never delete your data unless you ask us to.',
    },
  ];
  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow justify-center mb-3">Frequently asked</p>
        <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.05] text-forest-900">
          Honest answers, up front.
        </h2>
      </header>
      <div className="max-w-3xl mx-auto divide-y divide-ink-100 border-y border-ink-100">
        {items.map((it) => (
          <details key={it.q} className="group py-4">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4">
              <h3 className="font-medium text-forest-900 text-[15px]">{it.q}</h3>
              <span
                aria-hidden
                className="text-ink-400 group-open:rotate-45 transition-transform text-xl leading-none"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm text-ink-700 leading-relaxed max-w-2xl">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// =====================================================================
// Final CTA band
// =====================================================================

function FinalCta() {
  return (
    <section className="relative">
      <div className="rounded-3xl hero-bg text-cream-100 px-6 sm:px-10 py-10 sm:py-14 text-center relative overflow-hidden">
        <div aria-hidden className="hero-orb hero-orb--cream hero-orb--a" style={{ width: 360, height: 360, left: '50%', top: '-40%', transform: 'translateX(-50%)' }} />
        <div className="relative max-w-2xl mx-auto">
          <h2 className="font-display text-3xl sm:text-5xl font-medium tracking-[-0.02em] leading-[1.02]">
            Walk in prepared.
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              Walk out with options.
            </span>
          </h2>
          <p className="mt-4 text-cream-100/85 text-sm sm:text-base leading-relaxed">
            Start a case file today. Your seven-day trial begins when you subscribe - the
            organizing tools are free until then.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/cases/new"
              className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5 animate-glow"
            >
              Start your case file
              <ArrowRight />
            </Link>
            <Link
              href="/find-counsel"
              className="btn bg-white/15 text-white border border-white/25 hover:bg-white/25 backdrop-blur px-5 py-2.5"
            >
              Find counsel near me
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
