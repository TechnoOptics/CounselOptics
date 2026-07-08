'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { CaseMap, type MapPoint } from '@/app/cases/[id]/timeline/case-map';
import {
  formatOccurred,
  KIND_ICON,
  KIND_LABEL,
  type TimelineBundle,
  type TimelineEvent,
} from '@/lib/timeline-types';
import { getFirmEvidenceMediaUrl } from '@/lib/case-evidence-actions';
import { generateFirmTimelineNarrative } from '@/lib/firm-timeline-actions';
import { FirmTimelineCalendar, type PeriodRange } from './firm-timeline-calendar';
import { CollabProvider } from './collab-context';
import { SectionComments } from './section-comments';
import { CaseChatPanel } from './case-chat-panel';
import type { AuthorCard, CaseParticipant, ChatMessage, SectionComment } from '@/lib/case-collab-types';

/**
 * Firm-native Case Timeline. Distinct from the evidence intake (which is where
 * a firm ADDS + analyses evidence): this is the read + assemble surface - a
 * dated chronology, the case map, and the generated narrative document a firm
 * can attach to a filing. Renders inside the counsel shell (no consumer consent
 * gate) and reads/writes through the firm admin-path actions so ANY firm member
 * can use it. Adding/editing individual items stays on the evidence route.
 */
export function FirmTimeline({
  firmId,
  caseId,
  initialBundle,
  aiEnabled,
  collab,
}: {
  firmId: string;
  caseId: string;
  initialBundle: TimelineBundle;
  aiEnabled: boolean;
  collab: {
    currentUserId: string;
    participants: CaseParticipant[];
    comments: SectionComment[];
    authors: AuthorCard[];
    generalChat: ChatMessage[];
  };
}) {
  const t = useT();
  const [events] = useState<TimelineEvent[]>(initialBundle.events);
  const [narrative, setNarrative] = useState(initialBundle.narrative);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Timeline (list) vs. Calendar (density grid). The calendar can set a
  // period filter that scopes the chronology, and the filter survives a
  // switch back to the list so the user "drills into" the chronology.
  const [view, setView] = useState<'timeline' | 'calendar'>('timeline');
  const [range, setRange] = useState<PeriodRange | null>(null);

  // Chronological order: dated events first (ascending), undated last.
  const ordered = useMemo(() => {
    const withDate = events.filter((e) => e.occurredAt);
    const undated = events.filter((e) => !e.occurredAt);
    withDate.sort((a, b) => (a.occurredAt! < b.occurredAt! ? -1 : 1));
    return [...withDate, ...undated];
  }, [events]);

  // When a calendar period is selected, scope the chronology to it. Undated
  // events drop out of a period filter (they have no place on the calendar).
  const visible = useMemo(() => {
    if (!range) return ordered;
    const lo = new Date(range.start).getTime();
    const hi = new Date(range.end).getTime();
    return ordered.filter((e) => {
      if (!e.occurredAt) return false;
      const ms = new Date(e.occurredAt).getTime();
      return !Number.isNaN(ms) && ms >= lo && ms < hi;
    });
  }, [ordered, range]);

  const mapPoints: MapPoint[] = useMemo(
    () =>
      events.flatMap((e) =>
        (e.aiExtracted.geo_points ?? []).map((p) => ({
          ...p,
          time: e.occurredAt,
          when: formatOccurred(e.occurredAt, e.occurredPrecision),
          people: (e.aiExtracted.detected_people ?? []).slice(0, 6),
          title: e.title || KIND_LABEL[e.kind],
          relevance: e.aiExtracted.relevance_score,
        })),
      ),
    [events],
  );

  const openMedia = useCallback(
    async (path: string) => {
      setError(null);
      const res = await getFirmEvidenceMediaUrl(firmId, caseId, path);
      if (!res.ok || !res.url) {
        setError(res.error ?? t('Could not open the file.'));
        return;
      }
      if (isNativeApp()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: res.url });
      } else {
        window.open(res.url, '_blank', 'noopener');
      }
    },
    [firmId, caseId, t],
  );

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generateFirmTimelineNarrative(firmId, caseId);
      if (!res.ok) {
        setError(res.error ?? t('Could not generate the narrative.'));
        return;
      }
      // Reflect the new narrative without a full reload.
      const { getFirmTimelineBundle } = await import('@/lib/firm-timeline-actions');
      const bundle = await getFirmTimelineBundle(firmId, caseId);
      setNarrative(bundle.narrative);
    });
  };

  return (
    <CollabProvider
      firmId={firmId}
      caseId={caseId}
      currentUserId={collab.currentUserId}
      participants={collab.participants}
      initialComments={collab.comments}
      initialAuthors={collab.authors}
    >
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 space-y-6">
      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          <T>Chronology</T>{' '}
          <span className="text-ink-400 dark:text-cream-100/40">({events.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 overflow-hidden" role="group" aria-label={t('View')}>
            <button
              type="button"
              onClick={() => setView('timeline')}
              aria-pressed={view === 'timeline'}
              className={
                (view === 'timeline'
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100 '
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                'px-3 py-1.5 text-[12.5px] transition-colors'
              }
            >
              <T>Timeline</T>
            </button>
            <button
              type="button"
              onClick={() => setView('calendar')}
              aria-pressed={view === 'calendar'}
              className={
                (view === 'calendar'
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100 '
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                'px-3 py-1.5 text-[12.5px] transition-colors'
              }
            >
              <T>Calendar</T>
            </button>
          </div>
          <Link
            href={`/counsel/cases/${caseId}/evidence`}
            className="text-[12.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <T>Add / manage evidence</T>
          </Link>
          <Link
            href={`/cases/${caseId}/export`}
            className="text-[12.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <T>Export</T>
          </Link>
          {aiEnabled && (
            <button
              type="button"
              onClick={generate}
              disabled={pending || events.length === 0}
              className="btn-primary text-[12.5px] disabled:opacity-50"
            >
              {pending ? <T>Generating…</T> : narrative ? <T>Regenerate narrative</T> : <T>Generate narrative</T>}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[13px] text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      {/* Narrative document */}
      {narrative && (narrative.summary || narrative.narrative) && (
        <section className="card p-5 space-y-3">
          <p className="eyebrow text-[10px]"><T>Advottic narrative</T></p>
          {narrative.summary && (
            <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 whitespace-pre-wrap" data-no-translate>
              {narrative.summary}
            </p>
          )}
          {narrative.narrative && (
            <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap" data-no-translate>
              {narrative.narrative}
            </p>
          )}
          {narrative.conclusion && (
            <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed whitespace-pre-wrap border-t border-ink-100 dark:border-forest-700/40 pt-3" data-no-translate>
              {narrative.conclusion}
            </p>
          )}
        </section>
      )}

      {/* Calendar (density grid) */}
      {view === 'calendar' && (
        <FirmTimelineCalendar events={events} activeRange={range} onSelect={setRange} />
      )}

      {/* Map */}
      <CaseMap points={mapPoints} title={t('Case map')} />

      {/* Active period filter */}
      {range && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-forest-900/5 dark:bg-cream-100/5 ring-1 ring-ink-100 dark:ring-forest-700/40 px-3 py-2">
          <span className="text-[12px] text-ink-600 dark:text-cream-100/70">
            <T>Showing</T>{' '}
            <span className="font-medium text-forest-900 dark:text-cream-100" data-no-translate>{range.label}</span>{' '}
            <span className="text-ink-400 dark:text-cream-100/45">({visible.length})</span>
          </span>
          <button
            type="button"
            onClick={() => setRange(null)}
            className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-0.5 text-ink-700 dark:text-cream-100/80 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <T>Clear filter</T>
          </button>
          <div className="w-full">
            <SectionComments sectionType="calendar" targetRef={range.refKey} label={t('Notes on {period}').replace('{period}', range.label)} />
          </div>
        </div>
      )}

      {/* Chronology */}
      {visible.length === 0 ? (
        range ? (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            <T>No events in this period.</T>{' '}
            <button type="button" onClick={() => setRange(null)} className="underline">
              <T>Clear filter</T>
            </button>
          </p>
        ) : (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            <T>No evidence yet.</T>{' '}
            <Link href={`/counsel/cases/${caseId}/evidence`} className="underline">
              <T>Add evidence</T>
            </Link>{' '}
            <T>to build the timeline.</T>
          </p>
        )
      ) : (
        <ol className="space-y-2">
          {visible.map((e) => (
            <li key={e.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex flex-wrap items-center gap-1.5">
                    <span>{KIND_ICON[e.kind]}</span>
                    <span className="break-words" data-no-translate>{e.title || t('(untitled)')}</span>
                    <RelevanceBadge score={e.aiExtracted.relevance_score} reason={e.aiExtracted.relevance_reason} size="xs" />
                  </p>
                  <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5" data-no-translate>
                    {formatOccurred(e.occurredAt, e.occurredPrecision)}
                    {e.sourceLabel ? ` · ${e.sourceLabel}` : ''}
                  </p>
                  {e.aiSummary && (
                    <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1 whitespace-pre-wrap" data-no-translate>
                      {e.aiSummary}
                    </p>
                  )}
                </div>
                {e.media[0] && (
                  <button
                    type="button"
                    onClick={() => openMedia(e.media[0].path)}
                    className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[12px] hover:bg-cream-50 dark:hover:bg-forest-800/30 shrink-0"
                  >
                    <T>Open</T>
                  </button>
                )}
              </div>
              <SectionComments sectionType="event" targetRef={e.id} />
            </li>
          ))}
        </ol>
      )}
    </div>
    {/* Chat + presence dock (desktop). */}
    <aside className="hidden lg:block w-80 flex-none sticky top-24 self-start">
      <CaseChatPanel initialGeneralChat={collab.generalChat} />
    </aside>
    </div>
    </CollabProvider>
  );
}
