'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { CaseMap, type MapPoint } from '@/app/cases/[id]/timeline/case-map';
import {
  formatOccurred,
  KIND_ICON,
  KIND_LABEL,
  type TimelineEvent,
} from '@/lib/timeline-types';
import {
  bulkImportCaseEvidenceAction,
  getFirmCaseTimeline,
  analyzeFirmCaseEventAction,
  deleteFirmCaseEventAction,
  getFirmEvidenceMediaUrl,
} from '@/lib/case-evidence-actions';

const BATCH = 6; // files per request, so the UI can show progress + stay in limits

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
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const res = await getFirmCaseTimeline(firmId, caseId);
    if (res.ok && res.events) setEvents(res.events);
  }, [firmId, caseId]);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];
      setProgress({ done: 0, total: files.length });
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const fd = new FormData();
        for (const f of batch) fd.append('files', f);
        const res = await bulkImportCaseEvidenceAction(firmId, caseId, fd);
        imported += res.imported ?? 0;
        failed += res.failed ?? 0;
        if (res.errors) errors.push(...res.errors);
        if (!res.ok && res.error && !res.imported) errors.push(res.error);
        setProgress({ done: Math.min(i + BATCH, files.length), total: files.length });
        await refresh();
      }
      setBusy(false);
      setProgress(null);
      const parts = [t('Imported {n} file(s).').replace('{n}', String(imported))];
      if (failed) parts.push(t('{n} could not be imported.').replace('{n}', String(failed)));
      setNotice(parts.join(' '));
      if (errors.length) setError(errors.slice(0, 4).join('  •  '));
    },
    [firmId, caseId, refresh, t],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void upload(files);
  };

  function reanalyze(id: string) {
    setAnalyzing((s) => new Set(s).add(id));
    startTransition(async () => {
      const res = await analyzeFirmCaseEventAction(firmId, caseId, id);
      if (res.event) setEvents((list) => list.map((e) => (e.id === id ? res.event! : e)));
      else if (res.error) setError(res.error);
      setAnalyzing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteFirmCaseEventAction(firmId, caseId, id);
      if (res.ok) setEvents((list) => list.filter((e) => e.id !== id));
      else if (res.error) setError(res.error);
    });
  }

  async function openMedia(path: string) {
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
  }

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
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          {busy
            ? progress
              ? t('Importing {d}/{n}…').replace('{d}', String(progress.done)).replace('{n}', String(progress.total))
              : t('Importing…')
            : t('Choose files')}
        </button>
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

      {/* Evidence list */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            <T>Evidence</T> <span className="text-ink-400 dark:text-cream-100/40">({events.length})</span>
          </h2>
          <Link
            href={`/cases/${caseId}/timeline`}
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
          <ul className="space-y-2">
            {events.map((e) => {
              const isAnalyzing = analyzing.has(e.id) || e.aiStatus === 'running';
              return (
                <li key={e.id} className="card p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 flex flex-wrap items-center gap-1.5">
                        <span>{KIND_ICON[e.kind]}</span>
                        <span className="break-words">{e.title || t('(untitled)')}</span>
                        <RelevanceBadge score={e.aiExtracted.relevance_score} reason={e.aiExtracted.relevance_reason} size="xs" />
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
                          onClick={() => openMedia(e.media[0].path)}
                          className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30"
                        >
                          <T>Open</T>
                        </button>
                      )}
                      {aiEnabled && (
                        <button
                          type="button"
                          disabled={isAnalyzing || pending}
                          onClick={() => reanalyze(e.id)}
                          className="inline-flex items-center min-h-[30px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
                        >
                          {isAnalyzing ? <T>Analysing…</T> : <T>Re-analyse</T>}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(e.id)}
                        className="inline-flex items-center min-h-[30px] px-2.5 rounded-md text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                      >
                        <T>Delete</T>
                      </button>
                    </div>
                  </div>

                  {e.aiExtracted.email && (
                    <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
                      {e.aiExtracted.email.from ? `From ${e.aiExtracted.email.from}` : ''}
                      {e.aiExtracted.email.to?.length ? ` → ${e.aiExtracted.email.to.slice(0, 3).join(', ')}` : ''}
                    </p>
                  )}

                  {e.aiStatus === 'error' && e.aiError ? (
                    <p className="text-[12px] text-rose-600 dark:text-rose-300">{e.aiError}</p>
                  ) : isAnalyzing ? (
                    <p className="text-[12px] text-ink-400 dark:text-cream-100/40 italic">
                      <T>Analysing…</T>
                    </p>
                  ) : e.aiSummary ? (
                    <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 whitespace-pre-wrap" data-no-translate>
                      {e.aiSummary}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
