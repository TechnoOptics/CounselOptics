'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  associateProjectWithCaseAction,
  unlinkProjectFromCaseAction,
  createCaseFromProjectAction,
  pullProjectFilesIntoCaseAction,
} from '@/lib/projects-actions';

type CaseOption = { id: string; title: string; status: string };

/**
 * "Link to a case" panel on the project workspace: bind the binder to a matter
 * (create a new one or attach an existing one), then pull the binder's
 * documents into that matter's evidence timeline.
 */
export function LinkCasePanel({
  firmId,
  projectId,
  linkedCase,
  caseOptions,
  docCount,
}: {
  firmId: string;
  projectId: string;
  linkedCase: CaseOption | null;
  caseOptions: CaseOption[];
  docCount: number;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickCaseId, setPickCaseId] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else {
        setError(res.error ?? t('Something went wrong.'));
      }
    });
  }

  function createMatter() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await createCaseFromProjectAction(firmId, projectId);
      if (res.ok && res.caseId) {
        router.push(`/counsel/cases/${res.caseId}`);
      } else {
        setError(res.error ?? t('Could not open the matter.'));
      }
    });
  }

  function pullFiles() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await pullProjectFilesIntoCaseAction(firmId, projectId);
      if (res.ok) {
        const parts = [t('Pulled {n} file(s) into the case.').replace('{n}', String(res.imported ?? 0))];
        if (res.failed) parts.push(t('{n} could not be imported.').replace('{n}', String(res.failed)));
        setNotice(parts.join(' '));
        router.refresh();
      } else {
        setError(res.error ?? t('Nothing was imported.'));
      }
    });
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          <T>Link to a case</T>
        </h2>
        {linkedCase && (
          <span className="text-[11px] uppercase tracking-[0.1em] text-ink-400 dark:text-cream-100/40">
            <T>Linked</T>
          </span>
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

      {linkedCase ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3">
            <div className="min-w-0">
              <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
                <T>This project belongs to</T>
              </p>
              <Link
                href={`/counsel/cases/${linkedCase.id}`}
                className="text-[14px] font-medium text-forest-800 dark:text-cream-100 hover:underline break-words"
              >
                {linkedCase.title}
              </Link>
              <span className="ml-2 text-[11px] text-ink-400 dark:text-cream-100/40">
                {linkedCase.status}
              </span>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => unlinkProjectFromCaseAction(firmId, projectId))}
              className="inline-flex items-center min-h-[36px] px-3 rounded-md text-[12px] text-ink-600 dark:text-cream-100/70 ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
            >
              <T>Unlink</T>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || docCount === 0}
              onClick={pullFiles}
              className="btn-primary disabled:opacity-50"
              title={docCount === 0 ? t('Upload documents to this project first.') : undefined}
            >
              {pending
                ? t('Pulling in…')
                : t('Pull {n} file(s) into case').replace('{n}', String(docCount))}
            </button>
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              <T>Copies the project's documents into the case evidence timeline for analysis.</T>
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
            <T>
              Attach this binder to the matter it is for, then pull its documents into the case
              evidence timeline.
            </T>
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[200px]">
              <span className="block text-[12px] text-ink-500 dark:text-cream-100/55 mb-1">
                <T>Attach an existing matter</T>
              </span>
              <select
                value={pickCaseId}
                onChange={(e) => setPickCaseId(e.target.value)}
                className="input w-full"
              >
                <option value="">{t('Choose a matter…')}</option>
                {caseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.status})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pending || !pickCaseId}
              onClick={() =>
                run(() => associateProjectWithCaseAction(firmId, projectId, pickCaseId))
              }
              className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[13px] ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
            >
              <T>Link</T>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-200 dark:bg-forest-700/40" />
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-400 dark:text-cream-100/40">
              <T>or</T>
            </span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-forest-700/40" />
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={createMatter}
            className="btn-primary disabled:opacity-50"
          >
            {pending ? t('Opening matter…') : t('Open a new matter from this project')}
          </button>
        </div>
      )}
    </section>
  );
}
