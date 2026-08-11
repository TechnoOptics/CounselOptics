'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { installSeedTemplateAction } from '@/lib/seed-template-actions';
import type { SeedTemplate } from '@/lib/seed-templates';
import { templateNameKey } from '@/lib/template-name-match';
import { Chip } from '@/components/counsel/patterns';
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
    <details
      // Open only for a firm that has nothing of its own, where installing a
      // standard document is the fastest thing on the page. Once the firm has
      // its own templates, this is a way IN to a second one and belongs shut.
      open={installedNames.length === 0}
      className="rounded-xl border border-edge bg-surface-2 px-4 py-3"
    >
      <summary className="cursor-pointer text-[13px] font-medium text-foreground">
        <T>Start from a standard document</T>
      </summary>

      <p className="mt-1 text-[12.5px] text-muted">
        <T>Added to your list as a draft, so you can change the wording before any employee sees it.</T>
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

      {/* Rows divided by a rule, not a bordered box each. Five bordered cards
          inside a bordered panel read as five things to decide between; a
          divided list reads as one list, which is what it is. The tokens are
          the ones every other counsel surface uses, so this panel stops being
          the only place on the page with its own palette. */}
      <ul className="mt-3 divide-y divide-edge border-t border-edge">
        {templates.map((tpl) => {
          const already = installed.has(templateNameKey(tpl.name)) || done.includes(tpl.slug);
          return (
            <li key={tpl.slug} className="py-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-foreground">
                    <span>{tpl.name}</span>
                    <Chip tone="accent">{tpl.category}</Chip>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {tpl.description}
                  </p>
                </div>
                {already ? (
                  <span className="text-[12.5px] font-medium text-muted">
                    <T>Added to your templates</T>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => install(tpl.slug)}
                    disabled={busy !== null}
                    className="btn-secondary min-h-[40px]"
                  >
                    {busy === tpl.slug ? <T>Adding</T> : <T>Add as a draft</T>}
                  </button>
                )}
              </div>
              {tpl.notes.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12px] text-muted">
                  {tpl.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
