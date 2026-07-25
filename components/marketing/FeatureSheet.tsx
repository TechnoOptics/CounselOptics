'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  BrowserFrame,
  PersonalCaseRoomMock,
  AdvotticReviewMock,
  SafeWitnessMock,
  FirmEvidenceMock,
  LegalReviewMock,
  IntakeMock,
} from './PortalMocks';

/**
 * The public feature sheet. A calm segmented control switches between the two
 * products; each shows a short set of showcases (copy + a faithful product
 * mockup running a simulated case) and then a full, scannable feature matrix so
 * a visitor can see everything before creating an account.
 *
 * House style: feeling-first headings, one number per claim, no em-dashes,
 * no emoji.
 */

type Audience = 'personal' | 'firm';

type Showcase = {
  eyebrow: string;
  title: string;
  blurb: string;
  bullets: string[];
  mock: ReactNode;
  url: string;
  tone: 'personal' | 'firm';
};

const PERSONAL_SHOWCASES: Showcase[] = [
  {
    eyebrow: 'Gather',
    title: 'Your camera roll becomes an exhibit list.',
    blurb:
      'Drop in screenshots, PDFs, and photos as things happen. Advottic numbers each one, reads the date from the file, and tags the source, so nothing is lost before your hearing.',
    bullets: ['Auto-numbered A to Z and beyond', 'Dates pulled from the file', 'One private room per matter'],
    mock: <PersonalCaseRoomMock />,
    url: 'advottic.com/cases/security-deposit',
    tone: 'personal',
  },
  {
    eyebrow: 'Understand',
    title: 'A calm read of where your case stands.',
    blurb:
      'Advottic Review reads your file and points out possible issues, evidence gaps, and questions worth asking, in plain language. Bella answers legal terms and searches your own case for you.',
    bullets: ['Issue spotting in about 30 seconds', 'Jurisdiction-aware', 'Plain language, never advice'],
    mock: <AdvotticReviewMock />,
    url: 'advottic.com/cases/security-deposit/review',
    tone: 'personal',
  },
  {
    eyebrow: 'Stay safe',
    title: 'Help is one press away.',
    blurb:
      'Press and hold Safe Witness from the app or your watch to share your live location with trusted contacts and reach 911 in one tap. It keeps updating until you mark yourself safe.',
    bullets: ['Works on Wear OS', 'One-time live location', 'One-tap 911'],
    mock: <SafeWitnessMock />,
    url: 'advottic.com/safe',
    tone: 'personal',
  },
];

const FIRM_SHOWCASES: Showcase[] = [
  {
    eyebrow: 'Intake',
    title: 'Every matter starts clean.',
    blurb:
      'A branded intake form on your own domain populates the matter file automatically. Each client sees only their own matter, never another.',
    bullets: ['Your domain and colors', 'Auto-populated case metadata', 'Strict per-matter isolation'],
    mock: <IntakeMock />,
    url: 'yourfirm.advottic.com/intake',
    tone: 'firm',
  },
  {
    eyebrow: 'Triage',
    title: 'See the whole record at a glance.',
    blurb:
      'The evidence dashboard scores every item for relevance and reads the matter in under a minute, so you know what you have before you open a single file.',
    bullets: ['Relevance scored per item', 'Every metric deep-links to the evidence', 'Built for hundreds of exhibits'],
    mock: <FirmEvidenceMock />,
    url: 'yourfirm.advottic.com/matters/northwind',
    tone: 'firm',
  },
  {
    eyebrow: 'Prove',
    title: 'Case law you can actually cite.',
    blurb:
      'Legal review lays out each claim with its elements, recommended actions, and statutes, and every case citation is verified against CourtListener. Nothing unverified is ever shown.',
    bullets: ['Claim-by-claim analysis', 'Citations verified against CourtListener', 'Unverified cites are dropped'],
    mock: <LegalReviewMock />,
    url: 'yourfirm.advottic.com/matters/northwind/legal-review',
    tone: 'firm',
  },
];

type MatrixGroup = { stage: string; items: { name: string; desc: string }[] };

const PERSONAL_MATRIX: MatrixGroup[] = [
  {
    stage: 'Gather',
    items: [
      { name: 'Case rooms', desc: 'A private workspace per matter with its own evidence, parties, and hearings.' },
      { name: 'Auto-numbered exhibits', desc: 'Screenshots, PDFs, and voice memos numbered and dated for you.' },
      { name: 'Case timeline', desc: 'A clear chronology of what happened and when.' },
    ],
  },
  {
    stage: 'Understand',
    items: [
      { name: 'Advottic Review', desc: 'Possible issues, evidence gaps, and questions for your attorney.' },
      { name: 'Bella', desc: 'An in-app assistant that explains terms and searches your case.' },
      { name: 'Decoder', desc: 'Plain-English translation of a legal document you were handed.' },
    ],
  },
  {
    stage: 'Act',
    items: [
      { name: 'Court packet export', desc: 'Your whole case as one signed PDF, ready to file.' },
      { name: 'In-portal signing', desc: 'Sign engagement letters and releases inside the vault.' },
      { name: 'Collaborate by invite', desc: 'Add an attorney or helper with a scoped, revocable role.' },
    ],
  },
  {
    stage: 'Stay safe',
    items: [
      { name: 'Safe Witness', desc: 'Share live location with trusted contacts and reach 911 fast.' },
      { name: 'Encrypted vault', desc: 'AES-256 at rest, TLS 1.3 in transit, on US private infrastructure.' },
    ],
  },
  {
    stage: 'Find help',
    items: [
      { name: 'Court e-filing directory', desc: 'Where and how to file, by court. Free on every plan.' },
      { name: 'Public defender directory', desc: 'Find the office for your county. Free on every plan.' },
    ],
  },
];

const FIRM_MATRIX: MatrixGroup[] = [
  {
    stage: 'Intake',
    items: [
      { name: 'Branded client intake', desc: 'A form on your domain that populates the matter automatically.' },
      { name: 'Matters', desc: 'A role-scoped room per matter for counsel, paralegals, and clients.' },
    ],
  },
  {
    stage: 'Triage',
    items: [
      { name: 'Evidence dashboard', desc: 'Relevance scoring, coverage, and a year-by-year read of the record.' },
      { name: 'Advottic Review', desc: 'A first read of a fresh matter in under a minute.' },
      { name: 'Discovery review', desc: 'Privilege-flagged document review with priority.' },
    ],
  },
  {
    stage: 'Prove',
    items: [
      { name: 'Legal review', desc: 'Claim analysis with case law verified against CourtListener.' },
      { name: 'Investigation mode', desc: 'The prove-the-case board: parties, evidence, and approaches.' },
      { name: 'Bella co-counsel', desc: 'An assistant that runs tools, with every action logged.' },
    ],
  },
  {
    stage: 'Collaborate',
    items: [
      { name: 'Co-counsel access', desc: 'Bring in outside counsel, scoped to one matter, revocable at once.' },
      { name: 'Team conversations', desc: 'Channels and messages with row-level security and history.' },
      { name: 'Calendar and meetings', desc: 'Teams and Zoom links flow into the matter timeline.' },
    ],
  },
  {
    stage: 'Deliver',
    items: [
      { name: 'In-portal signing', desc: 'Place fields, route recipients, export a signed event chain.' },
      { name: 'Letter studio', desc: 'Compose letters on your letterhead and export to Word or PDF.' },
      { name: 'Court packet export', desc: 'A court-ready evidentiary exhibit from the matter file.' },
    ],
  },
  {
    stage: 'Operate',
    items: [
      { name: 'Trust accounting', desc: 'IOLTA three-way reconciliation across bank, ledger, and sub-accounts.' },
      { name: 'Audit log', desc: 'Append-only record of every read, write, share, sign, and export.' },
      { name: 'SSO and SCIM', desc: 'Microsoft Entra and Google Workspace, with access that follows AD groups.' },
    ],
  },
];

export function FeatureSheet() {
  const [aud, setAud] = useState<Audience>('personal');
  const showcases = aud === 'personal' ? PERSONAL_SHOWCASES : FIRM_SHOWCASES;
  const matrix = aud === 'personal' ? PERSONAL_MATRIX : FIRM_MATRIX;

  return (
    <div>
      {/* Segmented control */}
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Choose who you are"
          className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white/70 p-1 shadow-sm backdrop-blur dark:border-forest-700/50 dark:bg-forest-900/50"
        >
          {(
            [
              ['personal', 'For people'],
              ['firm', 'For law firms'],
            ] as [Audience, string][]
          ).map(([key, label]) => {
            const active = aud === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setAud(key)}
                className={`rounded-full px-5 py-2 text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 ${
                  active
                    ? 'bg-gold-metal text-forest-950 shadow-sm'
                    : 'text-ink-600 hover:text-forest-900 dark:text-cream-100/70 dark:hover:text-cream-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Showcases */}
      <div key={aud} className="mt-14 space-y-20 sm:space-y-28">
        {showcases.map((s, i) => (
          <div
            key={s.title}
            className="grid animate-fade-up items-center gap-8 lg:grid-cols-2 lg:gap-14"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Copy */}
            <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
              <p className="eyebrow">{s.eyebrow}</p>
              <h3 className="mt-2 font-display text-[26px] font-medium leading-[1.1] tracking-[-0.01em] text-forest-900 dark:text-cream-100 sm:text-[32px] text-balance">
                {s.title}
              </h3>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-600 dark:text-cream-100/75">
                {s.blurb}
              </p>
              <ul className="mt-5 space-y-2">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[13.5px] text-ink-700 dark:text-cream-100/80">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold-500/15 text-gold-700 dark:text-gold-300">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            {/* Mock */}
            <div className={i % 2 === 1 ? 'lg:order-1' : ''}>
              <BrowserFrame url={s.url} tone={s.tone}>
                {s.mock}
              </BrowserFrame>
            </div>
          </div>
        ))}
      </div>

      {/* Full feature matrix */}
      <div className="mt-24 border-t border-ink-100 pt-14 dark:border-forest-800">
        <div className="text-center">
          <p className="eyebrow justify-center">The full sheet</p>
          <h3 className="mt-2 font-display text-[26px] font-medium text-forest-900 dark:text-cream-100 sm:text-[30px]">
            Everything included, {aud === 'personal' ? 'for people' : 'for firms'}
          </h3>
        </div>
        <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {matrix.map((g) => (
            <div key={g.stage}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-300">
                {g.stage}
              </p>
              <ul className="mt-3 space-y-3">
                {g.items.map((it) => (
                  <li key={it.name} className="border-l-2 border-gold-500/25 pl-3">
                    <p className="text-[14px] font-semibold text-forest-900 dark:text-cream-100">{it.name}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500 dark:text-cream-100/60">{it.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-2xl border border-gold-300/40 bg-gradient-to-br from-cream-50 to-white p-8 text-center ring-1 ring-gold-400/20 dark:border-forest-700/50 dark:from-forest-900 dark:to-forest-950 sm:p-12">
        <h3 className="font-display text-[28px] font-medium text-forest-900 dark:text-cream-100 sm:text-[34px] text-balance">
          {aud === 'personal' ? 'Start your case for free.' : 'See it on your own matters.'}
        </h3>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-600 dark:text-cream-100/75">
          {aud === 'personal'
            ? 'No card to begin. Add evidence, get a calm read, and keep everything in one place.'
            : 'A 7-day free trial for your firm. Bring one matter and see the difference.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={aud === 'personal' ? '/cases/new' : '/enterprise'}
            className="btn bg-gold-metal px-5 py-2.5 font-semibold text-forest-950 shadow-gold-glow hover:brightness-110"
          >
            {aud === 'personal' ? 'Start a case' : 'Explore Advottic for firms'}
          </Link>
          <Link
            href="/pricing"
            data-hide-on-ios
            className="btn-ghost px-3 py-2.5 font-semibold text-forest-900 underline-offset-4 hover:underline dark:text-cream-100"
          >
            See pricing
          </Link>
        </div>
      </div>
    </div>
  );
}
