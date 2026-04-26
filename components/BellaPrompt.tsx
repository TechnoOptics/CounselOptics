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
        <span className="aurora flex-none inline-flex items-center justify-center h-9 w-9 rounded-full bg-forest-950 ring-1 ring-gold-400/40 text-gold-300">
          <SparkleIcon />
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

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
    </svg>
  );
}
