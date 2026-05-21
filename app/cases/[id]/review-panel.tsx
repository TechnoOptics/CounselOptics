'use client';

import { useState, useTransition } from 'react';
import { runReviewAction } from '@/lib/actions';
import type { AIReview } from '@/lib/types';
import { BellaPrompt } from '@/components/BellaPrompt';
import { CallALawyerCallout } from '@/components/CallALawyerCallout';

// Section anchors used by the in-page nav chip strip so the user
// can jump down to any review section without scrolling past the
// other three. These replace the old 4-tab "tabs inside the
// Review tab" pattern (user complaint: "tabs that have tabs felt
// like a maze").
//
// Order matters: "Next steps" leads because that's the section
// the user actually came here to read. Overview / Facts / Evidence
// follow as supporting context. Earlier we put Overview first
// (the AI's framing), which buried the actionable bullets behind
// three sections of preamble.
const SECTIONS: { id: string; label: string }[] = [
  { id: 'review-actions', label: 'Next steps' },
  { id: 'review-overview', label: 'Overview' },
  { id: 'review-facts', label: 'Facts & issues' },
  { id: 'review-evidence', label: 'Evidence & discovery' },
];

export function ReviewPanel({
  caseId,
  review,
}: {
  caseId: string;
  review: AIReview | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
          <h2 className="text-xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">Advottic Review</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {review ? (
              <>
                Last reviewed {formatRelative(review.createdAt)} ·{' '}
                <span className="font-mono text-[11px] text-ink-400">{review.modelUsed}</span>
                {' · '}
                <span className="text-emerald-700 dark:text-emerald-400">No training</span>
              </>
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
            AI · Advottic Review
          </div>
          <p className="text-cream-100/85 leading-relaxed max-w-md mx-auto mt-2 mb-5">
            Generate a structured, jurisdiction-aware issue-spotting summary
            grounded in your case description and exhibits.
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
                Run Advottic Review
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
            Advottic Review is composing the review.
          </p>
        </div>
      )}

      {review && (
        <div className="card overflow-hidden">
          {review.isDemo && (
            <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-2.5 text-xs text-amber-900">
              Demo response - set <code className="font-mono">ANTHROPIC_API_KEY</code> in{' '}
              <code className="font-mono">.env.local</code> to enable the full analysis.
            </div>
          )}

          {/* In-page section nav. Anchor chips, not tabs - clicking
              one scrolls the matching section into view rather than
              hiding the others. The whole review reads as one
              scrollable document. */}
          <SectionNav />

          <div className="p-6 md:p-7 space-y-10">
            <SectionHeading id="review-actions" label="Next steps" />
            <Actions review={review} />

            <SectionHeading id="review-overview" label="Overview" />
            <Overview review={review} />

            <SectionHeading id="review-facts" label="Facts & issues" />
            <Facts review={review} />

            <SectionHeading id="review-evidence" label="Evidence & discovery" />
            <Evidence review={review} />
          </div>

          <div className="border-t border-ink-100 px-5 py-3 bg-ink-50/50">
            <p className="text-[11px] leading-relaxed text-ink-500">{review.disclaimer}</p>
          </div>
        </div>
      )}

      {/* Once the review is done, plant a quiet "this is a good
          moment to loop in counsel" callout. The review just gave
          the user a real-looking output - the right next breath is
          to remind them this is a preparation tool, and a real
          attorney is who acts on it. */}
      {review && (
        <CallALawyerCallout
          reason={{
            title: 'A good time to bring in a licensed attorney',
            body:
              "Advottic Review surfaces issues and gaps - it does not decide them. Bring this packet to an attorney for advice on which issue to lead with, what to file, and whether the proposed next steps fit your jurisdiction.",
          }}
          ctaLabel="Find counsel near you"
        />
      )}

      {review && (
        <BellaPrompt
          title="Talk to Bella about this review"
          subtitle="Ask follow-up questions in plain English. She has the case and exhibits as context."
          prompts={[
            'Explain the strongest issue Advottic Review flagged.',
            'Which next step should I do first?',
            'What do these legal terms mean in plain English?',
          ]}
        />
      )}
    </section>
  );
}

/**
 * Sticky chip-strip that lets the user jump to any review section
 * via anchor scroll. Replaces the previous inner tab strip - now
 * the four sections render in one long scroll, and this chip row
 * is the discovery + jump surface.
 *
 * Sticks just under the case-page top tabs so it remains visible
 * while the user scrolls through long reviews. Smooth scroll is
 * the default browser behavior via `scrollIntoView` - no animation
 * code needed.
 */
function SectionNav() {
  return (
    <nav
      aria-label="Jump to review section"
      className="sticky top-0 z-10 bg-white/95 dark:bg-forest-900/95 backdrop-blur border-b border-ink-200 dark:border-forest-700/40 px-3 sm:px-5 py-2 flex flex-wrap gap-2"
    >
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-medium text-ink-700 dark:text-cream-100/75 bg-ink-50 dark:bg-forest-800/60 hover:bg-gold-100 hover:text-gold-900 dark:hover:bg-gold-900/30 dark:hover:text-gold-200 transition-colors"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Section heading + anchor target. The heading reads at h3 size so
 * the visual hierarchy is "Advottic Review" h2 -> "Overview" h3 ->
 * each Panel inside is h3/h4 from the existing components.
 *
 * scroll-mt offsets the sticky chip row's height so the heading
 * doesn't get hidden under it when the anchor link jumps.
 */
function SectionHeading({ id, label }: { id: string; label: string }) {
  return (
    <h3
      id={id}
      className="text-[11px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300 scroll-mt-20"
    >
      {label}
    </h3>
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
