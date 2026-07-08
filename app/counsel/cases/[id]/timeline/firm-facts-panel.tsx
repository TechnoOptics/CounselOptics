'use client';

import { useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { ExpandableText } from '@/components/ExpandableText';
import { EditMatterForm, type EditMatterInitial } from '../edit-matter-form';
import type { CaseFacts } from '@/app/cases/[id]/timeline/facts-panel';

/**
 * Firm-native "Facts of the case" for the timeline. Same content as the shared
 * consumer FactsPanel, but built for the firm builder surface:
 *   - COLLAPSED to just its heading by default, so the timeline leads with the
 *     chronology rather than a tall block of matter metadata. Click to expand.
 *   - INLINE EDITABLE: fixing a typo or correcting a name happens right here,
 *     reusing the matter-page edit action (updateFirmCaseAction) via
 *     EditMatterForm, so a firm member never has to leave the timeline.
 *
 * The consumer FactsPanel stays untouched (it is read-only and always open).
 */

function pretty(v: string | null | undefined): string | null {
  if (!v) return null;
  return v
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function FirmFactsPanel({
  facts,
  firmId,
  caseId,
  editInitial,
}: {
  facts: CaseFacts;
  firmId: string;
  caseId: string;
  editInitial: EditMatterInitial;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const hearing = facts.hearingAt
    ? [fmtDate(facts.hearingAt), facts.hearingLocation].filter(Boolean).join(' · ')
    : facts.hearingLocation || t('None scheduled');

  const rows: Array<[string, string | null]> = [
    ['Subject', facts.subjectName],
    ['Subject type', pretty(facts.subjectType)],
    ['Jurisdiction', pretty(facts.jurisdiction)],
    ['Case type', pretty(facts.caseType)],
    ['Posture', pretty(facts.posture)],
    ['Status', pretty(facts.status)],
    ['Next hearing', hearing],
    ['Opened', fmtDate(facts.createdAt)],
  ];
  const shown = rows.filter(([, v]) => Boolean(v));

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-forest-900/10 bg-white shadow-card dark:border-cream-50/10 dark:bg-forest-900/50">
      {/* Heading row — always visible, toggles the body. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-b border-transparent px-5 py-3 text-left transition-colors hover:bg-forest-900/[0.02] dark:hover:bg-cream-50/[0.03] data-[open=true]:border-forest-900/10 dark:data-[open=true]:border-cream-50/10"
        data-open={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-500">
            <T>Facts of the case</T>
          </span>
          <span className="mt-0.5 block truncate font-display text-lg font-semibold text-forest-900 dark:text-cream-50" data-no-translate>
            {facts.title}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-400 dark:text-cream-300/50">
          {open ? <T>Hide</T> : <T>Details</T>}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={'shrink-0 text-ink-400 transition-transform dark:text-cream-300/50 ' + (open ? 'rotate-180' : '')}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">
                  <T>{label}</T>
                </dt>
                <dd className="mt-0.5 truncate text-sm font-medium text-forest-900 dark:text-cream-100" title={value ?? undefined} data-no-translate>
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {facts.description && (
            <div className="border-t border-forest-900/10 px-5 py-4 dark:border-cream-50/10">
              <ExpandableText
                text={facts.description}
                className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-cream-200/90"
              />
            </div>
          )}

          {/* Inline edit — fix a typo or a name without leaving the timeline. */}
          <div className="border-t border-forest-900/10 px-5 py-3 dark:border-cream-50/10">
            <EditMatterForm firmId={firmId} caseId={caseId} initial={editInitial} />
          </div>
        </>
      )}
    </section>
  );
}
