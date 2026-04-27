import Link from 'next/link';

export const metadata = {
  title: 'What Advottic is, and isn’t',
  description:
    'Plain-English honesty about what Advottic does (organize evidence, prepare for hearings, ship a clean packet) and what it does not do (give legal advice, predict outcomes, replace a licensed attorney).',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'What Advottic is, and isn’t',
    description:
      'Advottic prepares. An attorney advises. You decide. The honest scope of what we do, and when to call a lawyer instead.',
    url: '/about',
    type: 'article',
  },
};

/**
 * Canonical "What Advottic is and isn't" page. The single place we
 * say it: Advottic prepares, an attorney advises, the user decides.
 *
 * Linked from the footer, the sign-in screen, and the welcome / first-
 * run flow. Every other surface in the app can ship a single short
 * line + a link here, instead of repeating the disclosure on every
 * screen.
 *
 * Tone: confident, empowering, plain English. We are not afraid of
 * what we do well, and we are clear about where a licensed attorney
 * is the right move.
 */
export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-up">
      {/* Hero */}
      <header className="text-center max-w-2xl mx-auto pt-2">
        <p className="eyebrow mb-3 justify-center">About Advottic</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          What Advottic is, and isn&rsquo;t.
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-cream-100/70 mt-4 leading-relaxed">
          We get this question a lot, and you deserve a straight answer. So here it is, in
          one page, in plain English &mdash; what we do, where a licensed attorney comes
          in, and how we stay out of your way at the moments that matter.
        </p>
      </header>

      {/* Three roles, side by side */}
      <section className="grid gap-4 sm:grid-cols-3">
        <RoleCard
          eyebrow="You"
          verb="Describe & decide"
          body="It is your case. You tell the story, you choose what to share, and you make the call on what to do next."
        />
        <RoleCard
          eyebrow="Advottic"
          verb="Organize & prepare"
          body="We help you turn what happened into a clean, structured case file: exhibits, dates, parties, deadlines, packet."
          highlight
        />
        <RoleCard
          eyebrow="An attorney"
          verb="Advise & represent"
          body="When the matter calls for legal judgment or someone speaking for you in court, that is what licensed counsel is for."
        />
      </section>

      {/* What Advottic does */}
      <Section eyebrow="What we do" title="What Advottic does well">
        <ul className="grid sm:grid-cols-2 gap-3">
          <DoesTile
            title="Build a structured case file"
            body="Subject, jurisdiction, posture, hearing date, exhibits with labels and categories. Same shape every time."
          />
          <DoesTile
            title="Surface evidence gaps"
            body="Advottic Review reads the case and flags missing exhibits, weak proofs, and concrete records to ask for."
          />
          <DoesTile
            title="Explain legal concepts plainly"
            body="Bella translates jargon (statute of limitations, motion to dismiss, default judgment) into plain English."
          />
          <DoesTile
            title="Track court dates"
            body="A countdown, a pre-hearing checklist tied to your case type, and a one-tap calendar export to your phone."
          />
          <DoesTile
            title="Generate a clean PDF packet"
            body="A cover, case info, numbered exhibits index, and Advottic Review summary &mdash; ready to email to an attorney."
          />
          <DoesTile
            title="Surface free or low-cost help"
            body="State-by-state directory of court e-filing portals, public defenders, and civil legal-aid organizations &mdash; one tap away."
          />
        </ul>
      </Section>

      {/* What Advottic doesn't do */}
      <Section eyebrow="What we do not do" title="Where we step back">
        <div className="card p-6 sm:p-7 ring-1 ring-rose-300/40 dark:ring-rose-500/30 bg-rose-50/40 dark:bg-rose-950/20">
          <ul className="space-y-3 text-sm sm:text-[15px] text-ink-800 dark:text-cream-100/85 leading-relaxed">
            <li className="flex items-start gap-3">
              <NoIcon />
              <span>
                <strong>We do not predict outcomes.</strong> No &ldquo;you will win,&rdquo;
                no &ldquo;this is a slam dunk,&rdquo; no probabilities. Every case turns on
                facts, judges, and evidence we cannot see.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <NoIcon />
              <span>
                <strong>We do not give legal advice for your specific case.</strong> We
                explain what a deadline is. We do not tell you whether you should miss it
                or meet it.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <NoIcon />
              <span>
                <strong>We do not represent you.</strong> Advottic is not a law firm. No
                attorney-client relationship is created by using the app or talking with
                Bella. Anything you share inside Advottic is not protected by
                attorney-client privilege.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <NoIcon />
              <span>
                <strong>We do not file documents for you.</strong> Court-portal links and
                e-filing instructions live on the{' '}
                <Link href="/file-exhibits" className="underline hover:text-forest-700">
                  /file-exhibits
                </Link>{' '}
                page. You file. The court receives. You stay in control of every keystroke.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <NoIcon />
              <span>
                <strong>We do not invent statutes or case names.</strong> If we do not
                know a citation, we say so and point you to where to look it up.
              </span>
            </li>
          </ul>
        </div>
      </Section>

      {/* When to call a lawyer */}
      <Section eyebrow="When to call a lawyer" title="The moments where counsel matters">
        <p className="text-sm sm:text-[15px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          Advottic is fastest when you walk in already organized. There are also moments
          where the right move is to stop typing and pick up the phone. The shortlist:
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 mt-4">
          <CallTile
            title="Anything criminal where jail is possible"
            body="You have a constitutional right to a public defender at no cost. Ask for one at your first court appearance."
            cta={{ href: '/public-defender', label: 'Public defender directory' }}
          />
          <CallTile
            title="Settle / plead / accept an offer"
            body="A choice that ends the matter and binds you forever should be reviewed by a licensed attorney before you sign."
            cta={{ href: '/find-counsel', label: 'Find counsel' }}
          />
          <CallTile
            title="The other side has counsel"
            body="When their lawyer files, an unrepresented party is at a structural disadvantage. Equalize early."
            cta={{ href: '/find-counsel', label: 'Find counsel' }}
          />
          <CallTile
            title="Statute-of-limitations clock running out"
            body="Deadlines for civil claims can be as short as a few months. A quick consult can save the case from being barred."
            cta={{ href: '/find-counsel', label: 'Find counsel' }}
          />
          <CallTile
            title="Family, immigration, or housing emergency"
            body="Custody, deportation, or imminent eviction need a specialist. Most areas have free clinics &mdash; we link them."
            cta={{ href: '/find-counsel', label: 'Find counsel' }}
          />
          <CallTile
            title="Anything you cannot afford to get wrong"
            body="If the cost of a wrong answer is more than a couple of hours of an attorney's time, the consult is the cheap option."
            cta={{ href: '/find-counsel', label: 'Find counsel' }}
          />
        </ul>
      </Section>

      {/* Who Advottic is for */}
      <Section eyebrow="Who Advottic is for" title="Three audiences, one product">
        <div className="grid gap-4 sm:grid-cols-3">
          <AudienceCard
            title="If you have a lawyer"
            body="Advottic is the cleanest possible 30-minute intake prep. Show up with a numbered exhibits index, a hearing-date timeline, and a summary your attorney can scan instead of building from your inbox."
          />
          <AudienceCard
            title="If you cannot afford one"
            body="Advottic helps you prepare a binder you can hand to a free legal-aid clinic, a public defender, or your county courthouse self-help desk. The lawyer's first hour is the most valuable; do not waste it on unsorted screenshots."
          />
          <AudienceCard
            title="If you are representing yourself"
            body="Advottic gives you the structure pro-se litigants almost always lack: deadlines tracked, exhibits numbered, evidence gaps surfaced. We will also put a free-help link in front of you at every decision point."
          />
        </div>
      </Section>

      {/* The promise */}
      <section className="card p-6 sm:p-8 text-center bg-gradient-to-br from-forest-50/60 to-cream-50/30 dark:from-forest-900/60 dark:to-forest-950/40 ring-1 ring-forest-300/30 dark:ring-forest-700/40">
        <p className="eyebrow mb-2 justify-center">The promise</p>
        <h3 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Walk in prepared. Anywhere your case takes you.
        </h3>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-3 max-w-xl mx-auto leading-relaxed">
          Whether the next step is your attorney&rsquo;s office, a free legal-aid clinic, a
          courthouse self-help desk, or a hearing where you speak for yourself &mdash;
          Advottic gets you there organized, not overwhelmed.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link href="/find-counsel" className="btn-secondary">
            Find counsel near you
          </Link>
          <Link href="/public-defender" className="btn-secondary">
            Public defender directory
          </Link>
          <Link href="/cases/new" className="btn-primary">
            Start a case file
          </Link>
        </div>
      </section>

      {/* Footer chrome */}
      <section className="text-center pt-2">
        <p className="text-xs text-ink-500 dark:text-cream-100/55">
          Last reviewed: 2026-04-27 &middot;{' '}
          <Link href="/security" className="underline">
            Trust &amp; Security
          </Link>{' '}
          &middot;{' '}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>{' '}
          &middot;{' '}
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </p>
      </section>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="font-display text-2xl sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {title}
        </h2>
      </div>
      <div className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function RoleCard({
  eyebrow,
  verb,
  body,
  highlight,
}: {
  eyebrow: string;
  verb: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-5 ${
        highlight
          ? 'ring-2 ring-gold-400/40 bg-cream-50 dark:bg-forest-900/80 dark:ring-gold-500/40'
          : ''
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {eyebrow}
      </p>
      <p className="font-display text-[22px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
        {verb}
      </p>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function DoesTile({ title, body }: { title: string; body: string }) {
  return (
    <li className="card p-4">
      <p className="font-semibold text-forest-900 dark:text-cream-100 text-[14.5px]">
        {title}
      </p>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
        {body}
      </p>
    </li>
  );
}

function CallTile({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="card p-5 ring-1 ring-amber-300/40 dark:ring-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15">
      <p className="font-semibold text-forest-900 dark:text-cream-100 text-[14.5px]">
        {title}
      </p>
      <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-1.5 leading-relaxed">
        {body}
      </p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-forest-900 dark:text-cream-100 mt-2 hover:text-gold-700 dark:hover:text-gold-300 underline underline-offset-2"
        >
          {cta.label} &rarr;
        </Link>
      )}
    </div>
  );
}

function AudienceCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-5">
      <h3 className="font-display text-[20px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </h3>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function NoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-none mt-0.5 text-rose-700 dark:text-rose-300"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5 5l14 14" />
    </svg>
  );
}
