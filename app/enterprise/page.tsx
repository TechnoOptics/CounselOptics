import Link from 'next/link';
import type { Metadata } from 'next';
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
 * pitch wants the serious-finance feel. Everything is sized for a
 * firm decision-maker - no consumer marketing.
 *
 * The previous version mounted <AudienceSplit active="enterprise" />
 * at the top, which (a) rendered the "For one person" card next to
 * the firm card, pitching consumer features to a firm visitor,
 * (b) emitted dark-on-dark headline text because AudienceSplit's
 * color logic targets OS dark mode but the enterprise shell forces
 * dark regardless, and (c) rendered a white inactive card on the
 * forest gradient, breaking the edge-to-edge dark surface. Removing
 * it kills all three issues at once. The site header logo + footer
 * still surface the personal product for anyone who wants to switch.
 *
 * Architecture:
 *   1. Hero - bold tagline + matter dashboard mock with audit chip.
 *   2. EnterpriseSectorTabs - the user picks who they are
 *      (private firm, in-house, in-house corporate counsel, legal
 *      aid, government), and the capability list re-renders to
 *      show what matters to that sector.
 *   3. Workflow - intake -> triage -> collaborate -> deliver.
 *   4. Compliance posture cards.
 *   5. Comparison table vs the stitched stack.
 *   6. EnterpriseInquiryForm - the form an interested firm fills
 *      out instead of an email mailto.
 */
export default function EnterprisePage() {
  return (
    <div className="enterprise-shell -mx-4 sm:-mx-6 px-4 sm:px-6 py-12 sm:py-16 space-y-20 sm:space-y-28 bg-gradient-to-b from-forest-950 via-forest-950 to-forest-900 text-cream-100">
      <div className="max-w-7xl mx-auto space-y-20 sm:space-y-28">
        <EnterpriseHero />
        <EnterpriseSectorTabs />
        <Workflow />
        <FirmCapabilities />
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
          {/*
            Audit CR-42: the previous markup produced "the<br/>right
            version" which collapsed to "theright" under innerText
            extractors (and screen readers that ignore <br/>'s line
            break). Two changes make the heading legible regardless
            of how it's read:
              1. Explicit trailing space after "the " before the
                 <br/> so the visible text content has whitespace
                 even when the line break is stripped.
              2. The <span> includes the trailing space so "right
                 version of" stays cohesive when read aloud.
            Visual rendering is unchanged - the leading-[0.96] hero
            still hard-wraps at the <br/>.
          */}
          <h1 className="mt-5 font-display text-[44px] sm:text-[60px] lg:text-[78px] font-medium tracking-[-0.025em] leading-[0.96] text-cream-100">
            Stop hunting for the{' '}
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              right version
            </span>
            {' of the file.'}
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
// Firm Capabilities - rich visual showcase of the six features that
// pull firms across the buying line. Each card mounts a faithful
// visual mock of the actual product surface (not a generic icon), so
// a procurement reviewer scrolling the page can see, in 90 seconds,
// what the firm-side of Advottic actually does.
// =====================================================================

function FirmCapabilities() {
  return (
    <section className="relative">
      <header className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
        <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300 mb-3">
          What ships in the box
        </p>
        <h2 className="font-display text-3xl sm:text-[44px] font-medium tracking-[-0.02em] leading-[1.04] text-cream-100">
          Seven tools your firm pays separately for today,{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            included
          </span>{' '}
          inside one workspace.
        </h2>
        <p className="text-sm sm:text-base text-cream-100/70 mt-4 leading-relaxed">
          No DocuSign add-on, no Calendly seat, no separate AI subscription, no
          trust-accounting plugin. Every workflow below lives inside the same
          encrypted vault, under the same audit log, scoped to the same matter.
        </p>
      </header>
      <div className="space-y-6 sm:space-y-7">
        <EsignMock />
        <MeetingsMock />
        <BellaAgentMock />
        <TeamChatMock />
        <div className="grid gap-6 sm:gap-7 lg:grid-cols-3">
          <IoltaMock />
          <AuditChainMock />
          <DiscoveryMock />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 1) In-portal document signing
// ---------------------------------------------------------------------

function EsignMock() {
  return (
    <CapabilityFrame
      eyebrow="In-portal document signing"
      title="Sign engagement letters, retainers, and releases without leaving the vault."
      blurb="Every signature event is hash-chained into a tamper-evident audit ledger. Documents never leave the encrypted portal, never sit in a third-party signing tool, and never expose privileged content to a vendor outside your DPA."
      bullets={[
        'Drag-to-place signature, initials, and date fields',
        'Recipient routing (signer, approver, witness, CC)',
        'Cryptographic chain over every event - exportable for opposing counsel',
        'No per-envelope fees, no DocuSign seat math',
      ]}
      tierHint="Counsel Solo and above"
    >
      <div className="rounded-2xl border border-cream-100/15 bg-forest-950/70 backdrop-blur p-5 sm:p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.22em] uppercase text-gold-300">
              Engagement letter
            </p>
            <p className="text-sm font-semibold text-cream-100 mt-1">
              Apartment lease - Sandoval v. 9th &amp; Cedar LLC
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 ring-1 ring-amber-300/40 text-amber-200 text-[10.5px] font-semibold px-2.5 py-1 tracking-wider uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
            Awaiting 1 of 3
          </span>
        </header>

        <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-4">
          <p className="text-[10px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-2">
            Recipients
          </p>
          <ul className="divide-y divide-cream-100/8">
            {[
              {
                name: 'M. Sandoval',
                role: 'Client',
                status: 'signed',
                ts: 'Today, 9:14 AM',
              },
              {
                name: 'Counsel of record',
                role: 'Witness',
                status: 'signed',
                ts: 'Today, 9:21 AM',
              },
              {
                name: 'Co-counsel - Patel',
                role: 'Approver',
                status: 'pending',
                ts: 'Sent 12 min ago',
              },
            ].map((r) => (
              <li
                key={r.name}
                className="flex items-center justify-between py-2 text-[12.5px]"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={
                      r.status === 'signed'
                        ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/40'
                        : 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/35'
                    }
                  >
                    {r.status === 'signed' ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M5 13l4 4 10-10"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                    )}
                  </span>
                  <div>
                    <p className="font-semibold text-cream-100">{r.name}</p>
                    <p className="text-cream-100/55 text-[11px]">{r.role}</p>
                  </div>
                </div>
                <p className="text-cream-100/60 text-[11px] tabular-nums">{r.ts}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-3 font-mono text-[11px] text-cream-100/65 space-y-1">
          <p className="text-gold-300 tracking-wider uppercase text-[9.5px] font-sans font-semibold">
            Audit chain · sha-256
          </p>
          <p className="break-all">
            #142 <span className="text-emerald-300">9b3c8a14</span>...e07f
          </p>
          <p className="break-all">
            #141 <span className="text-emerald-300">f1d203b6</span>...4a2c
          </p>
          <p className="break-all">
            #140 <span className="text-emerald-300">06ae9c41</span>...7882
          </p>
          <p className="text-cream-100/45 font-sans text-[10.5px] pt-0.5">
            Every signature, view, and download is linked to the previous event by hash. Break one link and the chain visibly breaks for opposing counsel.
          </p>
        </div>
      </div>
    </CapabilityFrame>
  );
}

// ---------------------------------------------------------------------
// 2) Calendar + Meetings: Microsoft 365 (Teams) + Zoom
// ---------------------------------------------------------------------

function MeetingsMock() {
  return (
    <CapabilityFrame
      eyebrow="Calendar + meetings"
      title="Microsoft Teams and Zoom, wired into every matter."
      blurb="Connect the firm's Microsoft 365 tenant and Zoom workspace once at the admin level. From that moment, every matter room can schedule a Teams meeting or generate a Zoom link inline, with the calendar event landing on the right attorney's Outlook or Google calendar - no copy-paste."
      bullets={[
        'OAuth via Microsoft Entra (Outlook + Teams via Graph) and Zoom Marketplace',
        'Tokens AES-GCM encrypted at rest; firm owners + admins are the only roles that can revoke',
        'Meeting links flow into the matter timeline alongside exhibits, notes, and signatures',
        'Per-firm revocation: a leaving attorney loses meeting access the moment they leave the AD group',
      ]}
      tierHint="Counsel Small Firm and above"
      reversed
    >
      <div className="rounded-2xl border border-cream-100/15 bg-forest-950/70 backdrop-blur p-5 sm:p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.22em] uppercase text-gold-300">
              Connected providers
            </p>
            <p className="text-sm font-semibold text-cream-100 mt-1">
              firm.advottic.com / integrations
            </p>
          </div>
          <span className="text-[10.5px] text-emerald-300 inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </header>

        <div className="grid sm:grid-cols-2 gap-3">
          <ProviderCard
            name="Microsoft 365"
            sub="Outlook calendar · Teams meeting"
            scopes="User.Read · Calendars.ReadWrite · offline_access"
            status="Connected as admin@firm.com"
          />
          <ProviderCard
            name="Zoom"
            sub="meeting:write · meeting:read"
            scopes="user:read · meeting:write · meeting:read"
            status="Connected as billing@firm.com"
          />
        </div>

        <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.22em] uppercase font-semibold text-gold-300">
              Tomorrow on the firm calendar
            </p>
            <span className="text-[10.5px] text-cream-100/55">Tue, 9:00 - 5:00</span>
          </div>
          <ul className="space-y-2">
            {[
              {
                t: '09:30',
                title: 'Sandoval intake call',
                where: 'Teams',
                matter: 'Apartment lease - 2026',
              },
              {
                t: '11:00',
                title: 'Co-counsel sync · Patel & Co',
                where: 'Zoom',
                matter: 'Vendor dispute - Acme',
              },
              {
                t: '14:30',
                title: 'Client signature walkthrough',
                where: 'Teams',
                matter: 'Estate of W. - probate',
              },
            ].map((m) => (
              <li
                key={m.t}
                className="flex items-center justify-between rounded-lg bg-cream-100/5 ring-1 ring-cream-100/10 px-3 py-2 text-[12.5px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-cream-100/70 tabular-nums shrink-0">
                    {m.t}
                  </span>
                  <div className="min-w-0">
                    <p className="text-cream-100 font-semibold truncate">{m.title}</p>
                    <p className="text-cream-100/55 text-[11px] truncate">{m.matter}</p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 ${
                    m.where === 'Teams'
                      ? 'bg-blue-400/15 text-blue-200 ring-1 ring-blue-400/30'
                      : 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30'
                  }`}
                >
                  {m.where}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CapabilityFrame>
  );
}

function ProviderCard({
  name,
  sub,
  scopes,
  status,
}: {
  name: string;
  sub: string;
  scopes: string;
  status: string;
}) {
  return (
    <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-cream-100">{name}</p>
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 font-semibold uppercase tracking-wider">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 13l4 4 10-10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          OK
        </span>
      </div>
      <p className="text-[11.5px] text-cream-100/65 mt-0.5">{sub}</p>
      <p className="text-[10px] font-mono text-cream-100/45 mt-2 break-all">{scopes}</p>
      <p className="text-[10.5px] text-cream-100/55 mt-1">{status}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// 3) Bella - AI agent that takes action
// ---------------------------------------------------------------------

function BellaAgentMock() {
  return (
    <CapabilityFrame
      eyebrow="Bella, the AI agent that takes action"
      title="Not a chatbot. A clerk that drafts, files, and reconciles."
      blurb="Most legal-AI tools answer questions. Bella runs tools: she drafts the engagement letter, starts a time entry when she sees you working on a matter, runs a conflict check on a new intake, and pulls in CourtListener case law when the legal basis benefits from precedent. Every action is logged."
      bullets={[
        'Tools include create_matter_intake, run_conflict_check, draft_document, start_time_entry, send_engagement_letter, file_court_form',
        'Zero-retention configured on Anthropic Claude - your firm data is never used to train any external model',
        'Per-user token budget so a heavy week never produces a surprise invoice',
        'Every Bella action is timestamped in the audit log for Model Rule 1.6 compliance',
      ]}
      tierHint="Bella included at every Counsel tier"
    >
      <div className="rounded-2xl border border-cream-100/15 bg-forest-950/70 backdrop-blur p-5 sm:p-6 space-y-3">
        <header className="flex items-center gap-3">
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full ring-2 ring-gold-400/45 bg-gradient-to-br from-forest-700 via-forest-800 to-forest-950">
            <span
              className="font-display text-[16px] font-medium tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
            >
              B
            </span>
          </span>
          <div>
            <p className="text-sm font-semibold text-cream-100">Bella</p>
            <p className="text-[10.5px] text-cream-100/55">
              Working on Vendor dispute - Acme
            </p>
          </div>
          <span className="ml-auto text-[10px] text-emerald-300 inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </header>

        <div className="rounded-xl bg-cream-100/5 ring-1 ring-cream-100/10 p-3 text-[12.5px] text-cream-100/85 leading-relaxed">
          Drafted the engagement letter from your firm template and queued it for signature.
          Conflict check came back clean against the last 3 years of matter history. Started a
          0.4h time entry against intake review.
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <ActionChip label="draft_document" detail="engagement_letter_v3.docx" />
          <ActionChip label="run_conflict_check" detail="0 hits / 3-year window" />
          <ActionChip label="start_time_entry" detail="0.4h · intake review" />
          <ActionChip label="send_engagement_letter" detail="queued for signature" />
        </div>

        <p className="text-[10.5px] text-cream-100/50 pt-1 font-mono">
          context window: 1 matter · 12 exhibits · 4 messages · 1 court rule set
        </p>
      </div>
    </CapabilityFrame>
  );
}

function ActionChip({ label, detail }: { label: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/12 ring-1 ring-gold-400/30 text-gold-200 text-[10.5px] font-semibold px-2.5 py-1">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 13l4 4 10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-mono">{label}</span>
      <span className="text-gold-200/70 font-normal">· {detail}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 4) Team chat - matter-room conversations with Realtime
// ---------------------------------------------------------------------

function TeamChatMock() {
  return (
    <CapabilityFrame
      eyebrow="Team conversations"
      title="A Slack-shaped workspace, scoped to your firm and your matters."
      blurb="Channels for firm-wide topics, group DMs for the team on a specific matter, and one-to-one DMs for sensitive back-and-forth. Messages, edits, and deletes propagate in roughly 100 milliseconds via Supabase Realtime WebSockets, with a 60-second heartbeat refetch as a safety net for flaky networks."
      bullets={[
        'Channels, group DMs, and 1:1 DMs - row-level security per channel membership',
        'Edit + soft-delete history, attachments (images, files, signed documents from the vault)',
        'Per-member last-read timestamp drives unread counts and inbox-style notifications',
        'No third-party chat vendor - messages live in the same Postgres + RLS as your matters',
      ]}
      tierHint="All Counsel tiers"
      reversed
    >
      <div className="rounded-2xl border border-cream-100/15 bg-forest-950/70 backdrop-blur overflow-hidden">
        <div className="grid grid-cols-[140px_1fr] min-h-[360px]">
          {/* Channel sidebar */}
          <aside className="border-r border-cream-100/10 bg-forest-950/40 p-3 text-[11px] space-y-3">
            <div>
              <p className="text-[9.5px] tracking-[0.22em] uppercase font-semibold text-gold-300 mb-1.5 px-1">
                Channels
              </p>
              <ul className="space-y-0.5">
                <ChannelRow name="general" unread={3} />
                <ChannelRow name="intake-and-conflicts" />
                <ChannelRow name="sandoval-v-9th-cedar" active />
                <ChannelRow name="acme-vendor-dispute" unread={1} />
              </ul>
            </div>
            <div>
              <p className="text-[9.5px] tracking-[0.22em] uppercase font-semibold text-gold-300 mb-1.5 px-1">
                Direct
              </p>
              <ul className="space-y-0.5">
                <DmRow name="Patel · co-counsel" presence="online" />
                <DmRow name="J. Liu · paralegal" presence="away" />
                <DmRow name="Sandoval · client" presence="offline" />
              </ul>
            </div>
          </aside>

          {/* Active channel */}
          <section className="flex flex-col">
            <header className="flex items-center justify-between border-b border-cream-100/10 px-4 py-2.5">
              <div>
                <p className="text-[12.5px] font-semibold text-cream-100">
                  # sandoval-v-9th-cedar
                </p>
                <p className="text-[10.5px] text-cream-100/55">
                  4 members · linked to matter MAT-104
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Realtime
              </span>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-[12.5px]">
              <ChatMessage
                who="C. Rivera"
                role="Counsel"
                ts="9:14 AM"
                body={
                  <>
                    Conflict check came back clean against the last 3 years. Drafted the engagement
                    letter from our firm template;{' '}
                    <span className="rounded bg-gold-400/15 ring-1 ring-gold-400/30 text-gold-200 px-1 font-mono text-[11px]">
                      @Patel
                    </span>{' '}
                    you&apos;re up next as approver.
                  </>
                }
              />
              <ChatMessage
                who="J. Liu"
                role="Paralegal"
                ts="9:18 AM"
                body={
                  <>
                    Uploaded the lease addendum to the vault.{' '}
                    <span className="inline-flex items-center gap-1.5 mt-1.5 rounded-md bg-cream-100/5 ring-1 ring-cream-100/15 px-2 py-1 text-[11px] text-cream-100/85">
                      <PaperclipIcon />
                      EX-012 · lease-addendum.pdf
                    </span>
                  </>
                }
              />
              <ChatMessage
                who="Bella"
                role="AI agent"
                ts="9:19 AM"
                bot
                body="Started a 0.4h time entry on this matter for intake review. Logged in audit chain #143."
              />
              <ChatMessage
                who="M. Patel"
                role="Co-counsel"
                ts="9:21 AM"
                body="Signed. Good to go on our end."
              />
            </div>

            <footer className="border-t border-cream-100/10 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-cream-100/5 ring-1 ring-cream-100/10 px-3 py-1.5 text-[11.5px] text-cream-100/45">
                  Message # sandoval-v-9th-cedar
                </div>
                <button
                  type="button"
                  aria-label="Send"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gold-metal text-forest-950 shadow-sm"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 12h14m0 0l-5-5m5 5l-5 5"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <p className="text-[10px] text-cream-100/40 mt-1.5 px-1">
                Read by 3 of 4 · last delivery 9:21 AM
              </p>
            </footer>
          </section>
        </div>
      </div>
    </CapabilityFrame>
  );
}

function ChannelRow({
  name,
  active,
  unread,
}: {
  name: string;
  active?: boolean;
  unread?: number;
}) {
  return (
    <li
      className={`flex items-center justify-between rounded px-2 py-1 ${
        active ? 'bg-gold-400/15 text-gold-100 font-semibold' : 'text-cream-100/75'
      }`}
    >
      <span className="truncate">
        <span className="text-cream-100/45 mr-0.5">#</span>
        {name}
      </span>
      {unread ? (
        <span className="rounded-full bg-rose-400/20 ring-1 ring-rose-300/40 text-rose-200 text-[9.5px] font-bold tabular-nums px-1.5 py-0">
          {unread}
        </span>
      ) : null}
    </li>
  );
}

function DmRow({
  name,
  presence,
}: {
  name: string;
  presence: 'online' | 'away' | 'offline';
}) {
  const tone =
    presence === 'online'
      ? 'bg-emerald-400'
      : presence === 'away'
        ? 'bg-amber-400'
        : 'bg-cream-100/30';
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1 text-cream-100/75">
      <span className={`h-1.5 w-1.5 rounded-full ${tone} shrink-0`} />
      <span className="truncate">{name}</span>
    </li>
  );
}

function ChatMessage({
  who,
  role,
  ts,
  body,
  bot,
}: {
  who: string;
  role: string;
  ts: string;
  body: React.ReactNode;
  bot?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold shrink-0 ${
          bot
            ? 'bg-gradient-to-br from-gold-400/30 to-gold-700/40 text-gold-100 ring-1 ring-gold-400/50'
            : 'bg-cream-100/10 text-cream-100 ring-1 ring-cream-100/15'
        }`}
      >
        {who
          .split(/[\s.]+/)
          .filter(Boolean)
          .map((p) => p[0])
          .slice(0, 2)
          .join('')}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] flex items-baseline gap-2">
          <span className="font-semibold text-cream-100">{who}</span>
          <span className="text-cream-100/45 text-[10.5px]">{role}</span>
          <span className="text-cream-100/35 text-[10.5px] tabular-nums">{ts}</span>
        </p>
        <div className="text-cream-100/85 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11l-9 9a5 5 0 01-7-7l9-9a3 3 0 014 4l-9 9a1 1 0 11-1-1l8-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------
// 4) IOLTA trust accounting
// ---------------------------------------------------------------------

function IoltaMock() {
  return (
    <CapabilityCard
      eyebrow="IOLTA trust accounting"
      title="3-way reconciliation, no spreadsheet."
      blurb="Daily reconciliation between bank, ledger, and matter sub-accounts. Negative-balance protection is enforced at the database, not just the UI - the row literally can't go red."
      tierHint="Counsel Solo and above"
    >
      <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-4 text-[12px]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-gold-300 tracking-wider uppercase text-[9.5px] font-semibold">
            Reconciliation · Mar 2026
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/30 text-emerald-300 text-[10px] font-semibold px-2 py-0.5">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 13l4 4 10-10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Balanced
          </span>
        </div>
        <dl className="space-y-2 tabular-nums">
          {[
            { l: 'Bank statement', v: '$184,602.18' },
            { l: 'Trust ledger', v: '$184,602.18' },
            { l: 'Sub-accounts sum', v: '$184,602.18' },
          ].map((r) => (
            <div key={r.l} className="flex items-center justify-between text-cream-100/85">
              <dt>{r.l}</dt>
              <dd className="font-mono font-semibold">{r.v}</dd>
            </div>
          ))}
          <div className="border-t border-cream-100/10 pt-2 flex items-center justify-between text-emerald-300">
            <dt>Variance</dt>
            <dd className="font-mono font-semibold">$0.00</dd>
          </div>
        </dl>
      </div>
    </CapabilityCard>
  );
}

// ---------------------------------------------------------------------
// 5) Append-only audit log
// ---------------------------------------------------------------------

function AuditChainMock() {
  return (
    <CapabilityCard
      eyebrow="Append-only audit log"
      title="Every read, write, sign, export."
      blurb="A cryptographic chain over every event. Hand the JSON export to opposing counsel and the chain verifies in 30 seconds - or visibly breaks if a row was altered."
      tierHint="All Counsel tiers"
    >
      <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-4 text-[11.5px] font-mono space-y-1.5 text-cream-100/80">
        {[
          { ts: '14:31:09', who: 'M. Sandoval', evt: 'sign.engagement.letter' },
          { ts: '14:30:54', who: 'admin@firm', evt: 'send.engagement.letter' },
          { ts: '14:28:11', who: 'Bella', evt: 'run.conflict.check (0 hits)' },
          { ts: '14:27:02', who: 'paralegal-7', evt: 'upload.exhibit (EX-012)' },
          { ts: '14:25:48', who: 'admin@firm', evt: 'create.matter.intake' },
        ].map((e, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-cream-100/45 tabular-nums">{e.ts}</span>
            <span className="text-gold-300">{e.who}</span>
            <span className="text-cream-100/75">{e.evt}</span>
          </div>
        ))}
        <p className="text-[10px] text-emerald-300/80 pt-1 sans-serif">
          chain verified · sha-256 over 4,217 events
        </p>
      </div>
    </CapabilityCard>
  );
}

// ---------------------------------------------------------------------
// 6) Discovery review
// ---------------------------------------------------------------------

function DiscoveryMock() {
  return (
    <CapabilityCard
      eyebrow="Discovery review"
      title="AI-assisted bulk review with privilege flags."
      blurb="Drop a 250-document production. Bella tags privilege candidates, surfaces high-priority items, and writes one-sentence summaries so first-pass review collapses from a day to an afternoon."
      tierHint="Counsel Small Firm and above"
    >
      <div className="rounded-xl border border-cream-100/10 bg-cream-100/5 p-3 space-y-1.5">
        {[
          { ref: 'DOC-104', kind: 'Email · 03/12', priv: true, pri: 'High', text: 'Counsel-client exchange re: settlement floor.' },
          { ref: 'DOC-205', kind: 'Memo · 04/01', priv: false, pri: 'High', text: 'Internal damages model with assumptions table.' },
          { ref: 'DOC-318', kind: 'PDF · 05/09', priv: false, pri: 'Med', text: 'Vendor invoice; references the disputed work order.' },
          { ref: 'DOC-411', kind: 'Email · 05/11', priv: true, pri: 'Low', text: 'Calendar invite with attached agenda.' },
        ].map((d) => (
          <div
            key={d.ref}
            className="rounded-lg bg-cream-100/5 ring-1 ring-cream-100/10 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono text-cream-100/85">{d.ref}</p>
              <div className="flex items-center gap-1.5">
                {d.priv && (
                  <span className="text-[9.5px] rounded-full bg-amber-400/15 ring-1 ring-amber-300/35 text-amber-200 font-semibold px-1.5 py-0.5">
                    PRIV
                  </span>
                )}
                <span
                  className={`text-[9.5px] rounded-full font-semibold px-1.5 py-0.5 ${
                    d.pri === 'High'
                      ? 'bg-rose-400/15 ring-1 ring-rose-300/35 text-rose-200'
                      : d.pri === 'Med'
                        ? 'bg-amber-400/15 ring-1 ring-amber-300/35 text-amber-200'
                        : 'bg-cream-100/10 ring-1 ring-cream-100/15 text-cream-100/60'
                  }`}
                >
                  {d.pri}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-cream-100/65 mt-0.5">{d.kind}</p>
            <p className="text-[11.5px] text-cream-100/85 mt-1 leading-snug">{d.text}</p>
          </div>
        ))}
      </div>
    </CapabilityCard>
  );
}

// ---------------------------------------------------------------------
// Shared frames
// ---------------------------------------------------------------------

function CapabilityFrame({
  eyebrow,
  title,
  blurb,
  bullets,
  tierHint,
  reversed,
  children,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  bullets: string[];
  tierHint: string;
  reversed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="relative overflow-hidden rounded-3xl border border-cream-100/12 bg-gradient-to-br from-forest-900/60 via-forest-950/60 to-forest-900/60 backdrop-blur p-6 sm:p-9 lg:p-12">
      <div
        aria-hidden
        className={`pointer-events-none absolute h-72 w-72 rounded-full opacity-30 blur-3xl ${
          reversed ? 'right-0 top-0' : 'left-0 bottom-0'
        }`}
        style={{
          background:
            'radial-gradient(circle, rgba(213,187,126,0.5) 0%, rgba(213,187,126,0) 65%)',
        }}
      />
      <div
        className={`relative grid gap-8 sm:gap-10 lg:gap-14 items-center ${
          reversed ? 'lg:grid-cols-[1.05fr_1fr]' : 'lg:grid-cols-[1fr_1.05fr]'
        }`}
      >
        <div className={reversed ? 'lg:order-2' : ''}>
          <p className="text-[11px] tracking-[0.28em] uppercase font-semibold text-gold-300">
            {eyebrow}
          </p>
          <h3 className="mt-3 font-display text-2xl sm:text-3xl lg:text-[34px] font-medium tracking-[-0.015em] leading-[1.08] text-cream-100">
            {title}
          </h3>
          <p className="text-[14.5px] sm:text-[15.5px] leading-relaxed text-cream-100/75 mt-4">
            {blurb}
          </p>
          <ul className="mt-5 space-y-2 text-[13.5px] text-cream-100/85">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5">
                <CheckIcon />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 inline-flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300">
            <span className="inline-block h-px w-5 bg-gold-400" />
            {tierHint}
          </p>
        </div>
        <div className={reversed ? 'lg:order-1' : ''}>{children}</div>
      </div>
    </article>
  );
}

function CapabilityCard({
  eyebrow,
  title,
  blurb,
  tierHint,
  children,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  tierHint: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-cream-100/12 bg-gradient-to-br from-forest-900/55 via-forest-950/55 to-forest-900/55 backdrop-blur p-5 sm:p-6 flex flex-col">
      <p className="text-[10.5px] tracking-[0.28em] uppercase font-semibold text-gold-300">
        {eyebrow}
      </p>
      <h3 className="mt-2 font-display text-lg sm:text-[20px] font-medium tracking-[-0.01em] leading-tight text-cream-100">
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed text-cream-100/72 mt-2">{blurb}</p>
      <div className="mt-4 flex-1">{children}</div>
      <p className="mt-4 inline-flex items-center gap-2 text-[10.5px] tracking-[0.18em] uppercase font-semibold text-gold-300">
        <span className="inline-block h-px w-4 bg-gold-400" />
        {tierHint}
      </p>
    </article>
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
      title: 'Security controls built to the SOC 2 criteria',
      body: 'Our controls are designed against the SOC 2 Trust Services Criteria, with formal Type II attestation on our roadmap. Vendor due diligence and our current security documentation are available under NDA.',
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
