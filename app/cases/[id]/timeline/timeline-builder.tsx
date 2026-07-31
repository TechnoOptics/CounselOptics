'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { MicButton } from './dictation';
import { MediaLightbox } from './media-lightbox';
import { CaseMap, type MapPoint } from './case-map';
import { SmartDatePicker } from './smart-date-picker';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import {
  createTimelineEvent,
  analyzeTimelineEvent,
  updateTimelineEvent,
  deleteTimelineEvent,
  addPerson,
  deletePerson,
  getTimelineMediaUrl,
  generateTimelineNarrative,
} from '@/lib/timeline-actions';
import {
  formatOccurred,
  sortTimeline,
  KIND_ICON,
  KIND_LABEL,
  ROLE_LABEL,
  type TimelineBundle,
  type TimelineEvent,
  type TimelineMedia,
  type CasePerson,
  type TimelineKind,
  type OccurredPrecision,
  type PersonRole,
} from '@/lib/timeline-types';

// Small type/label helpers for the attachment chips.
function mediaIcon(m: TimelineMedia): string {
  if (/^image\//.test(m.mime)) return '🖼️';
  if (/^audio\//.test(m.mime)) return '🎙️';
  if (/^video\//.test(m.mime)) return '🎬';
  if (m.mime === 'application/pdf' || /\.pdf$/i.test(m.name)) return '📄';
  return '📎';
}

// ── Small hook: lazily resolve a short-lived signed URL for a media path ──
const urlCache = new Map<string, string>();
function useSignedUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(path ? urlCache.get(path) ?? null : null);
  useEffect(() => {
    let active = true;
    if (!path) return;
    if (urlCache.has(path)) { setUrl(urlCache.get(path)!); return; }
    getTimelineMediaUrl(path).then((u) => {
      if (!active || !u) return;
      urlCache.set(path, u);
      setUrl(u);
    });
    return () => { active = false; };
  }, [path]);
  return url;
}

const KINDS: TimelineKind[] = ['photo', 'document', 'receipt', 'audio', 'video', 'message', 'note', 'event'];
const ROLES: PersonRole[] = ['subject', 'witness', 'opposing', 'support', 'other'];

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/** Parse a loosely-formatted date string ("March 2023", "2023-03-14") to ISO, or null. */
function parseLoose(s: string): string | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function TimelineBuilder({
  caseId,
  caseTitle,
  subjectName,
  initialBundle,
  aiEnabled,
}: {
  caseId: string;
  caseTitle: string;
  subjectName: string | null;
  initialBundle: TimelineBundle;
  aiEnabled: boolean;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialBundle.events);
  const [people, setPeople] = useState<CasePerson[]>(initialBundle.people);
  const [narrative, setNarrative] = useState(initialBundle.narrative);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const fileRef = useRef<HTMLInputElement>(null);

  const upsertEvent = useCallback((ev: TimelineEvent) => {
    setEvents((prev) => sortTimeline([...prev.filter((e) => e.id !== ev.id), ev]));
  }, []);

  const runAnalysis = useCallback(async (id: string) => {
    setAnalyzing((s) => new Set(s).add(id));
    try {
      const res = await analyzeTimelineEvent(id);
      if (res.event) upsertEvent(res.event);
    } finally {
      setAnalyzing((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [upsertEvent]);

  // Drop a pile of evidence → one event per file, each auto-analysed by Bella.
  // `occurredAt` (a YYYY-MM-DD string) pre-dates the entries, and is used when files
  // are dropped onto a specific day in the calendar view.
  const ingestFiles = useCallback(async (files: File[], occurredAt?: string) => {
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('files', file);
        if (occurredAt) { fd.append('occurredAt', occurredAt); fd.append('occurredPrecision', 'day'); }
        const res = await createTimelineEvent(caseId, fd);
        if (!res.ok || !res.event) { setError(res.error ?? 'Upload failed.'); continue; }
        upsertEvent(res.event);
        if (aiEnabled && res.event.aiStatus === 'pending') void runAnalysis(res.event.id);
      }
    } finally {
      setBusy(false);
    }
  }, [caseId, aiEnabled, upsertEvent, runAnalysis]);

  const onCreated = useCallback((ev: TimelineEvent) => {
    upsertEvent(ev);
    if (aiEnabled && ev.aiStatus === 'pending') void runAnalysis(ev.id);
  }, [upsertEvent, aiEnabled, runAnalysis]);

  const createPerson = useCallback(async (name: string, role: PersonRole): Promise<CasePerson | null> => {
    const res = await addPerson(caseId, { displayName: name, role });
    if (res.person) { setPeople((p) => [...p, res.person!]); return res.person; }
    return null;
  }, [caseId]);

  const removeEvent = useCallback((id: string) => setEvents((prev) => prev.filter((e) => e.id !== id)), []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void ingestFiles(files);
  };

  const dated = events.length;
  const analysed = events.filter((e) => e.aiStatus === 'done').length;
  // Enrich each geocoded pin with its event's time and tagged people, so the
  // map can breadcrumb movements over the timeline.
  const peopleName = (id: string) => people.find((p) => p.id === id)?.displayName ?? '';
  const mapPoints: MapPoint[] = events.flatMap((e) =>
    (e.aiExtracted.geo_points ?? []).map((p) => ({
      ...p,
      time: e.occurredAt,
      when: formatOccurred(e.occurredAt, e.occurredPrecision),
      people: e.people.map(peopleName).filter(Boolean),
      title: e.title,
      relevance: e.aiExtracted.relevance_score,
    })),
  );

  return (
    <div>
      {/* Header */}
      <header className="mb-6">
        <p className="eyebrow mb-1 text-gold-700 dark:text-gold-500">Case Timeline</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-forest-900 dark:text-cream-50">
          {caseTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-cream-300/80">
          Drop everything you&apos;ve collected: photos, documents, receipts, voice notes, videos, chat
          screenshots. Advottic reads each item, dates it, spots the people, and arranges it into a
          court-ready chronology.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-cream-300/70">
            <span className="rounded-full bg-forest-900/5 px-2.5 py-1 dark:bg-cream-50/10">{dated} entr{dated === 1 ? 'y' : 'ies'}</span>
            <span className="rounded-full bg-forest-900/5 px-2.5 py-1 dark:bg-cream-50/10">{analysed} analysed</span>
            <span className="rounded-full bg-forest-900/5 px-2.5 py-1 dark:bg-cream-50/10">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
          </div>
          <div className="inline-flex rounded-lg border border-forest-900/15 bg-white p-0.5 text-sm dark:border-cream-50/15 dark:bg-forest-900/50" role="tablist" aria-label="Timeline view">
            {(['list', 'calendar'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                  view === v
                    ? 'bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950'
                    : 'text-ink-600 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10'
                }`}
              >
                {v === 'list' ? 'List' : 'Calendar'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <CaseMap points={mapPoints} title="Movements · scrub the timeline to trace the breadcrumbs" />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div className="min-w-0">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`mb-6 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver
                ? 'border-gold-500 bg-gold-500/10'
                : 'border-forest-900/20 bg-white/60 dark:border-cream-50/15 dark:bg-cream-50/5'
            }`}
          >
            <div className="text-3xl">🗂️</div>
            <p className="mt-2 font-medium text-forest-900 dark:text-cream-100">
              Drop evidence here, or{' '}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-gold-700 underline underline-offset-2 hover:text-gold-800 dark:text-gold-500"
              >
                browse your files
              </button>
            </p>
            <p className="mt-1 text-xs text-ink-500 dark:text-cream-300/70">
              Each file becomes a dated timeline entry. Up to 50&nbsp;MB each.
            </p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx,text/*,audio/*,video/*"
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void ingestFiles(files);
                e.target.value = '';
              }}
            />
            {busy && <p className="mt-3 text-sm text-forest-700 dark:text-cream-300">Uploading…</p>}
            <div className="mt-3">
              <ManualAddButton caseId={caseId} onAdded={(ev) => { upsertEvent(ev); if (aiEnabled && ev.aiStatus === 'pending') void runAnalysis(ev.id); }} />
            </div>
          </div>

          {/* Timeline / Calendar */}
          {view === 'calendar' ? (
            <CalendarView
              caseId={caseId}
              events={events}
              people={people}
              analyzing={analyzing}
              aiEnabled={aiEnabled}
              onReanalyze={runAnalysis}
              onChange={upsertEvent}
              onDelete={removeEvent}
              onCreatePerson={createPerson}
              onCreated={onCreated}
              onIngestForDate={(files, date) => void ingestFiles(files, date)}
            />
          ) : events.length === 0 ? (
            <div className="rounded-2xl border border-forest-900/10 bg-white p-10 text-center dark:border-cream-50/10 dark:bg-forest-900/40">
              <p className="text-ink-600 dark:text-cream-300/80">
                Your timeline is empty. Drop your first piece of evidence above and watch it fall into place.
              </p>
            </div>
          ) : (
            <Timeline
              events={events}
              people={people}
              analyzing={analyzing}
              aiEnabled={aiEnabled}
              onReanalyze={runAnalysis}
              onChange={upsertEvent}
              onDelete={removeEvent}
              onCreatePerson={createPerson}
              onCreated={onCreated}
            />
          )}
        </div>

        {/* Side rail */}
        <aside className="space-y-6">
          <InsightsPanel events={events} />
          <PeopleRail
            caseId={caseId}
            people={people}
            events={events}
            onAdd={(p) => setPeople((prev) => [...prev, p])}
            onRemove={(id) => setPeople((prev) => prev.filter((x) => x.id !== id))}
          />
          <DocumentPanel
            caseId={caseId}
            narrative={narrative}
            eventCount={events.length}
            aiEnabled={aiEnabled}
            onGenerated={setNarrative}
          />
          <SharePanel caseId={caseId} />
        </aside>
      </div>
    </div>
  );
}

// ── Manual entry (note / event with typed context) ────────────────────────
function ManualAddButton({ caseId, onAdded }: { caseId: string; onAdded: (ev: TimelineEvent) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState<string | null>(null);
  const [precision, setPrecision] = useState<OccurredPrecision>('day');
  const [kind, setKind] = useState<TimelineKind>('event');
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-forest-700 underline underline-offset-2 hover:text-forest-900 dark:text-cream-300"
      >
        ＋ Add an entry manually (a note or event)
      </button>
    );
  }
  return (
    <div className="mx-auto mt-2 max-w-md rounded-xl border border-forest-900/15 bg-white p-4 text-left dark:border-cream-50/15 dark:bg-forest-900/60">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Landlord refused repairs)"
        className="mb-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-cream-50/20 dark:bg-forest-950"
      />
      <div className="mb-2 flex items-start gap-2">
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, and why it matters… (type or dictate)" rows={3}
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-cream-50/20 dark:bg-forest-950"
        />
        <MicButton onAppend={(t) => setDescription((d) => (d ? d + ' ' : '') + t)} />
      </div>
      <div className="mb-3 rounded-lg border border-forest-900/10 bg-forest-900/[0.02] p-2.5 dark:border-cream-50/10 dark:bg-cream-50/[0.03]">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">When did this happen?</p>
        <SmartDatePicker
          value={occurredAt}
          precision={precision}
          onChange={(n) => { setOccurredAt(n.occurredAt); setPrecision(n.precision); }}
        />
      </div>
      <div className="mb-3 flex gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as TimelineKind)}
          className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-ink-600">Cancel</button>
        <button
          type="button"
          disabled={pending || (!title && !description)}
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.append('title', title); fd.append('description', description);
            fd.append('kind', kind);
            if (occurredAt) { fd.append('occurredAt', occurredAt); fd.append('occurredPrecision', precision); }
            const res = await createTimelineEvent(caseId, fd);
            if (res.event) { onAdded(res.event); setOpen(false); setTitle(''); setDescription(''); setOccurredAt(null); setPrecision('day'); }
          })}
          className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950"
        >
          {pending ? 'Adding…' : 'Add entry'}
        </button>
      </div>
    </div>
  );
}

// ── The chronological timeline ────────────────────────────────────────────
function Timeline({
  events, people, analyzing, aiEnabled, onReanalyze, onChange, onDelete, onCreatePerson, onCreated,
}: {
  events: TimelineEvent[];
  people: CasePerson[];
  analyzing: Set<string>;
  aiEnabled: boolean;
  onReanalyze: (id: string) => void;
  onChange: (ev: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onCreatePerson: (name: string, role: PersonRole) => Promise<CasePerson | null>;
  onCreated: (ev: TimelineEvent) => void;
}) {
  // Group by year for a scannable spine.
  const groups: { key: string; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const key = e.occurredAt ? String(new Date(e.occurredAt).getUTCFullYear()) : 'Undated';
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(e); else groups.push({ key, items: [e] });
  }
  return (
    <div className="relative">
      <div className="absolute left-4 top-2 bottom-2 w-px bg-forest-900/15 dark:bg-cream-50/15" aria-hidden />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="mb-3 flex items-center gap-3">
              <span className="relative z-10 grid h-8 w-8 place-items-center rounded-full bg-forest-900 text-xs font-semibold text-cream-50 dark:bg-gold-metal dark:text-forest-950">
                {g.key === 'Undated' ? '·' : g.key.slice(2)}
              </span>
              <h2 className="font-display text-lg font-semibold text-forest-900 dark:text-cream-100">{g.key}</h2>
            </div>
            <div className="ml-1 space-y-3 pl-8">
              {g.items.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  people={people}
                  analyzing={analyzing.has(ev.id)}
                  aiEnabled={aiEnabled}
                  onReanalyze={() => onReanalyze(ev.id)}
                  onChange={onChange}
                  onDelete={onDelete}
                  onCreatePerson={onCreatePerson}
                  onCreated={onCreated}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EventCard({
  event, people, analyzing, aiEnabled, onReanalyze, onChange, onDelete, onCreatePerson, onCreated,
}: {
  event: TimelineEvent;
  people: CasePerson[];
  analyzing: boolean;
  aiEnabled: boolean;
  onReanalyze: () => void;
  onChange: (ev: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onCreatePerson: (name: string, role: PersonRole) => Promise<CasePerson | null>;
  onCreated: (ev: TimelineEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<TimelineMedia | null>(null);
  const firstImage = event.media.find((m) => /^image\//.test(m.mime)) ?? null;
  const thumb = useSignedUrl(firstImage?.path ?? null);
  const transcript = event.aiExtracted.ocr_text ?? null;
  const tagged = people.filter((p) => event.people.includes(p.id));
  const detected = event.aiExtracted.detected_people ?? [];
  const dates = event.aiExtracted.detected_dates ?? [];
  const locations = event.aiExtracted.locations ?? [];
  const orgs = event.aiExtracted.organizations ?? [];
  const thread = event.aiExtracted.message_thread;
  const meta = event.aiExtracted.metadata ?? [];
  const metaGps = event.aiExtracted.metadata_gps ?? null;

  async function setEntryDate(raw: string) {
    const iso = parseLoose(raw);
    if (!iso) return;
    await updateTimelineEvent(event.id, { occurredAt: iso.slice(0, 10), occurredPrecision: 'day' });
    onChange({ ...event, occurredAt: iso, occurredPrecision: 'day' });
  }

  // Turn a document that spans many dates into one entry per date.
  async function plotDates() {
    const seen = new Set<string>();
    for (const raw of dates) {
      const iso = parseLoose(raw);
      if (!iso) continue;
      const day = iso.slice(0, 10);
      if (seen.has(day)) continue;
      seen.add(day);
      const fd = new FormData();
      fd.append('title', `${event.title || 'Event'} - ${raw}`);
      fd.append('description', `Extracted from "${event.title || 'this item'}".`);
      fd.append('kind', 'event');
      fd.append('occurredAt', day);
      fd.append('occurredPrecision', 'day');
      const res = await createTimelineEvent(event.caseId, fd);
      if (res.event) onCreated(res.event);
    }
  }

  async function tagDetected(name: string) {
    const existing = people.find((p) => p.displayName.toLowerCase() === name.toLowerCase());
    const person = existing ?? (await onCreatePerson(name, 'other'));
    if (!person) return;
    const next = Array.from(new Set([...event.people, person.id]));
    await updateTimelineEvent(event.id, { people: next });
    onChange({ ...event, people: next });
  }

  return (
    <article className="relative rounded-xl border border-forest-900/10 bg-white p-4 shadow-sm dark:border-cream-50/10 dark:bg-forest-900/50">
      <span className="absolute -left-[38px] top-5 z-10 grid h-6 w-6 place-items-center rounded-full bg-cream-50 text-sm ring-2 ring-forest-900/15 dark:bg-forest-900 dark:ring-cream-50/15" aria-hidden>
        {KIND_ICON[event.kind]}
      </span>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500 dark:text-cream-300/70">
            <span className="font-medium text-forest-700 dark:text-gold-500">{formatOccurred(event.occurredAt, event.occurredPrecision)}</span>
            <span aria-hidden>·</span>
            <span>{KIND_LABEL[event.kind]}</span>
            {event.sourceLabel && (<><span aria-hidden>·</span><span>{event.sourceLabel}</span></>)}
          </div>
          <h3 className="mt-0.5 flex flex-wrap items-center gap-2 font-medium text-forest-900 dark:text-cream-100">
            <span data-no-translate>
              {event.title || <span className="italic text-ink-400">Untitled entry</span>}
            </span>
            <RelevanceBadge score={event.aiExtracted.relevance_score} reason={event.aiExtracted.relevance_reason} size="xs" />
          </h3>
        </div>
        <div className="flex flex-none gap-1">
          {aiEnabled && (
            <button type="button" onClick={onReanalyze} disabled={analyzing}
              title="Re-run Bella's analysis"
              className="rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-forest-900/5 disabled:opacity-50 dark:hover:bg-cream-50/10">
              {analyzing ? '…' : '↻'}
            </button>
          )}
          <button type="button" onClick={() => setEditing((v) => !v)} title="Edit"
            className="rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-forest-900/5 dark:hover:bg-cream-50/10">✎</button>
          <button type="button"
            onClick={async () => { if (confirm('Remove this entry?')) { await deleteTimelineEvent(event.id); onDelete(event.id); } }}
            title="Delete" className="rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-rose-50">🗑</button>
        </div>
      </div>

      <div className="mt-3 flex gap-3">
        {firstImage && (
          <button
            type="button"
            onClick={() => setViewing(firstImage)}
            title="View full screen"
            className="flex-none overflow-hidden rounded-lg ring-1 ring-forest-900/10 transition hover:ring-2 hover:ring-gold-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb ? <img src={thumb} alt="" data-no-translate className="h-20 w-20 object-cover" />
              : <div className="grid h-20 w-20 place-items-center bg-forest-900/5 text-2xl dark:bg-cream-50/10">🖼️</div>}
          </button>
        )}
        {!firstImage && event.media.length > 0 && (
          <button
            type="button"
            onClick={() => setViewing(event.media[0])}
            title="Open attachment"
            className="grid h-20 w-20 flex-none place-items-center rounded-lg bg-forest-900/5 text-2xl transition hover:ring-2 hover:ring-gold-500 dark:bg-cream-50/10"
          >
            {mediaIcon(event.media[0])}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {event.description && <p className="text-sm text-ink-700 dark:text-cream-200/90" data-no-translate>{event.description}</p>}

          {event.media.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.media.map((m) => (
                <button
                  key={m.path}
                  type="button"
                  onClick={() => setViewing(m)}
                  title={m.name}
                  className="inline-flex max-w-[13rem] items-center gap-1.5 rounded-full border border-forest-900/10 bg-forest-900/[0.03] px-2.5 py-1 text-xs text-ink-600 transition hover:border-gold-500 hover:text-forest-900 dark:border-cream-50/10 dark:bg-cream-50/[0.04] dark:text-cream-300 dark:hover:text-cream-100"
                >
                  <span aria-hidden>{mediaIcon(m)}</span>
                  <span className="truncate" data-no-translate>{m.name}</span>
                </button>
              ))}
            </div>
          )}

          {analyzing && <p className="mt-1 animate-pulse text-xs text-forest-600 dark:text-gold-500">Advottic Review is analysing this…</p>}
          {event.aiStatus === 'error' && event.aiError && (
            <p className="mt-1 text-xs text-rose-600">Analysis: {event.aiError}</p>
          )}
          {event.aiSummary && (
            <div className="mt-2 rounded-lg bg-gold-500/10 px-3 py-2 text-sm text-forest-900 dark:bg-gold-500/15 dark:text-cream-100">
              <span className="mr-1 font-medium text-gold-800 dark:text-gold-400">Advottic Review:</span>
              <span data-no-translate>{event.aiSummary}</span>
            </div>
          )}

          {thread?.messages && thread.messages.length > 0 && (
            <details className="mt-2 rounded-lg border border-forest-900/10 p-2 text-xs dark:border-cream-50/10">
              <summary className="cursor-pointer text-ink-600 dark:text-cream-300">
                {thread.platform ?? 'Chat'} · {thread.messages.length} message{thread.messages.length === 1 ? '' : 's'} parsed
              </summary>
              <ul className="mt-2 space-y-1" data-no-translate>
                {thread.messages.slice(0, 20).map((m, i) => (
                  <li key={i} className="text-ink-700 dark:text-cream-200/90">
                    <span className="font-medium">{m.sender ?? 'Unknown'}</span>
                    {m.recipient ? <span className="text-ink-400"> → {m.recipient}</span> : null}
                    {m.timestamp ? <span className="text-ink-400"> · {m.timestamp}</span> : null}
                    : {m.body}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* People: tagged + AI-detected suggestions */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tagged.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-forest-900/10 px-2 py-0.5 text-xs text-forest-900 dark:bg-cream-50/10 dark:text-cream-100" data-no-translate>
                <span className="grid h-4 w-4 place-items-center rounded-full bg-forest-900 text-[9px] text-cream-50 dark:bg-gold-metal dark:text-forest-950">{initials(p.displayName)}</span>
                {p.displayName}
              </span>
            ))}
            {detected
              .filter((n) => !tagged.some((p) => p.displayName.toLowerCase() === n.toLowerCase()))
              .slice(0, 6)
              .map((n) => (
                <button key={n} type="button" onClick={() => void tagDetected(n)}
                  className="rounded-full border border-dashed border-forest-900/25 px-2 py-0.5 text-xs text-ink-500 hover:border-gold-500 hover:text-gold-700 dark:border-cream-50/25" data-no-translate>
                  ＋ {n}
                </button>
              ))}
          </div>

          {/* Extracted intelligence: dates / locations / organizations */}
          {(dates.length > 0 || locations.length > 0 || orgs.length > 0) && (
            <div className="mt-2 space-y-1.5">
              {dates.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {dates.slice(0, 8).map((d) => {
                    const ok = Boolean(parseLoose(d));
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!ok || (event.occurredAt?.slice(0, 10) === parseLoose(d)?.slice(0, 10))}
                        onClick={() => void setEntryDate(d)}
                        title={ok ? "Use as this entry's date" : undefined}
                        className="rounded-full border border-forest-900/15 bg-forest-900/5 px-2 py-0.5 text-xs text-forest-800 enabled:hover:border-gold-500 disabled:opacity-60 dark:border-cream-50/15 dark:bg-cream-50/5 dark:text-cream-200"
                        data-no-translate
                      >
                        📅 {d}
                      </button>
                    );
                  })}
                  {dates.filter((d) => parseLoose(d)).length > 1 && (
                    <button
                      type="button"
                      onClick={() => void plotDates()}
                      className="rounded-full border border-dashed border-gold-500/50 px-2 py-0.5 text-xs text-gold-700 hover:bg-gold-500/10 dark:text-gold-500"
                    >
                      ＋ Plot all dates as entries
                    </button>
                  )}
                </div>
              )}
              {locations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {locations.slice(0, 6).map((loc) => (
                    <a
                      key={loc}
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View on map"
                      className="rounded-full border border-forest-900/15 bg-forest-900/5 px-2 py-0.5 text-xs text-forest-800 hover:border-gold-500 dark:border-cream-50/15 dark:bg-cream-50/5 dark:text-cream-200"
                      data-no-translate
                    >
                      📍 {loc}
                    </a>
                  ))}
                </div>
              )}
              {orgs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {orgs.slice(0, 6).map((o) => (
                    <span key={o} className="rounded-full bg-forest-900/5 px-2 py-0.5 text-xs text-ink-600 dark:bg-cream-50/5 dark:text-cream-300" data-no-translate>
                      🏢 {o}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Forensic "core details": EXIF/GPS/device/authoring metadata pulled
              from the file itself. Collapsed, terminal-styled. */}
          {meta.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 select-none">
                <span className="transition-transform group-open:rotate-90" aria-hidden>▸</span>
                <span className="font-mono tracking-tight">core_details</span>
                <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-700 dark:text-emerald-300">{meta.length}</span>
              </summary>
              <div className="mt-1.5 overflow-x-auto rounded-lg border border-emerald-500/25 bg-[#0b1512] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-300/90 shadow-inner">
                {meta.map((m) => (
                  <div key={m.label} className="flex gap-2">
                    <span className="w-24 flex-none text-emerald-500/55" data-no-translate>{m.label}</span>
                    <span className="min-w-0 break-words text-emerald-200" data-no-translate>{m.value}</span>
                  </div>
                ))}
                {metaGps && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${metaGps.lat},${metaGps.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-emerald-400 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-300"
                  >
                    ◎ open GPS on map
                  </a>
                )}
              </div>
            </details>
          )}
        </div>
      </div>

      {editing && (
        <EventEditor event={event} onSaved={(ev) => { onChange(ev); setEditing(false); }} onCancel={() => setEditing(false)} />
      )}

      {viewing && (
        <MediaLightbox media={viewing} transcript={transcript} onClose={() => setViewing(null)} />
      )}
    </article>
  );
}

function EventEditor({ event, onSaved, onCancel }: { event: TimelineEvent; onSaved: (ev: TimelineEvent) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  const [occurredAt, setOccurredAt] = useState<string | null>(event.occurredAt);
  const [precision, setPrecision] = useState<OccurredPrecision>(event.occurredPrecision);
  const [kind, setKind] = useState<TimelineKind>(event.kind);
  const [source, setSource] = useState(event.sourceLabel ?? '');
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-forest-900/[0.03] p-3 dark:bg-cream-50/[0.04]">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
      <div className="flex items-start gap-2">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Your context (type or dictate)"
          className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <MicButton onAppend={(t) => setDescription((d) => (d ? d + ' ' : '') + t)} />
      </div>
      <div className="rounded-lg border border-forest-900/10 bg-white/60 p-2.5 dark:border-cream-50/10 dark:bg-forest-950/40">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">When did this happen?</p>
        <SmartDatePicker
          value={occurredAt}
          precision={precision}
          onChange={(n) => { setOccurredAt(n.occurredAt); setPrecision(n.precision); }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as TimelineKind)}
          className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (optional)"
          className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-ink-600">Cancel</button>
        <button type="button" disabled={pending}
          onClick={() => start(async () => {
            const finalPrecision = occurredAt ? precision : 'unknown';
            await updateTimelineEvent(event.id, {
              title, description: description || null, kind, sourceLabel: source || null,
              occurredAt: occurredAt || null, occurredPrecision: finalPrecision,
            });
            onSaved({ ...event, title, description: description || null, kind, sourceLabel: source || null, occurredAt: occurredAt || null, occurredPrecision: finalPrecision });
          })}
          className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── People rail ───────────────────────────────────────────────────────────
function PeopleRail({ caseId, people, events, onAdd, onRemove }: {
  caseId: string; people: CasePerson[]; events: TimelineEvent[];
  onAdd: (p: CasePerson) => void; onRemove: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<PersonRole>('other');
  const [pending, start] = useTransition();
  const countFor = (id: string) => events.filter((e) => e.people.includes(id)).length;
  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
      <h2 className="mb-3 font-display text-base font-semibold text-forest-900 dark:text-cream-100">People</h2>
      <ul className="space-y-2">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-forest-900 text-[10px] font-semibold text-cream-50 dark:bg-gold-metal dark:text-forest-950" data-no-translate>{initials(p.displayName)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-forest-900 dark:text-cream-100" data-no-translate>{p.displayName}</span>
              <span className="text-[11px] text-ink-500 dark:text-cream-300/70">{ROLE_LABEL[p.role]} · {countFor(p.id)} entr{countFor(p.id) === 1 ? 'y' : 'ies'}</span>
            </span>
            <button type="button" onClick={async () => { if (confirm(`Remove ${p.displayName}?`)) { await deletePerson(p.id); onRemove(p.id); } }}
              className="text-xs text-ink-400 hover:text-rose-500">✕</button>
          </li>
        ))}
        {people.length === 0 && <li className="text-sm text-ink-500 dark:text-cream-300/70">No one tagged yet. Bella will suggest people from your evidence.</li>}
      </ul>
      <div className="mt-3 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a person"
          className="min-w-0 flex-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <select value={role} onChange={(e) => setRole(e.target.value as PersonRole)}
          className="rounded-lg border border-ink-200 px-1 py-1.5 text-xs dark:border-cream-50/20 dark:bg-forest-950">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button type="button" disabled={pending || !name.trim()}
          onClick={() => start(async () => { const res = await addPerson(caseId, { displayName: name, role }); if (res.person) { onAdd(res.person); setName(''); } })}
          className="rounded-lg bg-forest-900 px-2.5 py-1.5 text-sm text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">＋</button>
      </div>
    </div>
  );
}

// ── The generated legal document ──────────────────────────────────────────
function DocumentPanel({ caseId, narrative, eventCount, aiEnabled, onGenerated }: {
  caseId: string;
  narrative: TimelineBundle['narrative'];
  eventCount: number;
  aiEnabled: boolean;
  onGenerated: (n: TimelineBundle['narrative']) => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [glowing, setGlowing] = useState(false);
  const [updated, setUpdated] = useState(false);
  const ready = Boolean(narrative);

  function runGenerate() {
    setErr(null);
    const wasReady = ready;
    start(async () => {
      const res = await generateTimelineNarrative(caseId);
      if (!res.ok) { setErr(res.error ?? 'Failed.'); return; }
      const b = await import('@/lib/timeline-actions').then((m) => m.getTimelineBundle(caseId));
      onGenerated(b.narrative);
      setUpdated(wasReady); // a re-run of an already-built document
      setGlowing(true);
      setTimeout(() => setGlowing(false), 4600); // ~5 pulses then rest
    });
  }

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
      <h2 className="mb-1 font-display text-base font-semibold text-forest-900 dark:text-cream-100">Timeline document</h2>
      <p className="mb-3 text-xs text-ink-500 dark:text-cream-300/70">
        Advottic Review compiles a chronological account and conclusion from your entries, formatted as a court-ready exhibit. The finished document is available to download; it is not displayed here.
      </p>
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      <div className="flex flex-col gap-2">
        {aiEnabled && (
          <button type="button" disabled={pending || eventCount === 0}
            onClick={runGenerate}
            className="rounded-lg bg-forest-900 px-3 py-2 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
            {pending ? 'Building…' : ready ? 'Regenerate document' : 'Generate document'}
          </button>
        )}
        {ready ? (
          <a
            href={`/cases/${caseId}/timeline/export`}
            target="_blank"
            rel="noopener noreferrer"
            style={glowing ? { animation: 'adv-glow-pulse 0.9s ease-in-out 5' } : undefined}
            className="rounded-lg border border-gold-500/60 bg-gold-500/10 px-3 py-2 text-center text-sm font-semibold text-forest-900 hover:bg-gold-500/20 dark:text-cream-100"
          >
            Ready to download
            {updated && (
              <span className="ml-2 align-middle rounded bg-gold-metal px-1.5 py-0.5 text-[10px] font-bold text-forest-950">Updated</span>
            )}
          </a>
        ) : (
          <div
            aria-disabled="true"
            title="Generate the document first"
            className="cursor-not-allowed select-none rounded-lg border border-forest-900/15 bg-forest-900/[0.03] px-3 py-2 text-center text-sm font-medium text-ink-400 dark:border-cream-50/10 dark:text-cream-300/40"
          >
            Ready to download
          </div>
        )}
      </div>
    </div>
  );
}

function SharePanel({ caseId }: { caseId: string }) {
  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
      <h2 className="mb-1 font-display text-base font-semibold text-forest-900 dark:text-cream-100">Share</h2>
      <p className="mb-3 text-xs text-ink-500 dark:text-cream-300/70">
        Invite an attorney or a trusted collaborator to view or help build this timeline.
      </p>
      <Link href={`/cases/${caseId}#collaborators`}
        className="block rounded-lg border border-forest-900/20 px-3 py-2 text-center text-sm font-medium text-forest-900 hover:bg-forest-900/5 dark:border-cream-50/20 dark:text-cream-100 dark:hover:bg-cream-50/10">
        Manage collaborators
      </Link>
    </div>
  );
}

// ── Calendar view ─────────────────────────────────────────────────────────
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function CalendarView({
  caseId, events, people, analyzing, aiEnabled, onReanalyze, onChange, onDelete, onCreatePerson, onCreated, onIngestForDate,
}: {
  caseId: string;
  events: TimelineEvent[];
  people: CasePerson[];
  analyzing: Set<string>;
  aiEnabled: boolean;
  onReanalyze: (id: string) => void;
  onChange: (ev: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onCreatePerson: (name: string, role: PersonRole) => Promise<CasePerson | null>;
  onCreated: (ev: TimelineEvent) => void;
  onIngestForDate: (files: File[], dateISO: string) => void;
}) {
  // Group dated events by their UTC calendar day.
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    if (!e.occurredAt) continue;
    const key = e.occurredAt.slice(0, 10);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }

  // Start on the month of the most recent dated event, else the current month.
  const latest = events.find((e) => e.occurredAt)?.occurredAt ?? null;
  const initial = latest ? new Date(latest) : new Date();
  const [month, setMonth] = useState(() => new Date(Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth(), 1)));
  const [selected, setSelected] = useState<string | null>(latest ? latest.slice(0, 10) : null);
  const [dragDay, setDragDay] = useState<string | null>(null);

  const y = month.getUTCFullYear();
  const m = month.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayISO = new Date().toISOString().slice(0, 10);
  const undated = events.filter((e) => !e.occurredAt).length;
  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];

  function shift(delta: number) { setMonth(new Date(Date.UTC(y, m + delta, 1))); }

  return (
    <div>
      <div className="rounded-2xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
        {/* Month header */}
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month"
            className="rounded-md px-2 py-1 text-forest-700 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10">◀</button>
          <h2 className="font-display text-lg font-semibold text-forest-900 dark:text-cream-100">{MONTHS[m]} {y}</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { const t = new Date(); setMonth(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))); }}
              className="rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10">Today</button>
            <button type="button" onClick={() => shift(1)} aria-label="Next month"
              className="rounded-md px-2 py-1 text-forest-700 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10">▶</button>
          </div>
        </div>

        {/* Weekday row */}
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-400 dark:text-cream-300/60">
          {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} />;
            const iso = dayISO(y, m, d);
            const count = byDay.get(iso)?.length ?? 0;
            const isSel = selected === iso;
            const isToday = iso === todayISO;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelected(iso)}
                onDragOver={(e) => { e.preventDefault(); setDragDay(iso); }}
                onDragLeave={() => setDragDay((cur) => (cur === iso ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault(); setDragDay(null); setSelected(iso);
                  const files = Array.from(e.dataTransfer.files);
                  if (files.length) onIngestForDate(files, iso);
                }}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                  dragDay === iso ? 'border-gold-500 bg-gold-500/15'
                  : isSel ? 'border-forest-900 bg-forest-900/10 dark:border-gold-500 dark:bg-gold-500/15'
                  : 'border-transparent hover:bg-forest-900/5 dark:hover:bg-cream-50/10'
                }`}
              >
                <span className={`${isToday ? 'grid h-6 w-6 place-items-center rounded-full bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950' : 'text-forest-900 dark:text-cream-100'}`}>{d}</span>
                {count > 0 && (
                  <span className="absolute bottom-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-gold-600 px-1 text-[9px] font-semibold text-white dark:bg-gold-500 dark:text-forest-950">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        {undated > 0 && (
          <p className="mt-3 text-xs text-ink-500 dark:text-cream-300/70">
            {undated} undated {undated === 1 ? 'entry is' : 'entries are'} not shown on the calendar. Give them a date, or find them in List view.
          </p>
        )}
      </div>

      {/* Selected day */}
      {selected && (
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="relative z-10 grid h-8 w-8 place-items-center rounded-full bg-forest-900 text-xs font-semibold text-cream-50 dark:bg-gold-metal dark:text-forest-950">
              {Number(selected.slice(8, 10))}
            </span>
            <h3 className="font-display text-lg font-semibold text-forest-900 dark:text-cream-100">
              {formatOccurred(`${selected}T00:00:00.000Z`, 'day')}
            </h3>
          </div>

          <DayAddArea caseId={caseId} dateISO={selected} onCreated={onCreated} onIngestForDate={onIngestForDate} />

          <div className="mt-3 space-y-3">
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-cream-300/70">Nothing on this day yet. Drop files above or add a note.</p>
            ) : (
              selectedEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  people={people}
                  analyzing={analyzing.has(ev.id)}
                  aiEnabled={aiEnabled}
                  onReanalyze={() => onReanalyze(ev.id)}
                  onChange={onChange}
                  onDelete={onDelete}
                  onCreatePerson={onCreatePerson}
                  onCreated={onCreated}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Drop files onto a specific day, or jot a quick note dated to it. */
function DayAddArea({ caseId, dateISO, onCreated, onIngestForDate }: {
  caseId: string; dateISO: string;
  onCreated: (ev: TimelineEvent) => void;
  onIngestForDate: (files: File[], dateISO: string) => void;
}) {
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onIngestForDate(f, dateISO); }}
      className={`rounded-xl border border-dashed p-3 transition-colors ${over ? 'border-gold-500 bg-gold-500/10' : 'border-forest-900/20 dark:border-cream-50/15'}`}
    >
      <div className="flex items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for this day… (type or dictate)"
          className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <MicButton onAppend={(t) => setNote((n) => (n ? n + ' ' : '') + t)} />
        <button type="button" disabled={pending || !note.trim()}
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.append('description', note); fd.append('kind', 'note');
            fd.append('occurredAt', dateISO); fd.append('occurredPrecision', 'day');
            const res = await createTimelineEvent(caseId, fd);
            if (res.event) { onCreated(res.event); setNote(''); }
          })}
          className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
          {pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-forest-900/20 px-3 py-1.5 text-sm text-forest-900 hover:bg-forest-900/5 dark:border-cream-50/20 dark:text-cream-100 dark:hover:bg-cream-50/10">
          Files
        </button>
        <input ref={fileRef} type="file" multiple className="sr-only"
          accept="image/*,application/pdf,.doc,.docx,text/*,audio/*,video/*"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onIngestForDate(f, dateISO); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// ── Extracted intelligence: everything Bella pulled out, aggregated ───────
function InsightsPanel({ events }: { events: TimelineEvent[] }) {
  const dates = events.filter((e) => e.occurredAt).map((e) => e.occurredAt as string);
  const span = dates.length
    ? { first: dates.reduce((a, b) => (a < b ? a : b)), last: dates.reduce((a, b) => (a > b ? a : b)) }
    : null;

  const tally = (pick: (e: TimelineEvent) => string[]) => {
    const m = new Map<string, number>();
    for (const e of events) for (const v of pick(e)) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const places = tally((e) => e.aiExtracted.locations ?? []).slice(0, 6);
  const orgs = tally((e) => e.aiExtracted.organizations ?? []).slice(0, 6);

  if (!span && places.length === 0 && orgs.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gold-500/30 bg-gradient-to-b from-gold-500/[0.07] to-transparent p-4 dark:border-gold-500/25">
      <h2 className="mb-1 flex items-center gap-1.5 font-display text-base font-semibold text-forest-900 dark:text-cream-100">
        <span aria-hidden>✨</span> Extracted intelligence
      </h2>
      <p className="mb-3 text-xs text-ink-500 dark:text-cream-300/70">What Bella pulled from across your evidence.</p>

      {span && (
        <div className="mb-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400 dark:text-cream-300/60">Spans</p>
          <p className="text-sm text-forest-900 dark:text-cream-100" data-no-translate>
            {formatOccurred(span.first, 'day')} → {formatOccurred(span.last, 'day')}
          </p>
        </div>
      )}

      {places.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400 dark:text-cream-300/60">Places</p>
          <div className="flex flex-wrap gap-1.5">
            {places.map(([loc, n]) => (
              <a key={loc} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-forest-900/15 bg-white px-2 py-0.5 text-xs text-forest-800 hover:border-gold-500 dark:border-cream-50/15 dark:bg-forest-900/50 dark:text-cream-200"
                data-no-translate>
                📍 {loc}{n > 1 ? <span className="text-ink-400"> ×{n}</span> : null}
              </a>
            ))}
          </div>
        </div>
      )}

      {orgs.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400 dark:text-cream-300/60">Organizations</p>
          <div className="flex flex-wrap gap-1.5">
            {orgs.map(([o, n]) => (
              <span key={o} className="rounded-full bg-forest-900/5 px-2 py-0.5 text-xs text-ink-600 dark:bg-cream-50/10 dark:text-cream-300" data-no-translate>
                🏢 {o}{n > 1 ? <span className="text-ink-400"> ×{n}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
