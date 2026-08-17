import Link from 'next/link';
import { SectionPhoto } from '@/components/marketing/SectionPhoto';

/**
 * Top-of-home-page audience selector. Two big captivating cards:
 *
 *   Left  - Personal: people building their own case file (default
 *           audience for /). Its CTA reads "Start free - no card
 *           needed" and navigates to /cases/new. It does not scroll:
 *           there is no "Continue" button and no #personal-flow
 *           anchor anywhere in the app.
 *   Right - Enterprise: firms, in-house teams, paralegals (links to
 *           /enterprise which has a parallel layout but with copy and
 *           proof points sized for a firm pitch).
 *
 * Renders identically on both /  and /enterprise; the `active` prop
 * only picks which card gets the glowing "current" state and the
 * "You're here" badge. It does NOT change the CTA copy: each card's
 * primary button is fixed per variant ("Start free - no card needed"
 * and "Tell us about your firm"), and the one-tap path to the other
 * audience is the secondary link, "Or look at the <other> side
 * instead". An earlier version of this comment described a "Continue"
 * and "Switch to ..." pair that does not exist in this file.
 *
 * Every glyph is an in-house SVG so the page reads as a serious
 * legal tool, not a consumer app dotted with emoji.
 */
export function AudienceSplit({
  active,
}: {
  active: 'personal' | 'enterprise';
}) {
  return (
    <section id="audience" className="relative -mt-2 animate-fade-up">
      <header className="max-w-2xl mb-7 sm:mb-10">
        {/* TWO ACCENT CLAIMS WERE REMOVED FROM THIS HEADER, AND ONLY THOSE
            TWO. This block is not the subject of the hero change, but it
            renders ABOVE the hero and therefore owns the fold: measured on
            a production build, the first viewport made 11 to 16 accent
            claims depending on width, and none of them were the hero's,
            because the hero starts 1637px down at 1280px wide and 2607px
            down at 375px. docs/DESIGN.md allows the accent once per view,
            so a disciplined hero underneath a louder chooser would have
            inverted the page's hierarchy rather than fixed it.

            Gone: the gold rule that preceded the label, and the
            `gold-shine-ink ... italic` treatment on "how you work". The
            label itself keeps its gold, and that is now the fold's single
            claim. The italic went for the same reason as the hero's:
            Fraunces is loaded with no italic face, so it was a
            browser-synthesised slant, not a typeface.

            Everything else here is deliberately untouched. */}
        <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-700 dark:text-gold-300">
          Built for two audiences. Pick yours.
        </p>
        <h2 className="mt-4 font-display text-[34px] sm:text-[44px] lg:text-[52px] font-medium tracking-[-0.02em] leading-[1.02] text-forest-900 dark:text-cream-100">
          The same calm software, sized to how you work.
        </h2>
        <p className="mt-3 sm:mt-4 text-[15px] sm:text-[16px] leading-relaxed text-ink-700 dark:text-cream-100/80 max-w-xl">
          Whether you&apos;re tracking a matter that just landed in your lap, or a firm running
          fifty active matters across three jurisdictions, Advottic keeps the work tidy so the
          truth is ready when the moment arrives.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <AudienceCard
          variant="personal"
          active={active === 'personal'}
        />
        <AudienceCard
          variant="enterprise"
          active={active === 'enterprise'}
        />
      </div>
    </section>
  );
}

type Variant = 'personal' | 'enterprise';

function AudienceCard({ variant, active }: { variant: Variant; active: boolean }) {
  const config = variant === 'personal' ? PERSONAL : ENTERPRISE;
  const otherHref = variant === 'personal' ? '/enterprise' : '/';
  const otherLabel = variant === 'personal' ? 'enterprise' : 'personal';

  return (
    <article
      className={`relative overflow-hidden rounded-3xl p-7 sm:p-9 lg:p-10 transition-all duration-500 ${
        active
          ? variant === 'personal'
            ? // Light-cream wash in light mode, deep forest in dark mode so
              // the heading + bullets stay legible regardless of the user's
              // system preference. Earlier version was light-only and the
              // entire card disappeared on dark backgrounds.
              'bg-gradient-to-br from-cream-50 via-white to-cream-100 dark:from-forest-900 dark:via-forest-950 dark:to-forest-900 ring-1 ring-gold-500/40 shadow-card-hover'
            : // Enterprise active = always the deep forest treatment, in
              // both light and dark, because the firm pitch wants the
              // serious-finance feel either way.
              'bg-gradient-to-br from-forest-900 via-forest-950 to-forest-900 ring-1 ring-gold-500/30 shadow-card-hover text-cream-100'
          : // Inactive cards: subdued surface, ring brightens on hover.
            'bg-white dark:bg-forest-900/40 ring-1 ring-ink-200 dark:ring-forest-700/40 hover:ring-gold-500/40'
      }`}
    >
      {/* Ambient gradient halo */}
      {variant === 'personal' ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-50 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(213,187,126,0.30) 0%, rgba(213,187,126,0) 70%)',
          }}
        />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -bottom-24 h-80 w-80 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(213,187,126,0.32) 0%, rgba(213,187,126,0) 70%)',
          }}
        />
      )}

      {/* Active-state glowing strip */}
      {active && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 w-1 ${
            variant === 'personal' ? 'bg-gold-500' : 'bg-gold-400'
          }`}
        />
      )}

      <div className="relative z-10">
        {/* A photograph above the pitch rather than behind it. The card
            already carries a gold halo and a glowing strip; a picture
            underneath the type would fight both and could not be held to a
            contrast floor.

            OPTIONAL, and only one audience has one. The personal side used
            to show a woman running a cafe, which is warm but is the wrong
            story: somebody reaching Advottic on their own is in the middle
            of a dispute, a deposit or a dismissal, not a good day at work.
            An absent photograph says less than a photograph about the wrong
            subject. */}
        {config.photo && (
          <SectionPhoto
            src={config.photo.src}
            alt={config.photo.alt}
            aspect="aspect-[16/7]"
            sizes="(min-width: 1024px) 42vw, 92vw"
            className="mb-6"
          />
        )}
        <div className="flex items-center justify-between mb-5">
          <p
            className={`inline-flex items-center gap-2.5 text-[10px] tracking-[0.28em] uppercase font-semibold ${
              (variant === 'enterprise' && active) || (variant === 'personal' && active)
                ? 'text-gold-700 dark:text-gold-300'
                : 'text-gold-700 dark:text-gold-300'
            } ${variant === 'enterprise' && active ? '!text-gold-300' : ''}`}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                variant === 'personal'
                  ? 'bg-gold-100 text-gold-800 dark:bg-gold-400/15 dark:text-gold-300'
                  : 'bg-gold-400/20 text-gold-300'
              }`}
              aria-hidden
            >
              {variant === 'personal' ? <PersonGlyph /> : <BuildingGlyph />}
            </span>
            {config.eyebrow}
          </p>
          {active && (
            <span
              className={`text-[9px] tracking-[0.22em] uppercase font-semibold rounded-full px-2 py-0.5 ${
                variant === 'personal'
                  ? 'bg-gold-100 text-gold-800 border border-gold-300 dark:bg-gold-400/15 dark:text-gold-300 dark:border-gold-400/30'
                  : 'bg-gold-400/15 text-gold-300 border border-gold-400/30'
              }`}
            >
              You&apos;re here
            </span>
          )}
        </div>

        <h3
          className={`font-display text-[28px] sm:text-[34px] lg:text-[38px] font-medium tracking-[-0.02em] leading-[1.05] ${
            variant === 'enterprise' && active
              ? 'text-cream-100'
              : 'text-forest-900 dark:text-cream-100'
          }`}
        >
          {config.headline}
        </h3>

        <p
          className={`mt-4 text-[15px] sm:text-[16px] leading-relaxed ${
            variant === 'enterprise' && active
              ? 'text-cream-100/80'
              : 'text-ink-700 dark:text-cream-100/80'
          }`}
        >
          {config.subhead}
        </p>

        <ul
          className={`mt-6 space-y-2.5 text-sm ${
            variant === 'enterprise' && active ? 'text-cream-100/85' : 'text-ink-700 dark:text-cream-100/80'
          }`}
        >
          {config.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                  variant === 'personal'
                    ? 'bg-gold-100 text-gold-800 dark:bg-gold-400/15 dark:text-gold-300'
                    : 'bg-gold-400/20 text-gold-300'
                }`}
              >
                <CheckIcon />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Numeric proof strip */}
        <div
          className={`mt-7 grid grid-cols-2 gap-5 border-t pt-5 ${
            variant === 'enterprise' && active
              ? 'border-cream-100/15'
              : 'border-ink-200 dark:border-forest-700/40'
          }`}
        >
          {config.proof.map((p) => (
            <div key={p.label}>
              <p
                className={`font-display text-2xl sm:text-[28px] font-medium tabular-nums ${
                  variant === 'enterprise' && active
                    ? 'text-cream-100'
                    : 'text-forest-900 dark:text-cream-100'
                }`}
              >
                {p.value}
              </p>
              <p
                className={`text-[11px] mt-0.5 tracking-wide ${
                  variant === 'enterprise' && active
                    ? 'text-cream-100/55'
                    : 'text-ink-500 dark:text-cream-100/55'
                }`}
              >
                {p.label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-3">
          {active ? (
            <Link
              href={config.primaryHref}
              className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
            >
              {config.primaryCta}
              <ArrowRight />
            </Link>
          ) : (
            // Inactive card switch CTA. Stays visible against BOTH a
            // light-mode card surface and a dark-mode card surface; the
            // earlier version had identical foreground/background in
            // dark, which made the button vanish.
            <Link
              href={variant === 'personal' ? '/' : '/enterprise'}
              className={
                variant === 'personal'
                  ? 'btn bg-forest-900 text-cream-50 hover:bg-forest-800 dark:bg-gold-metal dark:text-forest-950 dark:hover:brightness-110 font-semibold px-5 py-2.5'
                  : 'btn bg-gold-metal text-forest-950 hover:brightness-110 font-semibold px-5 py-2.5'
              }
            >
              {config.switchCta}
              <ArrowRight />
            </Link>
          )}
          {active && (
            // Audit W20 P1 (bug B6): on the INACTIVE card this tertiary
            // link computed otherHref relative to the card's variant,
            // not relative to the page the visitor is on. On /enterprise
            // the inactive personal card rendered "Or look at the
            // enterprise side instead" pointing back to /enterprise, a
            // dead-end self-reference. Guarding on `active` means the
            // cross-link only ships from the card the visitor is
            // currently looking at, which is also where the language
            // ("look at the OTHER side") actually makes sense.
            <Link
              href={otherHref}
              className={`text-xs underline-offset-4 hover:underline ${
                variant === 'enterprise' && active
                  ? 'text-cream-100/65 hover:text-cream-100'
                  : 'text-ink-500 hover:text-forest-900 dark:text-cream-100/55 dark:hover:text-cream-100'
              }`}
            >
              Or look at the {otherLabel} side instead →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

const PERSONAL = {
  // No photograph. See the render above for why, and DESIGN_SYSTEM.md for
  // the rule: a photograph has to be of the subject, and there is no honest
  // stock image of somebody's own legal trouble.
  photo: null,
  eyebrow: 'For one person',
  headline: "When it's just you, your evidence, and the date on the calendar.",
  subhead:
    'A calm place to gather screenshots, dates, and the truth in your own words. Walk into court (or your attorney) with a packet they can read in five minutes.',
  bullets: [
    'Auto-numbered exhibits, dates pulled from the file metadata',
    'Bella, the in-app assistant, in plain English',
    'Advottic Review surfaces issues + questions worth asking your lawyer',
    'Export the full case packet as one PDF',
    'Encrypted at rest. Yours forever. Delete in one tap.',
  ],
  proof: [
    { value: '7 days', label: 'Free trial - no card to start' },
    { value: 'Cancel', label: 'Any time, one tap' },
  ],
  primaryCta: 'Start free - no card needed',
  primaryHref: '/cases/new',
  switchCta: 'Show me the personal side',
};

const ENTERPRISE = {
  photo: {
    src: '/marketing/people-reviewing-documents.webp',
    alt: 'Three colleagues around a table, reading through printed documents together.',
  },
  eyebrow: 'For firms, in-house, counsel',
  headline: 'Run every matter through one calm, secure, audited surface.',
  subhead:
    'A workspace your attorneys, paralegals, and clients share, scoped to the matter. Intake, evidence rooms, AI-assisted triage, document signing inside the encrypted vault, audit logs, SSO. Replace the stitched stack with one tool your team will actually use.',
  bullets: [
    'Per-matter rooms with role-based access (counsel, paralegal, client)',
    'Invite collaborators - signing partners, co-counsel, the client',
    'Built-in document signing that never leaves the encrypted vault',
    'Branded client intake. Your firm name on every screen.',
    'Microsoft / Google SSO. Full audit log + retention policy.',
    'Custom pricing - sized to firm + practice area. Talk to us.',
  ],
  proof: [
    { value: 'Custom', label: 'Per-seat pricing, agreed in writing' },
    { value: 'SOC 2', label: 'Posture - controls on request' },
  ],
  primaryCta: 'Tell us about your firm',
  primaryHref: '/enterprise#inquiry',
  switchCta: 'Show me the enterprise side',
};

// =====================================================================
// In-house SVG icon set. No emoji - keeps the page reading as a
// serious legal tool, not a consumer app dotted with picture-fonts.
// =====================================================================

function PersonGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BuildingGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M13 21V11a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v10M3 21h18M7 8h2M7 12h2M7 16h2M16 14h1M16 18h1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4 10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
