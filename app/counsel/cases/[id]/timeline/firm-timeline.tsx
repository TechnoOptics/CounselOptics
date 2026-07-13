'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { EvidencePreview } from '@/components/EvidencePreview';
import { KindIcon } from '@/components/counsel/KindIcon';
import { ExpandableText } from '@/components/ExpandableText';
import { CaseMap, type MapPoint } from '@/app/cases/[id]/timeline/case-map';
import {
  formatOccurred,
  KIND_LABEL,
  relevanceBand,
  type TimelineBundle,
  type TimelineEvent,
} from '@/lib/timeline-types';
import { generateFirmTimelineNarrative } from '@/lib/firm-timeline-actions';
import { EvidenceViewer } from '@/app/counsel/cases/[id]/evidence/evidence-viewer';
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
/**
 * Bucket an event's date into a "YYYY-MM" section key + a human month label.
 * Events with no (or an unparseable) date land in a single trailing "Undated"
 * section. The label is locale-formatted; the undated flag lets the caller show
 * a translated word instead of a date string.
 */
function monthKeyLabel(occurredAt: string | null): { key: string; label: string; undated: boolean } {
  if (!occurredAt) return { key: '~undated', label: '', undated: true };
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return { key: '~undated', label: '', undated: true };
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  return { key, label, undated: false };
}

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
  const [allEvents] = useState<TimelineEvent[]>(initialBundle.events);
  // The timeline, map, and analytics surface only items USEFUL to the case
  // (relevance band medium/high, plus unscored); low-relevance uploads stay in
  // the evidence database (intake) but do not clutter the chronology. Toggle to
  // reveal everything when needed.
  const [relevantOnly, setRelevantOnly] = useState(true);
  const lowCount = useMemo(
    () => allEvents.filter((e) => relevanceBand(e.aiExtracted?.relevance_score) === 'low').length,
    [allEvents],
  );
  const events = useMemo(
    () => (relevantOnly ? allEvents.filter((e) => relevanceBand(e.aiExtracted?.relevance_score) !== 'low') : allEvents),
    [allEvents, relevantOnly],
  );
  const [narrative, setNarrative] = useState(initialBundle.narrative);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Timeline (list) vs. Calendar (density grid). The calendar can set a
  // period filter that scopes the chronology, and the filter survives a
  // switch back to the list so the user "drills into" the chronology.
  const [view, setView] = useState<'timeline' | 'calendar'>('timeline');
  const [range, setRange] = useState<PeriodRange | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // In-window viewer: an index into the currently visible chronology, so PREV /
  // NEXT step through exactly the list on screen (never a new browser tab).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

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

  // Group the visible chronology into month sections that collapse/expand, so a
  // long timeline stays scannable - a header per period with a count, the events
  // tucked under it. Order is preserved (visible is already sorted); undated
  // items fall into their own trailing section.
  const periodGroups = useMemo(() => {
    const groups: { key: string; label: string; undated: boolean; items: TimelineEvent[] }[] = [];
    const byKey = new Map<string, number>();
    for (const e of visible) {
      const p = monthKeyLabel(e.occurredAt);
      let gi = byKey.get(p.key);
      if (gi === undefined) {
        gi = groups.length;
        byKey.set(p.key, gi);
        groups.push({ key: p.key, label: p.label, undated: p.undated, items: [] });
      }
      groups[gi].items.push(e);
    }
    return groups;
  }, [visible]);

  // Collapsed period keys. Empty = every section open (the default).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);
  const allCollapsed = periodGroups.length > 0 && collapsedGroups.size >= periodGroups.length;
  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups((prev) =>
      prev.size >= periodGroups.length ? new Set() : new Set(periodGroups.map((g) => g.key)),
    );
  }, [periodGroups]);

  // Open an item in the in-window viewer, positioned within the visible list so
  // the arrows navigate the on-screen chronology.
  const openItem = useCallback(
    (id: string) => {
      const i = visible.findIndex((e) => e.id === id);
      if (i >= 0) setViewerIndex(i);
    },
    [visible],
  );
  const viewerEvent = viewerIndex != null ? visible[viewerIndex] : undefined;
  // If the visible list shifts under an open viewer (e.g. a period filter
  // changes), keep the index in range.
  useEffect(() => {
    if (viewerIndex != null && viewerIndex >= visible.length) {
      setViewerIndex(visible.length ? visible.length - 1 : null);
    }
  }, [visible.length, viewerIndex]);

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
          {lowCount > 0 && (
            <button
              type="button"
              onClick={() => setRelevantOnly((v) => !v)}
              aria-pressed={relevantOnly}
              title={t('Hide low-relevance uploads from the timeline, map, and analytics. The full corpus stays in Add / manage evidence.')}
              className={
                (relevantOnly
                  ? 'bg-gold-metal/15 text-gold-700 dark:text-gold-300 ring-gold-metal/40 '
                  : 'text-ink-600 dark:text-cream-100/70 ring-ink-200 dark:ring-forest-700/40 ') +
                'inline-flex items-center gap-1.5 rounded-md ring-1 px-3 py-1.5 text-[12.5px] transition-colors'
              }
            >
              {relevantOnly ? <T>Relevant only</T> : <T>All uploads</T>}
              <span className="text-[11px] opacity-70" data-no-translate>
                {relevantOnly ? `(${lowCount} hidden)` : ''}
              </span>
            </button>
          )}
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
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={events.length === 0}
            className="text-[12.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40 disabled:opacity-50"
          >
            <T>Export</T>
          </button>
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
            <ExpandableText
              text={narrative.narrative}
              clampChars={600}
              className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap"
            />
          )}
          {narrative.conclusion && (
            <div className="border-t border-ink-100 dark:border-forest-700/40 pt-3">
              <ExpandableText
                text={narrative.conclusion}
                clampChars={400}
                className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed whitespace-pre-wrap"
              />
            </div>
          )}
        </section>
      )}

      {/* Calendar (density grid) */}
      {view === 'calendar' && (
        <FirmTimelineCalendar
          events={events}
          activeRange={range}
          onSelect={setRange}
          firmId={firmId}
          caseId={caseId}
          onOpenItem={openItem}
        />
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
        <div className="space-y-3">
          {periodGroups.length > 1 && (
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={toggleAllGroups}
                className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-0.5 text-ink-700 dark:text-cream-100/80 hover:bg-cream-50 dark:hover:bg-forest-800/40"
              >
                {allCollapsed ? <T>Expand all</T> : <T>Collapse all</T>}
              </button>
            </div>
          )}
          {periodGroups.map((g) => {
            const groupCollapsed = collapsedGroups.has(g.key);
            return (
              <section key={g.key} className="rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={!groupCollapsed}
                  className="flex w-full items-center gap-2 bg-cream-50/70 px-3 py-2 text-left hover:bg-cream-100/70 dark:bg-forest-900/40 dark:hover:bg-forest-800/40"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className={`shrink-0 text-ink-400 transition-transform dark:text-cream-100/50 ${groupCollapsed ? '' : 'rotate-90'}`}
                  >
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span
                    className="text-[12.5px] font-semibold text-forest-900 dark:text-cream-100"
                    data-no-translate={!g.undated ? '' : undefined}
                  >
                    {g.undated ? t('Undated') : g.label}
                  </span>
                  <span className="ml-auto text-[11px] text-ink-400 dark:text-cream-100/45">{g.items.length}</span>
                </button>
                {!groupCollapsed && (
                  <ol className="space-y-2 p-2">
                    {g.items.map((e) => {
            const ext = e.aiExtracted ?? {};
            const facts = [
              ...(ext.detected_people ?? []).slice(0, 4),
              ...(ext.organizations ?? []).slice(0, 3),
              ...(ext.locations ?? []).slice(0, 3),
            ];
            return (
              <li key={e.id} className="card p-3">
                <div className="flex gap-3">
                  {e.media[0] && (
                    <button
                      type="button"
                      onClick={() => openItem(e.id)}
                      className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-forest-800/40 sm:h-28 sm:w-28"
                      aria-label={t('Open')}
                    >
                      <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-full w-full" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex flex-wrap items-center gap-1.5">
                          <KindIcon kind={e.kind} className="h-4 w-4 shrink-0 text-gold-600 dark:text-gold-400/90" />
                          <span className="break-words" data-no-translate>{e.title || t('(untitled)')}</span>
                          <RelevanceBadge score={e.aiExtracted.relevance_score} reason={e.aiExtracted.relevance_reason} size="xs" />
                        </p>
                        <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5" data-no-translate>
                          {formatOccurred(e.occurredAt, e.occurredPrecision)}
                          {e.sourceLabel ? ` · ${e.sourceLabel}` : ''}
                        </p>
                      </div>
                      {e.media[0] && (
                        <button
                          type="button"
                          onClick={() => openItem(e.id)}
                          className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[12px] hover:bg-cream-50 dark:hover:bg-forest-800/30 shrink-0"
                        >
                          <T>Open</T>
                        </button>
                      )}
                    </div>
                    {e.aiSummary && (
                      <ExpandableText
                        text={e.aiSummary}
                        clampChars={240}
                        className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1 whitespace-pre-wrap"
                      />
                    )}
                    {facts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1" data-no-translate>
                        {facts.map((f, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded-full bg-cream-100/80 px-2 py-[1px] text-[10.5px] text-ink-700 dark:bg-forest-800/50 dark:text-cream-100/80"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <SectionComments sectionType="event" targetRef={e.id} />
              </li>
            );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
    {/* Chat + presence dock (desktop). */}
    <aside className="hidden lg:block w-80 flex-none sticky top-24 self-start">
      <CaseChatPanel initialGeneralChat={collab.generalChat} />
    </aside>
    </div>
    {exportOpen && (
      <ExportDialog caseId={caseId} events={ordered} onClose={() => setExportOpen(false)} />
    )}
    {viewerEvent && (
      <EvidenceViewer
        firmId={firmId}
        caseId={caseId}
        event={viewerEvent}
        index={viewerIndex as number}
        total={visible.length}
        hasPrev={(viewerIndex as number) > 0}
        hasNext={(viewerIndex as number) < visible.length - 1}
        onPrev={() => setViewerIndex((i) => (i != null && i > 0 ? i - 1 : i))}
        onNext={() => setViewerIndex((i) => (i != null && i < visible.length - 1 ? i + 1 : i))}
        onClose={() => setViewerIndex(null)}
      />
    )}
    </CollabProvider>
  );
}

/**
 * Firm-native export by selection. Lists the matter's evidence with checkboxes
 * (all selected by default), lets the user exclude items so the final file is
 * lean, then downloads a court-ready timeline exhibit built from ONLY the
 * selected items via the firm export route (which reads through the firm admin
 * path, fixing the empty-pages bug the consumer export produced for firm cases).
 */
function ExportDialog({
  caseId,
  events,
  onClose,
}: {
  caseId: string;
  events: TimelineEvent[];
  onClose: () => void;
}) {
  const t = useT();
  // Sensible default: the whole matter is selected; the user unchecks to trim.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(events.map((e) => e.id)));
  const [building, setBuilding] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(events.map((e) => e.id)));
  const selectNone = () => setSelected(new Set());

  const download = async () => {
    if (selected.size === 0) return;
    setBuilding(true);
    const ids = events.filter((e) => selected.has(e.id)).map((e) => e.id).join(',');
    const url = `/counsel/cases/${caseId}/export?ids=${encodeURIComponent(ids)}`;
    try {
      if (isNativeApp()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url, toolbarColor: '#0b0b0d' });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } finally {
      setBuilding(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('Export evidence')}
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-100 dark:border-forest-700/40 px-5 py-4">
          <p className="eyebrow text-[10px]"><T>Export</T></p>
          <h3 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            <T>Build a court-ready file</T>
          </h3>
          <p className="mt-1 text-[12.5px] text-ink-600 dark:text-cream-100/70">
            <T>Pick the evidence to include. Each item is embedded with its date and context. Uncheck anything you want to leave out.</T>
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-ink-100 dark:border-forest-700/40 px-5 py-2">
          <span className="text-[12px] text-ink-600 dark:text-cream-100/70">
            {selected.size} <T>of</T> {events.length} <T>selected</T>
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={selectAll} className="text-[12px] text-forest-700 dark:text-gold-300 hover:underline">
              <T>Select all</T>
            </button>
            <button type="button" onClick={selectNone} className="text-[12px] text-forest-700 dark:text-gold-300 hover:underline">
              <T>Select none</T>
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {events.map((e) => {
            const checked = selected.has(e.id);
            return (
              <li key={e.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-cream-50 dark:hover:bg-forest-800/40">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(e.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-forest-700 dark:accent-gold-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-forest-900 dark:text-cream-100">
                      <KindIcon kind={e.kind} className="h-4 w-4 shrink-0 text-gold-600 dark:text-gold-400/90" />
                      <span className="break-words" data-no-translate>{e.title || t('(untitled)')}</span>
                      <RelevanceBadge score={e.aiExtracted.relevance_score} reason={e.aiExtracted.relevance_reason} size="xs" />
                    </span>
                    <span className="block text-[11px] text-ink-500 dark:text-cream-100/55" data-no-translate>
                      {formatOccurred(e.occurredAt, e.occurredPrecision)}
                      {e.media[0] ? ` · ${e.media.length} ${e.media.length === 1 ? t('file') : t('files')}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 dark:border-forest-700/40 px-5 py-3">
          <button type="button" onClick={onClose} className="btn-ghost text-sm" disabled={building}>
            <T>Cancel</T>
          </button>
          <button
            type="button"
            onClick={download}
            disabled={building || selected.size === 0}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {building ? <T>Preparing…</T> : <T>Download</T>}
          </button>
        </div>
      </div>
    </div>
  );
}
