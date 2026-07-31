'use client';

import { useState, useTransition } from 'react';
import { T } from '@/components/i18n/LocaleProvider';
import {
  generateFirmLegalReviewAction,
  type LegalReview,
  type LegalReviewClaim,
  type VerifiedCase,
} from '@/lib/firm-legal-review-actions';

/**
 * Firm legal-review surface ("prove-the-case" layer). Surfaces the laws /
 * claims implicated by the matter facts + evidence in the matter's state, each
 * with a legal basis, recommended actions, statute references, and case
 * citations that have been VERIFIED against CourtListener (every citation
 * carries its real courtlistener.com link; unverified candidates are dropped
 * server-side and never reach here).
 *
 * AI-gated + graceful: when Advottic analysis is unavailable (no credits), the
 * panel shows a calm "add credits to run" state, never a raw error.
 */

// Keep in sync with lib/ai-errors.ts AI_UNAVAILABLE_MESSAGE (client can't import
// a server-only module). Used only to detect the graceful-degradation case.
const AI_UNAVAILABLE = "Advottic's analysis is temporarily unavailable. Please try again shortly.";

function isUnavailable(msg: string | null): boolean {
  return !!msg && (msg === AI_UNAVAILABLE || /temporarily unavailable|add credits/i.test(msg));
}

export function LegalReviewPanel({
  firmId,
  caseId,
  initial,
}: {
  firmId: string;
  caseId: string;
  initial: LegalReview | null;
}) {
  const [review, setReview] = useState<LegalReview | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await generateFirmLegalReviewAction(firmId, caseId);
      if (res.ok && res.review) setReview(res.review);
      else setError(res.error ?? 'Could not run the legal review.');
    });
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
            <T>Legal review</T>
          </h2>
          <p className="text-sm text-ink-500 mt-0.5 max-w-2xl leading-relaxed">
            {review ? (
              <>
                {review.state ? (
                  <>
                    <T>Generated for</T>{' '}
                    <span data-no-translate>{review.state}</span>
                  </>
                ) : (
                  <T>Jurisdiction not set</T>
                )}
                {' · '}
                <span className="text-emerald-700 dark:text-emerald-400" data-no-translate>
                  {review.verifiedCitationCount}
                </span>{' '}
                <T>citations verified in CourtListener</T>
                {review.droppedCitationCount > 0 && (
                  <>
                    {' · '}
                    <span data-no-translate>{review.droppedCitationCount}</span>{' '}
                    <T>unverified dropped</T>
                  </>
                )}
              </>
            ) : (
              <T>
                Surfaces the laws and claims implicated by the matter facts and
                evidence in the matter&apos;s state, with recommended actions and
                real case law. Every case citation is verified against
                CourtListener before it is shown.
              </T>
            )}
          </p>
        </div>
        <button onClick={run} disabled={pending} className="btn-primary">
          {pending && <Spinner />}
          {pending ? <T>Reviewing…</T> : review ? <T>Re-run legal review</T> : <T>Run legal review</T>}
        </button>
      </header>

      {error && (
        isUnavailable(error) ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <T>Advottic&apos;s analysis is temporarily unavailable right now. Please try again shortly.</T>{' '}
            <T>CourtListener citation checking stays available and runs the moment analysis is back.</T>
          </div>
        ) : (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" data-no-translate>
            {error}
          </p>
        )
      )}

      {!review && !pending && !error && (
        <div className="card-ai p-8 sm:p-10 text-center relative">
          <div
            aria-hidden
            className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-forest-950 ring-1 ring-gold-400/40 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-gold-300"
          >
            <SparkleIcon />
            <T>AI · Legal review</T>
          </div>
          <p className="text-cream-100/85 leading-relaxed max-w-md mx-auto mt-2 mb-5">
            <T>
              Surface the claims implicated by this matter in its state, each
              with recommended actions, statutes, and CourtListener-verified
              case law.
            </T>
          </p>
          <button
            onClick={run}
            disabled={pending}
            className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-5 py-2.5"
          >
            <SparkleIcon />
            <T>Run legal review</T>
          </button>
        </div>
      )}

      {pending && (
        <div className="card-ai p-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 ai-sweep" aria-hidden />
          <p className="relative text-cream-100 font-medium"><T>Reading the matter and checking case law…</T></p>
          <p className="relative text-cream-100/65 text-sm mt-1">
            <T>Verifying every citation against CourtListener.</T>
          </p>
        </div>
      )}

      {review && (
        <div className="space-y-4">
          {review.overview && (
            <div className="card p-5">
              <p className="eyebrow text-[10px] mb-1.5"><T>Overview</T></p>
              <p className="text-[14.5px] leading-relaxed text-ink-900 dark:text-cream-100/90 whitespace-pre-wrap" data-no-translate>
                {review.overview}
              </p>
            </div>
          )}
          {review.claims.length === 0 ? (
            <p className="card p-5 text-sm text-ink-500 italic">
              <T>No claims surfaced. Add matter facts and evidence, then re-run.</T>
            </p>
          ) : (
            review.claims.map((claim, i) => <ClaimCard key={i} claim={claim} index={i} />)
          )}
          <p className="text-[11px] leading-relaxed text-ink-400 dark:text-cream-100/45">
            <T>
              Work product for the firm, not legal advice. Case citations are
              verified to exist in CourtListener; statutes should be confirmed
              against the current code. Attorney review required.
            </T>
          </p>
        </div>
      )}
    </section>
  );
}

function ClaimCard({ claim, index }: { claim: LegalReviewClaim; index: number }) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 grid h-6 w-6 place-items-center rounded-full bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 text-[12px] font-semibold tabular-nums">
          {index + 1}
        </span>
        <h3 className="text-[15.5px] font-semibold text-forest-900 dark:text-cream-100 leading-snug" data-no-translate>
          {claim.title}
        </h3>
      </div>

      {claim.legalBasis && (
        <p className="text-[14px] leading-relaxed text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap" data-no-translate>
          {claim.legalBasis}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <BulletList title="Elements" items={claim.elements} />
        <BulletList title="Recommended actions" items={claim.recommendedActions} />
      </div>

      {claim.statutes.length > 0 && (
        <div>
          <p className="eyebrow text-[10px] mb-2"><T>Statutes</T></p>
          <ul className="space-y-1.5">
            {claim.statutes.map((s, i) => (
              <li key={i} className="text-[13px] text-ink-800 dark:text-cream-100/85">
                <span className="font-medium" data-no-translate>{s.label}</span>
                {s.citation && <span className="font-mono text-ink-500 dark:text-cream-100/55" data-no-translate> · {s.citation}</span>}
                {s.note && <span className="text-ink-400 dark:text-cream-100/45" data-no-translate> ({s.note})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="eyebrow text-[10px] mb-2">
          <T>Case law</T>{' '}
          <span className="text-emerald-700 dark:text-emerald-400 normal-case tracking-normal font-normal">
            <T>· verified in CourtListener</T>
          </span>
        </p>
        {claim.cases.length === 0 ? (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            <T>No case citation could be verified for this claim. Nothing unverified is shown.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {claim.cases.map((c, i) => (
              <CaseRow key={i} c={c} />
            ))}
          </ul>
        )}
        {claim.droppedCaseCount > 0 && (
          <p className="mt-2 text-[11px] text-ink-400 dark:text-cream-100/45">
            <span data-no-translate>{claim.droppedCaseCount}</span>{' '}
            <T>proposed citation(s) could not be verified and were dropped.</T>
          </p>
        )}
      </div>
    </div>
  );
}

function CaseRow({ c }: { c: VerifiedCase }) {
  return (
    <li className="rounded-lg border border-emerald-300/70 dark:border-emerald-500/25 bg-emerald-50/40 dark:bg-emerald-500/5 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[14px] font-semibold text-forest-900 dark:text-cream-100 underline decoration-emerald-400/50 hover:decoration-emerald-500"
          data-no-translate
        >
          {c.caseName}
        </a>
        {c.citation && (
          <span className="font-mono text-[12px] text-ink-500 dark:text-cream-100/55" data-no-translate>
            {c.citation}
          </span>
        )}
        {(c.court || c.dateFiled) && (
          <span className="text-[11.5px] text-ink-400 dark:text-cream-100/45" data-no-translate>
            {[c.court, c.dateFiled ? c.dateFiled.slice(0, 4) : null].filter(Boolean).join(', ')}
          </span>
        )}
      </div>
      {c.relevance && (
        <p className="mt-1 text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed" data-no-translate>
          {c.relevance}
        </p>
      )}
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
      >
        <T>View on CourtListener</T>
        <span aria-hidden>↗</span>
      </a>
    </li>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="eyebrow text-[10px] mb-2"><T>{title}</T></p>
      <ul className="space-y-1.5 text-[13.5px] text-ink-800 dark:text-cream-100/85">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[8px] h-1 w-1 flex-none rounded-full bg-ink-400" />
            <span className="whitespace-pre-wrap leading-relaxed" data-no-translate>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin text-current" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="currentColor" />
    </svg>
  );
}
