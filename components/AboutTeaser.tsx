import Link from 'next/link';

/**
 * Compact "What Advottic is, and isn't" section. Mirrors the role
 * triangle from the canonical /about page (You / Advottic / An
 * attorney) in a card-friendly form, then ends with a CTA that
 * leads readers to the full page.
 *
 * Designed to be droppable into the marketing home and the welcome
 * (intro) page. Same component, two surfaces - so the framing
 * stays consistent everywhere it matters.
 *
 * The `tone` prop lets the host page pick a light or dark surface:
 *   - `light` (default): cream / white background, suits in-flow
 *     placement on the marketing home between sections.
 *   - `dark`: forest hero background with gold accents, suits a
 *     focal moment (e.g. final CTA section, welcome page).
 */
export function AboutTeaser({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const isDark = tone === 'dark';
  return (
    <section
      className={
        isDark
          ? 'relative overflow-hidden rounded-3xl px-6 sm:px-10 py-12 sm:py-16 hero-bg text-cream-100 ring-1 ring-forest-700/40 shadow-card-hover'
          : 'relative overflow-hidden rounded-3xl px-6 sm:px-10 py-12 sm:py-16 bg-gradient-to-br from-cream-50 via-white to-cream-100/40 ring-1 ring-ink-200 shadow-card dark:from-forest-900/60 dark:via-forest-950/40 dark:to-forest-900/60 dark:ring-forest-700/40'
      }
    >
      {/* Decorative orbs - subtle, not central. Match the home hero. */}
      <div
        aria-hidden
        className={`hero-orb hero-orb--gold ${isDark ? 'opacity-50' : 'opacity-30'} hero-orb--a`}
        style={{ width: 200, height: 200, right: '-40px', top: '-60px' }}
      />
      <div
        aria-hidden
        className={`hero-orb hero-orb--cream ${isDark ? 'opacity-30' : 'opacity-15'} hero-orb--b`}
        style={{ width: 180, height: 180, left: '-40px', bottom: '-80px' }}
      />

      <div className="relative max-w-3xl mx-auto text-center">
        <p
          className={`eyebrow justify-center mb-3 ${isDark ? 'text-gold-300' : ''}`}
        >
          What we do · What we don&rsquo;t
        </p>
        <h2
          className={`font-display text-3xl sm:text-[40px] font-medium tracking-[-0.015em] leading-[1.05] ${
            isDark ? 'text-cream-100' : 'text-forest-900 dark:text-cream-100'
          }`}
        >
          Advottic prepares.{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            An attorney advises.
          </span>{' '}
          You decide.
        </h2>
        <p
          className={`text-sm sm:text-base mt-4 leading-relaxed max-w-2xl mx-auto ${
            isDark ? 'text-cream-100/80' : 'text-ink-600 dark:text-cream-100/70'
          }`}
        >
          We organize what happened. We do not represent you, predict outcomes, or replace
          a licensed attorney. The clearer the line, the more useful the tool.
        </p>
      </div>

      {/* Three roles, compact */}
      <div className="relative grid gap-3 sm:grid-cols-3 max-w-3xl mx-auto mt-8">
        <RoleChip tone={tone} eyebrow="You" verb="Describe & decide" />
        <RoleChip
          tone={tone}
          eyebrow="Advottic"
          verb="Organize & prepare"
          highlight
        />
        <RoleChip tone={tone} eyebrow="An attorney" verb="Advise & represent" />
      </div>

      <div className="relative flex flex-wrap items-center justify-center gap-3 mt-8">
        <Link
          href="/about"
          className={
            isDark
              ? 'btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5'
              : 'btn-primary text-cream-50 dark:text-forest-950 px-5 py-2.5'
          }
          style={isDark ? undefined : { color: '#fbf7e9' }}
        >
          Read what Advottic is, and isn&rsquo;t
          <span aria-hidden className="ml-1.5">
            &rarr;
          </span>
        </Link>
        <Link
          href="/find-counsel"
          className={
            isDark
              ? 'btn bg-white/10 text-cream-100 ring-1 ring-cream-100/25 hover:bg-white/15 backdrop-blur px-5 py-2.5'
              : 'btn-secondary px-5 py-2.5'
          }
        >
          Find counsel near you
        </Link>
      </div>
    </section>
  );
}

function RoleChip({
  tone,
  eyebrow,
  verb,
  highlight,
}: {
  tone: 'light' | 'dark';
  eyebrow: string;
  verb: string;
  highlight?: boolean;
}) {
  const isDark = tone === 'dark';
  const base = isDark
    ? 'rounded-xl bg-white/8 ring-1 ring-cream-100/15 px-4 py-3 text-cream-100 backdrop-blur'
    : 'rounded-xl bg-white ring-1 ring-ink-200 px-4 py-3 dark:bg-forest-900/70 dark:ring-forest-700/60';
  const accent = highlight
    ? isDark
      ? 'ring-gold-400/50 bg-cream-100/15'
      : 'ring-gold-400/60 bg-cream-50 dark:bg-forest-900/95 dark:ring-gold-500/40'
    : '';
  return (
    <div className={`${base} ${accent}`}>
      <p
        className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${
          isDark ? 'text-gold-300' : 'text-gold-700 dark:text-gold-300'
        }`}
      >
        {eyebrow}
      </p>
      <p
        className={`font-display text-[18px] font-medium tracking-[-0.01em] mt-1 ${
          isDark ? 'text-cream-100' : 'text-forest-900 dark:text-cream-100'
        }`}
      >
        {verb}
      </p>
    </div>
  );
}
