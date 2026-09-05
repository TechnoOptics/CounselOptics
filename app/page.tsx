import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { resolveDefaultLanding } from '@/lib/landing';
import { AppJsonLd, FaqJsonLd } from '@/components/seo/JsonLd';
import { HOME_FAQ } from '@/lib/home-faq';
import {
  BODY,
  BUTTON_INK,
  BUTTON_OUTLINE_CREAM,
  Definitions,
  FilePage,
  H1,
  H2,
  LABEL,
  LINK,
  Memo,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '@/components/marketing/file';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

export const metadata: Metadata = {
  title: {
    absolute: 'Advottic - Walk into court prepared',
  },
  description:
    'Advottic helps you organize evidence, surface jurisdiction-aware issues, prepare for hearings, and ship a clean packet your attorney can read in five minutes. 7-day free trial, no card required.',
  alternates: {
    canonical: '/',
    languages: { 'en-US': '/', 'es-US': '/es', 'x-default': '/' },
  },
  openGraph: {
    title: 'Advottic - Walk into court prepared',
    description:
      'Organize evidence, surface jurisdiction-aware issues, prepare for hearings, and ship a clean packet your attorney can read in five minutes.',
    url: '/',
    type: 'website',
  },
  keywords: [
    'organize legal case',
    'pro se case prep',
    'self represented court',
    'case file organizer',
    'exhibit binder',
    'prepare for court hearing',
    'small claims preparation',
    'evidence management for litigants',
    'attorney intake prep',
    'legal case organization software',
    'AI legal assistant',
    'legal case management software',
    'case building tool',
    'personal safety alert app',
    'Bella AI assistant',
    'Safe Witness personal safety',
  ],
};

export default async function HomePage() {
  // Once a user is signed in, the marketing page is noise. Send them to
  // their landing. Non-blocking on Supabase misconfig. If the lookup
  // succeeds but the redirect somehow does not fire, the cover still offers
  // a path to their cases so nobody is stuck on marketing chrome.
  let signedIn = false;
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
        redirect(await resolveDefaultLanding());
      }
    } catch (err) {
      if ((err as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
    }
  }

  return (
    <FilePage>
      <HomeStructuredData />
      <Cover signedIn={signedIn} />
      <WhatGoesIn />
      <WhatComesOut />
      <WhoCanSee />
      <InTheirWords />
      <WhatItIsNot />
      <FirmSignpost />
      <Close />
    </FilePage>
  );
}

function HomeStructuredData() {
  return (
    <>
      <AppJsonLd />
      <FaqJsonLd questions={HOME_FAQ} />
    </>
  );
}

function Cover({ signedIn }: { signedIn: boolean }) {
  return (
    <Section label="Cover" first>
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        {/* min-w-0 so the display headline can never set this column wider
            than a 375px phone; that overflow was a live defect on the
            previous hero and a guard reads the marker below. */}{/* Left: editorial copy block */}
        <div className="min-w-0 lg:col-span-7">
          <h1 className={H1}>Walk into court with everything in order.</h1>
          <p className={`${BODY} mt-6`}>
            Most cases are built quietly, one note and one document at a time. Advottic gives you
            a calm place to keep them, so when the moment comes to tell your story, the words, the
            dates and the paper are already there.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {signedIn ? (
              <Link href="/cases" className={BUTTON_INK}>
                Go to your cases
              </Link>
            ) : (
              <Link href="/cases/new" className={BUTTON_INK}>
                Start your case file
                <span className="font-normal opacity-75">free for 7 days</span>
              </Link>
            )}
            <Link href="/example" className={LINK}>
              See an example case
            </Link>
          </div>
          <p className={`${LABEL} mt-5`}>No card to start. Cancel any time. Yours to export.</p>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Sheet kicker="Case file" kickerRight="Small claims, claimant" title="Ramirez v. Oakline Rentals" assemble>
            <SheetRow mark="A" text="Signed lease agreement.pdf" right="Jan 3, 2024" />
            <SheetRow mark="B" text="Move-out photos (kitchen).jpg" right="Mar 30, 2025" />
            <SheetRow mark="C" text={'Text: "deposit next week".png'} right="Apr 6, 2025" />
            <SheetRow mark="D" text="Itemized deduction letter.pdf" right="Apr 9, 2025" />
            <Stamp line1="Hearing" line2="Apr 18" />
          </Sheet>
        </div>
      </div>
    </Section>
  );
}

function WhatGoesIn() {
  return (
    <Section tab="A" label="What goes in" id="gather">
      <h2 className={H2}>Your camera roll becomes an exhibit list.</h2>
      <p className={`${BODY} mt-4`}>
        Drop in screenshots, PDFs, photos and recordings as things happen. Each one is lettered,
        the date is read from the file, and the source is noted, so nothing is lost before your
        hearing.
      </p>
      <Definitions
        items={[
          { term: 'Lettered', def: 'A to Z and beyond, in the order you add them.' },
          { term: 'Dated', def: 'Read from the file itself, editable when it is wrong.' },
          { term: 'Kept', def: 'One private room per matter, encrypted at rest.' },
        ]}
      />
    </Section>
  );
}

function WhatComesOut() {
  return (
    <Section tab="B" label="What comes out" id="review">
      <h2 className={H2}>A calm read of where you stand, and a packet anyone can read in five minutes.</h2>
      <p className={`${BODY} mt-4`}>
        Advottic Review reads your file and points out possible issues, gaps in the evidence and
        questions worth asking, in plain language. Bella answers legal terms and finds things in
        your own case. The packet is one PDF: your account, the timeline, every exhibit.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Sheet kicker="Advottic Review" kickerRight="Read in 28 seconds" title="Ramirez v. Oakline Rentals">
          <Memo label="Possible issue" text="Deductions may exceed statutory limits under Civ. Code 1950.5." />
          <Memo label="Evidence gap" text="Add the dated move-out inspection to strengthen the timeline." />
          <Memo label="Ask your attorney" text="Whether the 21-day return window was met after move-out." />
        </Sheet>
        <Sheet kicker="Court packet" kickerRight="PDF, 14 pages" title="Contents">
          <SheetRow mark="1" text="Your account of what happened" />
          <SheetRow mark="2" text="Timeline, by event date" />
          <SheetRow mark="3" text="Exhibits A to L" />
          <SheetRow mark="4" text="Questions for the hearing" />
        </Sheet>
      </div>
    </Section>
  );
}

function WhoCanSee() {
  return (
    <Section tab="C" label="Who can see it" id="privacy">
      <h2 className={H2}>Yours alone, yours to take, and a clear log of every change.</h2>
      <Definitions
        items={[
          {
            term: 'Private by default',
            def: 'Everything you write or upload is encrypted and locked to your account. We do not read it, sell it or share it.',
          },
          {
            term: 'Yours to take with you',
            def: 'Download the whole file as a PDF or an archive whenever you like.',
          },
          {
            term: 'You stay in control',
            def: 'See who looked at the case, who added what, and when. Invite your attorney when you choose.',
          },
        ]}
      />
    </Section>
  );
}

/**
 * The three quotes are the ones the retired marquee carried, verbatim from
 * components/TestimonialMarquee.tsx. If that file's wording differs from
 * what is written here, the file wins: copy it, do not edit it.
 */
const QUOTES = [
  {
    quote: 'The judge said the word organized. That word changed how the rest of the hearing went.',
    who: 'Marisol R.',
    role: 'Self-represented, landlord-tenant',
  },
  {
    quote: 'My attorney told me later it shaved months off the timeline.',
    who: 'David K.',
    role: 'Small-business owner, contract dispute',
  },
  {
    quote: 'Plain English, in five minutes. I stopped feeling lost.',
    who: 'Tracy P.',
    role: 'First-time defendant',
  },
];

function InTheirWords() {
  return (
    <Section tab="D" label="In their words">
      <div className="grid gap-8 md:grid-cols-3">
        {QUOTES.map((q) => (
          <figure key={q.who} className="m-0">
            <blockquote className="m-0 font-caslon-text text-[20px] leading-[1.4]">
              {'"'}{q.quote}{'"'}
            </blockquote>
            <figcaption className={`${LABEL} mt-3`}>
              {q.who}. {q.role}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className={`${LABEL} mt-8 normal-case tracking-normal`}>
        Names changed or shortened on request. Quotes lightly edited for length. Outcomes vary; past
        results are not a promise of future ones.
      </p>
    </Section>
  );
}

function WhatItIsNot() {
  return (
    <Section tab="E" label="What it is not" id="faq">
      <h2 className={H2}>Advottic prepares. An attorney advises. You decide.</h2>
      <p className={`${BODY} mt-4`}>
        We organize what happened. We do not represent you, predict outcomes or replace a licensed
        attorney.
      </p>
      <div className="mt-8 border-t border-rule">
        {HOME_FAQ.map((it) => (
          <details key={it.q} className="group border-b border-rule py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-public text-[15px] font-medium">
              <h3 className="m-0 text-[15px] font-medium">{it.q}</h3>
              <span aria-hidden className="font-courier text-xl leading-none text-ink-600 group-open:rotate-45 dark:text-cream-100/60">
                +
              </span>
            </summary>
            <p className={`${BODY} mt-3 text-[15px]`}>{it.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FirmSignpost() {
  return (
    <section className="-mx-4 mt-4 bg-forest-950 px-4 py-10 text-cream-100 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="font-courier text-[12.5px] uppercase tracking-[0.08em] text-cream-100/60">For firms</p>
          <h2 className="mt-2 font-caslon text-[28px] font-normal leading-[1.1] tracking-[-0.01em] text-balance text-cream-100 sm:text-[34px] lg:text-[40px]">
            Running a practice?
          </h2>
          <p className="mt-3 max-w-[62ch] font-public text-[17px] leading-[1.55] text-cream-100/80">
            Advottic Counsel is the firm workspace: intake, evidence rooms, signing inside the vault,
            audit log, SSO. It has its own front door.
          </p>
        </div>
        <Link href="/enterprise" className={BUTTON_OUTLINE_CREAM}>
          See Advottic for firms
        </Link>
      </div>
    </section>
  );
}

function Close() {
  return (
    <Section label="Whenever you are ready">
      <h2 className={H2}>One small step today.</h2>
      <p className={`${BODY} mt-4`}>
        Start a case file and add to it as life unfolds. Free for 7 days, no card to start, cancel
        any time.
      </p>
      <Link href="/cases/new" className={`${BUTTON_INK} mt-6`}>
        Start your case file
      </Link>
    </Section>
  );
}
