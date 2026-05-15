import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'A personal invitation from Abel',
  description:
    "I'm Abel, the founder of Advottic. I built it because I think the legal system should be easier to walk into prepared. I'd love your help testing it - and your honest feedback.",
  alternates: { canonical: '/invite' },
  openGraph: {
    title: 'A personal invitation from Abel',
    description:
      "I built Advottic to help people walk into court prepared. I'd be honored if you tried it and told me what you think.",
    url: '/invite',
    type: 'article',
  },
};

/**
 * Personal beta-tester invitation landing page from Abel Muchai,
 * founder of Advottic. Warm, honest, no over-claims. Linked at
 * advottic.com/invite so it's a clean share URL.
 *
 * Security copy is deliberately accurate - no "we cannot see your
 * data" overclaim (the service-role key technically can; Bella +
 * Advottic Review send content to a processing partner under
 * zero-retention terms). What's true: encryption in transit and
 * at rest, RLS isolation, no AI training on user content,
 * exportable + deletable any time. That's the right kind of
 * reassuring without being false.
 */
export default function InvitePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-12 animate-fade-up py-2 sm:py-6">
      {/* Letterhead */}
      <header className="text-center space-y-5">
        <p className="eyebrow justify-center">A personal invitation</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.04] text-forest-900 dark:text-cream-100">
          Hi, I&rsquo;m{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            Abel.
          </span>
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-cream-100/75 max-w-xl mx-auto leading-relaxed">
          Founder of Advottic. I&rsquo;d love your help testing what we&rsquo;ve built -
          and your honest feedback.
        </p>
      </header>

      {/* Letter */}
      <section className="card p-6 sm:p-8 space-y-5 leading-relaxed text-[15px] sm:text-base text-ink-800 dark:text-cream-100/85">
        <p>
          Most people who end up in court - small claims, family matters, harassment,
          a contract that went sideways - arrive feeling overwhelmed. I&rsquo;ve watched
          people I love walk into hearings holding crumpled receipts in a plastic bag,
          carrying a story in their head that no one else can follow, and leave the
          courtroom wondering what just happened.
        </p>
        <p>
          That&rsquo;s the gap I built Advottic to close. Not a law firm. Not legal advice.
          A clean, structured way to <em>describe what happened</em>, organize your evidence,
          and walk into your hearing - or your attorney&rsquo;s office - with a
          packet anyone can read in five minutes. Because preparation is power, and people
          deserve to feel powerful in moments that matter to them.
        </p>
        <p>
          I&rsquo;m sending this to you because I respect your judgment. Try the app. Make a
          test case. Talk to Bella. Run an Advottic Review on a matter (real or imagined).
          Tell me what felt good, what felt clunky, what made you stop and think. The honest
          notes are the ones that make the next version better.
        </p>
        <p className="text-forest-700 dark:text-gold-300 font-display text-xl">
          With gratitude,
        </p>
        <p
          className="font-display text-2xl sm:text-3xl tracking-[-0.01em] text-forest-900 dark:text-cream-100"
          style={{ fontStyle: 'italic' }}
        >
          Abel Muchai
        </p>
        <p className="text-xs text-ink-500 dark:text-cream-100/55 -mt-3">
          Founder, Advottic &middot; contact@advottic.com
        </p>
      </section>

      {/* What you can try */}
      <section className="space-y-4">
        <p className="eyebrow">What you can try</p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Five minutes is plenty.
        </h2>
        <p className="text-sm sm:text-base text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-2xl">
          Pick any one of these. You don&rsquo;t need a real case - a made-up scenario
          works just as well for telling me whether the app holds together.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 mt-4">
          <Tile
            title="Open the example case"
            body="A read-only walkthrough at /example. No sign-in needed. Lets you see what a real Advottic file looks like before you make your own."
            href="/example"
            cta="Tour the example"
          />
          <Tile
            title="Start a 7-day free trial"
            body="Every feature unlocked. No card on file. Build a case file, upload exhibits, run a review, export the packet."
            href="/sign-in?next=/cases/new"
            cta="Begin"
          />
          <Tile
            title="Talk to Bella"
            body="Ask anything. Plain-English legal concepts, how the app works, what to do next. She does not pretend to be a lawyer."
            href="/sign-in?next=/cases"
            cta="Open Bella"
          />
          <Tile
            title="Try the document review"
            body="Paste a contract, lease, or court order at /review-my-document. No account required. Free."
            href="/review-my-document"
            cta="Review a document"
          />
        </ul>
      </section>

      {/* Honest security paragraph */}
      <section className="card p-6 sm:p-8 ring-1 ring-forest-300/40 dark:ring-forest-700/40 bg-gradient-to-br from-cream-50/50 to-white dark:from-forest-900/40 dark:to-forest-950/40">
        <p className="eyebrow mb-3">Your story stays yours</p>
        <h2 className="font-display text-xl sm:text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          We treat your data the way I&rsquo;d want mine treated.
        </h2>
        <ul className="mt-4 space-y-2.5 text-sm sm:text-[15px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          <li className="flex items-start gap-3">
            <Check />
            <span>
              <strong>Encrypted in transit and at rest.</strong> TLS 1.2+ on the wire,
              AES-256 in the database and the file vault.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Check />
            <span>
              <strong>Per-row access controls.</strong> No other user can see your case,
              even by accident, even if our app code had a bug. The rule is enforced by
              the database itself, not just the application.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Check />
            <span>
              <strong>Never used to train any AI.</strong> Bella and Advottic Review run
              under strict zero-retention commercial terms with our processing partner.
              Your case content reaches the model, returns an answer, and is not retained
              beyond the response.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Check />
            <span>
              <strong>Strict internal access.</strong> Our team only opens your account
              when you explicitly ask for support. Every administrative action is logged.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Check />
            <span>
              <strong>You stay in control.</strong> Export everything you&rsquo;ve written
              or uploaded any time. Delete your account at any time and the data is
              purged from primary storage within 30 days, from backups within 35.
            </span>
          </li>
        </ul>
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-5">
          Full details on the{' '}
          <Link href="/security" className="underline hover:text-forest-900 dark:hover:text-cream-100">
            Trust &amp; Security
          </Link>{' '}
          page. Here&rsquo;s also{' '}
          <Link href="/about" className="underline hover:text-forest-900 dark:hover:text-cream-100">
            what Advottic is, and isn&rsquo;t
          </Link>
          .
        </p>
      </section>

      {/* Feedback CTA */}
      <section className="card p-6 sm:p-8 text-center">
        <p className="eyebrow mb-2 justify-center">Tell me what you think</p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Any reaction is the right reaction.
        </h2>
        <p className="text-sm sm:text-base text-ink-600 dark:text-cream-100/70 mt-3 max-w-xl mx-auto leading-relaxed">
          What worked. What didn&rsquo;t. What confused you. What made you smile. Send a
          line, send a paragraph, send a screenshot - whatever&rsquo;s easiest for
          you. I read every message.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/sign-in?next=/cases/new"
            className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
          >
            Start the free trial
            <span aria-hidden className="ml-1.5">
              &rarr;
            </span>
          </Link>
          <Link
            href="/feedback"
            className="btn-secondary px-5 py-2.5"
          >
            Send feedback
          </Link>
          <a
            href="mailto:contact@advottic.com?subject=Advottic%20beta%20feedback"
            className="text-sm text-forest-900 dark:text-cream-100 underline underline-offset-2 hover:text-gold-700 dark:hover:text-gold-300"
          >
            Or email me directly
          </a>
        </div>
      </section>

      {/* Sign-off */}
      <section className="text-center text-xs text-ink-500 dark:text-cream-100/55 max-w-xl mx-auto">
        Advottic prepares. A licensed attorney advises. You decide.{' '}
        <Link
          href="/about"
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          Learn more
        </Link>
        .
      </section>
    </div>
  );
}

function Tile({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all group block"
    >
      <p className="font-semibold text-forest-900 dark:text-cream-100 text-[14.5px]">
        {title}
      </p>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
        {body}
      </p>
      <p className="text-[12.5px] mt-3 font-semibold text-gold-700 dark:text-gold-300 group-hover:underline underline-offset-2">
        {cta} &rarr;
      </p>
    </Link>
  );
}

function Check() {
  return (
    <span
      className="flex-none mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-forest-900 text-cream-200 dark:bg-gold-metal dark:text-forest-950"
      aria-hidden
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
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
