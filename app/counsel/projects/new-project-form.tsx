'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction } from '@/lib/projects-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

export function NewProjectForm({
  firmId,
  caseId = null,
}: {
  firmId: string;
  /** When set, the new project is attached to this case. */
  caseId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    startTransition(async () => {
      const res = await createProjectAction(firmId, { name, description, caseId });
      if (res.ok && res.projectId) {
        router.push(`/counsel/projects/${res.projectId}`);
      } else {
        setError(res.error ?? t('Could not create project.'));
      }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <T>New project</T>
      </button>
    );
  }

  return (
    <form action={submit} className="card p-5 space-y-3">
      <p className="eyebrow"><T>New project</T></p>
      <div>
        <label className="label" htmlFor="project-name">
          <T>Name</T>
        </label>
        <input
          id="project-name"
          name="name"
          required
          maxLength={200}
          autoFocus
          placeholder={t('e.g. Acme onboarding, Q3 policy review')}
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="project-desc">
          <T>Description (optional)</T>
        </label>
        <input
          id="project-desc"
          name="description"
          maxLength={500}
          placeholder={t('What this project is for')}
          className="input"
        />
      </div>
      {error && (
        <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[13px] text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/30"
        >
          <T>Cancel</T>
        </button>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? <T>Creating…</T> : <T>Create project</T>}
        </button>
      </div>
    </form>
  );
}
