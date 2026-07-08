'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  listCaseEvidenceForReanalysisAction,
  reanalyzeCaseEvidenceBatchAction,
} from '@/lib/case-evidence-bulk';
import { analyzeCaseFacesAction } from '@/lib/face-actions';

/**
 * "Reanalyze all evidence" control. Re-runs extraction over every item in the
 * matter, driven in small batches so progress shows and no single call runs
 * long. Hand-edited items are kept as they are. When recurring people is on, it
 * rescans faces in the same pass. Reflects the fresh analysis on completion.
 */

const CHUNK = 12;

export function BulkReanalyze({ firmId, caseId }: { firmId: string; caseId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (busy) return;
    if (!window.confirm(t('Re-analyse every item in this matter? Items you have edited by hand are left as they are.'))) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setProgress({ done: 0, total: 0 });

    const list = await listCaseEvidenceForReanalysisAction(firmId, caseId);
    if (!list.ok || !list.eventIds) {
      setNotice(list.error ?? t('Could not start.'));
      setBusy(false);
      setProgress(null);
      return;
    }
    const ids = list.eventIds;
    if (ids.length === 0) {
      setNotice(t('There is no evidence to re-analyse yet.'));
      setBusy(false);
      setProgress(null);
      return;
    }

    setProgress({ done: 0, total: ids.length });
    let analyzed = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await reanalyzeCaseEvidenceBatchAction(firmId, caseId, chunk);
      if (res.ok) {
        analyzed += res.analyzed ?? 0;
        failed += res.failed ?? 0;
        skipped += res.skipped ?? 0;
      } else {
        failed += chunk.length;
      }
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }

    // Rescan recurring faces in the same pass when the firm has that on.
    if (list.facesEnabled) {
      try {
        await analyzeCaseFacesAction(firmId, caseId);
      } catch {
        /* best-effort; the faces panel has its own scan control */
      }
    }

    const parts = [`${analyzed} ${t('re-analysed')}`];
    if (skipped) parts.push(`${skipped} ${t('kept as edited')}`);
    if (failed) parts.push(`${failed} ${t('could not be read')}`);
    setNotice(parts.join(', ') + '.');
    setBusy(false);
    setProgress(null);
    router.refresh();
  }, [busy, firmId, caseId, t, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex items-center rounded-full ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-[13px] text-forest-800 dark:text-cream-100/80 disabled:opacity-50"
      >
        {busy ? <T>Re-analysing</T> : <T>Reanalyze all evidence</T>}
      </button>
      {progress && progress.total > 0 && (
        <span className="text-[12px] text-ink-500 dark:text-cream-100/55" data-no-translate>
          {progress.done}/{progress.total}
        </span>
      )}
      {notice && (
        <span className="text-[12px] text-ink-600 dark:text-cream-100/70" data-no-translate>
          {notice}
        </span>
      )}
    </div>
  );
}
