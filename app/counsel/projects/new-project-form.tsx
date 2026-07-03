'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction } from '@/lib/projects-actions';

export function NewProjectForm({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    startTransition(async () => {
      const res = await createProjectAction(firmId, { name, description });
      if (res.ok && res.projectId) {
        router.push(`/counsel/projects/${res.projectId}`);
      } else {
        setError(res.error ?? 'Could not create project.');
      }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        New project
      </button>
    );
  }

  return (
    <form action={submit} className="card p-5 space-y-3">
      <p className="eyebrow">New project</p>
      <div>
        <label className="label" htmlFor="project-name">
          Name
        </label>
        <input
          id="project-name"
          name="name"
          required
          maxLength={200}
          autoFocus
          placeholder="e.g. Acme onboarding, Q3 policy review"
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="project-desc">
          Description (optional)
        </label>
        <input
          id="project-desc"
          name="description"
          maxLength={500}
          placeholder="What this project is for"
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
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  );
}
