'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { CaseMap, type MapPoint } from '@/app/cases/[id]/timeline/case-map';
import {
  formatOccurred,
  folderForEvent,
  sortTimeline,
  EVIDENCE_FOLDERS,
  KIND_ICON,
  KIND_LABEL,
  PRECISION_GRAINS,
  type OccurredPrecision,
  type TimelineEvent,
  type EvidenceEdit,
} from '@/lib/timeline-types';
import {
  bulkImportCaseEvidenceAction,
  importCaseEvidenceFromUrlsAction,
  getFirmCaseTimeline,
  analyzeFirmCaseEventAction,
  updateFirmCaseEvidenceAction,
  setFirmEvidenceFolderAction,
  renameFirmEvidenceFolderAction,
  deleteFirmCaseEventAction,
  getFirmEvidenceMediaUrl,
} from '@/lib/case-evidence-actions';

// Requests are packed by BOTH a file count and a byte budget so a batch never
// exceeds the 50 MB server-action body limit, whatever the file sizes are.
const MAX_BATCH_FILES = 10;
const MAX_BATCH_BYTES = 40 * 1024 * 1024; // headroom under the 50 MB server limit
// Above this many files in one drop, import fast (no inline AI) and let the
// background queue score them - so a 1,000+ item intake isn't blocked on a
// thousand sequential model calls.
const DEFER_AI_ABOVE = 40;
const ANALYZE_CONCURRENCY = 3; // parallel scoring passes when analysing pending

/** Pack files into request-sized batches bounded by count AND total bytes. */
function packBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let cur: File[] = [];
  let curBytes = 0;
  for (const f of files) {
    if (cur.length >= MAX_BATCH_FILES || (cur.length > 0 && curBytes + f.size > MAX_BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(f);
    curBytes += f.size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * Pull real files AND web URLs out of a drop. `dataTransfer` is only valid
 * synchronously inside the drop handler, so everything is read here before
 * any await.
 */
function extractDrop(dt: DataTransfer): { files: File[]; urls: string[] } {
  const files: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null) => {
    if (!f || f.size === 0) return;
    const key = `${f.name}:${f.size}:${f.lastModified}`;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(f);
    }
  };
  if (dt.items && dt.items.length) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file') add(it.getAsFile());
    }
  }
  for (const f of Array.from(dt.files ?? [])) add(f);

  const urls: string[] = [];
  const pushUrl = (u: string) => {
    const t = u.trim();
    if (/^https?:\/\//i.test(t) && !urls.includes(t)) urls.push(t);
  };
  try {
    dt.getData('text/uri-list')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .forEach(pushUrl);
  } catch {
    /* getData can throw in some browsers mid-drag; ignore */
  }
  if (urls.length === 0) {
    try {
      const html = dt.getData('text/html');
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) pushUrl(m[1]);
    } catch {
      /* ignore */
    }
  }
  if (urls.length === 0) {
    try {
      pushUrl(dt.getData('text/plain'));
    } catch {
      /* ignore */
    }
  }
  return { files, urls };
}

/** ISO timestamp -> YYYY-MM-DD for a <input type="date"> (empty when undated). */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function EvidenceIntake({
  firmId,
  caseId,
  initialEvents,
  aiEnabled,
}: {
  firmId: string;
  caseId: string;
  initialEvents: TimelineEvent[];
  aiEnabled: boolean;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async (): Promise<TimelineEvent[]> => {
    const res = await getFirmCaseTimeline(firmId, caseId);
    if (res.ok && res.events) {
      setEvents(res.events);
      return res.events;
    }
    return [];
  }, [firmId, caseId]);

  // Score a specific set of entries, a few at a time, so a big backlog after a
  // large import gets relevance + folders without a thousand-deep serial queue.
  // Shared by the automatic post-import kick and the manual "Analyse pending".
  const runAnalyzeQueue = useCallback(
    async (queue: string[]) => {
      if (queue.length === 0) return;
      setBusy(true);
      setProgress({ done: 0, total: queue.length });
      setAnalyzing((s) => new Set([...s, ...queue]));
      let done = 0;
      let idx = 0;
      const worker = async () => {
        for (;;) {
          const i = idx++;
          if (i >= queue.length) return;
          const id = queue[i];
          const res = await analyzeFirmCaseEventAction(firmId, caseId, id);
          if (res.event) {
            const ev = res.event;
            setEvents((list) => list.map((e) => (e.id === id ? ev : e)));
          }
          setAnalyzing((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
          done += 1;
          setProgress({ done, total: queue.length });
        }
      };
      await Promise.all(Array.from({ length: ANALYZE_CONCURRENCY }, worker));
      setBusy(false);
      setProgress(null);
      setNotice(t('Scored {n} item(s).').replace('{n}', String(done)));
    },
    [firmId, caseId, t],
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      // Large drops import fast: skip inline scoring so the intake keeps moving,
      // then the queue is auto-kicked (and the cron backstops it) afterwards.
      const deferAi = aiEnabled && files.length > DEFER_AI_ABOVE;
      const batches = packBatches(files);
      let imported = 0;
      let failed = 0;
      let done = 0;
      const errors: string[] = [];
      setProgress({ done: 0, total: files.length });
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const fd = new FormData();
        for (const f of batch) fd.append('files', f);
        const res = await bulkImportCaseEvidenceAction(firmId, caseId, fd, {
          analyze: !deferAi,
        });
        imported += res.imported ?? 0;
        failed += res.failed ?? 0;
        if (res.errors) errors.push(...res.errors);
        if (!res.ok && res.error && !res.imported) errors.push(res.error);
        done += batch.length;
        setProgress({ done, total: files.length });
        // Refresh the list periodically rather than every batch so a huge drop
        // doesn't fire hundreds of timeline reads while it's still importing.
        if (b === batches.length - 1 || b % 5 === 4) await refresh();
      }
      setBusy(false);
      setProgress(null);
      const parts = [t('Imported {n} file(s).').replace('{n}', String(imported))];
      if (failed) parts.push(t('{n} could not be imported.').replace('{n}', String(failed)));
      if (errors.length) setError(errors.slice(0, 4).join('  •  '));

      // Always-on analysis: after a deferred import, kick the pending queue
      // automatically instead of waiting for the user to click a button. If the
      // tab is closed before it finishes, the cron sweep picks up the rest.
      if (deferAi && imported) {
        const fresh = await refresh();
        const queue = fresh.filter((e) => e.aiStatus === 'skipped').map((e) => e.id);
        parts.push(t('Scoring {n} item(s) in the background.').replace('{n}', String(queue.length)));
        setNotice(parts.join(' '));
        void runAnalyzeQueue(queue);
        return;
      }
      setNotice(parts.join(' '));
    },
    [firmId, caseId, refresh, aiEnabled, t, runAnalyzeQueue],
  );

  const analyzePending = useCallback(async () => {
    setError(null);
    setNotice(null);
    const queue = events.filter((e) => e.aiStatus === 'skipped').map((e) => e.id);
    await runAnalyzeQueue(queue);
  }, [events, runAnalyzeQueue]);

  const importFromUrls = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      const res = await importCaseEvidenceFromUrlsAction(firmId, caseId, urls);
      await refresh();
      setBusy(false);
      const parts = [t('Imported {n} file(s).').replace('{n}', String(res.imported ?? 0))];
      if (res.failed) parts.push(t('{n} could not be imported.').replace('{n}', String(res.failed)));
      setNotice(parts.join(' '));
      if (res.errors?.length) setError(res.errors.slice(0, 4).join('  •  '));
      else if (!res.ok && res.error) setError(res.error);
    },
    [firmId, caseId, refresh, t],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Read the transfer synchronously - it's invalid after the handler returns.
    const { files, urls } = extractDrop(e.dataTransfer);
    if (files.length) void upload(files);
    else if (urls.length) void importFromUrls(urls);
  };

  // Paste-to-add: a document-level listener catches a pasted screenshot / file /
  // http URL even when nothing is focused, without hijacking a plain text paste.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files: File[] = [];
      const seen = new Set<string>();
      const add = (f: File | null) => {
        if (!f || f.size === 0) return;
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          files.push(f);
        }
      };
      for (const it of Array.from(dt.items ?? [])) {
        if (it.kind === 'file') add(it.getAsFile());
      }
      for (const f of Array.from(dt.files ?? [])) add(f);
      if (files.length) {
        e.preventDefault();
        const stamp = Date.now();
        const named = files.map((f, i) => {
          if (f.name && f.name !== 'image.png') return f;
          const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
          return new File([f], `pasted-${stamp}-${i}.${ext}`, { type: f.type });
        });
        void upload(named);
        return;
      }
      const text = dt.getData('text/plain')?.trim();
      if (text && /^https?:\/\//i.test(text)) {
        e.preventDefault();
        void importFromUrls([text]);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [upload, importFromUrls]);

  const pendingCount = useMemo(
    () => (aiEnabled ? events.filter((e) => e.aiStatus === 'skipped').length : 0),
    [aiEnabled, events],
  );

  const reanalyze = useCallback(
    (id: string, force = false) => {
      setAnalyzing((s) => new Set(s).add(id));
      startTransition(async () => {
        const res = await analyzeFirmCaseEventAction(firmId, caseId, id, { force });
        setAnalyzing((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        if (res.needsConfirm) {
          if (typeof window !== 'undefined' && window.confirm(
            t('This entry was corrected by hand. Re-analysing replaces those edits. Continue?'),
          )) {
            reanalyze(id, true);
          }
          return;
        }
        if (res.event) setEvents((list) => list.map((e) => (e.id === id ? res.event! : e)));
        else if (res.error) setError(res.error);
      });
    },
    [firmId, caseId, t],
  );

  const remove = useCallback(
    (id: string) => {
      startTransition(async () => {
        const res = await deleteFirmCaseEventAction(firmId, caseId, id);
        if (res.ok) setEvents((list) => list.filter((e) => e.id !== id));
        else if (res.error) setError(res.error);
      });
    },
    [firmId, caseId],
  );

  const saveEdit = useCallback(
    (id: string, edit: EvidenceEdit) => {
      startTransition(async () => {
        const res = await updateFirmCaseEvidenceAction(firmId, caseId, id, edit);
        if (res.ok && res.event) {
          setEvents((list) => list.map((e) => (e.id === id ? res.event! : e)));
          setEditingId(null);
        } else if (res.error) {
          setError(res.error);
        }
      });
    },
    [firmId, caseId],
  );

  const moveFolder = useCallback(
    (id: string, folder: string) => {
      startTransition(async () => {
        const res = await setFirmEvidenceFolderAction(firmId, caseId, id, folder);
        if (res.ok && res.event) setEvents((list) => list.map((e) => (e.id === id ? res.event! : e)));
        else if (res.error) setError(res.error);
      });
    },
    [firmId, caseId],
  );

  const renameFolder = useCallback(
    (from: string, to: string) => {
      if (!to.trim() || to.trim() === from) return;
      startTransition(async () => {
        const res = await renameFirmEvidenceFolderAction(firmId, caseId, from, to.trim());
        if (res.ok) await refresh();
        else if (res.error) setError(res.error);
      });
    },
    [firmId, caseId, refresh],
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

  // Map pins across every event, carrying case-relevance for de-emphasis.
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

  // Group evidence into folders, kept in the taxonomy's order, each folder's
  // entries sorted chronologically. Only non-empty folders are shown.
  const folders = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const f = folderForEvent(e);
      const bucket = map.get(f);
      if (bucket) bucket.push(e);
      else map.set(f, [e]);
    }
    const ordered: { name: string; items: TimelineEvent[] }[] = [];
    for (const name of EVIDENCE_FOLDERS) {
      const items = map.get(name);
      if (items?.length) ordered.push({ name, items: sortTimeline(items) });
    }
    // Any folder name outside the taxonomy (shouldn't happen, but never hide data).
    for (const [name, items] of map) {
      if (!(EVIDENCE_FOLDERS as readonly string[]).includes(name)) {
        ordered.push({ name, items: sortTimeline(items) });
      }
    }
    return ordered;
  }, [events]);

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? 'border-forest-500 bg-forest-50/60 dark:bg-forest-900/40'
            : 'border-ink-200 dark:border-forest-700/40'
        }`}
      >
        <p className="text-2xl">🗂️</p>
        <p className="mt-1 text-[14px] font-medium text-forest-900 dark:text-cream-100">
          <T>Drop evidence here</T>
        </p>
        <p className="mt-0.5 text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>Photos, video, PDFs and documents, and email files (.eml, .msg). Drop many at once.</T>
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-400 dark:text-cream-100/45">
          <T>Advottic reads each item, files it into a folder, and scores how it bears on the case. Thousands at once is fine.</T>
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="btn-primary disabled:opacity-50"
          >
            {busy
              ? progress
                ? t('Working {d}/{n}…').replace('{d}', String(progress.done)).replace('{n}', String(progress.total))
                : t('Working…')
              : t('Choose files')}
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void analyzePending()}
              className="inline-flex items-center min-h-[38px] px-3 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[13px] text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
            >
              {t('Analyse pending ({n})').replace('{n}', String(pendingCount))}
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,application/pdf,.doc,.docx,text/*,audio/*,.eml,.msg,message/rfc822"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void upload(files);
            e.target.value = '';
          }}
        />
        {!aiEnabled && (
          <p className="mt-2 text-[11px] text-ink-400 dark:text-cream-100/40">
            <T>Files are stored on the timeline. AI analysis and relevance scoring need a firm plan.</T>
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[13px] text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-forest-200 dark:border-forest-700/40 bg-forest-50 dark:bg-forest-900/30 px-3 py-2 text-[13px] text-forest-800 dark:text-cream-100/80">
          {notice}
        </p>
      )}

      {/* Breadcrumb map (renders nothing without a Maps key or located pins) */}
      <CaseMap points={mapPoints} title={t('Case map')} />

      {/* Evidence, organised into folders */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            <T>Evidence</T> <span className="text-ink-400 dark:text-cream-100/40">({events.length})</span>
          </h2>
          <Link
            href={`/counsel/cases/${caseId}/timeline`}
            className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
          >
            <T>Open full timeline builder</T> →
          </Link>
        </div>

        {events.length === 0 ? (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            <T>No evidence yet. Drop files above to begin.</T>
          </p>
        ) : (
          folders.map((folder) => (
            <FolderSection
              key={folder.name}
              name={folder.name}
              items={folder.items}
              collapsed={collapsed.has(folder.name)}
              onToggle={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  if (n.has(folder.name)) n.delete(folder.name);
                  else n.add(folder.name);
                  return n;
                })
              }
              onRename={(to) => renameFolder(folder.name, to)}
              renderItem={(e) => (
                <EvidenceCard
                  key={e.id}
                  event={e}
                  aiEnabled={aiEnabled}
                  busy={pending}
                  analyzing={analyzing.has(e.id) || e.aiStatus === 'running'}
                  editing={editingId === e.id}
                  onEdit={() => setEditingId(e.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(edit) => saveEdit(e.id, edit)}
                  onReanalyze={() => reanalyze(e.id)}
                  onMoveFolder={(folderName) => moveFolder(e.id, folderName)}
                  onDelete={() => remove(e.id)}
                  onOpen={() => openMedia(e.media[0]?.path ?? '')}
                />
              )}
            />
          ))
        )}
      </section>
    </div>
  );
}

/** A collapsible folder header with an inline rename, wrapping its entries. */
function FolderSection({
  name,
  items,
  collapsed,
  onToggle,
  onRename,
  renderItem,
}: {
  name: string;
  items: TimelineEvent[];
  collapsed: boolean;
  onToggle: () => void;
  onRename: (to: string) => void;
  renderItem: (e: TimelineEvent) => React.ReactNode;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div className="rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-cream-50/70 dark:bg-forest-900/30">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 min-w-0 text-left"
          aria-expanded={!collapsed}
        >
          <span className="text-ink-400 dark:text-cream-100/45 text-[11px]">{collapsed ? '▸' : '▾'}</span>
          {renaming ? null : (
            <span className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 truncate" data-no-translate>
              {name}
            </span>
          )}
          <span className="text-[11.5px] text-ink-400 dark:text-cream-100/45">({items.length})</span>
        </button>
        {renaming ? (
          <form
            className="flex items-center gap-1.5 ml-auto"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(draft);
              setRenaming(false);
            }}
          >
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-1.5 py-1"
              data-no-translate
            >
              {EVIDENCE_FOLDERS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button type="submit" className="text-[12px] text-forest-700 dark:text-cream-100/80 hover:underline">
              <T>Save</T>
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
            >
              <T>Cancel</T>
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setRenaming(true);
            }}
            className="ml-auto text-[11.5px] text-ink-400 dark:text-cream-100/45 hover:text-ink-600 dark:hover:text-cream-100/70"
            title={t('Rename folder')}
          >
            <T>Rename</T>
          </button>
        )}
      </div>
      {!collapsed && <ul className="p-2 space-y-2">{items.map((e) => renderItem(e))}</ul>}
    </div>
  );
}

/** A row of small labelled chips for one extracted field (people, orgs, ...). */
function ChipRow({ icon, label, items }: { icon: string; label: string; items?: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-no-translate>
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
        {icon} {label}
      </span>
      {items.slice(0, 12).map((it, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full bg-cream-100/80 dark:bg-forest-800/50 px-2 py-[1px] text-[11px] text-ink-700 dark:text-cream-100/80"
        >
          {it}
        </span>
      ))}
      {items.length > 12 && (
        <span className="text-[10.5px] text-ink-400 dark:text-cream-100/40">+{items.length - 12}</span>
      )}
    </div>
  );
}

/** One evidence entry: header, scene summary, extracted chips, and edit form. */
function EvidenceCard({
  event: e,
  aiEnabled,
  busy,
  analyzing,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onReanalyze,
  onMoveFolder,
  onDelete,
  onOpen,
}: {
  event: TimelineEvent;
  aiEnabled: boolean;
  busy: boolean;
  analyzing: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (edit: EvidenceEdit) => void;
  onReanalyze: () => void;
  onMoveFolder: (folder: string) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const ext = e.aiExtracted ?? {};
  const currentFolder = folderForEvent(e);
  const edited = Boolean(ext.edited_at);

  if (editing) {
    return (
      <li className="card p-3">
        <EditForm event={e} onCancel={onCancelEdit} onSave={onSave} busy={busy} />
      </li>
    );
  }

  return (
    <li className="card p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex flex-wrap items-center gap-1.5">
            <span>{KIND_ICON[e.kind]}</span>
            <span className="break-words" data-no-translate>{e.title || t('(untitled)')}</span>
            <RelevanceBadge score={ext.relevance_score} reason={ext.relevance_reason} size="xs" />
            {edited && (
              <span
                className="inline-flex items-center rounded-full bg-forest-100 dark:bg-forest-800/60 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em] text-forest-700 dark:text-cream-100/70"
                title={t('Corrected by hand')}
              >
                <T>Edited</T>
              </span>
            )}
          </p>
          <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            {formatOccurred(e.occurredAt, e.occurredPrecision)}
            {e.sourceLabel ? ` · ${e.sourceLabel}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] shrink-0">
          {e.media[0] && (
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
            >
              <T>Open</T>
            </button>
          )}
          {aiEnabled && (
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
            >
              <T>Edit</T>
            </button>
          )}
          {aiEnabled && (
            <button
              type="button"
              disabled={analyzing || busy}
              onClick={onReanalyze}
              className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
            >
              {analyzing ? <T>Analysing…</T> : <T>Re-analyse</T>}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="inline-flex items-center min-h-[30px] px-2.5 rounded-md text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
          >
            <T>Delete</T>
          </button>
        </div>
      </div>

      {ext.email && (
        <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
          {ext.email.from ? `From ${ext.email.from}` : ''}
          {ext.email.to?.length ? ` → ${ext.email.to.slice(0, 3).join(', ')}` : ''}
        </p>
      )}

      {e.aiStatus === 'error' && e.aiError ? (
        <p className="text-[12px] text-rose-600 dark:text-rose-300">{e.aiError}</p>
      ) : analyzing ? (
        <p className="text-[12px] text-ink-400 dark:text-cream-100/40 italic">
          <T>Analysing…</T>
        </p>
      ) : e.aiStatus === 'skipped' ? (
        <p className="text-[12px] text-ink-400 dark:text-cream-100/40 italic">
          <T>Waiting to be analysed…</T>
        </p>
      ) : e.aiSummary ? (
        <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 whitespace-pre-wrap" data-no-translate>
          {e.aiSummary}
        </p>
      ) : null}

      {/* What Advottic mined from this item */}
      <div className="space-y-1">
        <ChipRow icon="👤" label={t('People')} items={ext.detected_people} />
        <ChipRow icon="🏢" label={t('Organizations')} items={ext.organizations} />
        <ChipRow icon="📍" label={t('Locations')} items={ext.locations} />
        <ChipRow icon="📅" label={t('Dates')} items={ext.detected_dates} />
        <ChipRow icon="🔎" label={t('Details')} items={ext.objects} />
      </div>

      {/* Move between folders */}
      {aiEnabled && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Folder</T>
          </label>
          <select
            value={currentFolder}
            disabled={busy}
            onChange={(ev) => onMoveFolder(ev.target.value)}
            className="text-[11.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-1.5 py-0.5 disabled:opacity-50"
            data-no-translate
          >
            {EVIDENCE_FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}

/** Multi-line -> trimmed list, and back, for the editable chip fields. */
function linesToList(s: string): string[] {
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The inline correction form shown when an entry is being edited. */
function EditForm({
  event: e,
  onCancel,
  onSave,
  busy,
}: {
  event: TimelineEvent;
  onCancel: () => void;
  onSave: (edit: EvidenceEdit) => void;
  busy: boolean;
}) {
  const t = useT();
  const ext = e.aiExtracted ?? {};
  const [title, setTitle] = useState(e.title ?? '');
  const [summary, setSummary] = useState(e.aiSummary ?? '');
  const [date, setDate] = useState(toDateInput(e.occurredAt));
  const [precision, setPrecision] = useState<OccurredPrecision>(
    e.occurredAt ? (e.occurredPrecision === 'unknown' ? 'day' : e.occurredPrecision) : 'day',
  );
  const [people, setPeople] = useState((ext.detected_people ?? []).join('\n'));
  const [orgs, setOrgs] = useState((ext.organizations ?? []).join('\n'));
  const [locations, setLocations] = useState((ext.locations ?? []).join('\n'));
  const [dates, setDates] = useState((ext.detected_dates ?? []).join('\n'));

  const field = 'w-full text-[12.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-2 py-1.5';
  const listBox = `${field} min-h-[52px] whitespace-pre font-mono`;

  return (
    <form
      className="space-y-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSave({
          title,
          summary,
          occurredAt: date || null,
          occurredPrecision: precision,
          detectedPeople: linesToList(people),
          organizations: linesToList(orgs),
          locations: linesToList(locations),
          detectedDates: linesToList(dates),
        });
      }}
    >
      <div>
        <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Title</T></label>
        <input value={title} onChange={(ev) => setTitle(ev.target.value)} className={field} data-no-translate />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>What this shows</T></label>
        <textarea value={summary} onChange={(ev) => setSummary(ev.target.value)} rows={3} className={field} data-no-translate />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Date</T></label>
          <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} className={field} />
        </div>
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Precision</T></label>
          <select
            value={precision}
            onChange={(ev) => setPrecision(ev.target.value as OccurredPrecision)}
            className={field}
            disabled={!date}
          >
            {PRECISION_GRAINS.filter((g) => g.value !== 'unknown').map((g) => (
              <option key={g.value} value={g.value}>
                {t(g.label)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>People (one per line)</T></label>
          <textarea value={people} onChange={(ev) => setPeople(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Organizations (one per line)</T></label>
          <textarea value={orgs} onChange={(ev) => setOrgs(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Locations (one per line)</T></label>
          <textarea value={locations} onChange={(ev) => setLocations(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40"><T>Dates (one per line)</T></label>
          <textarea value={dates} onChange={(ev) => setDates(ev.target.value)} className={listBox} data-no-translate />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
          <T>Save changes</T>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center min-h-[38px] px-3 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[13px] text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/30"
        >
          <T>Cancel</T>
        </button>
      </div>
    </form>
  );
}
