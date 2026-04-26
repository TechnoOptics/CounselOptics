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
      <TrustBadges />
      <FlowTimeline />
      <BellaShowcase />
      <Personas />
      <Outcomes />
      <TestimonialMarquee />
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
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-14 items-center">
        {/* Left: editorial copy block */}
        <div className="lg:col-span-7">
          <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-700 dark:text-gold-300">
            <span className="inline-block h-px w-8 bg-gold-500 dark:bg-gold-400" />
            A quiet place to build your story
          </p>
          <h1 className="mt-5 font-display text-[44px] sm:text-[60px] lg:text-[80px] font-medium tracking-[-0.025em] leading-[0.95] text-forest-900 dark:text-cream-100">
            Big things rarely happen
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              all at once.
            </span>
          </h1>
          <p className="mt-6 text-[17px] sm:text-lg leading-relaxed text-ink-700 dark:text-cream-100/80 max-w-xl">
            Most cases are built quietly, one note and one document at a time. Advottic gives
            you a calm place to gather everything as it happens, so when the moment finally
            comes to tell your story, you walk in ready - with the words, the dates, and the
            paper to back you up.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/cases/new"
              className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
            >
              Start your case file
              <ArrowRight />
            </Link>
            <Link
              href={existingCases > 0 ? '/cases' : '/example'}
              className="btn-ghost text-forest-900 dark:text-cream-100 hover:text-gold-700 dark:hover:text-gold-300 underline-offset-4 hover:underline px-3 py-2.5 font-semibold"
            >
              {existingCases > 0
                ? `View ${existingCases} case${existingCases === 1 ? '' : 's'} →`
                : 'See an example case →'}
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-500 dark:text-cream-100/55">
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
                On your time
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                Daily
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">a few minutes is plenty</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-forest-700 dark:text-gold-300">
                Exhibits per case
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                A → Z+
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">auto-numbered as you go</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-forest-700 dark:text-gold-300">
                Your data
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-forest-900 dark:text-cream-100">
                Yours
              </dd>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">encrypted and exportable</p>
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
      title: 'Start when you can',
      eyebrow: 'A quiet first step',
      body: 'Open a case file the day something feels off. Tell us who is involved and where the matter sits. It takes about a minute, and you can keep coming back.',
      bullets: [
        'A person, a business, an agency, or a matter',
        'Country, state, and city if you know them',
        "Whether you're bringing the case or responding to one",
      ],
    },
    {
      n: '02',
      title: 'Add things as they happen',
      eyebrow: 'A few minutes at a time',
      body: 'Photos, PDFs, voice memos, screenshots, the email thread. Each item becomes an exhibit, neatly labeled and dated, so nothing slips through the cracks while life keeps moving.',
      bullets: [
        'Auto-labeled Exhibit A through Z and beyond',
        'Up to 50 MB per file, every common format',
        'Searchable and easy to find later',
      ],
    },
    {
      n: '03',
      title: 'Ready when you are',
      eyebrow: 'Walk in prepared',
      body: 'Legal Eye reads what you have and gently points out gaps, questions to ask, and things to watch for. When the day comes, export a clean packet your attorney can read in five minutes.',
      bullets: [
        'Plain-English notes, never legal advice',
        'Reminders if your case mentions criminal matters - you have the right to a public defender',
        'Polished PDF with cover, exhibits, and review',
      ],
    },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-12">
        <p className="eyebrow justify-center mb-3">How it works</p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          A small step today is a strong story tomorrow.
        </h2>
        <p className="text-sm sm:text-base text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed">
          You don&apos;t need a lawyer to start. You don&apos;t need a perfect plan. You just
          need a quiet place to keep the truth tidy until the day you need it.
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
      title: 'Standing on your own',
      body: 'You may not have a lawyer yet. That is okay. Advottic holds the structure so you can focus on what really happened, in your own words, on your own time.',
      tag: 'Most common',
    },
    {
      title: 'Receiving the news',
      body: 'A complaint, a letter, a process server. Take a breath. Capture what you have, write down what you remember, and give yourself a clear next step.',
      tag: '',
    },
    {
      title: 'Working with counsel',
      body: 'You and your attorney can both see the file, add to it, and stay aligned. Your hours of intake become a clean handoff.',
      tag: 'Attorney POV',
    },
    {
      title: 'Looking after a small business',
      body: 'Vendor disputes, employment questions, contract issues. Keep the paper trail tidy now so your eventual lawyer hits the ground running.',
      tag: '',
    },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow justify-center mb-3">Built for the moments that matter</p>
        <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Made for whoever is sitting in the chair.
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
          label="The time it takes to brief your attorney"
          sub="Cover, case info, exhibits, and a clear summary"
        />
        <Outcome
          big="A → Z+"
          label="Exhibits, neatly labeled as you add them"
          sub="With category, source, and the date it happened"
        />
        <Outcome
          big="100%"
          label="Your file, exportable any time you want"
          sub="A polished PDF or a complete archive, on your terms"
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
      a: 'No, and we will never pretend it is. Advottic helps you keep your story tidy and your evidence organized. We are not a law firm and we do not create an attorney-client relationship. For decisions that matter, please talk to a licensed attorney.',
    },
    {
      q: 'I am facing criminal charges. Can Advottic help?',
      a: 'Please reach out to a public defender right away if there is any chance of incarceration - that help is free and your constitutional right. Advottic can hold the timeline and the documents in the meantime, but a real attorney is what you need first.',
    },
    {
      q: 'Where is my information kept?',
      a: 'Your case lives in a private, encrypted database, and your uploads sit in a private file vault. Only your account can open them. You can export everything you have written or uploaded at any time.',
    },
    {
      q: 'Can my attorney see my case?',
      a: 'Yes, on the Pro plan you can invite them by email. They can read the file and add to it, and you stay in charge of who has access. Remove them whenever you like.',
    },
    {
      q: 'What happens when I close a case?',
      a: 'It moves into your closed cases, stays searchable, and your packet export stays accessible. We do not delete anything unless you ask us to.',
    },
  ];
  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow justify-center mb-3">Frequently asked</p>
        <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Honest answers, kindly given.
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
// Trust badges - thin row right under hero. Three concrete reassurances.
// =====================================================================

function TrustBadges() {
  const items: { eyebrow: string; line: string; sub: string }[] = [
    {
      eyebrow: 'Private by default',
      line: 'Your story is yours alone',
      sub: 'Everything you write or upload is encrypted and locked to your account. We do not read it, sell it, or share it.',
    },
    {
      eyebrow: 'Yours to take with you',
      line: 'Export anything, anytime',
      sub: 'Download your full case file as a PDF or a JSON archive whenever you need it - no questions, no friction.',
    },
    {
      eyebrow: 'You stay in control',
      line: 'A clear log of every change',
      sub: 'See who looked at the case, who added what, and when. Nothing happens behind your back.',
    },
  ];
  return (
    <section
      aria-label="Trust signals"
      className="-mt-6 sm:-mt-10 grid gap-3 sm:grid-cols-3"
    >
      {items.map((it) => (
        <div
          key={it.eyebrow}
          className="card p-5 hover:shadow-card-hover transition-shadow"
        >
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
            {it.eyebrow}
          </p>
          <p className="font-display text-base font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100 mt-1.5">
            {it.line}
          </p>
          <p className="text-xs text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
            {it.sub}
          </p>
        </div>
      ))}
    </section>
  );
}

// =====================================================================
// Bella showcase - dark band, sample chat exchange, gold sparkle.
// =====================================================================

function BellaShowcase() {
  return (
    <section className="relative">
      <div className="rounded-3xl hero-bg text-cream-100 px-6 sm:px-10 py-10 sm:py-14 relative overflow-hidden">
        <div
          aria-hidden
          className="hero-orb hero-orb--gold hero-orb--a"
          style={{ width: 320, height: 320, right: '-80px', top: '-60px' }}
        />
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14 items-center relative">
          <div className="lg:col-span-6">
            <p className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
              <span className="inline-block h-px w-8 bg-gold-400" />
              Meet Bella
            </p>
            <h2 className="mt-4 font-display text-3xl sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.05]">
              A powerful and informed assistant{' '}
              <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
                in your corner.
              </span>
            </h2>
            <p className="mt-4 text-cream-100/85 leading-relaxed max-w-xl">
              Bella is the calm, well-read friend who has been through this before. Tell her
              what you remember, ask her to find that case from January, or have her open the
              new-case wizard for you. She listens, she helps, and she always asks before doing
              anything on your behalf.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-cream-100/85">
              <BellaBullet>
                <strong>Finds your cases</strong> by title, subject, or where it happened.
              </BellaBullet>
              <BellaBullet>
                <strong>Walks you through new ones</strong> when you ask her to.
              </BellaBullet>
              <BellaBullet>
                <strong>Pulls up the details you need</strong> so you don&apos;t have to dig.
              </BellaBullet>
              <BellaBullet>
                <strong>Always asks first</strong> before opening or changing anything.
              </BellaBullet>
            </ul>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-2xl bg-forest-950/80 ring-1 ring-gold-400/30 shadow-card-hover overflow-hidden backdrop-blur">
              <div className="flex items-center gap-2.5 px-5 py-3 border-b border-cream-100/10">
                <span className="aurora inline-flex h-7 w-7 items-center justify-center rounded-full bg-forest-950 ring-1 ring-gold-400/40 text-gold-300">
                  <BellaSparkle />
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-cream-100 leading-tight">
                    Bella
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-cream-100/60 mt-0.5 flex items-center gap-1.5">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                    Here · Listening · Yours
                  </p>
                </div>
              </div>
              <div className="px-5 py-5 space-y-3 text-[13.5px] leading-relaxed">
                <ChatBubble role="user">where is my apartment lease case from january?</ChatBubble>
                <ChatBubble role="bella">
                  Found it. <strong className="text-gold-300">Apartment lease — security deposit refund</strong>{' '}
                  (Shakopee, MN), under review with 7 exhibits and a hearing in 9 days. Want me
                  to open it?
                </ChatBubble>
                <ChatBubble role="user">yes please</ChatBubble>
                <ChatBubble role="bella">
                  Opening it now. <span className="text-gold-300">↗ /cases/3fd84ed6...</span>
                </ChatBubble>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({
  role,
  children,
}: {
  role: 'user' | 'bella';
  children: React.ReactNode;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md px-3.5 py-2 bg-cream-200 text-forest-900 font-medium">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2 bg-forest-800/70 text-cream-100 ring-1 ring-gold-400/20">
        {children}
      </div>
    </div>
  );
}

function BellaBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex-none mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gold-metal text-forest-950">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 13l4 4 10-10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

function BellaSparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
    </svg>
  );
}

// =====================================================================
// Smart features - bento-style grid showcasing the headline features.
// =====================================================================

function SmartFeaturesGrid() {
  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow justify-center mb-3">Inside the app</p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Built for the work that actually moves a case forward.
        </h2>
      </header>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <BentoCard
          span={2}
          eyebrow="Legal Eye review"
          title="Jurisdiction-aware issue spotting in seconds."
          body="A thorough review reads your case and exhibits, surfaces possible issues, evidence gaps, and next-step questions for your attorney. Always hedged, never legal advice."
          accent="gold"
        />
        <BentoCard
          eyebrow="Smart-assist wizard"
          title="One question at a time."
          body="A card-by-card flow that captures only what matters. Skip what's optional. Auto-runs Legal Eye on submit."
        />
        <BentoCard
          eyebrow="Document review"
          title="Paste any contract — get plain English back."
          body="Lease, demand letter, retainer, court order. No account needed for the review."
        />
        <BentoCard
          eyebrow="Hearing countdown"
          title="A pre-hearing checklist that wakes up when you do."
          body="Set the date once. We surface a countdown card and a prioritized to-do list keyed to your case state."
        />
        <BentoCard
          eyebrow="Live presence + audit"
          title="See who's in your case, right now."
          body="Avatar chips with a green pulse for everyone viewing the case. Every view, edit, and share is logged on the Activity tab."
          accent="emerald"
        />
        <BentoCard
          eyebrow="PDF packet"
          title="A clean export your attorney can read in five minutes."
          body="Cover, case info, exhibits, and the latest Legal Eye review — one polished file."
        />
        <BentoCard
          eyebrow="Find counsel"
          title="Maps + reviews in your jurisdiction."
          body="Browse nearby firms straight from Google Maps with practice-area filters."
        />
      </div>
    </section>
  );
}

function BentoCard({
  eyebrow,
  title,
  body,
  span = 1,
  accent = 'default',
}: {
  eyebrow: string;
  title: string;
  body: string;
  span?: 1 | 2;
  accent?: 'default' | 'gold' | 'emerald';
}) {
  const isWide = span === 2;
  const accentClasses =
    accent === 'gold'
      ? 'card-luminous'
      : accent === 'emerald'
        ? 'card border-emerald-400/40 dark:border-emerald-500/30'
        : 'card-hover';
  return (
    <article
      className={`${accentClasses} p-6 ${isWide ? 'sm:col-span-2 lg:col-span-2 lg:row-span-1' : ''}`}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {eyebrow}
      </p>
      <h3 className="font-display text-lg sm:text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100 mt-2 leading-snug">
        {title}
      </h3>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
        {body}
      </p>
    </article>
  );
}

// =====================================================================
// Final CTA band - dramatic, gold-accented, two CTAs.
// =====================================================================

function FinalCta() {
  return (
    <section className="relative">
      <div className="rounded-3xl hero-bg text-cream-100 px-6 sm:px-10 py-12 sm:py-20 text-center relative overflow-hidden">
        <div
          aria-hidden
          className="hero-orb hero-orb--cream hero-orb--a"
          style={{ width: 360, height: 360, left: '50%', top: '-40%', transform: 'translateX(-50%)' }}
        />
        <div
          aria-hidden
          className="hero-orb hero-orb--gold hero-orb--b"
          style={{ width: 240, height: 240, left: '8%', bottom: '-20%' }}
        />
        <div className="relative max-w-3xl mx-auto">
          <p className="text-[10px] uppercase tracking-[0.32em] font-semibold text-gold-300 mb-5">
            Whenever you are ready
          </p>
          <h2 className="font-display text-4xl sm:text-6xl lg:text-[80px] font-medium tracking-[-0.025em] leading-[0.98]">
            One small step today,
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              a stronger story tomorrow.
            </span>
          </h2>
          <p className="mt-6 text-cream-100/85 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            Start a case file today. Add to it as life unfolds. When the time comes to tell
            your story, you will be glad you did.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/cases/new"
              className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-6 py-3 animate-glow text-base"
            >
              Begin your case file
              <ArrowRight />
            </Link>
            <Link
              href="/example"
              className="btn bg-white/15 text-white border border-white/25 hover:bg-white/25 backdrop-blur px-6 py-3 text-base"
            >
              See what one looks like
            </Link>
          </div>
          <p className="mt-6 text-[11px] uppercase tracking-[0.22em] text-cream-100/55">
            7-day free trial · cancel anytime · no card needed to start
          </p>
        </div>
      </div>
    </section>
  );
}
