'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type ActionResult = { ok: boolean; error?: string };

/**
 * Shared shape behind LogoUploader and LetterheadUploader
 * (app/counsel/settings/) - upload-to-a-firm-branding-field +
 * remove, with a preview, that previously differed only in field
 * name, accepted types, size copy, preview aspect ratio, and accent
 * color. Unlike the four case/vault/contract/firm-document upload
 * forms (which have genuinely different fields and post-submit
 * behavior per domain), these two really are the same component with
 * different parameters.
 */
export function FirmBrandingImageUploader({
  firmId,
  currentUrl,
  fieldName,
  uploadAction,
  removeAction,
  accept,
  sizeLabel,
  label,
  alt,
  emptyLabel,
  variant,
}: {
  firmId: string;
  currentUrl: string;
  /** FormData field name the upload action expects the file under. */
  fieldName: string;
  uploadAction: (firmId: string, formData: FormData) => Promise<ActionResult>;
  removeAction: (firmId: string) => Promise<ActionResult>;
  accept: string;
  sizeLabel: string;
  label: string;
  alt: string;
  emptyLabel: string;
  variant: 'square' | 'wide';
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPick(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set(fieldName, file);
    startTransition(async () => {
      const res = await uploadAction(firmId, fd);
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
      const res = await removeAction(firmId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not remove.');
    });
  }

  const fileInputClassName =
    variant === 'square'
      ? 'block text-[13px] text-ink-700 dark:text-cream-100/85 file:mr-3 file:rounded-md file:border-0 file:bg-gold-400 file:px-3 file:py-1.5 file:text-forest-950 file:font-semibold file:cursor-pointer disabled:opacity-50'
      : 'text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-forest-600 file:px-3 file:py-1.5 file:text-cream-50 file:hover:bg-forest-700 file:cursor-pointer file:disabled:opacity-50';

  return (
    <div>
      <p className="label">
        {label} <span className="text-ink-500 dark:text-cream-100/70 font-normal">({sizeLabel})</span>
      </p>
      {variant === 'square' ? (
        <div className="flex items-center gap-4">
          <span className="h-14 w-14 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 bg-cream-50 dark:bg-forest-900/40 flex items-center justify-center overflow-hidden flex-none">
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt={alt} className="h-full w-full object-contain" />
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
              accept={accept}
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
              className={fileInputClassName}
            />
            {currentUrl && (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="text-[12px] underline text-rose-600 dark:text-rose-300"
              >
                Remove
              </button>
            )}
            {pending && (
              <p className="text-[12px] text-ink-500 dark:text-cream-100/55">Uploading...</p>
            )}
            {error && <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 bg-cream-50 dark:bg-forest-900/40 overflow-hidden flex items-center justify-center min-h-[80px]">
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt={alt} className="w-full h-auto max-h-32 object-contain" />
            ) : (
              <span className="text-[11px] text-ink-400 dark:text-cream-100/40 uppercase tracking-wider py-6">
                {emptyLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              disabled={pending}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onPick(f);
              }}
              className={fileInputClassName}
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
          {error ? <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
