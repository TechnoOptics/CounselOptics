'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFirmDocumentAction } from '@/lib/firm-actions';

export function UploadDocumentForm({ firmId }: { firmId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadFirmDocumentAction(firmId, formData);
      if (res.ok) {
        formRef.current?.reset();
        setFileLabel('');
        router.refresh();
      } else {
        setError(res.error ?? 'Upload failed.');
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className="card p-5 sm:p-6 space-y-3">
      <p className="eyebrow">Upload a document</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            File
          </span>
          <label
            htmlFor="firm-doc-file"
            className="btn-secondary cursor-pointer inline-flex"
          >
            Choose file
          </label>
          <span className="ml-3 text-sm text-ink-500 dark:text-cream-100/55 truncate">
            {fileLabel || 'No file selected'}
          </span>
          <input
            id="firm-doc-file"
            name="file"
            type="file"
            required
            disabled={pending}
            className="sr-only"
            onChange={(e) =>
              setFileLabel(e.currentTarget.files?.[0]?.name ?? '')
            }
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Display name (optional)
          </span>
          <input name="name" placeholder="Renewal lease - 2026" className="input" />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Tags{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (comma-separated)
          </span>
        </span>
        <input name="tags" placeholder="lease, renewal, pending" className="input" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          Up to 50 MB. Stored encrypted in private firm vault.
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
    </form>
  );
}
