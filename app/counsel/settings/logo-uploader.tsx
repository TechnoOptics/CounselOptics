'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadFirmLogoAction,
  removeFirmLogoAction,
} from '@/lib/firm-actions';

/**
 * Upload the firm's logo (PNG/JPG/WebP/SVG, <=3MB) to the public
 * firm-branding bucket and store the URL on firms.logo_url. Replaces
 * the old paste-a-URL field - admins shouldn't need a CDN.
 */
export function LogoUploader({
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
    fd.set('logo', file);
    startTransition(async () => {
      const res = await uploadFirmLogoAction(firmId, fd);
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
      const res = await removeFirmLogoAction(firmId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not remove.');
    });
  }

  return (
    <div>
      <p className="label">
        Logo{' '}
        <span className="text-ink-400 dark:text-cream-100/45 font-normal">
          (PNG, JPG, WebP, or SVG - max 3 MB)
        </span>
      </p>
      <div className="flex items-center gap-4">
        <span className="h-14 w-14 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 bg-cream-50 dark:bg-forest-900/40 flex items-center justify-center overflow-hidden flex-none">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Firm logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-[10px] text-ink-400 dark:text-cream-100/40 uppercase tracking-wider">
              None
            </span>
          )}
        </span>
        <div className="space-y-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
            className="block text-[13px] text-ink-700 dark:text-cream-100/85 file:mr-3 file:rounded-md file:border-0 file:bg-gold-400 file:px-3 file:py-1.5 file:text-forest-950 file:font-semibold file:cursor-pointer disabled:opacity-50"
          />
          {currentUrl && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="text-[12px] underline text-rose-600 dark:text-rose-300"
            >
              Remove logo
            </button>
          )}
          {pending && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              Uploading...
            </p>
          )}
          {error && (
            <p className="text-[12px] text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
