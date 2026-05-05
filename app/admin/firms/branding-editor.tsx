'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { updateFirmBrandingAction } from '@/lib/actions';

/**
 * Brand editor for an HQ Firms-table row. Inline popover, opens on
 * click, lets the operator upload a new logo and tweak the accent
 * color. Submits via updateFirmBrandingAction; on success the page
 * revalidates and the new branding shows on <slug>.advottic.com
 * within seconds (server action invalidates the firm cache).
 */
export function BrandingEditor({
  firmId,
  firmName,
  slug,
  logoUrl,
  accentColor,
}: {
  firmId: string;
  firmName: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accent, setAccent] = useState(accentColor);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setOpen(false);
    setError(null);
    setAccent(accentColor);
    setRemoveLogo(false);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) {
      setPreviewUrl(null);
      return;
    }
    setRemoveLogo(false);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (removeLogo) fd.set('removeLogo', '1');
    startTransition(async () => {
      const result = await updateFirmBrandingAction(firmId, fd);
      if (!result.ok) {
        setError(result.error ?? 'Save failed.');
        return;
      }
      reset();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-cream-100/80 hover:text-cream-100 hover:bg-white/8 transition-colors"
        title={`Edit ${firmName} branding`}
      >
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded object-cover"
          />
        ) : (
          <span
            className="h-4 w-4 rounded inline-block"
            style={{ backgroundColor: accentColor }}
            aria-hidden
          />
        )}
        <span>Brand</span>
      </button>
    );
  }

  return (
    <div className="absolute z-30 right-0 top-full mt-1 w-80 p-4 rounded-xl bg-[#0a1714] ring-1 ring-white/10 shadow-2xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cream-100/65">
            {firmName}
          </p>
          <button
            type="button"
            onClick={reset}
            className="text-[11px] text-cream-100/55 hover:text-cream-100"
          >
            Cancel
          </button>
        </div>

        <label className="block">
          <span className="block text-[11px] font-medium text-cream-100/85 mb-1">
            Logo
          </span>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg ring-1 ring-white/10 bg-black/40 overflow-hidden flex items-center justify-center flex-none">
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt=""
                  width={48}
                  height={48}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : !removeLogo && logoUrl ? (
                <Image
                  src={logoUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span
                  className="h-full w-full inline-flex items-center justify-center text-cream-100 font-semibold"
                  style={{ backgroundColor: accent }}
                >
                  {firmName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <input
                ref={fileRef}
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={onFile}
                className="block w-full text-[11px] text-cream-100/70 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-white/10 file:text-cream-100 file:cursor-pointer hover:file:bg-white/15"
              />
              {logoUrl && !previewUrl && (
                <label className="flex items-center gap-1.5 text-[11px] text-cream-100/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeLogo}
                    onChange={(e) => setRemoveLogo(e.target.checked)}
                    className="h-3 w-3"
                  />
                  Remove current logo
                </label>
              )}
            </div>
          </div>
          <p className="text-[10px] text-cream-100/45 mt-1">
            PNG, JPEG, WebP, or SVG. Up to 2&nbsp;MB. Square recommended.
          </p>
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium text-cream-100/85 mb-1">
            Accent color
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-8 w-10 rounded border border-white/10 bg-black/40 cursor-pointer"
            />
            <input
              type="text"
              name="accentColor"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="flex-1 px-2 py-1.5 text-[12px] font-mono rounded bg-black/40 ring-1 ring-white/10 text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
              maxLength={7}
              pattern="^#[0-9a-fA-F]{6}$"
            />
          </div>
          <p className="text-[10px] text-cream-100/45 mt-1">
            Used for buttons + emphasis on the firm&rsquo;s tenant subdomain.
          </p>
        </label>

        {error && (
          <p className="text-[11px] text-rose-300 leading-snug">{error}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] font-mono text-cream-100/45">
            {slug}.advottic.com
          </span>
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1.5 rounded text-[12px] font-semibold bg-gold-500 text-forest-950 hover:bg-gold-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {pending ? 'Saving…' : 'Save branding'}
          </button>
        </div>
      </form>
    </div>
  );
}
