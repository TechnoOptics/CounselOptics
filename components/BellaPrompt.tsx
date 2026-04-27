'use client';

/**
 * Inline launcher card that opens Bella with a pre-filled prompt focused
 * on the surrounding case context. Lets the AI feel native instead of
 * always living behind a floating FAB. Bella herself listens for the
 * `advottic:bella-open` custom event below.
 *
 * Renders as a compact dark-forest card with a gold sparkle, two or
 * three suggested prompts, and a subtle "No training" reassurance.
 */
export function BellaPrompt({
  title = 'Ask Bella about this case',
  subtitle = 'Plain-English answers grounded in your exhibits and review.',
  prompts,
}: {
  title?: string;
  subtitle?: string;
  prompts: string[];
}) {
  function open(prompt: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('advottic:bella-open', { detail: { prompt } }),
    );
  }
  return (
    <div className="card-ai p-5 sm:p-6 relative overflow-hidden">
      <div className="flex items-start gap-3">
        <span className="aurora flex-none">
          <BellaB size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
            Bella · No training
          </p>
          <p className="font-display text-lg font-medium tracking-[-0.01em] text-cream-100 mt-1">
            {title}
          </p>
          <p className="text-sm text-cream-100/70 mt-1 leading-relaxed">{subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {prompts.map((p) => (
              <button
                key={p}
                onClick={() => open(p)}
                type="button"
                className="text-left text-[12px] rounded-full bg-forest-800/70 hover:bg-forest-700 ring-1 ring-gold-400/20 hover:ring-gold-400/40 text-cream-100 px-3 py-1.5 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BellaB({ size = 20 }: { size?: number }) {
  const disc = Math.round(size * 1.55);
  return (
    <span
      className="inline-flex items-center justify-center rounded-full flex-none"
      aria-hidden
      style={{
        width: disc,
        height: disc,
        background:
          'radial-gradient(circle at 30% 25%, rgba(245,237,214,0.16), transparent 55%), linear-gradient(180deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
        boxShadow:
          'inset 0 1px 0 rgba(245, 237, 214, 0.20), inset 0 -2px 4px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25)',
        border: '1px solid rgba(213, 187, 126, 0.55)',
      }}
    >
      <span
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: 700,
          fontSize: size,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          background:
            'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          textShadow: '0 1px 0 rgba(0,0,0,0.30)',
          transform: 'translateX(-0.5px)',
        }}
      >
        B
      </span>
    </span>
  );
}
