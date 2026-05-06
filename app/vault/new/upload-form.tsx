'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadReceiptAction } from '@/lib/receipts-actions';
import { RECEIPT_CATEGORIES } from '@/lib/contract-types';

export function ReceiptUploadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadReceiptAction(formData);
      if (res.ok) router.push('/vault');
      else setError(res.error ?? 'Upload failed.');
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Label
          </span>
          <input
            name="label"
            placeholder="Voicemail from landlord 5/4"
            className="input"
            required
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Category
          </span>
          <select name="category" className="input" required defaultValue="">
            <option value="" disabled>
              Pick a category...
            </option>
            {RECEIPT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.hint ? ` - ${c.hint}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          File{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (optional - up to 50 MB)
          </span>
        </span>
        <label
          htmlFor="receipt-file"
          className="btn-secondary cursor-pointer inline-flex"
        >
          Choose file
        </label>
        <span className="ml-3 text-sm text-ink-500 dark:text-cream-100/55 truncate">
          {fileName || 'No file selected'}
        </span>
        <input
          id="receipt-file"
          name="file"
          type="file"
          className="sr-only"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? '')}
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            When did this happen?
          </span>
          <input name="occurredAt" type="date" className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Source / from
          </span>
          <input
            name="source"
            placeholder="Landlord John, Acme HR, etc."
            className="input"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Description (optional)
        </span>
        <textarea
          name="description"
          rows={3}
          placeholder="What is this and why are you keeping it? One sentence is enough."
          className="input"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Tags{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (comma-separated)
          </span>
        </span>
        <input
          name="tags"
          placeholder="apartment, landlord, water-damage, may-2026"
          className="input"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving...' : 'Save to vault'}
        </button>
      </div>
    </form>
  );
}
