'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { installSeedTemplateAction } from '@/lib/seed-template-actions';
import type { SeedTemplate } from '@/lib/seed-templates';
import { templateNameKey } from '@/lib/template-name-match';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Standard templates the legal team can install with one click instead of
 * retyping a document they already use.
 *
 * Installing copies the text into the firm's own list as a DRAFT. Nothing
 * reaches an employee's Hub until the legal team reads it and publishes it,
 * which is the reason the button says "Add as a draft" rather than "Use".
 */
export function StandardTemplates({
  firmId,
  templates,
  installedNames,
}: {
  firmId: string;
  templates: readonly Pick<SeedTemplate, 'slug' | 'name' | 'description' | 'category' | 'notes'>[];
  installedNames: string[];
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // The same key the install action refuses on, so the button and the save
  // cannot disagree about whether a firm already has this document. A trimmed
  // lowercase comparison lived here and in the action, and it is how a firm
  // ended up with two NDAs one hyphen apart.
  const installed = new Set(installedNames.map(templateNameKey));

  const install = async (slug: string) => {
    setBusy(slug);
    setError(null);
    setWarning(null);
    const res = await installSeedTemplateAction(firmId, slug);
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? t('Could not add that template.'));
      return;
    }
    // Added, and worth saying something about. Not an error: the template is
    // in the list either way, and the firm is the one who decides whether two
    // names this close are a problem.
    if (res.warning) setWarning(res.warning);
    setDone((list) => [...list, slug]);
    // The list below this panel is seeded from a server prop into useState, so
    // it does not know about a template that was created after it mounted.
    // Without this the firm is told "Added to your templates" while their
    // templates visibly do not contain it until they reload, which reads as
    // the install having failed.
    router.refresh();
  };

  if (templates.length === 0) return null;

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
      <h2 className="text-[14px] font-semibold text-forest-900 dark:text-cream-100">
        <T>Start from a standard document</T>
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-500 dark:text-cream-100/55">
        <T>
          Added as a draft in your own list, so you can read it and change the wording before
          any employee sees it.
        </T>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {warning && !error && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
          {warning}
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {templates.map((tpl) => {
          const already = installed.has(templateNameKey(tpl.name)) || done.includes(tpl.slug);
          return (
            <li
              key={tpl.slug}
              className="rounded-lg border border-ink-100 p-3 dark:border-forest-800/50"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-forest-900 dark:text-cream-100">
                    {tpl.name}
                    <span className="ml-2 rounded-full bg-gold-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300">
                      {tpl.category}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-500 dark:text-cream-100/60">
                    {tpl.description}
                  </p>
                </div>
                {already ? (
                  <span className="text-[12.5px] font-medium text-ink-500 dark:text-cream-100/55">
                    <T>Added to your templates</T>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => install(tpl.slug)}
                    disabled={busy !== null}
                    className="btn-primary min-h-[40px]"
                  >
                    {busy === tpl.slug ? <T>Adding</T> : <T>Add as a draft</T>}
                  </button>
                )}
              </div>
              {tpl.notes.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-ink-100 pt-2 text-[12px] text-ink-500 dark:border-forest-800/50 dark:text-cream-100/55">
                  {tpl.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
