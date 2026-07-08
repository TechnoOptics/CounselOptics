'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { runReviewAction } from '@/lib/actions';
import type { AIReview } from '@/lib/types';
import { BellaPrompt } from '@/components/BellaPrompt';
import { CallALawyerCallout } from '@/components/CallALawyerCallout';

export function ReviewPanel({
  caseId,
  review,
  variant = 'consumer',
  showBella = true,
}: {
  caseId: string;
  review: AIReview | null;
  /**
   * Whether to render the contextual post-review Bella launcher inside
   * the panel. The counsel matter page sets this false because it shows
   * a single always-visible firm Bella card at the section level, so the
   * in-panel one would be a duplicate.
   */
  showBella?: boolean;
  /**
   * 'consumer' - the self-represented litigant surface: "Advottic
   * Review" heading, the "bring in a licensed attorney" callout, and
   * client-coaching Bella prompts.
   * 'firm' - the counsel work-product surface: reuses the exact same
   * AI machinery (runReviewAction / the carousel) but reframes it as
   * "Case Analysis", drops the call-a-lawyer callout (the firm IS
   * counsel), and swaps in litigation-oriented Bella prompts.
   */
  variant?: 'consumer' | 'firm';
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isFirm = variant === 'firm';

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        await runReviewAction(caseId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Review failed.');
      }
    });
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
            {isFirm ? 'Case Analysis' : 'Advottic Review'}
          </h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {review ? (
              <>
                Last reviewed {formatRelative(review.createdAt)} ·{' '}
                <span className="font-mono text-[11px] text-ink-400">{review.modelUsed}</span>
                {' · '}
                <span className="text-emerald-700 dark:text-emerald-400">No training</span>
              </>
            ) : isFirm ? (
              'Reads the matter facts and exhibits on file, then surfaces the legal issues, evidence gaps, and discovery/records targets for the team to work. Matter content is never used to train external models.'
            ) : (
              'Advottic Review reads the case description and exhibits, then surfaces issues, evidence gaps, and possible subpoena targets. Your case content is never used to train external models.'
            )}
          </p>
        </div>
        <button onClick={trigger} disabled={pending} className="btn-primary">
          {pending && <Spinner />}
          {pending ? 'Reviewing…' : review ? 'Re-run review' : 'Run review'}
        </button>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {!review && !pending && (
        <div className="card-ai p-8 sm:p-10 text-center relative">
          <div
            aria-hidden
            className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-forest-950 ring-1 ring-gold-400/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-gold-300 aurora"
          >
            <SparkleIcon />
            {isFirm ? 'AI · Case Analysis' : 'AI · Advottic Review'}
          </div>
          <p className="text-cream-100/85 leading-relaxed max-w-md mx-auto mt-2 mb-5">
            {isFirm
              ? 'Generate a structured, jurisdiction-aware issue-spotting analysis grounded in the matter facts and exhibits on file.'
              : 'Generate a structured, jurisdiction-aware issue-spotting summary grounded in your case description and exhibits.'}
          </p>
          {/*
            Audit W20 V3 CR-24: this CTA used to lack `disabled={pending}`
            and a loading state, so the first click looked like a no-op
            (the pending spinner was on the smaller header button only).
            Users would re-click - the second click hit while the first
            request was still in flight, sometimes succeeding, sometimes
            racing. Adding disabled={pending} + a spinner + a label
            swap fixes both the perceptual problem (click feels alive)
            and the race (second click is blocked by the disabled flag).
          */}
          <button
            onClick={trigger}
            disabled={pending}
            aria-busy={pending}
            className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5 disabled:opacity-70 disabled:cursor-progress"
          >
            {pending ? (
              <>
                <Spinner />
                Reading the case…
              </>
            ) : (
              <>
                <SparkleIcon />
                {isFirm ? 'Run Case Analysis' : 'Run Advottic Review'}
              </>
            )}
          </button>
        </div>
      )}

      {pending && (
        <div className="card-ai p-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 ai-sweep" aria-hidden />
          <p className="relative text-cream-100 font-medium">
            Reading the case &amp; exhibits…
          </p>
          <p className="relative text-cream-100/65 text-sm mt-1">
            {isFirm
              ? 'Composing the case analysis.'
              : 'Advottic Review is composing the review.'}
          </p>
        </div>
      )}

      {review && <ReviewCarousel review={review} />}

      {/* Once the review is done, plant a quiet "this is a good
          moment to loop in counsel" callout. The review just gave
          the user a real-looking output - the right next breath is
          to remind them this is a preparation tool, and a real
          attorney is who acts on it. Firm variant SKIPS this: the
          firm is counsel, so nudging them to "find counsel" is wrong. */}
      {review && !isFirm && (
        <CallALawyerCallout
          reason={{
            title: 'A good time to bring in a licensed attorney',
            body:
              "Advottic Review surfaces issues and gaps - it does not decide them. Bring this packet to an attorney for advice on which issue to lead with, what to file, and whether the proposed next steps fit your jurisdiction.",
          }}
          ctaLabel="Find counsel near you"
        />
      )}

      {review && showBella && (
        <BellaPrompt
          title={isFirm ? 'Work the analysis with Advottic' : 'Talk to Bella about this review'}
          subtitle={
            isFirm
              ? 'Ask focused follow-ups grounded in the matter facts and exhibits on file.'
              : 'Ask follow-up questions in plain English. She has the case and exhibits as context.'
          }
          prompts={
            isFirm
              ? [
                  'Identify the discovery gaps in this analysis.',
                  'Summarize exhibit relevance to each element.',
                  "What's missing for our theory of the case?",
                ]
              : [
                  'Explain the strongest issue Advottic Review flagged.',
                  'Which next step should I do first?',
                  'What do these legal terms mean in plain English?',
                ]
          }
        />
      )}
    </section>
  );
}

/**
 * Swipeable card carousel for the four review sections. Replaces the old
 * nested-tab / one-long-scroll layout (user feedback: "tabs in tabs is
 * messy, and it's too much scrolling"). Each section is a full-width card
 * the user swipes left/right between - native horizontal scroll-snap on
 * touch, plus section pills, a position counter, prev/next arrows, and
 * dots for pointer users. Only one section shows at a time, so vertical
 * scrolling is minimal and there's no tab-inside-a-tab. The card height
 * eases to fit the active section.
 */
function ReviewCarousel({ review }: { review: AIReview }) {
  const slides: { label: string; body: React.ReactNode }[] = [
    { label: 'Overview', body: <Overview review={review} /> },
    { label: 'Facts & issues', body: <Facts review={review} /> },
    { label: 'Evidence & discovery', body: <Evidence review={review} /> },
    { label: 'Next steps', body: <Actions review={review} /> },
  ];
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);

  // Ease the card's height to the visible section so a short section
  // doesn't leave a tall, empty card.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = track.children[active] as HTMLElement | undefined;
      if (el) setHeight(el.offsetHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  function goTo(i: number) {
    const next = Math.max(0, Math.min(slides.length - 1, i));
    const track = trackRef.current;
    if (track) track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    setActive(next);
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track) return;
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    setActive((prev) => (prev === i ? prev : i));
  }

  return (
    <div className="card overflow-hidden">
      {review.isDemo && (
        <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-2.5 text-xs text-amber-900">
          Demo response - set <code className="font-mono">ANTHROPIC_API_KEY</code> in{' '}
          <code className="font-mono">.env.local</code> to enable the full analysis.
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-ink-200 dark:border-forest-700/40 px-3 sm:px-5 py-2">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => goTo(i)}
              aria-current={i === active}
              className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                i === active
                  ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950'
                  : 'bg-ink-50 text-ink-600 hover:text-forest-900 dark:bg-forest-800/60 dark:text-cream-100/70 dark:hover:text-cream-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous section"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-600 hover:bg-ink-100 disabled:opacity-30 dark:text-cream-100/70 dark:hover:bg-forest-800"
          >
            <Chevron dir="left" />
          </button>
          <span className="w-9 text-center text-[11px] tabular-nums text-ink-400 dark:text-cream-100/55">
            {active + 1} / {slides.length}
          </span>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === slides.length - 1}
            aria-label="Next section"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-600 hover:bg-ink-100 disabled:opacity-30 dark:text-cream-100/70 dark:hover:bg-forest-800"
          >
            <Chevron dir="right" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        onScroll={onScroll}
        data-hswipe
        style={height ? { height } : undefined}
        className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth transition-[height] duration-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s) => (
          <section
            key={s.label}
            aria-label={s.label}
            className="w-full shrink-0 self-start snap-start space-y-5 p-6 md:p-7"
          >
            <h3 className="text-[11px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
              {s.label}
            </h3>
            {s.body}
          </section>
        ))}
      </div>

      <div className="flex justify-center gap-1.5 py-3">
        {slides.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to ${s.label}`}
            className={`h-1.5 rounded-full transition-all ${
              i === active
                ? 'w-5 bg-forest-900 dark:bg-gold-metal'
                : 'w-1.5 bg-ink-300 dark:bg-forest-700'
            }`}
          />
        ))}
      </div>

      <div className="border-t border-ink-100 dark:border-forest-700/40 bg-ink-50/50 px-5 py-3 dark:bg-forest-900/40">
        <p className="text-[11px] leading-relaxed text-ink-500 dark:text-cream-100/55">
          {review.disclaimer}
        </p>
      </div>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Overview({ review }: { review: AIReview }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="eyebrow">Classification</span>
          <span className="inline-flex items-center rounded-full bg-ink-950 text-white px-2.5 py-1 text-[11px] font-medium tracking-wide leading-none">
            {shortLabel(review.classification)}
          </span>
        </div>
        <p className="text-[15.5px] leading-relaxed text-ink-900 whitespace-pre-wrap">
          {review.summary}
        </p>
      </div>
      {review.classification && (
        <div className="rounded-lg bg-ink-50 border border-ink-100 px-4 py-3 text-sm text-ink-700 leading-relaxed">
          {review.classification}
        </div>
      )}
    </div>
  );
}

function Facts({ review }: { review: AIReview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Timeline" items={review.timeline} />
      <Panel title="Key facts" items={review.keyFacts} />
      <Panel title="Possible legal issues" items={review.possibleIssues} />
      <Panel
        title="Applicable doctrines"
        subtitle="Attorney to verify against current statutes"
        items={review.applicableLegalReferences}
      />
    </div>
  );
}

function Evidence({ review }: { review: AIReview }) {
  const hasEvidence = (review.evidenceToStrengthen ?? []).length > 0;
  const hasSubpoena = (review.subpoenaTargets ?? []).length > 0;
  const hasMapping = review.evidenceMapping.length > 0;

  if (!hasEvidence && !hasSubpoena && !hasMapping) {
    return <p className="text-sm text-ink-500">No evidence recommendations in this review.</p>;
  }

  return (
    <div className="space-y-6">
      <AccentList
        title="Evidence to strengthen the case"
        items={review.evidenceToStrengthen}
        accent="emerald"
      />
      <AccentList
        title="Possible subpoena / records targets"
        subtitle="Attorney must confirm the appropriate legal process."
        items={review.subpoenaTargets}
        accent="sky"
      />
      <Panel title="Evidence mapping to exhibits" items={review.evidenceMapping} />
    </div>
  );
}

function Actions({ review }: { review: AIReview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Missing information" items={review.missingInformation} />
      <Panel title="Suggested next steps" items={review.suggestedNextSteps} />
      <div className="md:col-span-2">
        <Panel title="Questions to ask an attorney" items={review.questionsForAttorney} />
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: string[] | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-5">
      <div className="mb-3">
        <h3 className="eyebrow">{title}</h3>
        {subtitle && <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>}
      </div>
      <ul className="space-y-2 text-[14px] text-ink-800">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-[9px] h-1 w-1 flex-none rounded-full bg-ink-400"
            />
            <span className="whitespace-pre-wrap leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccentList({
  title,
  subtitle,
  items,
  accent,
}: {
  title: string;
  subtitle?: string;
  items: string[] | undefined;
  accent: 'emerald' | 'sky';
}) {
  if (!items || items.length === 0) return null;
  const styles = {
    emerald: {
      border: 'border-emerald-300/80',
      bg: 'bg-emerald-50/40',
      bar: 'bg-emerald-400',
    },
    sky: {
      border: 'border-sky-300/80',
      bg: 'bg-sky-50/40',
      bar: 'bg-sky-400',
    },
  }[accent];
  return (
    <div>
      <div className="mb-2.5">
        <h4 className="text-[13px] font-semibold tracking-tight text-ink-950">{title}</h4>
        {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      <ul
        className={`rounded-lg border ${styles.border} ${styles.bg} divide-y divide-ink-100/70 overflow-hidden`}
      >
        {items.map((item, i) => (
          <li key={i} className="relative px-4 py-3 text-[14px] text-ink-800 leading-relaxed">
            <span
              aria-hidden
              className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${styles.bar}`}
            />
            <span className="whitespace-pre-wrap block pl-1.5">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortLabel(c: string): string {
  const cleaned = c.replace(/\s+/g, ' ').trim();
  const first = cleaned.split(/[-:;.]/, 1)[0].trim();
  return first.length > 56 ? first.slice(0, 53) + '…' : first;
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 15l.7 1.9L21.6 18l-1.9.6L19 21l-.7-2.4L16.4 18l1.9-.7L19 15z"
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}
