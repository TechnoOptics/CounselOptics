import Link from 'next/link';
import type { Metadata } from 'next';
import { AudienceSplit } from '@/components/AudienceSplit';
import { EnterpriseInquiryForm } from '@/components/EnterpriseInquiryForm';
import { EnterpriseSectorTabs } from '@/components/EnterpriseSectorTabs';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

export const metadata: Metadata = {
  title: {
    absolute: 'Advottic for Enterprise - One workspace per matter',
  },
  description:
    'A calm, audited workspace your firm and clients share, scoped to the matter. Branded intake, AI-assisted issue spotting, SSO, audit logs, encrypted vault, in-portal document signing. Built for firms, in-house counsel, and legal ops teams who take privilege seriously.',
  alternates: { canonical: '/enterprise' },
  openGraph: {
    title: 'Advottic for Enterprise',
    description:
      'A workspace your attorneys, paralegals, and clients share, scoped to the matter. Branded intake, audit logs, SSO, encrypted vault, in-portal document signing.',
    url: '/enterprise',
    type: 'website',
  },
};

/**
 * Enterprise landing. The whole page lives on a deep-forest base
 * (regardless of the user's light/dark preference) because the firm
 * pitch wants the serious-finance feel. The audience split at top
 * lets visitors flip back to the personal side; everything below is
 * sized for a firm decision-maker.
 *
 * Architecture:
 *   1. AudienceSplit - keeps the personal/enterprise switch always
 *      one tap away.
 *   2. Hero - bold tagline + matter dashboard mock with audit chip.
 *   3. EnterpriseSectorTabs - the user picks who they are
 *      (private firm, in-house, in-house corporate counsel, legal
 *      aid, government), and the capability list re-renders to
 *      show what matters to that sector. Solves the "what we have
 *      now does not apply to in-house corporate counsel" problem.
 *   4. Workflow - intake -> triage -> collaborate -> deliver.
 *   5. Compliance posture cards.
 *   6. Comparison table vs the stitched stack.
 *   7. EnterpriseInquiryForm - the form an interested firm fills
 *      out instead of an email mailto. Submission lands in
 *      enterprise_inquiries (Supabase) and is reviewed by an admin
 *      who reaches out and sets custom pricing in the firm's
 *      subscription record.
 */
export default function EnterprisePage() {
  return (
    <div className="enterprise-shell -mx-4 sm:-mx-6 px-4 sm:px-6 py-12 sm:py-16 space-y-20 sm:space-y-28 bg-gradient-to-b from-forest-950 via-forest-950 to-forest-900 text-cream-100">
      <div className="max-w-7xl mx-auto space-y-20 sm:space-y-28">
        <AudienceSplit active="enterprise" />
        <EnterpriseHero />
        <EnterpriseSectorTabs />
        <Workflow />
        <Compliance />
        <CompareTable />
        <EnterpriseInquiry />
        <EnterpriseStructuredData />
      </div>
    </div>
  );
}

// =====================================================================
// Hero - confidence-first, bold numerics
// =====================================================================

function EnterpriseHero() {
  return (
    <section className="relative -mt-2 animate-fade-up">
      <div className="grid gap-8 sm:gap-10 lg:grid-cols-12 lg:gap-14 items-center">
        <div className="lg:col-span-7">
          <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300">
            <span className="inline-block h-px w-8 bg-gold-400" />
            Advottic for Firms
          </p>
          <h1 className="mt-5 font-display text-[44px] sm:text-[60px] lg:text-[78px] font-medium tracking-[-0.025em] leading-[0.96] text-cream-100">
            Stop hunting for the
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              right version
            </span>{' '}
            of the file.
          </h1>
          <p className="mt-6 text-[17px] sm:text-lg leading-relaxed text-cream-100/80 max-w-xl">
            Every matter, one room. Every exhibit, one source of truth. Every attorney,
            paralegal, and client on the same page. Sign documents inside the vault. Hand the
            audit log to opposing counsel without flinching.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="#inquiry"
              className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
            >
              Tell us about your firm
              <ArrowRight />
            </Link>
            <Link
              href="#sectors"
              className="btn bg-cream-100/8 hover:bg-cream-100/15 border border-cream-100/20 text-cream-100 font-semibold px-5 py-2.5"
            >
              See what fits your team
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-cream-100/55">
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> Custom pricing, written agreement
            </span>
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> SSO included
            </span>
            <span className="inline-flex items-center gap-1.5">
              <DotEmerald /> White-label client surface
            </span>
          </div>

          <dl className="mt-6 sm:mt-10 grid grid-cols-3 gap-6 max-w-lg border-t border-cream-100/15 pt-4 sm:pt-6">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
                Per matter
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-cream-100">
                One room
              </dd>
              <p className="text-[11px] text-cream-100/55 mt-0.5">role-scoped, audited</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
                Encryption
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-cream-100">
                AES-256
              </dd>
              <p className="text-[11px] text-cream-100/55 mt-0.5">at rest + TLS in transit</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
                Pricing
              </dt>
              <dd className="mt-1 font-display text-2xl sm:text-[28px] font-medium tabular-nums text-cream-100">
                Custom
              </dd>
              <p className="text-[11px] text-cream-100/55 mt-0.5">scoped to your firm</p>
            </div>
          </dl>
        </div>

        <div className="lg:col-span-5">
          <FirmDashboardMock />
        </div>
      </div>
    </section>
  );
}

function FirmDashboardMock() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-[3rem] opacity-50 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(213,187,126,0.35) 0%, rgba(213,187,126,0) 65%), radial-gradient(circle at 70% 80%, rgba(15,45,36,0.35) 0%, rgba(15,45,36,0) 60%)',
        }}
      />
      <div className="relative rounded-3xl border border-gold-400/20 bg-gradient-to-br from-forest-900 via-forest-950 to-forest-900 text-cream-100 p-6 sm:p-7 shadow-card-hover overflow-hidden">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
            Firm dashboard - live
          </p>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            42 matters open
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: 'Apartment lease - 2026', tag: 'Civil', exhibits: 12, days: 5 },
            { name: 'Vendor dispute - Acme', tag: 'Commercial', exhibits: 27, days: 11 },
            { name: 'Employment matter', tag: 'Labor', exhibits: 8, days: 3 },
            { name: 'Estate of W. - probate', tag: 'Probate', exhibits: 31, days: 18 },
          ].map((m) => (
            <div
              key={m.name}
              className="rounded-xl border border-cream-100/15 bg-cream-100/5 p-4 backdrop-blur"
            >
              <p className="text-[10px] tracking-wider uppercase text-gold-300 mb-1.5">
                {m.tag}
              </p>
              <p className="text-sm font-semibold tracking-tight">{m.name}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-cream-100/60">
                <span>{m.exhibits} exhibits</span>
                <span>hearing in {m.days}d</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-[11px]">
          <div className="rounded-xl border border-cream-100/15 bg-cream-100/5 p-3">
            <p className="text-gold-300 tracking-wider uppercase text-[9px] mb-1">
              Documents signed
            </p>
            <p className="font-display text-2xl font-medium tabular-nums">
              17
            </p>
            <p className="text-cream-100/55">in the vault, this week</p>
          </div>
          <div className="rounded-xl border border-cream-100/15 bg-cream-100/5 p-3">
            <p className="text-gold-300 tracking-wider uppercase text-[9px] mb-1">
              Audit log
            </p>
            <p className="font-display text-2xl font-medium tabular-nums">
              All
            </p>
            <p className="text-cream-100/55">read/write events captured</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Workflow - day-in-the-life narrative
// =====================================================================

function Workflow() {
  const steps = [
    {
      n: '01',
      eyebrow: 'Intake',
      title: 'Client intake without the email ping-pong.',
      body: "Send a branded intake link. The client uploads their docs, captures the timeline in their words, and you watch the matter populate in real time. By the time you take their call, you've already read the file.",
      bullets: [
        'Branded form. Your domain, your colors.',
        'Auto-populated case metadata',
        'Client never sees other matters',
      ],
    },
    {
      n: '02',
      eyebrow: 'Triage',
      title: 'Advottic Review reads the file in 30 seconds.',
      body: 'Run Review on a freshly-intaked matter. It returns the issues it spotted, the evidentiary gaps, the relevant statutes for the jurisdiction, and the questions worth asking the client. Hourly time goes to judgement, not skimming.',
      bullets: [
        'Jurisdiction-aware issue spotting',
        'Gap analysis: what evidence is missing',
        'Question list ready for the client call',
      ],
    },
    {
      n: '03',
      eyebrow: 'Collaborate',
      title: 'Counsel, paralegal, client - one room. With signing.',
      body: "Your team adds exhibits and notes. The client adds documents through their scoped view. Sign the engagement letter, the retainer, the release, all inside the vault - the file never leaves the encrypted portal. Every action is audited.",
      bullets: [
        'Role-scoped views (counsel / paralegal / client)',
        'In-portal document signing - never leaves the vault',
        'Real-time presence + activity log',
      ],
    },
    {
      n: '04',
      eyebrow: 'Deliver',
      title: 'Walk into the deposition with one packet.',
      body: 'When hearing day arrives, export a signed PDF packet with case summary, numbered exhibits, and the question list. Hand it to the printer or upload it to e-filing. Or share a read-only link with opposing counsel that expires.',
      bullets: [
        'Signed PDF, branded with firm letterhead',
        'Auto-numbered exhibits with metadata',
        'Time-limited share links + audit',
      ],
    },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-12">
        <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300 mb-3">
          A day at the firm
        </p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-cream-100">
          From intake to packet, one quiet thread.
        </h2>
      </header>
      <ol className="relative space-y-12 sm:space-y-16 max-w-4xl mx-auto">
        <span
          aria-hidden
          className="hidden sm:block absolute left-[2.25rem] top-2 bottom-2 w-px bg-gradient-to-b from-gold-300 via-gold-500/60 to-gold-300"
        />
        {steps.map((s) => (
          <li
            key={s.n}
            className="relative grid gap-4 sm:grid-cols-[4.5rem_1fr] items-start"
          >
            <div className="flex sm:flex-col items-center sm:items-stretch gap-3 sm:gap-2">
              <span className="relative inline-flex h-12 w-12 sm:h-[4.5rem] sm:w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-forest-800 to-forest-950 text-cream-100 ring-1 ring-gold-400/40 shadow-card font-mono text-sm sm:text-base">
                {s.n}
              </span>
              <p className="text-[10px] tracking-[0.22em] uppercase font-semibold text-gold-300 sm:text-center">
                {s.eyebrow}
              </p>
            </div>
            <div className="rounded-2xl border border-cream-100/15 bg-cream-100/5 p-6 sm:p-7 backdrop-blur">
              <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-cream-100">
                {s.title}
              </h3>
              <p className="text-sm sm:text-[15px] leading-relaxed text-cream-100/75 mt-2">
                {s.body}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-cream-100/85">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <CheckIcon />
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

// =====================================================================
// Compliance posture
// =====================================================================

function Compliance() {
  const items = [
    {
      eyebrow: 'Encryption',
      title: 'AES-256 at rest, TLS 1.3 in transit',
      body: 'Every byte your client uploads is encrypted on disk. Every request between browser and server is protected. Storage runs on private VPCs in the United States.',
    },
    {
      eyebrow: 'Identity',
      title: 'SSO via Microsoft Entra + Google Workspace',
      body: 'No new password to manage, no rogue accounts. Roles map to AD groups so onboarding a new associate is one click in your existing IdP.',
    },
    {
      eyebrow: 'Signing',
      title: 'In-portal document signing',
      body: 'Engagement letters, retainers, releases - all signed inside the encrypted vault. Documents never leave the portal, never sit in third-party signing systems.',
    },
    {
      eyebrow: 'Audit',
      title: 'Append-only event log',
      body: 'Every read, write, share, sign, export, and login is logged with timestamp + actor. Exportable as JSON for your compliance team. Retention follows your firm policy.',
    },
    {
      eyebrow: 'Posture',
      title: 'SOC 2 Type II controls in place',
      body: 'Annual third-party audit. Vulnerability scanning, penetration testing, vendor due diligence. Documentation available under NDA.',
    },
    {
      eyebrow: 'Privilege',
      title: 'Built for attorney-client privilege',
      body: 'No advertising trackers. No third-party analytics on case content. Client data is never used to train any external model. Full DPA + BAA on request.',
    },
  ];

  return (
    <section className="rounded-3xl bg-gradient-to-br from-forest-900/80 via-forest-950 to-forest-900/80 ring-1 ring-gold-400/15 px-6 sm:px-10 py-10 sm:py-14 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -right-32 -top-24 h-96 w-96 rounded-full opacity-25 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(213,187,126,0.5) 0%, rgba(213,187,126,0) 65%)',
        }}
      />
      <header className="relative max-w-3xl mb-10">
        <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300">
          Privilege, posture, peace of mind
        </p>
        <h2 className="mt-4 font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05]">
          Built for firms whose reputation depends on the file being right.
        </h2>
      </header>
      <div className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <article
            key={it.title}
            className="rounded-2xl border border-cream-100/15 bg-cream-100/5 p-6 backdrop-blur"
          >
            <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300 mb-2">
              {it.eyebrow}
            </p>
            <h3 className="text-lg font-semibold tracking-tight mb-2">{it.title}</h3>
            <p className="text-sm leading-relaxed text-cream-100/75">{it.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// =====================================================================
// Comparison table
// =====================================================================

function CompareTable() {
  const rows = [
    { capability: 'One audited workspace per matter', us: true, them: false },
    { capability: 'Branded client intake (no Typeform / Tally)', us: true, them: false },
    { capability: 'AI-assisted issue spotting + gap analysis', us: true, them: false },
    { capability: 'In-portal document signing (vault never leaves)', us: true, them: false },
    { capability: 'Encrypted exhibit vault with retention rules', us: true, them: 'Sometimes' },
    { capability: 'Append-only audit log of every action', us: true, them: false },
    { capability: 'Microsoft Entra + Google SSO out of the box', us: true, them: 'Add-on' },
    { capability: 'Mobile + desktop + biometric sign-in', us: true, them: false },
    { capability: 'Bulk PDF + JSON export at any time', us: true, them: false },
    { capability: 'No third-party advertising / training on your data', us: true, them: '?' },
  ];

  return (
    <section>
      <header className="text-center max-w-2xl mx-auto mb-10">
        <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300 mb-3">
          The cost of staying with what you have
        </p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-cream-100">
          Three tools and a folder, or one workspace.
        </h2>
        <p className="text-sm sm:text-base text-cream-100/70 mt-3 leading-relaxed">
          Most firms run intake on a form builder, exhibits in a Dropbox, signing in a separate
          tool, and chase versions in email. Every hand-off is a privilege risk. Every duplicated
          file is a billable hour you can&apos;t bill.
        </p>
      </header>
      <div className="overflow-hidden rounded-2xl border border-cream-100/15">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cream-100/5 text-left">
              <th className="py-3 px-4 sm:px-6 font-semibold text-cream-100/85">
                Capability
              </th>
              <th className="py-3 px-3 sm:px-6 font-semibold text-cream-100 w-24 sm:w-32 text-center">
                Advottic
              </th>
              <th className="py-3 px-3 sm:px-6 font-semibold text-cream-100/60 w-24 sm:w-32 text-center">
                Stitched stack
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100/10">
            {rows.map((r) => (
              <tr key={r.capability} className="bg-forest-950/40">
                <td className="py-3.5 px-4 sm:px-6 text-cream-100/85">
                  {r.capability}
                </td>
                <td className="py-3.5 px-3 sm:px-6 text-center">
                  <CellMark val={r.us} />
                </td>
                <td className="py-3.5 px-3 sm:px-6 text-center">
                  <CellMark val={r.them} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CellMark({ val }: { val: boolean | string }) {
  if (val === true) {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30"
        aria-label="Yes"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 13l4 4 10-10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (val === false) {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-400/15 text-rose-300 ring-1 ring-rose-400/30"
        aria-label="No"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="text-[11px] uppercase tracking-wider text-cream-100/55">
      {val}
    </span>
  );
}

// =====================================================================
// Inquiry section - real form, not a mailto
// =====================================================================

function EnterpriseInquiry() {
  return (
    <section
      id="inquiry"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-forest-900 via-forest-950 to-forest-900 ring-1 ring-gold-400/20 px-6 sm:px-10 py-10 sm:py-16"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -bottom-24 h-96 w-96 rounded-full opacity-50 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(213,187,126,0.40) 0%, rgba(213,187,126,0) 70%)',
        }}
      />
      <div className="relative grid gap-10 lg:grid-cols-2 lg:gap-14 max-w-6xl mx-auto">
        <div>
          <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300 mb-3">
            A 20-minute walkthrough, then your call
          </p>
          <h2 className="font-display text-3xl sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.05] text-cream-100">
            See your firm running on Advottic, today.
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-cream-100/80 max-w-xl">
            Tell us a bit about your team and we&apos;ll set up a sandbox seeded with one of
            your real (de-identified) matters. After the demo you decide if it&apos;s worth a
            30-day pilot. No commitment.
          </p>
          <ul className="mt-7 space-y-3 text-sm text-cream-100/80">
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span>
                <strong className="text-cream-100">Custom pricing in writing.</strong> We agree
                on a per-seat or per-matter rate scoped to your firm size and practice area.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span>
                <strong className="text-cream-100">Auto-payment on the cadence you pick.</strong>{' '}
                Once we&apos;ve agreed on a number, billing runs on its own schedule.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <CheckIcon />
              <span>
                <strong className="text-cream-100">Real reply within one business day.</strong>{' '}
                A human reads every inquiry. No CRM, no follow-up sequences.
              </span>
            </li>
          </ul>
        </div>
        <div className="rounded-2xl border border-cream-100/15 bg-cream-100/5 p-6 sm:p-8 backdrop-blur">
          <EnterpriseInquiryForm />
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// Helpers
// =====================================================================

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="mt-0.5 flex-none text-emerald-300"
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

function DotEmerald() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />;
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

function EnterpriseStructuredData() {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Advottic for Enterprise',
    description:
      'Multi-attorney case management platform. Per-matter rooms, branded client intake, encrypted exhibit vault with in-portal document signing, audit log, SSO, AI-assisted issue spotting.',
    brand: { '@type': 'Brand', name: 'Advottic' },
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}/enterprise`,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'USD',
        valueAddedTaxIncluded: false,
      },
      availability: 'https://schema.org/InStock',
    },
  };
  return (
    <script
      id="ld-enterprise-product"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(product) }}
    />
  );
}
