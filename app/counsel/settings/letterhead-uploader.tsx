'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadFirmLetterheadAction,
  removeFirmLetterheadAction,
} from '@/lib/firm-actions';

/**
 * Upload the firm's letterhead - the wide horizontal image that gets
 * painted across the top of any PDF Bella renders for the firm
 * (return address, partners, bar IDs, etc). Separate from the small
 * sidebar logo: that one's a square mark, this one is a full-width
 * stationery strip.
 *
 * Uploads land in the existing public firm-branding bucket. PDFs
 * fetch the URL from firms.letterhead_url at render time, so
 * changes show up on the very next document without a redeploy.
 */
export function LetterheadUploader({
  firmId,
  currentUrl,
}: {
  firmId: string;
  currentUrl: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPick(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set('letterhead', file);
    startTransition(async () => {
      const res = await uploadFirmLetterheadAction(firmId, fd);
      if (res.ok) {
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } else {
        setError(res.error ?? 'Upload failed.');
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeFirmLetterheadAction(firmId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not remove.');
    });
  }

  return (
    <div>
      <p className="label">
        Letterhead{' '}
        <span className="text-ink-500 dark:text-cream-100/70 font-normal">
          (PNG, JPG, or WebP - max 8 MB; painted across the top of PDFs Bella renders)
        </span>
      </p>
      <div className="space-y-3">
        {/* Wide preview strip rather than a square thumb so the user
            actually sees what the PDF header will look like. */}
        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 bg-cream-50 dark:bg-forest-900/40 overflow-hidden flex items-center justify-center min-h-[80px]">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Firm letterhead"
              className="w-full h-auto max-h-32 object-contain"
            />
          ) : (
            <span className="text-[11px] text-ink-400 dark:text-cream-100/40 uppercase tracking-wider py-6">
              No letterhead - PDFs will use a text-only banner
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) onPick(f);
            }}
            className="text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-forest-600 file:px-3 file:py-1.5 file:text-cream-50 file:hover:bg-forest-700 file:cursor-pointer file:disabled:opacity-50"
          />
          {currentUrl ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="text-[12px] text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
