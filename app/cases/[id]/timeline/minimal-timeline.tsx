'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { MicButton } from './dictation';
import { MediaLightbox } from './media-lightbox';
import { SmartDatePicker } from './smart-date-picker';
import {
  createTimelineEvent,
  updateTimelineEvent,
  deleteTimelineEvent,
  getTimelineMediaUrl,
} from '@/lib/timeline-actions';
import { inviteCollaboratorAction } from '@/lib/actions';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KindIcon } from '@/components/counsel/KindIcon';
import { ArchiveIcon, ClipIcon, PencilIcon, PersonIcon, TrashIcon } from '@/components/counsel/EntityIcons';
import {
  formatOccurred,
  sortTimeline,
  KIND_LABEL,
  type TimelineBundle,
  type TimelineEvent,
  type TimelineMedia,
  type TimelineKind,
  type OccurredPrecision,
} from '@/lib/timeline-types';

/* Stroke icons rather than emoji, matching the builder view. */
function MediaIcon({ m }: { m: TimelineMedia }) {
  if (/^image\//.test(m.mime)) return <KindIcon kind="photo" className="h-3.5 w-3.5" />;
  if (/^audio\//.test(m.mime)) return <KindIcon kind="audio" className="h-3.5 w-3.5" />;
  if (/^video\//.test(m.mime)) return <KindIcon kind="video" className="h-3.5 w-3.5" />;
  if (m.mime === 'application/pdf' || /\.pdf$/i.test(m.name)) {
    return <KindIcon kind="document" className="h-3.5 w-3.5" />;
  }
  return <ClipIcon size={14} />;
}

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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* `text-muted`, not `text-ink-500`: ink-500 is 4.83:1 on white but
              only 4.41:1 once the chip's own 5% forest tint is under it. */}
          <span className="rounded-full bg-forest-900/5 px-2.5 py-1 text-xs text-muted dark:bg-cream-50/10 dark:text-cream-300/70">
            {events.length} {events.length === 1 ? 'item' : 'items'}
          </span>
          <InviteFirm caseId={caseId} />
        </div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

      {/* Once a firm has built the timeline (a narrative exists), the client can
          download the finished, court-ready document. */}
      {initialBundle.narrative ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/40 bg-gold-500/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-forest-900 dark:text-cream-50">Your timeline is ready</p>
            <p className="mt-0.5 text-xs text-ink-600 dark:text-cream-300/80">Your legal team has prepared a court-ready case timeline from everything you added.</p>
          </div>
          <a
            href={`/cases/${caseId}/timeline/export`}
            className="flex-none rounded-lg bg-forest-900 px-4 py-2 text-sm font-semibold text-cream-50 hover:bg-forest-800 dark:bg-gold-metal dark:text-forest-950"
          >
            Download timeline (PDF)
          </a>
        </div>
      ) : events.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-forest-900/10 bg-white/60 px-5 py-3 text-xs text-ink-500 dark:border-cream-50/10 dark:bg-cream-50/5 dark:text-cream-300/70">
          When your legal team finishes building your timeline, a download button will appear here.
        </div>
      ) : null}

      {/* Upload + context */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) void ingest(f); }}
        className={`mb-4 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? 'border-gold-500 bg-gold-500/10' : 'border-forest-900/20 bg-white/60 dark:border-cream-50/15 dark:bg-cream-50/5'
        }`}
      >
        <div className="flex justify-center text-forest-900/65 dark:text-cream-50/40">
          <ArchiveIcon size={30} />
        </div>
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
      ) : (
        <ListOverview events={events} onChange={upsert} onDelete={(id) => setEvents((p) => p.filter((e) => e.id !== id))} />
      )}

      {/* Firm upsell */}
      <div className="mt-6 rounded-2xl border border-gold-500/30 bg-gradient-to-b from-gold-500/[0.07] to-transparent p-4 text-sm text-ink-700 dark:border-gold-500/25 dark:text-cream-200/90">
        <p><span className="font-semibold text-forest-900 dark:text-cream-100">Working with a firm?</span> On a firm plan, Advottic reads every item (OCR, dates, people, locations, chat senders), tags who&apos;s who, and generates a court-ready timeline document. You just submit; they build.</p>
      </div>
    </div>
  );
}

// ── Add one item with typed/dictated context ──────────────────────────────
function AddWithContext({ caseId, onAdded }: { caseId: string; onAdded: (ev: TimelineEvent) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState<string | null>(null);
  const [precision, setPrecision] = useState<OccurredPrecision>('day');
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
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Context: what is this, and why it matters (type or dictate)"
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-cream-50/20 dark:bg-forest-950" />
        <MicButton onAppend={(t) => setDescription((d) => (d ? d + ' ' : '') + t)} />
      </div>
      <div className="mb-2 rounded-lg border border-forest-900/10 bg-forest-900/[0.02] p-2.5 dark:border-cream-50/10 dark:bg-cream-50/[0.03]">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">When did this happen?</p>
        <SmartDatePicker
          value={occurredAt}
          precision={precision}
          minimal
          onChange={(n) => { setOccurredAt(n.occurredAt); setPrecision(n.precision); }}
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
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
            if (occurredAt) { fd.append('occurredAt', occurredAt); fd.append('occurredPrecision', precision); }
            files.forEach((f) => fd.append('files', f));
            const res = await createTimelineEvent(caseId, fd);
            if (res.event) { onAdded(res.event); setOpen(false); setTitle(''); setDescription(''); setOccurredAt(null); setPrecision('day'); setFiles([]); }
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<TimelineMedia | null>(null);
  const img = event.media.find((m) => /^image\//.test(m.mime)) ?? null;
  const thumb = useSignedUrl(img?.path ?? null);
  const transcript = event.aiExtracted?.ocr_text ?? null;
  return (
    <article className="rounded-xl border border-forest-900/10 bg-white p-4 dark:border-cream-50/10 dark:bg-forest-900/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-ink-500 dark:text-cream-300/70">
            <KindIcon kind={event.kind} className="h-3.5 w-3.5" />
            <span className="font-medium text-forest-700 dark:text-gold-500">{formatOccurred(event.occurredAt, event.occurredPrecision)}</span>
            <span aria-hidden>·</span><span>{KIND_LABEL[event.kind]}</span>
          </div>
          <h3 className="mt-0.5 font-medium text-forest-900 dark:text-cream-100" data-no-translate>
            {event.title || <span className="italic text-ink-400">Untitled</span>}
          </h3>
        </div>
        <div className="flex flex-none gap-1">
          <button type="button" onClick={() => setEditing((v) => !v)} title="Edit" aria-label="Edit this item"
            className="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-forest-900/5 dark:hover:bg-cream-50/10"><PencilIcon size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(true)} title="Delete" aria-label="Remove this item"
              className="grid h-8 w-8 place-items-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"><TrashIcon size={15} /></button>
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        {img ? (
          <button
            type="button"
            onClick={() => setViewing(img)}
            title="View full screen"
            className="flex-none overflow-hidden rounded-lg ring-1 ring-forest-900/10 transition hover:ring-2 hover:ring-gold-500"
          >
            {thumb ? <img src={thumb} alt="" data-no-translate className="h-16 w-16 object-cover" />
              : <div className="grid h-16 w-16 place-items-center bg-forest-900/5 text-forest-900/65 dark:bg-cream-50/10 dark:text-cream-50/40"><KindIcon kind="photo" className="h-6 w-6" /></div>}
          </button>
        ) : event.media.length > 0 ? (
          <button
            type="button"
            onClick={() => setViewing(event.media[0])}
            title="Open attachment"
            className="grid h-16 w-16 flex-none place-items-center rounded-lg bg-forest-900/5 text-forest-900/65 transition hover:ring-2 hover:ring-gold-500 dark:bg-cream-50/10 dark:text-cream-50/50"
          >
            <MediaIcon m={event.media[0]} />
          </button>
        ) : null}
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
                  className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-forest-900/10 bg-forest-900/[0.03] px-2.5 py-1 text-xs text-ink-600 transition hover:border-gold-500 hover:text-forest-900 dark:border-cream-50/10 dark:bg-cream-50/[0.04] dark:text-cream-300 dark:hover:text-cream-100"
                >
                  <MediaIcon m={m} />
                  <span className="truncate" data-no-translate>{m.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && <MinimalEditor event={event} onSaved={(ev) => { onChange(ev); setEditing(false); }} onCancel={() => setEditing(false)} />}
      {viewing && <MediaLightbox media={viewing} transcript={transcript} onClose={() => setViewing(null)} />}

      {/* Was a native confirm(), suppressed inside the Capacitor WebView. */}
      {confirmDelete && (
        <ConfirmDialog
          question="Remove this item?"
          detail="The item and anything attached to it come off your timeline. This cannot be undone."
          confirmLabel="Remove"
          cancelLabel="Keep it"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            await deleteTimelineEvent(event.id);
            onDelete(event.id);
          }}
        />
      )}
    </article>
  );
}

function MinimalEditor({ event, onSaved, onCancel }: {
  event: TimelineEvent; onSaved: (ev: TimelineEvent) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  const [occurredAt, setOccurredAt] = useState<string | null>(event.occurredAt);
  const [precision, setPrecision] = useState<OccurredPrecision>(event.occurredPrecision);
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
      <div className="rounded-lg border border-forest-900/10 bg-white/60 p-2.5 dark:border-cream-50/10 dark:bg-forest-950/40">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">When did this happen?</p>
        <SmartDatePicker
          value={occurredAt}
          precision={precision}
          minimal
          onChange={(n) => { setOccurredAt(n.occurredAt); setPrecision(n.precision); }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-ink-600">Cancel</button>
        <button type="button" disabled={pending}
          onClick={() => start(async () => {
            const prec: OccurredPrecision = occurredAt ? precision : 'unknown';
            await updateTimelineEvent(event.id, { title, description: description || null, occurredAt: occurredAt || null, occurredPrecision: prec });
            onSaved({ ...event, title, description: description || null, occurredAt: occurredAt || null, occurredPrecision: prec });
          })}
          className="rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Invite a law firm to this case (a client-friendly wrapper over the
//    collaborator invite: adds the firm as an Attorney, who then gets the full
//    build experience on the client's case). ─────────────────────────────────
function InviteFirm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open && !msg) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-forest-900/15 bg-white px-2.5 py-1 text-xs font-medium text-forest-800 hover:border-gold-500 dark:border-cream-50/15 dark:bg-forest-900/40 dark:text-cream-200"
      >
        <PersonIcon /> Invite your law firm
      </button>
    );
  }

  return (
    <div className="w-full">
      {msg && (
        <p className={`mb-2 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300'}`}>
          {msg.text}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="firm@lawfirm.com"
            className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-cream-50/20 dark:bg-forest-950"
          />
          <button
            type="button" disabled={pending || !email.trim()}
            onClick={() => start(async () => {
              setMsg(null);
              const fd = new FormData();
              fd.append('email', email.trim());
              fd.append('role', 'attorney');
              try {
                const res = await inviteCollaboratorAction(caseId, fd);
                if (!res.ok) {
                  setMsg({ ok: false, text: res.error ?? 'Invite failed.' });
                  return;
                }
                setOpen(false); setEmail('');
                setMsg({ ok: true, text: res.emailed ? `Invite sent to ${email.trim()}. Once they join, they can build your timeline.` : `${email.trim()} added. Email delivery is unconfigured, so let them know directly.` });
              } catch (err) {
                setMsg({ ok: false, text: err instanceof Error ? err.message : 'Invite failed.' });
              }
            })}
            className="flex-none rounded-lg bg-forest-900 px-3 py-1.5 text-sm font-medium text-cream-50 disabled:opacity-50 dark:bg-gold-metal dark:text-forest-950"
          >
            {pending ? 'Sending…' : 'Send invite'}
          </button>
          <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="flex-none rounded-lg px-2 py-1.5 text-sm text-ink-500">Cancel</button>
        </div>
      )}
    </div>
  );
}

