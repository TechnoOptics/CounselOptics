'use client';

/**
 * Bella avatar slot. Prefers a real portrait at /bella-portrait.jpg
 * (drop a 256+ square JPG/PNG into public/ and it appears
 * automatically). Falls back to a gold-gradient "B" monogram on a
 * forest disc so the slot never looks empty.
 *
 * Lives in its own client component because onError is a DOM event
 * handler and can't be passed from a server component.
 *
 * a11y: the portrait carries a descriptive alt (not aria-hidden) so
 * screen readers announce "Bella, the Advottic AI assistant" rather
 * than skipping the slot entirely. Per Week-1 audit (item #6) the
 * automated checker counts decorative aria-hidden images as missing
 * alt, even though the markup is technically correct - giving Bella
 * a real label satisfies both the checker and gives sighted-impaired
 * users actually-useful context.
 */
export function BellaAvatar() {
  return (
    <span className="relative flex h-10 w-10 items-center justify-center rounded-full overflow-hidden ring-2 ring-gold-400/50 bg-gradient-to-br from-forest-700 via-forest-800 to-forest-950">
      <img
        src="/bella-portrait.jpg"
        alt="Bella, the Advottic AI legal-prep assistant"
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = 'none';
        }}
      />
      <span
        className="relative z-[1] font-display text-[18px] font-medium tracking-tight"
        style={{
          background:
            'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          textShadow: '0 1px 0 rgba(0,0,0,0.25)',
        }}
      >
        B
      </span>
    </span>
  );
}
