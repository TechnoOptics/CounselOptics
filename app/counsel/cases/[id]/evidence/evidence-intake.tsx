'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { EvidencePreview } from '@/components/EvidencePreview';
import { isNativeApp } from '@/lib/platform';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  formatOccurred,
  folderForEvent,
  capturedAt,
  exhibitLabel,
  isOnTimeline,
  relevanceBand,
  sortTimeline,
  EVIDENCE_FOLDERS,
  KIND_LABEL,
  PRECISION_GRAINS,
  type OccurredPrecision,
  type TimelineEvent,
  type TimelineKind,
  type EvidenceEdit,
} from '@/lib/timeline-types';
import {
  bulkImportCaseEvidenceAction,
  importCaseEvidenceFromUrlsAction,
  getFirmCaseTimeline,
  getFirmCaseTimelinePage,
  type EvidencePageCursor,
  analyzeFirmCaseEventAction,
  updateFirmCaseEvidenceAction,
  setFirmEvidenceFolderAction,
  renameFirmEvidenceFolderAction,
  deleteFirmCaseEventAction,
  setFirmEvidenceExcludedAction,
  setFirmEvidenceOnTimelineAction,
  updateFirmEvidenceCollectionsAction,
  deleteFirmEvidenceCollectionAction,
  setEvidenceFolderVisibilityAction,
  checkEvidenceDuplicatesAction,
  listCaseEvidenceNamesAction,
  exportSelectedEvidenceAction,
  type EvidenceExportItem,
} from '@/lib/case-evidence-actions';
import { EvidenceViewer } from './evidence-viewer';
import { KindIcon } from '@/components/counsel/KindIcon';
import { ExpandableText } from '@/components/ExpandableText';
import { EvidenceDashboard } from './evidence-dashboard';
import { DuplicatePanel, findDuplicateGroups } from './duplicate-panel';
import { DuplicateDialog, type DuplicateAction, type DuplicateEntry } from './duplicate-dialog';
import { ShareExportDialog } from './share-export-dialog';
import { ShareDialog, type ShareTarget } from '@/components/counsel/ShareDialog';
import { Dialog } from '@/components/Dialog';

// How often the list re-syncs from the server as a fallback to Realtime, so
// items and scores another member (or the background scorer) produced appear
// without a manual reload. Only fires when the view is idle (see the effect).
const AUTO_REFRESH_MS = 25_000;

// Requests are packed by BOTH a file count and a byte budget so a batch never
// exceeds the 50 MB server-action body limit, whatever the file sizes are.
// Smaller batches upload + import well within the request timeout even on a
// modest connection, so a big drop no longer times out and skips items. (Was
// 10 files / 40 MB, which on limited upload bandwidth could exceed the timeout.)
const MAX_BATCH_FILES = 6;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
// Above this many files in one drop, import fast (no inline AI) and let the
// background queue score them - so a 1,000+ item intake isn't blocked on a
// thousand sequential model calls.
const DEFER_AI_ABOVE = 5;
const ANALYZE_CONCURRENCY = 3; // parallel scoring passes when analysing pending
const BULK_CONCURRENCY = 3; // parallel workers for bulk delete / re-analyse
// Above this many files in one drop, skip the interactive duplicate prompt: a
// per-file dialog is impractical at that scale (and hashing every file up front
// is heavy). The server still records each file's hash, so later smaller imports
// still detect these as duplicates.
const DEDUPE_PROMPT_MAX = 60;
const UPLOAD_CONCURRENCY = 2; // parallel import requests; 2 avoids saturating a modest upload link (each in-flight batch competes for the same bandwidth)
const BATCH_RETRIES = 2; // retry a failed batch before giving up (so one blip can't abort a 1,000-file run)
const BATCH_TIMEOUT_MS = 180_000; // give up on a hung request so the whole drop can't stall forever (generous: a slow link needs time to push a batch)
const REFRESH_TIMEOUT_MS = 20_000; // list re-sync is best-effort; never let it freeze the upload spinner

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

/** Hex SHA-256 of a file's bytes, for client-side duplicate pre-checks. */
async function hashFile(file: File): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** Insert a " (copy)" before the extension so a kept-both duplicate is distinct. */
function copyName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (copy)`;
  return `${name.slice(0, dot)} (copy)${name.slice(dot)}`;
}

/**
 * Field-aware, token-based search scoring. Every whitespace token must match
 * SOMEWHERE (AND semantics - "hohag budget 2014" narrows with each word), and
 * each token is scored by WHERE it hits: exhibit number > title > filename /
 * people / organizations > place / folder / kind / date > summary > extracted
 * text - so results can rank the strongest matches first. Exhibit numbers are
 * understood however they're typed: "1451", "ex1451", "EX-1451".
 */
function scoreEventForQuery(e: TimelineEvent, tokens: string[]): number {
  const ext = e.aiExtracted ?? {};
  const exh = (exhibitLabel(ext.exhibit_no) || '').toLowerCase();
  const title = (e.title || '').toLowerCase();
  const files = e.media.map((m) => m.name || '').join(' ').toLowerCase();
  const people = (ext.detected_people ?? []).join(' ').toLowerCase();
  const orgs = (ext.organizations ?? []).join(' ').toLowerCase();
  const places = (ext.locations ?? []).join(' ').toLowerCase();
  const folder = folderForEvent(e).toLowerCase();
  const kind = `${KIND_LABEL[e.kind]} ${ext.document_type ?? ''} ${e.sourceLabel ?? ''}`.toLowerCase();
  const dates = [formatOccurred(e.occurredAt, e.occurredPrecision), ...(ext.detected_dates ?? [])]
    .join(' ')
    .toLowerCase();
  const summary = (e.aiSummary || '').toLowerCase();
  const deepText = `${ext.ocr_text ?? ''} ${(ext.objects ?? []).join(' ')}`.toLowerCase();

  let total = 0;
  for (const t of tokens) {
    let s = 0;
    // Exhibit-number awareness: "1451" / "ex1451" / "ex-1451" all hit EX-1451
    // exactly, scored above everything else.
    const exm = t.match(/^(?:ex-?)?0*(\d{1,5})$/);
    if (exm && typeof ext.exhibit_no === 'number' && String(Math.floor(ext.exhibit_no)) === exm[1]) {
      s = 12;
    } else if (exh && exh.includes(t)) s = 10;
    else if (title.includes(t)) s = 8;
    else if (files.includes(t)) s = 6;
    else if (people.includes(t) || orgs.includes(t)) s = 6;
    else if (places.includes(t)) s = 5;
    else if (folder.includes(t) || kind.includes(t)) s = 4;
    else if (dates.includes(t)) s = 4;
    else if (summary.includes(t)) s = 3;
    else if (deepText.includes(t)) s = 2;
    if (s === 0) return 0; // every token must land somewhere
    total += s;
  }
  return total;
}

/** A month bucket key + label for date grouping. */
function monthBucket(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: 'zzzz-undated', label: 'Undated' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'zzzz-undated', label: 'Undated' };
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key, label };
}

type GroupMode = 'folder' | 'date' | 'relevance';

/** A single-dimension focus applied from the dashboard's deep links
 *  (?folder=, ?relevance=, ?status=, ?doctype=, ?type=, ?year=). Narrows the
 *  working list to exactly the slice a metric or chart segment represents, so
 *  the dashboard reads as a launchpad into the evidence rather than a static
 *  readout. */
type Focus = {
  folder?: string;
  relevance?: 'high' | 'medium' | 'low' | 'unscored';
  status?: 'done' | 'error' | 'pending';
  doctype?: string;
  type?: 'images' | 'videos' | 'emails' | 'docs';
  year?: string;
};

function parseFocus(sp: URLSearchParams | null): Focus {
  const f: Focus = {};
  if (!sp) return f;
  const folder = sp.get('folder');
  if (folder) f.folder = folder;
  const rel = sp.get('relevance');
  if (rel === 'high' || rel === 'medium' || rel === 'low' || rel === 'unscored') f.relevance = rel;
  const st = sp.get('status');
  if (st === 'done' || st === 'error' || st === 'pending') f.status = st;
  const dt = sp.get('doctype');
  if (dt) f.doctype = dt;
  const ty = sp.get('type');
  if (ty === 'images' || ty === 'videos' || ty === 'emails' || ty === 'docs') f.type = ty;
  const yr = sp.get('year');
  if (yr && /^\d{4}$/.test(yr)) f.year = yr;
  return f;
}

function focusActive(f: Focus): boolean {
  return !!(f.folder || f.relevance || f.status || f.doctype || f.type || f.year);
}

const REL_LABEL: Record<NonNullable<Focus['relevance']>, string> = {
  high: 'Highly relevant',
  medium: 'Relevant',
  low: 'Low relevance',
  unscored: 'Not yet scored',
};
const STATUS_LABEL: Record<NonNullable<Focus['status']>, string> = {
  done: 'Analyzed',
  error: 'Not analyzable',
  pending: 'In progress',
};
const TYPE_LABEL: Record<NonNullable<Focus['type']>, string> = {
  images: 'Images',
  videos: 'Video',
  emails: 'Emails',
  docs: 'Documents',
};

function focusLabel(f: Focus): string {
  if (f.folder) return f.folder;
  if (f.relevance) return REL_LABEL[f.relevance];
  if (f.status) return STATUS_LABEL[f.status];
  if (f.doctype) return f.doctype;
  if (f.type) return TYPE_LABEL[f.type];
  if (f.year) return f.year;
  return '';
}

function eventMediaClass(e: TimelineEvent): 'images' | 'videos' | 'emails' | 'docs' | 'other' {
  const mime = (e.media?.[0]?.mime ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime === 'message/rfc822') return 'emails';
  if (mime.startsWith('application/') || mime.startsWith('text/')) return 'docs';
  return 'other';
}

function matchesFocus(e: TimelineEvent, f: Focus): boolean {
  if (f.folder && folderForEvent(e) !== f.folder) return false;
  if (f.relevance && (relevanceBand(e.aiExtracted?.relevance_score) ?? 'unscored') !== f.relevance) return false;
  if (f.status) {
    const s = e.aiStatus;
    if (f.status === 'done' && s !== 'done') return false;
    if (f.status === 'error' && s !== 'error') return false;
    if (f.status === 'pending' && (s === 'done' || s === 'error')) return false;
  }
  if (f.doctype && (e.aiExtracted?.document_type ?? '') !== f.doctype) return false;
  if (f.type && eventMediaClass(e) !== f.type) return false;
  if (f.year && (e.aiExtracted?.suggested_occurred_at ?? '').slice(0, 4) !== f.year) return false;
  return true;
}
type ViewMode = 'gallery' | 'list' | 'grid';

type FolderMeta = { createdBy: string | null; isPublic: boolean; createdAt?: string };

export function EvidenceIntake({
  firmId,
  caseId,
  initialEvents,
  initialCursor = null,
  aiEnabled,
  viewerId = null,
  initialFolderMeta = {},
}: {
  firmId: string;
  caseId: string;
  initialEvents: TimelineEvent[];
  /** Keyset cursor for the page after `initialEvents`; null when the first page
   *  was the whole matter. When present the client streams the rest. */
  initialCursor?: EvidencePageCursor | null;
  aiEnabled: boolean;
  /** Signed-in user, for private-folder visibility + the folder toggle. */
  viewerId?: string | null;
  /** Folder visibility registry (who created each folder; public/private). */
  initialFolderMeta?: Record<string, FolderMeta>;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  // Keyset streaming: page 1 (initialEvents) paints instantly; the remaining
  // pages stream in here and append, so a heavy matter is interactive at once.
  // `loadedAll` gates the effects that need the WHOLE set (resume-analysis).
  const [loadedAll, setLoadedAll] = useState<boolean>(initialCursor == null);
  const streamRef = useRef(false);
  useEffect(() => {
    if (streamRef.current || initialCursor == null) return;
    streamRef.current = true;
    let cancelled = false;
    (async () => {
      let cursor: EvidencePageCursor | null = initialCursor;
      while (cursor && !cancelled) {
        const res = await getFirmCaseTimelinePage(firmId, caseId, { cursor });
        if (!res.ok || !res.events) break;
        const batch = res.events;
        setEvents((list) => {
          const seen = new Set(list.map((e) => e.id));
          const fresh = batch.filter((e) => !seen.has(e.id));
          return fresh.length ? [...list, ...fresh] : list;
        });
        cursor = res.nextCursor ?? null;
      }
      if (!cancelled) setLoadedAll(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [firmId, caseId, initialCursor]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Fast first paint on a heavy matter: open with every folder section
    // collapsed so hundreds of evidence cards don't all mount on load (the main
    // cause of the intake feeling slow). Small matters open fully expanded.
    const active = initialEvents.filter((e) => !e.aiExtracted?.excluded);
    if (active.length <= 60) return new Set();
    const names = new Set<string>();
    for (const e of active) names.add(folderForEvent(e));
    return names;
  });
  const [pending, startTransition] = useTransition();

  // View + organisation controls. Grid is the default: the readable, image-first
  // layout the firm reviews evidence in; the list stays a click away.
  const [view, setView] = useState<ViewMode>('gallery');
  // Deep-link focus from the dashboard: the URL search params narrow the list to
  // the slice a metric/chart segment stands for, and preset the grouping.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [focus, setFocus] = useState<Focus>(() => parseFocus(searchParams));
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    const g = searchParams?.get('group');
    return g === 'date' || g === 'relevance' || g === 'folder' ? g : 'folder';
  });
  const clearFocus = useCallback(() => {
    setFocus({});
    if (pathname) router.replace(pathname, { scroll: false });
  }, [pathname, router]);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  // When a search begins, bring the results into view and keep them the main
  // focus (the search bar sits above analytics/upload zones that would
  // otherwise leave the matches below the fold).
  const resultsRef = useRef<HTMLElement | null>(null);
  const wasSearching = useRef(false);
  useEffect(() => {
    if (searching && !wasSearching.current) {
      resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    wasSearching.current = searching;
  }, [searching]);
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(new Set());
  const [hiddenKinds, setHiddenKinds] = useState<Set<TimelineKind>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  // Items set aside as "not part of the case" are hidden by default, with a
  // toggle to bring them back into view (to restore or delete them).
  const [showExcluded, setShowExcluded] = useState(false);
  const [dupDismissed, setDupDismissed] = useState(false);
  // Add-evidence section: expanded on an empty matter, otherwise collapsed so
  // the page leads with search + the evidence itself. Dragging files over the
  // collapsed row expands it. The one-line "at a glance" strip expands into
  // the full dashboard on demand.
  const [showIntake, setShowIntake] = useState<boolean | null>(null);
  const intakeOpen = showIntake ?? events.length === 0;
  const intakeRef = useRef<HTMLElement | null>(null);
  const [glanceOpen, setGlanceOpen] = useState(false);
  const openIntake = useCallback(() => {
    setShowIntake(true);
    setTimeout(() => intakeRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }, []);

  // Selection + viewer + dialogs
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Folders (collections) tab: named, hand-built groupings of evidence.
  // Membership is a pure filter (ai_extracted.collections) - nothing moves.
  const [tab, setTab] = useState<'evidence' | 'folders'>('evidence');
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderMeta, setFolderMeta] = useState<Record<string, FolderMeta>>(initialFolderMeta);

  // Deep links from the header search / Folders nav: ?q= prefills the smart
  // search, ?tab=folders opens the Folders tab (optionally ?open=<name> jumps
  // straight into that folder). Tracked by value so the effect re-applies on
  // client-side navigation but never fights the user's own typing.
  const lastDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${searchParams?.get('q') ?? ''}|${searchParams?.get('tab') ?? ''}|${searchParams?.get('open') ?? ''}`;
    if (lastDeepLinkRef.current === key) return;
    lastDeepLinkRef.current = key;
    const q = searchParams?.get('q');
    if (searchParams?.get('tab') === 'folders') {
      setTab('folders');
      setOpenCollection(searchParams?.get('open') ?? null);
    } else if (q) {
      setTab('evidence');
      setQuery(q);
    }
  }, [searchParams]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [dedupe, setDedupe] = useState<{ entries: DuplicateEntry[]; all: { file: File; hash: string | null }[] } | null>(null);
  const [shareData, setShareData] = useState<{ matter: string; items: EvidenceExportItem[] } | null>(null);
  // Secure encrypt-and-send of the selected exhibits' ORIGINAL files.
  const [secureShare, setSecureShare] = useState<ShareTarget | null>(null);

  const refresh = useCallback(async (): Promise<TimelineEvent[]> => {
    // Best-effort list re-sync. It's awaited mid-upload while `busy` is
    // true, so a hung or failed request (flaky mobile network) must
    // never freeze the spinner: race a timeout and swallow errors. The
    // batches have already landed server-side; the list catches up on
    // the next load / auto-resume.
    try {
      const res = await Promise.race([
        getFirmCaseTimeline(firmId, caseId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('__timeout__')), REFRESH_TIMEOUT_MS),
        ),
      ]);
      if (res.ok && res.events) {
        setEvents(res.events);
        return res.events;
      }
    } catch {
      /* keep the current list; do not freeze the upload */
    }
    return [];
  }, [firmId, caseId]);

  // Score a specific set of entries, a few at a time, so a big backlog after a
  // large import gets relevance + folders without a thousand-deep serial queue.
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

  // Warn before a refresh / tab-close while an import is running: the un-sent
  // files live only in this tab (the browser can't re-read them after a reload),
  // so leaving mid-upload would lose whatever hasn't been sent yet.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  // Resume analysis after a reload: anything already uploaded but not yet
  // scored (ai_status 'skipped') OR that failed a prior attempt ('error') is
  // picked back up automatically, so an unanalyzed upload never stays
  // unanalyzed and a transient failure self-heals on the next visit. Runs once
  // per mount; the server-side cron also backstops this.
  // Exhibit-number safety net. Keyset pages skip backfill (it must renumber
  // across the whole matter, not per page). Once fully streamed, if anything is
  // still unnumbered, do ONE full refresh - which runs the server-side backfill
  // and repopulates. Fires only for a matter that actually has unnumbered items
  // (essentially none in steady state, since every prior full load numbered
  // them and post-upload refresh numbers new ones), so the common path pays
  // nothing.
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (backfilledRef.current || !loadedAll) return;
    backfilledRef.current = true;
    if (events.some((e) => typeof e.aiExtracted?.exhibit_no !== 'number')) {
      void refresh();
    }
  }, [loadedAll, events, refresh]);

  const resumedRef = useRef(false);
  useEffect(() => {
    // Wait for the full keyset stream before queuing, so unanalyzed items on
    // later pages aren't missed (loadedAll is true immediately when there was
    // only one page).
    if (resumedRef.current || !aiEnabled || !loadedAll) return;
    resumedRef.current = true;
    const queue = events
      .filter((e) => (e.aiStatus === 'skipped' || e.aiStatus === 'error') && !e.aiExtracted?.duplicate_of)
      .map((e) => e.id);
    if (queue.length) void runAnalyzeQueue(queue);
  }, [aiEnabled, loadedAll, events, runAnalyzeQueue]);

  // Latest interaction state, read by the auto-refresh guard so a background
  // re-sync never clobbers an in-progress upload / edit / selection / viewer.
  const idleRef = useRef(true);
  idleRef.current =
    !busy && !pending && editingId === null && selected.size === 0 && dedupe === null && viewerIndex === null;

  // Auto-refresh: a Supabase Realtime subscription on this case's evidence rows
  // nudges a re-sync when anything changes, with a slow poll as a fallback (firm
  // members are not case members, so Realtime row delivery is best-effort; the
  // poll keeps new items + fresh scores flowing in either way). Both only fire
  // when the view is idle, so they never interrupt work in progress.
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const syncIfIdle = () => {
      if (cancelled || !idleRef.current) return;
      void refresh();
    };
    const scheduleSync = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(syncIfIdle, 1200);
    };
    try {
      const supabase = createBrowserSupabase();
      const channel = supabase
        .channel(`case-evidence:${caseId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'case_timeline_events', filter: `case_id=eq.${caseId}` },
          scheduleSync,
        )
        .subscribe();
      const poll = setInterval(syncIfIdle, AUTO_REFRESH_MS);
      return () => {
        cancelled = true;
        if (debounce) clearTimeout(debounce);
        clearInterval(poll);
        supabase.removeChannel(channel);
      };
    } catch {
      // Supabase env not configured here: skip live refresh, nothing else breaks.
      return () => {
        cancelled = true;
      };
    }
  }, [caseId, refresh]);

  /** The actual upload: batch the files and (on the first batch) apply replaces. */
  const performUpload = useCallback(
    async (files: File[], replaceHashes: string[] = []) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      const deferAi = aiEnabled && files.length > DEFER_AI_ABOVE;
      const batches = packBatches(files);
      let imported = 0;
      let failed = 0;
      let done = 0;
      let sinceRefresh = 0;
      const errors: string[] = [];
      setProgress({ done: 0, total: files.length });

      // Send one batch with a timeout + retries. A batch that keeps failing (or
      // hangs) is counted and SKIPPED - it must never throw out of here, or the
      // whole run would abort partway (which read like an upload "cap"/hang).
      const sendBatch = async (batch: File[], replaces: string[] | undefined) => {
        for (let attempt = 0; ; attempt++) {
          try {
            const fd = new FormData();
            for (const f of batch) fd.append('files', f);
            return await Promise.race([
              bulkImportCaseEvidenceAction(firmId, caseId, fd, {
                analyze: !deferAi,
                replaceHashes: replaces,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('__timeout__')), BATCH_TIMEOUT_MS),
              ),
            ]);
          } catch (err) {
            const timedOut = err instanceof Error && err.message === '__timeout__';
            // A timeout is terminal (the request may still be completing
            // server-side; retrying could double-import). Other errors retry.
            if (timedOut || attempt >= BATCH_RETRIES) {
              return {
                ok: false,
                imported: 0,
                failed: batch.length,
                errors: [timedOut ? 'A batch timed out and was skipped.' : err instanceof Error ? err.message : 'Upload failed.'],
              };
            }
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      };

      const tally = (batch: File[], res: { ok?: boolean; imported?: number; failed?: number; error?: string; errors?: string[] }) => {
        imported += res.imported ?? 0;
        failed += res.failed ?? 0;
        if (res.errors) errors.push(...res.errors);
        if (!res.ok && res.error && !res.imported) errors.push(res.error);
        done += batch.length;
        sinceRefresh += batch.length;
        setProgress({ done, total: files.length });
      };

      try {
        if (batches.length > 0) {
          // First batch carries any replaceHashes and runs alone, so the
          // "replace" resolution happens exactly once before anything else.
          tally(batches[0], await sendBatch(batches[0], replaceHashes));
          await refresh();
          sinceRefresh = 0;
          // Remaining batches go through a small worker pool for speed, while
          // still refreshing the list periodically (not on every batch).
          let next = 1;
          const worker = async () => {
            for (;;) {
              const i = next++;
              if (i >= batches.length) return;
              tally(batches[i], await sendBatch(batches[i], undefined));
              if (sinceRefresh >= 40 || done === files.length) {
                sinceRefresh = 0;
                await refresh();
              }
            }
          };
          await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
        }
      } finally {
        setBusy(false);
        setProgress(null);
      }

      const parts = [t('Imported {n} file(s).').replace('{n}', String(imported))];
      if (failed) parts.push(t('{n} could not be imported.').replace('{n}', String(failed)));
      if (errors.length) setError(errors.slice(0, 4).join('  •  '));

      if (deferAi && imported) {
        const fresh = await refresh();
        const queue = fresh.filter((e) => e.aiStatus === 'skipped' && !e.aiExtracted?.duplicate_of).map((e) => e.id);
        parts.push(t('Scoring {n} item(s) in the background.').replace('{n}', String(queue.length)));
        setNotice(parts.join(' '));
        void runAnalyzeQueue(queue);
        return;
      }
      setNotice(parts.join(' '));
    },
    [firmId, caseId, refresh, aiEnabled, t, runAnalyzeQueue],
  );

  /** Upload entry point: pre-check for duplicates, prompt, then hand off. */
  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      setError(null);

      // ── Zip expansion ───────────────────────────────────────────────────
      // A firm can zip a folder of exhibits and drop the single archive; we
      // expand it in the browser and feed the extracted files into the exact
      // same pipeline (dedup → upload → analysis → exhibit numbers). Loaded
      // lazily so fflate isn't in the initial bundle.
      let sourceFiles = files;
      if (files.some((f) => /\.zip$/i.test(f.name) || /zip/.test(f.type))) {
        const { expandZips } = await import('./unzip');
        const z = await expandZips(files);
        sourceFiles = z.files;
        if (z.archives > 0) {
          setNotice(
            t('Unzipped {n} file(s) from {z} archive(s).')
              .replace('{n}', String(z.extracted))
              .replace('{z}', String(z.archives)),
          );
        }
        if (sourceFiles.length === 0) {
          setBusy(false);
          return;
        }
      }

      // ── Name-based auto-skip ────────────────────────────────────────────
      // A file whose name already exists in this matter is silently skipped -
      // no prompt - so re-dropping the same set never re-imports duplicates.
      // This also de-dupes by name WITHIN the current drop. Runs before the
      // content-hash prompt and before the large-drop shortcut.
      let candidates = sourceFiles;
      let autoSkipped = 0;
      const namesRes = await listCaseEvidenceNamesAction(firmId, caseId);
      if (namesRes.ok && namesRes.names) {
        const existing = new Set(namesRes.names);
        const seen = new Set<string>();
        candidates = files.filter((f) => {
          const key = f.name.trim().toLowerCase();
          if (!key) return true;
          if (existing.has(key) || seen.has(key)) {
            autoSkipped += 1;
            return false;
          }
          seen.add(key);
          return true;
        });
      }
      if (autoSkipped > 0) {
        setNotice(
          t('Skipped {n} file(s) already in this matter (same name).').replace(
            '{n}',
            String(autoSkipped),
          ),
        );
      }
      if (candidates.length === 0) {
        setBusy(false);
        return;
      }

      // Skip the interactive content-hash prompt for very large drops.
      if (candidates.length > DEDUPE_PROMPT_MAX) {
        setBusy(false);
        await performUpload(candidates);
        return;
      }
      const withHash = await Promise.all(candidates.map(async (file) => ({ file, hash: await hashFile(file) })));
      const hashes = withHash.map((h) => h.hash).filter((h): h is string => Boolean(h));
      let dupMap: Record<string, { id: string; title: string; exhibit: string | null }> = {};
      if (hashes.length) {
        const res = await checkEvidenceDuplicatesAction(firmId, caseId, hashes);
        if (res.ok && res.duplicates) dupMap = res.duplicates;
      }
      const entries: DuplicateEntry[] = withHash
        .filter((h) => h.hash && dupMap[h.hash])
        .map((h) => ({ file: h.file, hash: h.hash as string, existing: dupMap[h.hash as string] }));
      setBusy(false);
      if (entries.length) {
        setDedupe({ entries, all: withHash });
        return; // wait for the dialog to resolve
      }
      await performUpload(candidates);
    },
    [firmId, caseId, performUpload, t],
  );

  /** Resolve the duplicate dialog into a final file list + replace set. */
  const applyDedupe = useCallback(
    (resolutions: Map<File, DuplicateAction>) => {
      if (!dedupe) return;
      const finalFiles: File[] = [];
      const replaceHashes: string[] = [];
      for (const { file, hash } of dedupe.all) {
        const action = resolutions.get(file); // undefined for non-duplicate files
        if (action === 'skip') continue;
        if (action === 'replace') {
          if (hash) replaceHashes.push(hash);
          finalFiles.push(file);
        } else if (action === 'rename') {
          finalFiles.push(new File([file], copyName(file.name), { type: file.type }));
        } else {
          finalFiles.push(file);
        }
      }
      setDedupe(null);
      void performUpload(finalFiles, replaceHashes);
    },
    [dedupe, performUpload],
  );

  const analyzePending = useCallback(async () => {
    setError(null);
    setNotice(null);
    const queue = events
      .filter((e) => (e.aiStatus === 'skipped' || e.aiStatus === 'error') && !e.aiExtracted?.duplicate_of)
      .map((e) => e.id);
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

  // "Unscanned" = never analysed (skipped) OR a scan that failed (error). Both
  // are items that did not process; the reprocess control picks up both so a
  // failed batch is never silently left behind.
  const pendingCount = useMemo(
    () =>
      aiEnabled
        ? events.filter((e) => (e.aiStatus === 'skipped' || e.aiStatus === 'error') && !e.aiExtracted?.duplicate_of).length
        : 0,
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
          if (
            typeof window !== 'undefined' &&
            window.confirm(t('This entry was corrected by hand. Re-analysing replaces those edits. Continue?'))
          ) {
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
        if (res.ok) {
          setEvents((list) => list.filter((e) => e.id !== id));
          setSelected((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        } else if (res.error) setError(res.error);
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

  // ── Filtering + ordering ────────────────────────────────────────────
  // The case's working evidence: everything not set aside. Drives the dashboard,
  // the duplicate scan, and (unless "show set-aside" is on) the list itself.
  const activeEvents = useMemo(() => events.filter((e) => !e.aiExtracted?.excluded), [events]);
  const excludedCount = events.length - activeEvents.length;
  const baseEvents = showExcluded ? events : activeEvents;

  // name -> member events, for the Folders tab (sorted by name).
  const collectionsMap = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const e of activeEvents) {
      for (const c of e.aiExtracted?.collections ?? []) {
        const list = m.get(c);
        if (list) list.push(e);
        else m.set(c, [e]);
      }
    }
    // Private folders are visible to their creator only; folders without a
    // registry entry (legacy) and public folders show for every case viewer.
    for (const name of m.keys()) {
      const meta = folderMeta[name];
      if (meta && !meta.isPublic && meta.createdBy !== viewerId) m.delete(name);
    }
    return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [activeEvents, folderMeta, viewerId]);

  // Live search suggestions drawn from the matter's OWN data — a real exhibit
  // number, the most-mentioned person and organization, and the most common
  // evidence kind — so the suggestions always lead somewhere.
  const searchSuggestions = useMemo(() => {
    const out: string[] = [];
    const withEx = activeEvents.find((e) => typeof e.aiExtracted?.exhibit_no === 'number');
    const exh = withEx ? exhibitLabel(withEx.aiExtracted?.exhibit_no) : null;
    if (exh) out.push(exh);
    const top = (pick: (e: TimelineEvent) => string[]) => {
      const counts = new Map<string, number>();
      for (const e of activeEvents) for (const v of pick(e)) {
        const k = v.trim();
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const person = top((e) => e.aiExtracted?.detected_people ?? []);
    if (person) out.push(person);
    const org = top((e) => e.aiExtracted?.organizations ?? []);
    if (org && org !== person) out.push(org);
    const kind = top((e) => [KIND_LABEL[e.kind]]);
    if (kind) out.push(kind);
    return out.slice(0, 4);
  }, [activeEvents]);

  // Numbers for the one-line "Case evidence" strip.
  const glanceStats = useMemo(() => {
    let onTl = 0;
    let high = 0;
    for (const e of activeEvents) {
      if (isOnTimeline(e)) onTl++;
      if (relevanceBand(e.aiExtracted?.relevance_score) === 'high') high++;
    }
    return { total: activeEvents.length, onTl, high };
  }, [activeEvents]);

  // Token-scored search: `scores` holds per-item strength while a query is
  // active, so the results can rank best-match-first.
  const searchResult = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const scores = new Map<string, number>();
    const list = baseEvents.filter((e) => {
      if (!matchesFocus(e, focus)) return false;
      if (hiddenFolders.has(folderForEvent(e))) return false;
      if (hiddenKinds.has(e.kind)) return false;
      if (tokens.length) {
        const s = scoreEventForQuery(e, tokens);
        if (s <= 0) return false;
        scores.set(e.id, s);
      }
      return true;
    });
    return { list, scores };
  }, [baseEvents, query, hiddenFolders, hiddenKinds, focus]);
  const filtered = searchResult.list;

  // Possible duplicates within the working evidence (exact by content hash, or
  // similar by filename + size). Recomputed as items land.
  const duplicateGroups = useMemo(() => findDuplicateGroups(activeEvents), [activeEvents]);
  const duplicateExtras = duplicateGroups.reduce((n, g) => n + g.items.length - 1, 0);

  // Folder groups (taxonomy order), each chronologically sorted.
  const folderGroups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of filtered) {
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
    for (const [name, items] of map) {
      if (!(EVIDENCE_FOLDERS as readonly string[]).includes(name)) {
        ordered.push({ name, items: sortTimeline(items) });
      }
    }
    return ordered;
  }, [filtered]);

  // Date groups (by captured month), chronological, undated last.
  const dateGroups = useMemo(() => {
    const map = new Map<string, { label: string; items: TimelineEvent[] }>();
    for (const e of filtered) {
      const { key, label } = monthBucket(capturedAt(e));
      const bucket = map.get(key);
      if (bucket) bucket.items.push(e);
      else map.set(key, { label, items: [e] });
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, { label, items }]) => ({
        name: label,
        key,
        items: [...items].sort((a, b) => (capturedAt(a) ?? '').localeCompare(capturedAt(b) ?? '')),
      }));
  }, [filtered]);

  // Group by AI relevance band (Highly relevant / Relevant / Low / Not yet
  // scored), highest first. Lets the firm collapse the long tail and open only
  // what proves the case.
  const relevanceGroups = useMemo(() => {
    const order = ['high', 'medium', 'low', 'unscored'] as const;
    const label: Record<(typeof order)[number], string> = {
      high: 'Highly relevant',
      medium: 'Relevant',
      low: 'Low relevance',
      unscored: 'Not yet scored',
    };
    const map = new Map<string, TimelineEvent[]>();
    for (const e of filtered) {
      const band = relevanceBand(e.aiExtracted?.relevance_score) ?? 'unscored';
      const bucket = map.get(band);
      if (bucket) bucket.push(e);
      else map.set(band, [e]);
    }
    return order
      .filter((b) => map.has(b))
      .map((b) => ({
        name: label[b],
        key: b,
        items: [...(map.get(b) ?? [])].sort(
          (a, z) => (z.aiExtracted?.relevance_score ?? -1) - (a.aiExtracted?.relevance_score ?? -1),
        ),
      }));
  }, [filtered]);

  // The flat display order (used by the grid and the viewer's next/prev).
  // While a search is active the strongest matches rank FIRST (score desc,
  // newest as the tiebreak) instead of the grouping order.
  const ordered = useMemo(() => {
    const flat = (groupMode === 'folder'
      ? folderGroups
      : groupMode === 'date'
        ? dateGroups
        : relevanceGroups
    ).flatMap((g) => g.items);
    const scores = searchResult.scores;
    if (scores.size === 0) return flat;
    return [...flat].sort((a, b) => {
      const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
      if (d !== 0) return d;
      return (b.occurredAt ? new Date(b.occurredAt).getTime() : 0) - (a.occurredAt ? new Date(a.occurredAt).getTime() : 0);
    });
  }, [groupMode, folderGroups, dateGroups, relevanceGroups, searchResult.scores]);

  // Counts for the filter chips are taken from the base list, so hiding one
  // folder still shows the others' real totals.
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of baseEvents) m.set(folderForEvent(e), (m.get(folderForEvent(e)) ?? 0) + 1);
    return m;
  }, [baseEvents]);
  const kindCounts = useMemo(() => {
    const m = new Map<TimelineKind, number>();
    for (const e of baseEvents) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [baseEvents]);

  // ── Selection ───────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const selectAllVisible = useCallback(() => setSelected(new Set(ordered.map((e) => e.id))), [ordered]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  // Selection is resolved against ALL events, not the filtered view — so
  // searching or filtering never silently drops already-selected items from a
  // bulk action. Items selected but currently hidden are surfaced as a count.
  const selectedEvents = useMemo(() => events.filter((e) => selected.has(e.id)), [events, selected]);
  const selectedIds = useMemo(() => selectedEvents.map((e) => e.id), [selectedEvents]);
  const hiddenSelectedCount = useMemo(() => {
    if (selected.size === 0) return 0;
    const visible = new Set(ordered.map((e) => e.id));
    let n = 0;
    for (const id of selected) if (!visible.has(id)) n++;
    return n;
  }, [ordered, selected]);
  // When every selected item is already set aside, the bulk control restores
  // rather than excludes.
  const selectedAllExcluded =
    selectedEvents.length > 0 && selectedEvents.every((e) => e.aiExtracted?.excluded);
  // When every selected item is already on the timeline, the bulk control
  // removes rather than adds.
  const selectedAllOnTimeline =
    selectedEvents.length > 0 && selectedEvents.every((e) => isOnTimeline(e));

  // ── Bulk actions ────────────────────────────────────────────────────
  const runBulk = useCallback(
    async (ids: string[], worker: (id: string) => Promise<void>) => {
      setBusy(true);
      setProgress({ done: 0, total: ids.length });
      let done = 0;
      let idx = 0;
      const run = async () => {
        for (;;) {
          const i = idx++;
          if (i >= ids.length) return;
          await worker(ids[i]);
          done += 1;
          setProgress({ done, total: ids.length });
        }
      };
      await Promise.all(Array.from({ length: BULK_CONCURRENCY }, run));
      setBusy(false);
      setProgress(null);
    },
    [],
  );

  // Delete a specific set of items (used by bulk delete and the duplicate panel).
  const deleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await runBulk(ids, async (id) => {
        const res = await deleteFirmCaseEventAction(firmId, caseId, id);
        if (res.ok) {
          setEvents((list) => list.filter((e) => e.id !== id));
          setSelected((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }
      });
    },
    [runBulk, firmId, caseId],
  );

  const bulkDelete = useCallback(async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(t('Delete {n} selected item(s)? This cannot be undone.').replace('{n}', String(ids.length)))) {
      return;
    }
    await deleteIds(ids);
    clearSelection();
    setNotice(t('Deleted {n} item(s).').replace('{n}', String(ids.length)));
  }, [selectedIds, deleteIds, clearSelection, t]);

  const bulkReanalyze = useCallback(async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    setAnalyzing((s) => new Set([...s, ...ids]));
    await runBulk(ids, async (id) => {
      const res = await analyzeFirmCaseEventAction(firmId, caseId, id);
      // A hand-edited item returns needsConfirm; leave it untouched in a bulk run.
      if (res.event) setEvents((list) => list.map((e) => (e.id === id ? res.event! : e)));
      setAnalyzing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    });
    setAnalyzing((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    setNotice(t('Re-analysed {n} item(s).').replace('{n}', String(ids.length)));
  }, [selectedIds, runBulk, firmId, caseId, t]);

  const bulkShare = useCallback(async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    setBusy(true);
    const res = await exportSelectedEvidenceAction(firmId, caseId, ids);
    setBusy(false);
    if (res.ok && res.items) setShareData({ matter: res.matter ?? 'Matter', items: res.items });
    else setError(res.error ?? t('Could not prepare the share.'));
  }, [selectedIds, firmId, caseId, t]);

  // Build a court-ready file from just the selected items, via the firm export
  // route (admin-path, so it renders the same evidence the firm sees here).
  // section=exhibits keeps it a LEAN hand-over packet: Cover → Index →
  // Certification → the exhibits, with none of the narrative sections.
  const bulkExport = useCallback(async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    const url = `/counsel/cases/${caseId}/export?ids=${encodeURIComponent(ids.join(','))}&section=exhibits`;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, toolbarColor: '#0b0b0d' });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }, [selectedIds, caseId]);

  // Encrypt-and-send the selected exhibits' ORIGINAL files (one file direct,
  // several as an exhibit-numbered ZIP) via the secure two-email share.
  const bulkSecureShare = useCallback(() => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    setSecureShare({
      path: `/counsel/cases/${caseId}/evidence/download?ids=${encodeURIComponent(ids.join(','))}`,
      label:
        ids.length === 1
          ? t('1 exhibit file')
          : t('{n} exhibit files').replace('{n}', String(ids.length)),
    });
  }, [selectedIds, caseId, t]);

  // Download the ORIGINAL files of the selected items (no court packet): each
  // file named with its exhibit number; several arrive as one ZIP.
  const bulkDownload = useCallback(async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    const url = `/counsel/cases/${caseId}/evidence/download?ids=${encodeURIComponent(ids.join(','))}`;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, toolbarColor: '#0b0b0d' });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [selectedIds, caseId]);

  // ---- Folders (collections) ------------------------------------------------
  // Add the current selection to a named folder (creating it on first use).
  const addSelectionToFolder = useCallback(
    async (name: string) => {
      const ids = selectedIds;
      if (ids.length === 0) return;
      setBusy(true);
      const res = await updateFirmEvidenceCollectionsAction(firmId, caseId, ids, name, 'add');
      setBusy(false);
      if (!res.ok || !res.name) {
        setError(res.error ?? t('Could not add those items to the folder.'));
        return;
      }
      const folder = res.name;
      const idSet = new Set(ids);
      setEvents((list) =>
        list.map((e) => {
          if (!idSet.has(e.id)) return e;
          const prior = e.aiExtracted?.collections ?? [];
          if (prior.includes(folder)) return e;
          return { ...e, aiExtracted: { ...(e.aiExtracted ?? {}), collections: [...prior, folder] } };
        }),
      );
      setFolderMeta((m) =>
        m[folder] ? m : { ...m, [folder]: { createdBy: viewerId, isPublic: true } },
      );
      setFolderDialogOpen(false);
      clearSelection();
      setNotice(
        t('Added {n} item(s) to “{f}”.').replace('{n}', String(ids.length)).replace('{f}', folder),
      );
    },
    [selectedIds, firmId, caseId, clearSelection, viewerId, t],
  );

  // Remove the current selection from the folder that is open.
  const removeSelectionFromFolder = useCallback(
    async (name: string) => {
      const ids = selectedIds;
      if (ids.length === 0) return;
      setBusy(true);
      const res = await updateFirmEvidenceCollectionsAction(firmId, caseId, ids, name, 'remove');
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? t('Could not update the folder.'));
        return;
      }
      const idSet = new Set(ids);
      setEvents((list) =>
        list.map((e) =>
          idSet.has(e.id)
            ? {
                ...e,
                aiExtracted: {
                  ...(e.aiExtracted ?? {}),
                  collections: (e.aiExtracted?.collections ?? []).filter((c) => c !== name),
                },
              }
            : e,
        ),
      );
      clearSelection();
      setNotice(t('Removed {n} item(s) from “{f}”.').replace('{n}', String(ids.length)).replace('{f}', name));
    },
    [selectedIds, firmId, caseId, clearSelection, t],
  );

  // Delete a folder (the grouping only - every item stays in the evidence).
  const deleteCollection = useCallback(
    async (name: string) => {
      setBusy(true);
      const res = await deleteFirmEvidenceCollectionAction(firmId, caseId, name);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? t('Could not delete the folder.'));
        return;
      }
      setEvents((list) =>
        list.map((e) =>
          e.aiExtracted?.collections?.includes(name)
            ? {
                ...e,
                aiExtracted: {
                  ...(e.aiExtracted ?? {}),
                  collections: (e.aiExtracted.collections ?? []).filter((c) => c !== name),
                },
              }
            : e,
        ),
      );
      setFolderMeta((m) => {
        if (!m[name]) return m;
        const next = { ...m };
        delete next[name];
        return next;
      });
      setOpenCollection(null);
      setNotice(t('Deleted the folder “{f}”. Its items stay in the evidence.').replace('{f}', name));
    },
    [firmId, caseId, t],
  );

  // Public/private toggle for a folder (creator only; server re-checks).
  const setFolderVisibility = useCallback(
    async (name: string, isPublic: boolean) => {
      setBusy(true);
      const res = await setEvidenceFolderVisibilityAction(firmId, caseId, name, isPublic);
      setBusy(false);
      if (!res.ok || !res.meta) {
        setError(res.error ?? t('Could not change who sees the folder.'));
        return;
      }
      setFolderMeta((m) => ({ ...m, [name]: res.meta as FolderMeta }));
      setNotice(
        isPublic
          ? t('“{f}” is now visible to everyone on this matter.').replace('{f}', name)
          : t('“{f}” is now visible only to you.').replace('{f}', name),
      );
    },
    [firmId, caseId, t],
  );

  // The same export features the selection bar offers, for a whole folder.
  const exportIdsAsOneDoc = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const url = `/counsel/cases/${caseId}/export?ids=${encodeURIComponent(ids.join(','))}&section=exhibits`;
      if (isNativeApp()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url, toolbarColor: '#0b0b0d' });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    },
    [caseId],
  );
  const downloadIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const url = `/counsel/cases/${caseId}/evidence/download?ids=${encodeURIComponent(ids.join(','))}`;
      if (isNativeApp()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url, toolbarColor: '#0b0b0d' });
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    },
    [caseId],
  );
  const indexShareIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setBusy(true);
      const res = await exportSelectedEvidenceAction(firmId, caseId, ids);
      setBusy(false);
      if (res.ok && res.items) setShareData({ matter: res.matter ?? 'Matter', items: res.items });
      else setError(res.error ?? t('Could not prepare the share.'));
    },
    [firmId, caseId, t],
  );
  const secureShareIds = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      setSecureShare({
        path: `/counsel/cases/${caseId}/evidence/download?ids=${encodeURIComponent(ids.join(','))}`,
        label,
      });
    },
    [caseId],
  );

  // Add (or remove) the selected items to the timeline in one pass.
  const bulkSetOnTimeline = useCallback(
    async (onTimeline: boolean) => {
      const ids = selectedIds;
      if (ids.length === 0) return;
      setBusy(true);
      const res = await setFirmEvidenceOnTimelineAction(firmId, caseId, ids, onTimeline);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? t('Could not update those items.'));
        return;
      }
      const idSet = new Set(ids);
      setEvents((list) =>
        list.map((e) =>
          idSet.has(e.id)
            ? { ...e, aiExtracted: { ...(e.aiExtracted ?? {}), on_timeline: onTimeline } }
            : e,
        ),
      );
      clearSelection();
      setNotice(
        onTimeline
          ? t('Added {n} item(s) to the timeline.').replace('{n}', String(ids.length))
          : t('Removed {n} item(s) from the timeline.').replace('{n}', String(ids.length)),
      );
    },
    [selectedIds, firmId, caseId, clearSelection, t],
  );

  // Set aside (or restore) the selected items. Excluded items stay stored but
  // drop out of the working view, the coverage counts, and exports.
  const bulkSetExcluded = useCallback(
    async (excluded: boolean) => {
      const ids = selectedIds;
      if (ids.length === 0) return;
      setBusy(true);
      const res = await setFirmEvidenceExcludedAction(firmId, caseId, ids, excluded);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? t('Could not update those items.'));
        return;
      }
      const idSet = new Set(ids);
      setEvents((list) =>
        list.map((e) => {
          if (!idSet.has(e.id)) return e;
          const ext = { ...(e.aiExtracted ?? {}) };
          if (excluded) ext.excluded = true;
          else delete ext.excluded;
          return { ...e, aiExtracted: ext };
        }),
      );
      clearSelection();
      setNotice(
        excluded
          ? t('Set aside {n} item(s). They stay stored and can be restored.').replace('{n}', String(ids.length))
          : t('Restored {n} item(s) to the case.').replace('{n}', String(ids.length)),
      );
    },
    [selectedIds, firmId, caseId, clearSelection, t],
  );

  // ── Viewer ──────────────────────────────────────────────────────────
  const openViewer = useCallback(
    (id: string) => {
      const i = ordered.findIndex((e) => e.id === id);
      if (i >= 0) setViewerIndex(i);
    },
    [ordered],
  );
  const viewerEvent = viewerIndex != null ? ordered[viewerIndex] : undefined;
  // If the list shifts under an open viewer (a delete), keep it in range.
  useEffect(() => {
    if (viewerIndex != null && viewerIndex >= ordered.length) {
      setViewerIndex(ordered.length ? ordered.length - 1 : null);
    }
  }, [ordered.length, viewerIndex]);

  // Add / remove a single item to the timeline (the per-card control). Evidence
  // stays in the intake either way; this only governs the chronology.
  const toggleOnTimeline = useCallback(
    (id: string, onTimeline: boolean) => {
      // Optimistic: reflect the choice immediately, roll back on failure.
      setEvents((list) =>
        list.map((e) =>
          e.id === id ? { ...e, aiExtracted: { ...(e.aiExtracted ?? {}), on_timeline: onTimeline } } : e,
        ),
      );
      startTransition(async () => {
        const res = await setFirmEvidenceOnTimelineAction(firmId, caseId, [id], onTimeline);
        if (!res.ok) {
          setEvents((list) =>
            list.map((e) =>
              e.id === id ? { ...e, aiExtracted: { ...(e.aiExtracted ?? {}), on_timeline: !onTimeline } } : e,
            ),
          );
          if (res.error) setError(res.error);
        }
      });
    },
    [firmId, caseId],
  );

  // Set aside / restore a single item (the per-card control).
  const toggleExclude = useCallback(
    (id: string, excluded: boolean) => {
      startTransition(async () => {
        const res = await setFirmEvidenceExcludedAction(firmId, caseId, [id], excluded);
        if (res.ok) {
          setEvents((list) =>
            list.map((e) => {
              if (e.id !== id) return e;
              const ext = { ...(e.aiExtracted ?? {}) };
              if (excluded) ext.excluded = true;
              else delete ext.excluded;
              return { ...e, aiExtracted: ext };
            }),
          );
        } else if (res.error) setError(res.error);
      });
    },
    [firmId, caseId],
  );

  const groups =
    groupMode === 'folder' ? folderGroups : groupMode === 'date' ? dateGroups : relevanceGroups;

  // Speed: collapse every group but the first by default (and re-seed when the
  // grouping changes). A collapsed group never mounts its rows or thumbnails,
  // so a heavy matter paints immediately instead of minting hundreds of signed
  // URLs up front. User toggles are preserved within a grouping.
  const seededGroupMode = useRef<GroupMode | null>(null);
  useEffect(() => {
    if (seededGroupMode.current === groupMode) return;
    seededGroupMode.current = groupMode;
    setCollapsed(new Set(groups.slice(1).map((g) => g.name)));
  }, [groupMode, groups]);

  const allVisibleSelected = ordered.length > 0 && ordered.every((e) => selected.has(e.id));

  const cardProps = (e: TimelineEvent) => ({
    firmId,
    caseId,
    event: e,
    aiEnabled,
    busy: pending,
    analyzing: analyzing.has(e.id) || e.aiStatus === 'running',
    selected: selected.has(e.id),
    excluded: Boolean(e.aiExtracted?.excluded),
    onTimeline: isOnTimeline(e),
    onToggleSelect: () => toggleSelect(e.id),
    onOpenViewer: () => openViewer(e.id),
    onReanalyze: () => reanalyze(e.id),
    onDelete: () => remove(e.id),
    onToggleExclude: () => toggleExclude(e.id, !e.aiExtracted?.excluded),
    onToggleTimeline: () => toggleOnTimeline(e.id, !isOnTimeline(e)),
  });

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Status banner (duplicate skips, unzip results, errors) at the very top
          - right by the drop zone where the upload happens - so a message is
          seen at once instead of being buried below the drop zone / long list. */}
      {(error || notice) && (
        <div className="space-y-2">
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 shadow-sm dark:border-rose-700/40 dark:bg-rose-950/80 dark:text-rose-200">
              {error}
            </p>
          )}
          {notice && (
            <p className="flex items-start justify-between gap-3 rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-[13px] text-forest-800 shadow-sm dark:border-forest-700/40 dark:bg-forest-900/90 dark:text-cream-100/85">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label={t('Dismiss')}
                className="shrink-0 rounded px-1 leading-none text-forest-500 hover:text-forest-800 dark:text-cream-100/50 dark:hover:text-cream-100"
              >
                ✕
              </button>
            </p>
          )}
        </div>
      )}

      {/* Case evidence at a glance - a single line; expand for the full
          dashboard so search + the evidence itself stay the main focus. */}
      {activeEvents.length > 0 && (
        <div className="overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-forest-800/40">
          <button
            type="button"
            onClick={() => setGlanceOpen((v) => !v)}
            aria-expanded={glanceOpen}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-cream-50/60 dark:hover:bg-forest-900/30"
          >
            <span className="font-semibold text-forest-900 dark:text-cream-100"><T>Case evidence</T></span>
            <span className="min-w-0 truncate text-ink-500 dark:text-cream-100/55" data-no-translate>
              {glanceStats.total} {t('items')} · {glanceStats.onTl} {t('on timeline')} · {glanceStats.high} {t('high relevance')}
            </span>
            <span aria-hidden className="ml-auto text-[11px] text-ink-400 dark:text-cream-100/45">{glanceOpen ? '▾' : '▸'}</span>
          </button>
          {glanceOpen && (
            <div className="border-t border-ink-100 p-3 dark:border-forest-800/40">
              <EvidenceDashboard events={activeEvents} caseId={caseId} aiEnabled={aiEnabled} />
            </div>
          )}
        </div>
      )}

      {/* The case map moved to the matter Evidence dashboard (rendered from the
          server-side analytics aggregate), so it is no longer duplicated here. */}

      {/* Evidence */}
      <section ref={resultsRef} className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Evidence / Folders tabs. Folders are hand-built, named groupings
              (one item can be in many); opening one filters the view to it. */}
          <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'evidence'}
              onClick={() => setTab('evidence')}
              className={
                (tab === 'evidence'
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100 '
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                'px-3.5 py-1.5 text-[13px] transition-colors'
              }
            >
              <T>Evidence</T>{' '}
              <span className="text-ink-400 dark:text-cream-100/40" data-no-translate>({activeEvents.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'folders'}
              onClick={() => { setTab('folders'); setOpenCollection(null); }}
              className={
                (tab === 'folders'
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100 '
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                'px-3.5 py-1.5 text-[13px] transition-colors'
              }
            >
              <T>Folders</T>{' '}
              <span className="text-ink-400 dark:text-cream-100/40" data-no-translate>({collectionsMap.size})</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openIntake}
              className="inline-flex items-center gap-1 rounded-md bg-gold-500/10 px-2.5 py-1 text-[12px] font-semibold text-gold-700 ring-1 ring-gold-500/25 hover:bg-gold-500/20 dark:text-gold-300"
            >
              + <T>Add evidence</T>
            </button>
            <Link
              href={`/counsel/cases/${caseId}/timeline`}
              prefetch={false}
              className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
            >
              <T>Open full timeline builder</T> →
            </Link>
          </div>
        </div>

        {tab === 'folders' && (
          openCollection === null ? (
            collectionsMap.size === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center dark:border-forest-700/40">
                <p className="text-2xl" aria-hidden>📁</p>
                <p className="mt-1 text-[14px] font-medium text-forest-900 dark:text-cream-100"><T>No folders yet</T></p>
                <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-500 dark:text-cream-100/55">
                  <T>Select items on the Evidence tab, then choose “Add to folder” in the selection bar. A folder never moves anything — it is a saved view, and one item can sit in many folders.</T>
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[...collectionsMap.entries()].map(([name, items]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setOpenCollection(name)}
                    className="group flex flex-col items-start gap-1 rounded-xl border border-ink-200 bg-cream-50/60 p-3.5 text-left transition-all hover:border-gold-500/60 hover:bg-white hover:shadow-sm dark:border-forest-700/50 dark:bg-forest-900/40 dark:hover:bg-forest-800/60"
                  >
                    <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-gold-500/10 text-[15px] ring-1 ring-gold-500/20 transition-colors group-hover:bg-gold-500/20">📁</span>
                    <span className="mt-1 w-full truncate text-[13.5px] font-semibold text-forest-900 dark:text-cream-100" data-no-translate>{name}</span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-ink-500 dark:text-cream-100/50" data-no-translate>
                      {items.length} {t('item(s)')}
                      {folderMeta[name] && !folderMeta[name].isPublic && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-ink-100 px-1.5 py-[1px] text-[10px] font-medium text-ink-600 dark:bg-forest-800/70 dark:text-cream-100/60">
                          🔒 <T>Only you</T>
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            (() => {
              const members = collectionsMap.get(openCollection) ?? [];
              const memberIds = members.map((e) => e.id);
              return (
                <div className="space-y-3">
                  <FolderHeader
                    name={openCollection}
                    count={members.length}
                    busy={busy}
                    isPublic={folderMeta[openCollection]?.isPublic !== false}
                    canToggle={
                      !folderMeta[openCollection]?.createdBy ||
                      folderMeta[openCollection]?.createdBy === viewerId
                    }
                    onToggleVisibility={(pub) => void setFolderVisibility(openCollection, pub)}
                    onBack={() => setOpenCollection(null)}
                    onSelectAll={() => setSelected(new Set(memberIds))}
                    onExportOne={() => void exportIdsAsOneDoc(memberIds)}
                    onExportIndividual={() => void downloadIds(memberIds)}
                    onIndex={() => void indexShareIds(memberIds)}
                    onShare={() =>
                      secureShareIds(
                        memberIds,
                        `${openCollection} — ${members.length === 1 ? t('1 exhibit file') : t('{n} exhibit files').replace('{n}', String(members.length))}`,
                      )
                    }
                    onDelete={() => void deleteCollection(openCollection)}
                  />
                  {members.length === 0 ? (
                    <p className="text-[13px] text-ink-500 dark:text-cream-100/55"><T>This folder is empty.</T></p>
                  ) : (
                    <div className="space-y-3">
                      {members.map((e) => (
                        <EvidenceCard
                          key={e.id}
                          {...cardProps(e)}
                          editing={editingId === e.id}
                          onEdit={() => setEditingId(e.id)}
                          onCancelEdit={() => setEditingId(null)}
                          onSave={(edit) => saveEdit(e.id, edit)}
                          onMoveFolder={(folderName) => moveFolder(e.id, folderName)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
          )
        )}

        {tab === 'evidence' && (<>

        {/* Proactive duplicate review */}
        {duplicateGroups.length > 0 && !dupDismissed && (
          <DuplicatePanel
            firmId={firmId}
            caseId={caseId}
            groups={duplicateGroups}
            extras={duplicateExtras}
            busy={busy}
            onDelete={async (ids) => {
              await deleteIds(ids);
              setNotice(t('Removed {n} duplicate copy(ies).').replace('{n}', String(ids.length)));
            }}
            onDismiss={() => setDupDismissed(true)}
            onOpen={(id) => openViewer(id)}
          />
        )}

        {events.length > 0 && (
          <Toolbar
            view={view}
            setView={setView}
            groupMode={groupMode}
            setGroupMode={setGroupMode}
            query={query}
            setQuery={setQuery}
            suggestions={searchSuggestions}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            hiddenFolders={hiddenFolders}
            setHiddenFolders={setHiddenFolders}
            hiddenKinds={hiddenKinds}
            setHiddenKinds={setHiddenKinds}
            folderCounts={folderCounts}
            kindCounts={kindCounts}
            shownCount={filtered.length}
            totalCount={baseEvents.length}
            excludedCount={excludedCount}
            showExcluded={showExcluded}
            setShowExcluded={setShowExcluded}
            allVisibleSelected={allVisibleSelected}
            onSelectAll={selectAllVisible}
            onClearSelection={clearSelection}
          />
        )}

        {focusActive(focus) && (
          <div className="flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-[13px]">
            <i className="ti ti-filter text-gold-600 dark:text-gold-400" aria-hidden="true" />
            <span className="text-ink-500 dark:text-cream-100/55"><T>Showing</T></span>
            <span className="font-semibold text-forest-900 dark:text-cream-100">{focusLabel(focus)}</span>
            <span className="tabular-nums text-ink-500 dark:text-cream-100/55">
              · {filtered.length} <T>items</T>
            </span>
            <button
              type="button"
              onClick={clearFocus}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-gold-700 hover:bg-gold-500/15 dark:text-gold-300"
            >
              <i className="ti ti-x" aria-hidden="true" />
              <T>Clear filter</T>
            </button>
          </div>
        )}

        {/* Search-results banner: makes the matches unmistakably the focus. */}
        {searching && (
          <div className="flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-[13.5px]">
            <span aria-hidden className="text-gold-600 dark:text-gold-400">⌕</span>
            <span className="font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
              {filtered.length}
            </span>
            <span className="text-ink-500 dark:text-cream-100/55">
              <T>result(s) for</T>
            </span>
            <span className="min-w-0 truncate font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
              “{query.trim()}”
            </span>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-gold-700 hover:bg-gold-500/15 dark:text-gold-300"
            >
              ✕ <T>Clear search</T>
            </button>
          </div>
        )}

        {/* Keyset stream status: the first page is interactive immediately;
            the rest arrive in the background. */}
        {!loadedAll && (
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 bg-cream-50/60 px-3 py-1.5 text-[12px] text-ink-500 dark:border-forest-700/40 dark:bg-forest-900/40 dark:text-cream-100/55">
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-300 border-t-forest-600 dark:border-forest-700 dark:border-t-gold-metal"
            />
            <span data-no-translate>
              {t('Loading more evidence… {n} so far').replace('{n}', String(events.length))}
            </span>
          </div>
        )}

        {events.length === 0 ? (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            <T>No evidence yet. Use Add evidence below to begin.</T>
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
            {searching ? <T>No evidence matches this search.</T> : <T>Nothing matches the current filters.</T>}
          </p>
        ) : view === 'gallery' ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {ordered.map((e) => (
              <GalleryTile key={e.id} {...cardProps(e)} />
            ))}
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {ordered.map((e) => (
              <GridCard key={e.id} {...cardProps(e)} />
            ))}
          </div>
        ) : searching ? (
          // While searching, folders/date buckets get out of the way: matches
          // render as ONE flat list so no result hides in a collapsed group.
          <div className="space-y-3">
            {ordered.map((e) => (
              <EvidenceCard
                key={e.id}
                {...cardProps(e)}
                editing={editingId === e.id}
                onEdit={() => setEditingId(e.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(edit) => saveEdit(e.id, edit)}
                onMoveFolder={(folderName) => moveFolder(e.id, folderName)}
              />
            ))}
          </div>
        ) : (
          groups.map((group) => (
            <FolderSection
              key={group.name}
              name={group.name}
              items={group.items}
              collapsed={collapsed.has(group.name)}
              renamable={groupMode === 'folder'}
              onToggle={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  if (n.has(group.name)) n.delete(group.name);
                  else n.add(group.name);
                  return n;
                })
              }
              onRename={(to) => renameFolder(group.name, to)}
              renderItem={(e) => (
                <EvidenceCard
                  key={e.id}
                  {...cardProps(e)}
                  editing={editingId === e.id}
                  onEdit={() => setEditingId(e.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(edit) => saveEdit(e.id, edit)}
                  onMoveFolder={(folderName) => moveFolder(e.id, folderName)}
                />
              )}
            />
          ))
        )}
        </>)}
      </section>

      {/* Add evidence - its own section, collapsed once the matter already has
          items so the page leads with search and the evidence itself. Dragging
          files over it expands it automatically. */}
      <section
        id="add-evidence"
        ref={intakeRef}
        onDragOver={(e) => {
          e.preventDefault();
          if (!intakeOpen) setShowIntake(true);
        }}
        className="scroll-mt-4 overflow-hidden rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40"
      >
        <button
          type="button"
          onClick={() => setShowIntake(!intakeOpen)}
          aria-expanded={intakeOpen}
          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-cream-50/60 dark:hover:bg-forest-900/30"
        >
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-gold-500/10 text-[13px] font-semibold text-gold-600 ring-1 ring-gold-500/25 dark:text-gold-300">+</span>
          <span className="text-[13.5px] font-semibold text-forest-900 dark:text-cream-100"><T>Add evidence</T></span>
          <span className="hidden text-[12px] text-ink-400 dark:text-cream-100/45 sm:inline"><T>drop files here, or browse</T></span>
          <span aria-hidden className="ml-auto text-[11px] text-ink-400 dark:text-cream-100/45">{intakeOpen ? '▾' : '▸'}</span>
        </button>
        {intakeOpen && (
          <div className="border-t border-ink-100 p-3 dark:border-forest-800/40">
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
                <T>Photos, video, PDFs and documents, and email files (.eml, .msg) — or a .zip of a whole folder. Drop many at once.</T>
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
                    {t('Reprocess unscanned ({n})').replace('{n}', String(pendingCount))}
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf,.doc,.docx,.xlsx,.xlsm,.xls,.csv,.tsv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/*,audio/*,.eml,.msg,message/rfc822,.zip,application/zip,application/x-zip-compressed"
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

          </div>
        )}
      </section>

      {/* Selection action bar: surfaces the moment the first box is checked */}
      {selected.size > 0 && (
        <BulkBar
          count={selectedIds.length}
          hiddenCount={hiddenSelectedCount}
          busy={busy}
          aiEnabled={aiEnabled}
          allVisibleSelected={allVisibleSelected}
          excludeMode={selectedAllExcluded ? 'restore' : 'exclude'}
          timelineMode={selectedAllOnTimeline ? 'remove' : 'add'}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onDelete={() => void bulkDelete()}
          onReanalyze={() => void bulkReanalyze()}
          onShare={bulkSecureShare}
          onIndex={() => void bulkShare()}
          onExportOne={() => void bulkExport()}
          onExportIndividual={() => void bulkDownload()}
          onExclude={() => void bulkSetExcluded(!selectedAllExcluded)}
          onToggleTimeline={() => void bulkSetOnTimeline(!selectedAllOnTimeline)}
          onAddToFolder={() => setFolderDialogOpen(true)}
          folderName={tab === 'folders' ? openCollection : null}
          onRemoveFromFolder={
            tab === 'folders' && openCollection
              ? () => void removeSelectionFromFolder(openCollection)
              : undefined
          }
        />
      )}

      {/* Viewer */}
      {viewerEvent && (
        <EvidenceViewer
          firmId={firmId}
          caseId={caseId}
          event={viewerEvent}
          index={viewerIndex as number}
          total={ordered.length}
          hasPrev={(viewerIndex as number) > 0}
          hasNext={(viewerIndex as number) < ordered.length - 1}
          onPrev={() => setViewerIndex((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setViewerIndex((i) => (i != null && i < ordered.length - 1 ? i + 1 : i))}
          onClose={() => setViewerIndex(null)}
          onTimeline={isOnTimeline(viewerEvent)}
          onToggleTimeline={() => toggleOnTimeline(viewerEvent.id, !isOnTimeline(viewerEvent))}
        />
      )}

      {/* Duplicate prompt */}
      {dedupe && (
        <DuplicateDialog
          entries={dedupe.entries}
          onCancel={() => {
            setDedupe(null);
            setNotice(t('Import cancelled.'));
          }}
          onApply={applyDedupe}
        />
      )}

      {/* Evidence index hand-off (links + mined facts, exported deliberately) */}
      {shareData && (
        <ShareExportDialog matter={shareData.matter} items={shareData.items} onClose={() => setShareData(null)} />
      )}

      {/* Secure encrypt-and-send of the selected exhibits' original files */}
      {secureShare && (
        <ShareDialog caseId={caseId} target={secureShare} onClose={() => setSecureShare(null)} />
      )}

      {/* Add the selection to a named folder (create new, or pick existing) */}
      {folderDialogOpen && (
        <AddToFolderDialog
          count={selectedIds.length}
          existing={[...collectionsMap.keys()]}
          busy={busy}
          onAdd={(name) => void addSelectionToFolder(name)}
          onClose={() => setFolderDialogOpen(false)}
        />
      )}
    </div>
  );
}

/** Search box, view/group toggles, filter chips, and select-all. */
function Toolbar({
  view,
  setView,
  groupMode,
  setGroupMode,
  query,
  setQuery,
  suggestions,
  showFilters,
  setShowFilters,
  hiddenFolders,
  setHiddenFolders,
  hiddenKinds,
  setHiddenKinds,
  folderCounts,
  kindCounts,
  shownCount,
  totalCount,
  excludedCount,
  showExcluded,
  setShowExcluded,
  allVisibleSelected,
  onSelectAll,
  onClearSelection,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  groupMode: GroupMode;
  setGroupMode: (g: GroupMode) => void;
  query: string;
  setQuery: (q: string) => void;
  suggestions: string[];
  showFilters: boolean;
  setShowFilters: (b: boolean) => void;
  hiddenFolders: Set<string>;
  setHiddenFolders: (updater: (s: Set<string>) => Set<string>) => void;
  hiddenKinds: Set<TimelineKind>;
  setHiddenKinds: (updater: (s: Set<TimelineKind>) => Set<TimelineKind>) => void;
  folderCounts: Map<string, number>;
  kindCounts: Map<TimelineKind, number>;
  shownCount: number;
  totalCount: number;
  excludedCount: number;
  showExcluded: boolean;
  setShowExcluded: (b: boolean) => void;
  allVisibleSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const t = useT();
  const anyFilter = hiddenFolders.size > 0 || hiddenKinds.size > 0;
  const seg = 'px-2.5 py-1 text-[12px] transition-colors';
  const segOn = 'bg-forest-600 text-cream-50';
  const segOff = 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/30';

  return (
    <div className="space-y-2">
      {/* Search is the front door to the evidence set — a full-width,
          search-engine-grade pill: tall, soft shadow that lifts on focus, a
          real magnifier, a round clear control, and a hint of what it
          understands underneath. */}
      <div>
        <div
          className={`search-pill-gold relative rounded-full transition-shadow ${
            query
              ? 'shadow-lg ring-2 ring-gold-500/40'
              : 'hover:shadow-md focus-within:shadow-lg focus-within:ring-2 focus-within:ring-gold-500/35'
          }`}
        >
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 dark:text-cream-100/40">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search this matter’s evidence…')}
            aria-label={t('Search evidence')}
            className="w-full rounded-full bg-transparent py-3 pl-12 pr-12 text-[15px] text-forest-900 outline-none placeholder:text-ink-400 dark:text-cream-50 dark:placeholder:text-cream-100/40"
            data-no-translate
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('Clear search')}
              className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:text-cream-100/50 dark:hover:bg-forest-800 dark:hover:text-cream-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {/* Live suggestions from THIS matter's data + a hint of what to do
            next — hidden once a search is underway (the results banner takes
            over). */}
        {!query && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-2">
            {suggestions.length > 0 && (
              <>
                <span className="text-[11.5px] text-ink-400 dark:text-cream-100/40"><T>Try:</T></span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="rounded-full bg-cream-50 px-2.5 py-1 text-[11.5px] font-medium text-forest-700 ring-1 ring-ink-200 hover:bg-gold-500/10 hover:text-gold-700 hover:ring-gold-500/40 dark:bg-forest-900/50 dark:text-cream-100/75 dark:ring-forest-700/50 dark:hover:text-gold-300"
                    data-no-translate
                  >
                    {s}
                  </button>
                ))}
                <span aria-hidden className="hidden h-3 w-px bg-ink-200 dark:bg-forest-700/60 sm:inline-block" />
              </>
            )}
            <span className="text-[11.5px] text-ink-400 dark:text-cream-100/40">
              <T>Select items to share or export · click any item to preview it</T>
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Group by */}
        <div className="inline-flex overflow-hidden rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40">
          <button type="button" onClick={() => setGroupMode('folder')} className={`${seg} ${groupMode === 'folder' ? segOn : segOff}`}>
            <T>Folders</T>
          </button>
          <button type="button" onClick={() => setGroupMode('date')} className={`${seg} ${groupMode === 'date' ? segOn : segOff}`}>
            <T>Date</T>
          </button>
          <button type="button" onClick={() => setGroupMode('relevance')} className={`${seg} ${groupMode === 'relevance' ? segOn : segOff}`}>
            <T>Relevance</T>
          </button>
        </div>

        {/* View */}
        <div className="inline-flex overflow-hidden rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40">
          <button type="button" onClick={() => setView('gallery')} className={`${seg} ${view === 'gallery' ? segOn : segOff}`} aria-label={t('Gallery view')}>
            ▦
          </button>
          <button type="button" onClick={() => setView('grid')} className={`${seg} ${view === 'grid' ? segOn : segOff}`} aria-label={t('Card view')}>
            ▤
          </button>
          <button type="button" onClick={() => setView('list')} className={`${seg} ${view === 'list' ? segOn : segOff}`} aria-label={t('List view')}>
            ☰
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center rounded-md px-2.5 py-1 text-[12px] ring-1 ${
            anyFilter
              ? 'bg-forest-100 text-forest-800 ring-forest-300 dark:bg-forest-800/60 dark:text-cream-100/85 dark:ring-forest-700/40'
              : 'ring-ink-200 text-ink-600 dark:ring-forest-700/40 dark:text-cream-100/70'
          }`}
        >
          <T>Filter</T>
          {anyFilter ? ` (${hiddenFolders.size + hiddenKinds.size})` : ''}
        </button>

        {/* Counts + select-all live on the SAME control row, right-aligned,
            so the toolbar is one line instead of two stacked strips. */}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[12px] text-ink-500 dark:text-cream-100/55">
          <span data-no-translate>
            {shownCount === totalCount
              ? t('Showing all {n}').replace('{n}', String(totalCount))
              : `${t('Showing')} ${shownCount} / ${totalCount}`}
          </span>
          <button
            type="button"
            onClick={allVisibleSelected ? onClearSelection : onSelectAll}
            className="text-forest-700 dark:text-cream-100/80 hover:underline"
          >
            {allVisibleSelected ? <T>Deselect all</T> : <T>Select all shown</T>}
          </button>
          {excludedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowExcluded(!showExcluded)}
              className="text-ink-500 dark:text-cream-100/55 hover:underline"
              data-no-translate
            >
              {showExcluded
                ? t('Hide set-aside ({n})').replace('{n}', String(excludedCount))
                : t('Show set-aside ({n})').replace('{n}', String(excludedCount))}
            </button>
          )}
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="space-y-2 rounded-lg ring-1 ring-ink-100 dark:ring-forest-800/40 p-3">
          <p className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/45">
            <T>Folders</T>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EVIDENCE_FOLDERS.filter((f) => folderCounts.get(f)).map((f) => {
              const on = !hiddenFolders.has(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    setHiddenFolders((s) => {
                      const n = new Set(s);
                      if (n.has(f)) n.delete(f);
                      else n.add(f);
                      return n;
                    })
                  }
                  className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${
                    on
                      ? 'bg-forest-600 text-cream-50 ring-forest-600'
                      : 'text-ink-400 line-through ring-ink-200 dark:text-cream-100/40 dark:ring-forest-700/40'
                  }`}
                  data-no-translate
                >
                  {f} ({folderCounts.get(f)})
                </button>
              );
            })}
          </div>
          <p className="pt-1 text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/45">
            <T>Types</T>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_LABEL) as TimelineKind[])
              .filter((k) => kindCounts.get(k))
              .map((k) => {
                const on = !hiddenKinds.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setHiddenKinds((s) => {
                        const n = new Set(s);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ring-1 ${
                      on
                        ? 'bg-forest-600 text-cream-50 ring-forest-600'
                        : 'text-ink-400 line-through ring-ink-200 dark:text-cream-100/40 dark:ring-forest-700/40'
                    }`}
                  >
                    <KindIcon kind={k} className="h-3.5 w-3.5 shrink-0" />
                    <span data-no-translate>
                      {KIND_LABEL[k]} ({kindCounts.get(k)})
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The floating bulk-action bar shown the moment items are selected. */
function BulkBar({
  count,
  hiddenCount,
  busy,
  aiEnabled,
  allVisibleSelected,
  excludeMode,
  timelineMode,
  onSelectAll,
  onClear,
  onDelete,
  onReanalyze,
  onShare,
  onIndex,
  onExportOne,
  onExportIndividual,
  onExclude,
  onToggleTimeline,
  onAddToFolder,
  folderName,
  onRemoveFromFolder,
}: {
  count: number;
  hiddenCount: number;
  busy: boolean;
  aiEnabled: boolean;
  allVisibleSelected: boolean;
  excludeMode: 'exclude' | 'restore';
  timelineMode: 'add' | 'remove';
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onReanalyze: () => void;
  onShare: () => void;
  onIndex: () => void;
  onExportOne: () => void;
  onExportIndividual: () => void;
  onExclude: () => void;
  onToggleTimeline: () => void;
  onAddToFolder: () => void;
  /** Set when a folder is open - enables "Remove from folder". */
  folderName?: string | null;
  onRemoveFromFolder?: () => void;
}) {
  const t = useT();
  const [exportOpen, setExportOpen] = useState(false);
  // Portal to <body>: a transformed route wrapper otherwise turns this "fixed"
  // bar into "pinned to the bottom of the page CONTENT", so users had to
  // scroll to reach their selection actions. Portaled, it floats over the
  // viewport wherever they are.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);
  const act = 'rounded-full px-3 py-1.5 text-[13px] hover:bg-white/10 disabled:opacity-50';
  const node = (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: 'calc(1rem + var(--safe-bottom, 0px))' }}
    >
      <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 rounded-2xl bg-forest-900 px-3 py-2 text-cream-50 shadow-2xl ring-1 ring-forest-700/50">
        <span className="pl-1 text-[13px] font-medium" data-no-translate>
          {count} {t('selected')}
          {hiddenCount > 0 && (
            <span className="ml-1 text-[11.5px] font-normal text-gold-300">
              · {t('{n} hidden by search').replace('{n}', String(hiddenCount))}
            </span>
          )}
        </span>
        <button type="button" onClick={allVisibleSelected ? onClear : onSelectAll} className={act}>
          {allVisibleSelected ? <T>None</T> : <T>All</T>}
        </button>
        <span className="mx-1 h-4 w-px bg-cream-50/20" />
        <button type="button" disabled={busy} onClick={onToggleTimeline} className={act}>
          {timelineMode === 'remove' ? <T>Remove from timeline</T> : <T>Add to timeline</T>}
        </button>
        {aiEnabled && (
          <button type="button" disabled={busy} onClick={onReanalyze} className={act}>
            <T>Reanalyse</T>
          </button>
        )}
        <button type="button" disabled={busy} onClick={onAddToFolder} className={act}>
          <T>Add to folder</T>
        </button>
        {folderName && onRemoveFromFolder && (
          <button type="button" disabled={busy} onClick={onRemoveFromFolder} className={act}>
            <T>Remove from folder</T>
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onShare}
          className="rounded-full bg-gold-metal px-3 py-1.5 text-[13px] font-semibold text-black shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          <T>Share</T>
        </button>
        {/* Export: one combined court document, or each exhibit as its own
            file - numbering (ITEM n / EX-####) is kept either way. */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setExportOpen((v) => !v)}
            aria-expanded={exportOpen}
            className={act}
          >
            <T>Export</T> ▾
          </button>
          {exportOpen && (
            <div className="absolute bottom-full left-1/2 z-10 mb-2 w-72 -translate-x-1/2 rounded-xl bg-forest-900 p-1.5 shadow-2xl ring-1 ring-forest-700/60">
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExportOne(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
              >
                <span className="block text-[13px] font-semibold"><T>One document</T></span>
                <span className="block text-[11.5px] text-cream-100/60"><T>Court-ready PDF - items keep their ITEM and EX-numbers</T></span>
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExportIndividual(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
              >
                <span className="block text-[13px] font-semibold"><T>Individual documents</T></span>
                <span className="block text-[11.5px] text-cream-100/60"><T>Each original file, named with its exhibit number</T></span>
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onIndex(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
              >
                <span className="block text-[13px] font-semibold"><T>Evidence index</T></span>
                <span className="block text-[11.5px] text-cream-100/60"><T>A hand-over list with exhibit numbers and short-lived links</T></span>
              </button>
            </div>
          )}
        </div>
        <button type="button" disabled={busy} onClick={onExclude} className={act}>
          {excludeMode === 'restore' ? <T>Restore</T> : <T>Exclude</T>}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded-full px-3 py-1.5 text-[13px] text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
        >
          <T>Delete</T>
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={t('Clear selection')}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
  if (!mounted || typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

/**
 * Header row for an OPEN evidence folder: back link, name + count, and the
 * full export feature set (one court document / individual files / evidence
 * index / secure share) applied to every item in the folder, plus a two-step
 * folder delete that never touches the evidence itself.
 */
function FolderHeader({
  name,
  count,
  busy,
  isPublic,
  canToggle,
  onToggleVisibility,
  onBack,
  onSelectAll,
  onExportOne,
  onExportIndividual,
  onIndex,
  onShare,
  onDelete,
}: {
  name: string;
  count: number;
  busy: boolean;
  /** True = every case viewer sees this folder; false = creator only. */
  isPublic: boolean;
  /** Only the folder's creator may flip visibility. */
  canToggle: boolean;
  onToggleVisibility: (isPublic: boolean) => void;
  onBack: () => void;
  onSelectAll: () => void;
  onExportOne: () => void;
  onExportIndividual: () => void;
  onIndex: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);
  const btn =
    'rounded-md px-2.5 py-1.5 text-[12.5px] ring-1 ring-ink-200 text-ink-700 hover:bg-cream-50 dark:ring-forest-700/40 dark:text-cream-100/85 dark:hover:bg-forest-800/40 disabled:opacity-50';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-cream-50/70 px-3 py-2.5 dark:border-forest-700/50 dark:bg-forest-900/40">
      <button type="button" onClick={onBack} className="text-[12.5px] text-ink-500 hover:underline dark:text-cream-100/55">
        ← <T>All folders</T>
      </button>
      <span aria-hidden className="text-[15px]">📁</span>
      <span className="min-w-0 truncate text-[14px] font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
        {name}
      </span>
      <span className="text-[12px] text-ink-500 dark:text-cream-100/50" data-no-translate>
        ({count})
      </span>
      {/* Who sees this folder. Public = everyone viewing the case; private =
          only its creator. A pure view preference - the items themselves stay
          in the shared evidence either way. */}
      {canToggle ? (
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          disabled={busy}
          onClick={() => onToggleVisibility(!isPublic)}
          title={t('Public: everyone viewing this case sees the folder. Off: only you see it.')}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1 transition-colors disabled:opacity-50 ${
            isPublic
              ? 'bg-gold-500/10 text-gold-700 ring-gold-500/40 dark:text-gold-300'
              : 'bg-ink-100 text-ink-600 ring-ink-200 dark:bg-forest-800/70 dark:text-cream-100/65 dark:ring-forest-700/50'
          }`}
        >
          <span
            aria-hidden
            className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${
              isPublic ? 'bg-gold-500/70' : 'bg-ink-300 dark:bg-forest-700'
            }`}
          >
            <span
              className={`absolute top-[2px] h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${
                isPublic ? 'left-[13px]' : 'left-[2px]'
              }`}
            />
          </span>
          {isPublic ? <T>Public</T> : <T>Only you</T>}
        </button>
      ) : (
        <span className="inline-flex items-center rounded-full bg-gold-500/10 px-2.5 py-1 text-[11.5px] font-medium text-gold-700 ring-1 ring-gold-500/40 dark:text-gold-300">
          <T>Public</T>
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy || count === 0} onClick={onSelectAll} className={btn}>
          <T>Select all</T>
        </button>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            disabled={busy || count === 0}
            onClick={() => setExportOpen((v) => !v)}
            aria-expanded={exportOpen}
            className={btn}
          >
            <T>Export</T> ▾
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl bg-white p-1.5 shadow-2xl ring-1 ring-ink-200 dark:bg-forest-900 dark:ring-forest-700/60">
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExportOne(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gold-500/10"
              >
                <span className="block text-[13px] font-semibold text-forest-900 dark:text-cream-100"><T>One document</T></span>
                <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/60"><T>Court-ready PDF - items keep their ITEM and EX-numbers</T></span>
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExportIndividual(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gold-500/10"
              >
                <span className="block text-[13px] font-semibold text-forest-900 dark:text-cream-100"><T>Individual documents</T></span>
                <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/60"><T>Each original file, named with its exhibit number</T></span>
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onIndex(); }}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gold-500/10"
              >
                <span className="block text-[13px] font-semibold text-forest-900 dark:text-cream-100"><T>Evidence index</T></span>
                <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/60"><T>A hand-over list with exhibit numbers and short-lived links</T></span>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy || count === 0}
          onClick={onShare}
          className="rounded-md bg-gold-metal px-2.5 py-1.5 text-[12.5px] font-semibold text-black shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          <T>Share</T>
        </button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-md bg-rose-600 px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <T>Delete folder?</T>
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={btn}>
              <T>Keep</T>
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            title={t('Deletes only the folder - every item stays in the evidence')}
            className="rounded-md px-2.5 py-1.5 text-[12.5px] text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-700/40 dark:hover:bg-rose-950/30 disabled:opacity-50"
          >
            <T>Delete folder</T>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "Add to folder" for the current selection: pick an existing folder or name a
 * new one. Membership is additive - the items also stay wherever else they are.
 */
function AddToFolderDialog({
  count,
  existing,
  busy,
  onAdd,
  onClose,
}: {
  count: number;
  existing: string[];
  busy: boolean;
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  return (
    <Dialog onClose={onClose} ariaLabel={t('Add to folder')} size="sm" elevated>
      <div className="p-4">
        <h3 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          <T>Add to folder</T>
        </h3>
        <p className="mt-1 text-[12.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
          {count === 1 ? t('1 selected item') : t('{n} selected items').replace('{n}', String(count))}
          {' · '}
          {t('a folder is a saved view — items stay where they are and can sit in several folders')}
        </p>

        {existing.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
              <T>Existing folders</T>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {existing.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  onClick={() => onAdd(name)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cream-50 px-3 py-1.5 text-[12.5px] font-medium text-forest-700 ring-1 ring-ink-200 hover:bg-gold-500/10 hover:text-gold-700 hover:ring-gold-500/40 disabled:opacity-50 dark:bg-forest-900/50 dark:text-cream-100/80 dark:ring-forest-700/50 dark:hover:text-gold-300"
                  data-no-translate
                >
                  <span aria-hidden>📁</span> {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) onAdd(draft);
          }}
        >
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
            <T>New folder</T>
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={60}
              placeholder={t('e.g. Hearing prep, Key financials…')}
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[13.5px] text-forest-900 outline-none focus:border-gold-500/60 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
              data-no-translate
              autoFocus
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="shrink-0 rounded-md bg-gold-metal px-3.5 py-2 text-[13px] font-semibold text-black shadow-sm hover:brightness-110 disabled:opacity-50"
            >
              <T>Create</T>
            </button>
          </div>
        </form>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-ink-600 ring-1 ring-ink-200 hover:bg-cream-50 dark:text-cream-100/70 dark:ring-forest-700/40 dark:hover:bg-forest-800/40"
          >
            <T>Cancel</T>
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** A collapsible section (a folder, or a date bucket) wrapping its entries. */
function FolderSection({
  name,
  items,
  collapsed,
  renamable,
  onToggle,
  onRename,
  renderItem,
}: {
  name: string;
  items: TimelineEvent[];
  collapsed: boolean;
  renamable: boolean;
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
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 min-w-0 text-left" aria-expanded={!collapsed}>
          <span className="text-ink-400 dark:text-cream-100/45 text-[11px]">{collapsed ? '▸' : '▾'}</span>
          {renaming ? null : (
            <span className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 truncate" data-no-translate>
              {name}
            </span>
          )}
          <span className="text-[11.5px] text-ink-400 dark:text-cream-100/45">({items.length})</span>
        </button>
        {renamable && renaming ? (
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
            <button type="button" onClick={() => setRenaming(false)} className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline">
              <T>Cancel</T>
            </button>
          </form>
        ) : renamable ? (
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
        ) : null}
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
      {items.length > 12 && <span className="text-[10.5px] text-ink-400 dark:text-cream-100/40">+{items.length - 12}</span>}
    </div>
  );
}

/**
 * The per-item "on the timeline" control. Evidence always lives in the intake;
 * this only governs whether the item shows on the case chronology. On = a filled
 * chip that removes on click; off = a quiet outline that adds.
 */
function TimelineToggle({
  on,
  busy,
  onToggle,
  size = 'sm',
}: {
  on: boolean;
  busy: boolean;
  onToggle: () => void;
  size?: 'sm' | 'xs';
}) {
  const pad = size === 'xs' ? 'px-2 py-[3px] text-[10.5px]' : 'px-2.5 py-1 text-[11.5px]';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-full ${pad} font-medium ring-1 transition-colors disabled:opacity-50 ${
        on
          ? 'bg-forest-600 text-cream-50 ring-forest-600 hover:bg-forest-500'
          : 'text-forest-700 ring-ink-200 hover:bg-cream-50 dark:text-cream-100/80 dark:ring-forest-700/40 dark:hover:bg-forest-800/30'
      }`}
    >
      <span aria-hidden>{on ? '✓' : '+'}</span>
      {on ? <T>On timeline</T> : <T>Add to timeline</T>}
    </button>
  );
}

/** Shared props both the list card and the grid tile take. */
type CardShared = {
  firmId: string;
  caseId: string;
  event: TimelineEvent;
  aiEnabled: boolean;
  busy: boolean;
  analyzing: boolean;
  selected: boolean;
  excluded: boolean;
  onTimeline: boolean;
  onToggleSelect: () => void;
  onOpenViewer: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  onToggleExclude: () => void;
  onToggleTimeline: () => void;
};

/**
 * A readable grid card: a large preview of the item on one side, its extracted
 * facts (title, date, people, orgs, locations, summary, relevance, exhibit #)
 * laid out next to it. Side-by-side on any card wide enough; stacks on a narrow
 * one. Clicking the preview or title opens the in-window viewer.
 */
/**
 * Compact gallery tile (default view): just the thumbnail, a small exhibit
 * badge, an on-timeline dot and a two-line caption (title + date). Clicking it
 * opens the full EvidenceViewer, which carries all the context - summary,
 * relevance, people/orgs/places/dates - in its side panel. Deliberately light:
 * the wall of per-item facts lives in the viewer, not on every tile, so a large
 * evidence set reads as a calm contact sheet instead of an endless feed.
 */
function GalleryTile({
  firmId,
  caseId,
  event: e,
  selected,
  excluded,
  onTimeline,
  onToggleSelect,
  onOpenViewer,
}: CardShared) {
  const t = useT();
  const ext = e.aiExtracted ?? {};
  const exhibit = exhibitLabel(ext.exhibit_no);
  return (
    <div className={`group relative flex flex-col ${excluded ? 'opacity-55' : ''}`}>
      <button
        type="button"
        onClick={onOpenViewer}
        aria-label={t('Open item')}
        className={`relative block w-full overflow-hidden rounded-lg ring-1 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 ${
          selected ? 'ring-2 ring-forest-500' : 'ring-ink-100 hover:ring-gold-500/50 dark:ring-forest-800/50'
        }`}
      >
        <div className="aspect-[4/3] w-full bg-ink-50 dark:bg-forest-900/50">
          <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-full w-full" />
        </div>
        {exhibit && (
          <span className="absolute right-1.5 top-1.5 rounded bg-forest-950/70 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-cream-50">
            {exhibit}
          </span>
        )}
        {onTimeline && (
          <span
            aria-hidden
            title={t('On timeline')}
            className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-gold-400 ring-2 ring-forest-950/60"
          />
        )}
      </button>
      {/* Selection checkbox: quiet until hover or selected. */}
      <label
        className={`absolute left-1.5 top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-white/85 shadow ring-1 ring-black/5 transition-opacity dark:bg-forest-900/85 ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        }`}
      >
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3 w-3 accent-forest-600" />
      </label>
      <div className="mt-1.5 min-w-0 px-0.5">
        <button
          type="button"
          onClick={onOpenViewer}
          className="block w-full truncate text-left text-[12px] font-medium text-forest-900 hover:underline dark:text-cream-100"
          data-no-translate
          title={e.title || e.media[0]?.name || ''}
        >
          {e.title || e.media[0]?.name || t('(untitled)')}
        </button>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-400 dark:text-cream-100/45" data-no-translate>
          {formatOccurred(e.occurredAt, e.occurredPrecision)}
        </p>
      </div>
    </div>
  );
}

function GridCard({
  firmId,
  caseId,
  event: e,
  busy,
  selected,
  excluded,
  analyzing,
  onTimeline,
  onToggleSelect,
  onOpenViewer,
  onToggleExclude,
  onToggleTimeline,
}: CardShared) {
  const t = useT();
  const ext = e.aiExtracted ?? {};
  const exhibit = exhibitLabel(ext.exhibit_no);
  const summary = (e.aiSummary ?? '').trim();
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl ring-1 sm:flex-row ${
        selected ? 'ring-2 ring-forest-500' : 'ring-ink-100 dark:ring-forest-800/40'
      } ${excluded ? 'opacity-60' : ''}`}
    >
      {/* Preview side */}
      <div className="relative shrink-0 sm:w-44 lg:w-52">
        <button
          type="button"
          onClick={onOpenViewer}
          className="block h-40 w-full sm:h-full"
          aria-label={t('Open item')}
        >
          <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-full w-full" />
        </button>
        <label className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/85 shadow ring-1 ring-black/5 dark:bg-forest-900/85">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3.5 w-3.5 accent-forest-600" />
        </label>
        {exhibit && (
          <span className="absolute right-2 top-2 rounded bg-forest-950/70 px-1.5 py-0.5 font-mono text-[10px] text-cream-50">
            {exhibit}
          </span>
        )}
      </div>

      {/* Facts side */}
      <div className="min-w-0 flex-1 space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpenViewer}
            className="min-w-0 flex-1 text-left text-[13.5px] font-medium text-forest-900 hover:underline dark:text-cream-100"
            data-no-translate
          >
            <KindIcon kind={e.kind} className="mr-1 inline h-4 w-4 align-text-bottom text-ink-400 dark:text-cream-100/50" />
            {e.title || e.media[0]?.name || t('(untitled)')}
          </button>
          <RelevanceBadge score={ext.relevance_score} reason={ext.relevance_reason} size="xs" />
        </div>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55" data-no-translate>
          {formatOccurred(e.occurredAt, e.occurredPrecision)}
          {excluded ? ` · ${t('Set aside')}` : ''}
        </p>
        {analyzing ? (
          <p className="text-[12px] italic text-ink-400 dark:text-cream-100/40"><T>Analysing…</T></p>
        ) : e.aiStatus === 'skipped' ? (
          <p className="text-[12px] italic text-ink-400 dark:text-cream-100/40"><T>Waiting to be analysed…</T></p>
        ) : summary ? (
          <ExpandableText
            text={summary}
            clampChars={480}
            className="text-[12.5px] leading-relaxed text-ink-600 dark:text-cream-100/70 whitespace-pre-wrap"
          />
        ) : null}
        <div className="space-y-1 pt-0.5">
          <ChipRow icon="👤" label={t('People')} items={ext.detected_people} />
          <ChipRow icon="🏢" label={t('Orgs')} items={ext.organizations} />
          <ChipRow icon="📍" label={t('Places')} items={ext.locations} />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <TimelineToggle on={onTimeline} busy={busy} onToggle={onToggleTimeline} />
          {excluded && (
            <button
              type="button"
              onClick={onToggleExclude}
              className="text-[11px] text-forest-700 hover:underline dark:text-cream-100/80"
            >
              <T>Restore to case</T>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** One evidence entry (list view): thumbnail, header, chips, actions, edit form. */
function EvidenceCard({
  firmId,
  caseId,
  event: e,
  aiEnabled,
  busy,
  analyzing,
  selected,
  excluded,
  onTimeline,
  onToggleSelect,
  onOpenViewer,
  onReanalyze,
  onDelete,
  onToggleExclude,
  onToggleTimeline,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onMoveFolder,
}: CardShared & {
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (edit: EvidenceEdit) => void;
  onMoveFolder: (folder: string) => void;
}) {
  const t = useT();
  const ext = e.aiExtracted ?? {};
  const currentFolder = folderForEvent(e);
  const edited = Boolean(ext.edited_at);
  const exhibit = exhibitLabel(ext.exhibit_no);

  if (editing) {
    return (
      <li className="card p-3">
        <EditForm event={e} onCancel={onCancelEdit} onSave={onSave} busy={busy} />
      </li>
    );
  }

  return (
    <li className={`card p-3 ${excluded ? 'opacity-60' : ''}`}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={t('Select item')}
            className="mt-1 h-4 w-4 accent-forest-600"
          />
          <button
            type="button"
            onClick={onOpenViewer}
            className="block h-28 w-24 overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-forest-800/40 sm:h-32 sm:w-28"
            aria-label={t('Open item')}
          >
            <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-full w-full" />
          </button>
          {excluded && (
            <button
              type="button"
              onClick={onToggleExclude}
              className="text-[10.5px] text-forest-700 hover:underline dark:text-cream-100/80"
            >
              <T>Restore</T>
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex flex-wrap items-center gap-1.5">
                {exhibit && (
                  <span className="rounded bg-cream-100 dark:bg-forest-800/60 px-1.5 py-[1px] font-mono text-[10.5px] text-ink-500 dark:text-cream-100/70">
                    {exhibit}
                  </span>
                )}
                <KindIcon kind={e.kind} className="h-4 w-4 shrink-0 text-ink-400 dark:text-cream-100/50" />
                <button type="button" onClick={onOpenViewer} className="break-words text-left hover:underline" data-no-translate>
                  {e.title || t('(untitled)')}
                </button>
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
              {/* Delete first, so it is immediately reachable at the top of
                  the item rather than buried at the end of the action row. */}
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                aria-label={t('Delete item')}
                className="inline-flex items-center min-h-[30px] px-2.5 rounded-md text-rose-600 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-800/50 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 font-medium"
              >
                <T>Delete</T>
              </button>
              <TimelineToggle on={onTimeline} busy={busy} onToggle={onToggleTimeline} size="xs" />
              <button
                type="button"
                onClick={onOpenViewer}
                className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
              >
                <T>Open</T>
              </button>
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

          <div className="space-y-1">
            <ChipRow icon="👤" label={t('People')} items={ext.detected_people} />
            <ChipRow icon="🏢" label={t('Organizations')} items={ext.organizations} />
            <ChipRow icon="📍" label={t('Locations')} items={ext.locations} />
            <ChipRow icon="📅" label={t('Dates')} items={ext.detected_dates} />
            <ChipRow icon="🔎" label={t('Details')} items={ext.objects} />
          </div>

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
        </div>
      </div>
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

  const field =
    'w-full text-[12.5px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-2 py-1.5';
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
        <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
          <T>Title</T>
        </label>
        <input value={title} onChange={(ev) => setTitle(ev.target.value)} className={field} data-no-translate />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
          <T>What this shows</T>
        </label>
        <textarea value={summary} onChange={(ev) => setSummary(ev.target.value)} rows={3} className={field} data-no-translate />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Date</T>
          </label>
          <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} className={field} />
        </div>
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Precision</T>
          </label>
          <select value={precision} onChange={(ev) => setPrecision(ev.target.value as OccurredPrecision)} className={field} disabled={!date}>
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
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>People (one per line)</T>
          </label>
          <textarea value={people} onChange={(ev) => setPeople(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Organizations (one per line)</T>
          </label>
          <textarea value={orgs} onChange={(ev) => setOrgs(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Locations (one per line)</T>
          </label>
          <textarea value={locations} onChange={(ev) => setLocations(ev.target.value)} className={listBox} data-no-translate />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/40">
            <T>Dates (one per line)</T>
          </label>
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
