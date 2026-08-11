'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadExhibitAction } from '@/lib/actions';
import { EXHIBIT_CATEGORIES } from '@/lib/types';

export function UploadForm({ caseId }: { caseId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // The refusal arrives as a value. It used to be thrown, and React strips
      // an error's message crossing the Server Action boundary in a production
      // build, so reading err.message here showed the person "An error occurred
      // in the Server Components render..." instead of what was wrong with
      // their file. The catch below is kept for a dropped connection only, and
      // deliberately does NOT read a message off the rejection.
      try {
        const res = await uploadExhibitAction(caseId, formData);
        if (!res.ok) {
          setError(res.error ?? 'Upload failed.');
          return;
        }
        formRef.current?.reset();
        setFileLabel('');
      } catch {
        setError(
          'That upload did not reach us. Check your connection and try again.',
        );
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="file-main">
          File
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="file-main" className="btn-secondary cursor-pointer">
            Choose file
          </label>
          {/* Mobile rear-camera capture - on phones this opens the
              camera straight to the back lens. On desktop the browser
              degrades to a normal file picker, which is fine. */}
          <label
            htmlFor="file-camera"
            className="btn-secondary cursor-pointer inline-flex items-center gap-1.5"
            title="Capture a photo with the rear camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Scan with camera
          </label>
          <span className="text-sm text-ink-500 truncate">
            {fileLabel || 'No file selected'}
          </span>
        </div>
        <input
          id="file-main"
          name="file"
          type="file"
          required
          className="sr-only"
          onChange={(e) => setFileLabel(e.currentTarget.files?.[0]?.name ?? '')}
        />
        {/* Hidden second input, camera-only. When the user picks
            from it we shadow-copy the File into the main input via
            DataTransfer so the form submission only carries one
            entry. */}
        <input
          id="file-camera"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) return;
            const main = formRef.current?.querySelector<HTMLInputElement>(
              'input[name="file"]',
            );
            if (main) {
              const dt = new DataTransfer();
              dt.items.add(f);
              main.files = dt.files;
              setFileLabel(f.name);
              // Auto-pick "Photo" as a sensible category default
              // when the user just scanned with the camera.
              const cat = formRef.current?.querySelector<HTMLSelectElement>(
                'select[name="category"]',
              );
              if (cat && !cat.value) cat.value = 'Photo';
            }
            e.currentTarget.value = '';
          }}
        />
        <p className="text-xs text-ink-500 mt-1.5">
          Images, PDFs, audio, video, or documents. Up to 50MB. On phone, &ldquo;Scan with
          camera&rdquo; opens straight to the rear lens.
        </p>
      </div>

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
          <input id="incidentDate" name="incidentDate" type="date" className="input" />
        </div>
      </div>

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
          {pending ? 'Uploading…' : 'Add exhibit'}
        </button>
      </div>
    </form>
  );
}
