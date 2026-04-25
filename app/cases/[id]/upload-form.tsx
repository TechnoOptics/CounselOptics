'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadExhibitAction } from '@/lib/actions';
import { EXHIBIT_CATEGORIES } from '@/lib/types';

export function UploadForm({
  caseId,
  planItemId,
  compact = false,
}: {
  caseId: string;
  planItemId?: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    if (planItemId) formData.set('planItemId', planItemId);
    startTransition(async () => {
      try {
        await uploadExhibitAction(caseId, formData);
        formRef.current?.reset();
        setFileLabel('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.');
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor={`file-${planItemId ?? 'main'}`}>
          File
        </label>
        <div className="flex items-center gap-3">
          <label
            htmlFor={`file-${planItemId ?? 'main'}`}
            className="btn-secondary cursor-pointer"
          >
            Choose file
          </label>
          <span className="text-sm text-ink-500 truncate">
            {fileLabel || 'No file selected'}
          </span>
        </div>
        <input
          id={`file-${planItemId ?? 'main'}`}
          name="file"
          type="file"
          required
          className="sr-only"
          onChange={(e) => setFileLabel(e.currentTarget.files?.[0]?.name ?? '')}
        />
        <p className="text-xs text-ink-500 mt-1.5">
          Images, PDFs, audio, video, or documents. Up to 50MB.
        </p>
      </div>

      {!compact && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="category">
              Category
            </label>
            <select id="category" name="category" className="input" defaultValue="">
              <option value="">Select…</option>
              {EXHIBIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="incidentDate">
              Date of incident
            </label>
            <input
              id="incidentDate"
              name="incidentDate"
              type="date"
              className="input"
            />
          </div>
        </div>
      )}

      {!compact && (
        <div>
          <label className="label" htmlFor="source">
            Source
          </label>
          <input
            id="source"
            name="source"
            placeholder="Where this evidence came from (device, person, etc.)"
            className="input"
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <input
          id="description"
          name="description"
          placeholder="What this exhibit shows or why it matters"
          className="input"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? 'Uploading…' : planItemId ? 'Fill exhibit slot' : 'Add exhibit'}
        </button>
      </div>
    </form>
  );
}
