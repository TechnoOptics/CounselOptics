'use client';

import { useMemo, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';

export type DuplicateAction = 'skip' | 'replace' | 'rename';

export type DuplicateEntry = {
  file: File;
  hash: string;
  existing: { id: string; title: string; exhibit: string | null };
};

/**
 * Shown when a drop/selection contains files whose bytes already exist in this
 * matter. For each duplicate the reader chooses to Skip it, Replace the stored
 * copy, or keep both (Rename). An "apply to all" control sets one action for
 * every remaining duplicate at once, so a big batch is resolved in one click.
 * Non-duplicate files in the same batch are unaffected and import regardless.
 */
export function DuplicateDialog({
  entries,
  onCancel,
  onApply,
}: {
  entries: DuplicateEntry[];
  onCancel: () => void;
  onApply: (resolutions: Map<File, DuplicateAction>) => void;
}) {
  const t = useT();
  const [actions, setActions] = useState<DuplicateAction[]>(() => entries.map(() => 'skip'));
  const [bulk, setBulk] = useState<DuplicateAction>('skip');

  const applyToAll = (a: DuplicateAction) => {
    setBulk(a);
    setActions(entries.map(() => a));
  };

  const resolutions = useMemo(() => {
    const map = new Map<File, DuplicateAction>();
    entries.forEach((e, i) => map.set(e.file, actions[i] ?? 'skip'));
    return map;
  }, [entries, actions]);

  const label: Record<DuplicateAction, string> = {
    skip: t('Skip'),
    replace: t('Replace'),
    rename: t('Keep both'),
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Duplicate files')}
      onClick={onCancel}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-forest-900"
      >
        <div className="border-b border-ink-100 p-5 dark:border-forest-700/40">
          <h2 className="text-[15px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Some files are already in this matter</T>
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-500 dark:text-cream-100/55">
            {t('{n} of the files you added match evidence already stored here. Choose what to do with each.').replace(
              '{n}',
              String(entries.length),
            )}
          </p>
        </div>

        {entries.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-cream-50/60 px-5 py-2.5 dark:border-forest-700/40 dark:bg-forest-900/40">
            <span className="text-[11px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/45">
              <T>Apply to all</T>
            </span>
            {(['skip', 'replace', 'rename'] as DuplicateAction[]).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => applyToAll(a)}
                className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${
                  bulk === a
                    ? 'bg-forest-600 text-cream-50 ring-forest-600'
                    : 'ring-ink-200 text-ink-600 dark:ring-forest-700/40 dark:text-cream-100/70'
                }`}
              >
                {label[a]}
              </button>
            ))}
          </div>
        )}

        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {entries.map((e, i) => (
            <li key={i} className="space-y-1.5">
              <p className="truncate text-[13px] font-medium text-forest-900 dark:text-cream-100" data-no-translate>
                {e.file.name}
              </p>
              <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
                {t('Matches')} {e.existing.exhibit ? `${e.existing.exhibit} · ` : ''}
                {e.existing.title}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(['skip', 'replace', 'rename'] as DuplicateAction[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() =>
                      setActions((prev) => {
                        const n = [...prev];
                        n[i] = a;
                        return n;
                      })
                    }
                    className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${
                      actions[i] === a
                        ? 'bg-forest-600 text-cream-50 ring-forest-600'
                        : 'ring-ink-200 text-ink-600 hover:bg-cream-50 dark:ring-forest-700/40 dark:text-cream-100/70 dark:hover:bg-forest-800/30'
                    }`}
                  >
                    {label[a]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 p-4 dark:border-forest-700/40">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[38px] items-center rounded-md px-3 text-[13px] text-ink-600 ring-1 ring-ink-200 hover:bg-cream-50 dark:text-cream-100/80 dark:ring-forest-700/40 dark:hover:bg-forest-800/30"
          >
            <T>Cancel import</T>
          </button>
          <button type="button" onClick={() => onApply(resolutions)} className="btn-primary">
            <T>Continue</T>
          </button>
        </div>
      </div>
    </div>
  );
}
