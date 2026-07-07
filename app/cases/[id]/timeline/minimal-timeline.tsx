'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { MicButton } from './dictation';
import {
  createTimelineEvent,
  updateTimelineEvent,
  deleteTimelineEvent,
  getTimelineMediaUrl,
} from '@/lib/timeline-actions';
import {
  formatOccurred,
  sortTimeline,
  KIND_ICON,
  KIND_LABEL,
  type TimelineBundle,
  type TimelineEvent,
  type TimelineKind,
  type OccurredPrecision,
} from '@/lib/timeline-types';

const urlCache = new Map<string, string>();
function useSignedUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(path ? urlCache.get(path) ?? null : null);
  useEffect(() => {
    let on = true;
    if (!path) return;
    if (urlCache.has(path)) { setUrl(urlCache.get(path)!); return; }
    getTimelineMediaUrl(path).then((u) => { if (on && u) { urlCache.set(path, u); setUrl(u); } });
    return () => { on = false; };
  }, [path]);
  return url;
}

const KINDS: TimelineKind[] = ['photo', 'document', 'receipt', 'audio', 'video', 'message', 'note', 'event'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function MinimalTimeline({
  caseId,
  caseTitle,
  initialBundle,
}: {
  caseId: string;
  caseTitle: string;
  initialBundle: TimelineBundle;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialBundle.events);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upsert = useCallback((ev: TimelineEvent) => {
    setEvents((prev) => sortTimeline([...prev.filter((e) => e.id !== ev.id), ev]));
  }, []);

  const ingest = useCallback(async (files: File[], occurredAt?: string) => {
    setError(null); setBusy(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('files', file);
        if (occurredAt) { fd.append('occurredAt', occurredAt); fd.append('occurredPrecision', 'day'); }
        const res = await createTimelineEvent(caseId, fd);
        if (!res.ok || !res.event) { setError(res.error ?? 'Upload failed.'); continue; }
        upsert(res.event);
      }
    } finally { setBusy(false); }
  }, [caseId, upsert]);

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-1 text-gold-700 dark:text-gold-500">Case Timeline</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-forest-900 dark:text-cream-50">{caseTitle}</h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-cream-300/80">
          Upload everything you&apos;ve collected and add a little context to each item. Your legal team
          turns it into a fully-analysed, court-ready case timeline.
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-full bg-forest-900/5 px-2.5 py-1 text-xs text-ink-500 dark:bg-cream-50/10 dark:text-cream-300/70">
            {events.length} {events.length === 1 ? 'item' : 'items'}
          </span>
          <div className="inline-flex rounded-lg border border-forest-900/15 bg-white p-0.5 text-sm dark:border-cream-50/15 dark:bg-forest-900/50">
            {(['list', 'calendar'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 font-medium transition-colors ${
                  view === v ? 'bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950'
                  : 'text-ink-600 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10'
                }`}>
                {v === 'list' ? 'List' : 'Calendar'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

      {/* Upload + context */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) void ingest(f); }}
        className={`mb-4 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? 'border-gold-500 bg-gold-500/10' : 'border-forest-900/20 bg-white/60 dark:border-cream-50/15 dark:bg-cream-50/5'
        }`}
      >
        <div className="text-3xl">🗂️</div>
        <p className="mt-2 font-medium text-forest-900 dark:text-cream-100">
          Drop files here, or{' '}
          <button type="button" onClick={() => fileRef.current?.click()} className="text-gold-700 underline underline-offset-2 dark:text-gold-500">browse</button>
        </p>
        <p className="mt-1 text-xs text-ink-500 dark:text-cream-300/70">Photos, documents, receipts, voice notes, videos, screenshots. Up to 50&nbsp;MB each.</p>
        <input ref={fileRef} type="file" multiple className="sr-only"
          accept="image/*,application/pdf,.doc,.docx,text/*,audio/*,video/*"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) void ingest(f); e.target.value = ''; }} />
        {busy && <p className="mt-3 text-sm text-forest-700 dark:text-cream-300">Uploading…</p>}
        <div className="mt-3"><AddWithContext caseId={caseId} onAdded={upsert} /></div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-forest-900/10 bg-white p-10 text-center text-ink-600 dark:border-cream-50/10 dark:bg-forest-900/40 dark:text-cream-300/80">
          Nothing yet. Drop your first item above.
        </div>
      ) : view === 'calendar' ? (
        <MonthOverview events={events} onChange={upsert} onDelete={(id) => setEvents((p) => p.filter((e) => e.id !== id))} onIngestForDate={(f, d) => void ingest(f, d)} caseId={caseId} onAdded={upsert} />
      ) : (
        <ListOverview events={events} onChange={upsert} onDelete={(id) => setEvents((p) => p.filter((e) => e.id !== id))} />
      )}

      {/* Firm upsell */}
      <div className="mt-6 rounded-2xl border border-gold-500/30 bg-gradient-to-b from-gold-500/[0.07] to-transparent p-4 text-sm text-ink-700 dark:border-gold-500/25 dark:text-cream-200/90">
        <p><span className="font-semibold text-forest-900 dark:text-cream-100">Working with a firm?</span> On a firm plan, Advottic reads every item — OCR, dates, people, locations, chat senders — tags who&apos;s who, and generates a court-ready timeline document. You just submit; they build.</p>
      </div>
    </div>
  );
}

// ── Add one item with typed/dictated context ──────────────────────────────
function AddWithContext({ caseId, onAdded }: { caseId: string; onAdded: (ev: TimelineEvent) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<TimelineKind>('note');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-sm text-forest-700 underline underline-offset-2 dark:text-cream-300">＋ Add an item with context</button>;
  }
  return (
    <div className="mx-auto mt-2 max-w-md rounded-xl border border-forest-900/15 bg-white p-4 text-left dark:border-cream-50/15 dark:bg-forest-900/60">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Text from landlord)"
        className="mb-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
      <div className="mb-2 flex items-start gap-2">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Context — what is this, and why it matters (type or dictate)"
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <MicButton onAppend={(t) => setDescription((d) => (d ? d + ' ' : '') + t)} />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <select value={kind} onChange={(e) => setKind(e.target.value as TimelineKind)}
          className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <button type="button" onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-forest-900/20 px-2.5 py-1.5 text-sm text-forest-900 dark:border-cream-50/20 dark:text-cream-100">
          {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Attach'}
        </button>
        <input ref={fileRef} type="file" multiple className="sr-only"
          accept="image/*,application/pdf,.doc,.docx,text/*,audio/*,video/*"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-ink-600">Cancel</button>
        <button type="button" disabled={pending || (!title && !description && files.length === 0)}
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.append('title', title); fd.append('description', description); fd.append('kind', kind);
            if (date) { fd.append('occurredAt', date); fd.append('occurredPrecision', 'day'); }
            files.forEach((f) => fd.append('files', f));
            const res = await createTimelineEvent(caseId, fd);
            if (res.event) { onAdded(res.event); setOpen(false); setTitle(''); setDescription(''); setDate(''); setFiles([]); }
          })}
          className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
          {pending ? 'Adding…' : 'Add item'}
        </button>
      </div>
    </div>
  );
}

// ── Minimal chronological list ────────────────────────────────────────────
function ListOverview({ events, onChange, onDelete }: {
  events: TimelineEvent[]; onChange: (ev: TimelineEvent) => void; onDelete: (id: string) => void;
}) {
  const groups: { key: string; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const key = e.occurredAt ? String(new Date(e.occurredAt).getUTCFullYear()) : 'Undated';
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(e); else groups.push({ key, items: [e] });
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 font-display text-lg font-semibold text-forest-900 dark:text-cream-100">{g.key}</h2>
          <div className="space-y-2">
            {g.items.map((ev) => <MinimalCard key={ev.id} event={ev} onChange={onChange} onDelete={onDelete} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function MinimalCard({ event, onChange, onDelete }: {
  event: TimelineEvent; onChange: (ev: TimelineEvent) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const img = event.media.find((m) => /^image\//.test(m.mime)) ?? null;
  const thumb = useSignedUrl(img?.path ?? null);
  return (
    <article className="rounded-xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-ink-500 dark:text-cream-300/70">
            <span>{KIND_ICON[event.kind]}</span>
            <span className="font-medium text-forest-700 dark:text-gold-500">{formatOccurred(event.occurredAt, event.occurredPrecision)}</span>
            <span aria-hidden>·</span><span>{KIND_LABEL[event.kind]}</span>
          </div>
          <h3 className="mt-0.5 font-medium text-forest-900 dark:text-cream-100" data-no-translate>
            {event.title || <span className="italic text-ink-400">Untitled</span>}
          </h3>
        </div>
        <div className="flex flex-none gap-1">
          <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-forest-900/5 dark:hover:bg-cream-50/10">✎</button>
          <button type="button" onClick={async () => { if (confirm('Remove this item?')) { await deleteTimelineEvent(event.id); onDelete(event.id); } }}
            className="rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-rose-50">🗑</button>
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        {img ? (
          thumb ? <img src={thumb} alt="" data-no-translate className="h-16 w-16 flex-none rounded-lg object-cover ring-1 ring-forest-900/10" />
            : <div className="grid h-16 w-16 flex-none place-items-center rounded-lg bg-forest-900/5 dark:bg-cream-50/10">🖼️</div>
        ) : event.media.length > 0 ? (
          <div className="grid h-16 w-16 flex-none place-items-center rounded-lg bg-forest-900/5 text-xl dark:bg-cream-50/10">{KIND_ICON[event.kind]}</div>
        ) : null}
        {event.description && <p className="min-w-0 flex-1 text-sm text-ink-700 dark:text-cream-200/90" data-no-translate>{event.description}</p>}
      </div>
      {editing && <MinimalEditor event={event} onSaved={(ev) => { onChange(ev); setEditing(false); }} onCancel={() => setEditing(false)} />}
    </article>
  );
}

function MinimalEditor({ event, onSaved, onCancel }: {
  event: TimelineEvent; onSaved: (ev: TimelineEvent) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  const [date, setDate] = useState(event.occurredAt ? new Date(event.occurredAt).toISOString().slice(0, 10) : '');
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-forest-900/[0.03] p-3 dark:bg-cream-50/[0.04]">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
      <div className="flex items-start gap-2">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Context (type or dictate)"
          className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <MicButton onAppend={(t) => setDescription((d) => (d ? d + ' ' : '') + t)} />
      </div>
      <div className="flex justify-between">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-ink-600">Cancel</button>
          <button type="button" disabled={pending}
            onClick={() => start(async () => {
              const prec: OccurredPrecision = date ? 'day' : 'unknown';
              await updateTimelineEvent(event.id, { title, description: description || null, occurredAt: date || null, occurredPrecision: prec });
              onSaved({ ...event, title, description: description || null, occurredAt: date ? new Date(date).toISOString() : null, occurredPrecision: prec });
            })}
            className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Minimal month overview ────────────────────────────────────────────────
function MonthOverview({ events, onChange, onDelete, onIngestForDate, caseId, onAdded }: {
  events: TimelineEvent[];
  onChange: (ev: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onIngestForDate: (files: File[], dateISO: string) => void;
  caseId: string;
  onAdded: (ev: TimelineEvent) => void;
}) {
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) { if (!e.occurredAt) continue; const k = e.occurredAt.slice(0, 10); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e); }
  const latest = events.find((e) => e.occurredAt)?.occurredAt ?? null;
  const init = latest ? new Date(latest) : new Date();
  const [month, setMonth] = useState(() => new Date(Date.UTC(init.getUTCFullYear(), init.getUTCMonth(), 1)));
  const [selected, setSelected] = useState<string | null>(latest ? latest.slice(0, 10) : null);
  const y = month.getUTCFullYear(); const m = month.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayISO = new Date().toISOString().slice(0, 10);
  const undated = events.filter((e) => !e.occurredAt).length;
  const iso = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const selEvents = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div>
      <div className="rounded-2xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => setMonth(new Date(Date.UTC(y, m - 1, 1)))} className="rounded-md px-2 py-1 text-forest-700 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10">◀</button>
          <h2 className="font-display text-lg font-semibold text-forest-900 dark:text-cream-100">{MONTHS[m]} {y}</h2>
          <button type="button" onClick={() => setMonth(new Date(Date.UTC(y, m + 1, 1)))} className="rounded-md px-2 py-1 text-forest-700 hover:bg-forest-900/5 dark:text-cream-300 dark:hover:bg-cream-50/10">▶</button>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-400 dark:text-cream-300/60">
          {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} />;
            const k = iso(d); const count = byDay.get(k)?.length ?? 0; const sel = selected === k; const today = k === todayISO;
            return (
              <button key={k} type="button" onClick={() => setSelected(k)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setSelected(k); const f = Array.from(e.dataTransfer.files); if (f.length) onIngestForDate(f, k); }}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                  sel ? 'border-forest-900 bg-forest-900/10 dark:border-gold-500 dark:bg-gold-500/15' : 'border-transparent hover:bg-forest-900/5 dark:hover:bg-cream-50/10'
                }`}>
                <span className={today ? 'grid h-6 w-6 place-items-center rounded-full bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950' : 'text-forest-900 dark:text-cream-100'}>{d}</span>
                {count > 0 && <span className="absolute bottom-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-gold-600 px-1 text-[9px] font-semibold text-white dark:bg-gold-500 dark:text-forest-950">{count}</span>}
              </button>
            );
          })}
        </div>
        {undated > 0 && <p className="mt-3 text-xs text-ink-500 dark:text-cream-300/70">{undated} undated {undated === 1 ? 'item' : 'items'} — add a date, or find them in List view.</p>}
      </div>

      {selected && (
        <div className="mt-4">
          <h3 className="mb-3 font-display text-lg font-semibold text-forest-900 dark:text-cream-100">{formatOccurred(`${selected}T00:00:00.000Z`, 'day')}</h3>
          {selEvents.length === 0
            ? <p className="text-sm text-ink-500 dark:text-cream-300/70">Nothing on this day. Drop files onto the date, or add an item with that date.</p>
            : <div className="space-y-2">{selEvents.map((ev) => <MinimalCard key={ev.id} event={ev} onChange={onChange} onDelete={onDelete} />)}</div>}
        </div>
      )}
    </div>
  );
}
