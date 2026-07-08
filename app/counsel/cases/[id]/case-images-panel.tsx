'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '@/lib/platform';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  uploadCaseImageAction,
  deleteCaseImageAction,
  getCaseImageUrl,
  type CaseImage,
} from '@/lib/case-images-actions';

/**
 * Party portraits + case-context images on the matter details. Firm-scoped
 * (admin-path) upload / list / delete. Thumbnails load via short-TTL signed
 * URLs. Two groups: People / parties, and Case context.
 */
export function CaseImagesPanel({
  firmId,
  caseId,
  initial,
}: {
  firmId: string;
  caseId: string;
  initial: CaseImage[];
}) {
  const t = useT();
  const [images, setImages] = useState<CaseImage[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (files: File[], kind: 'party' | 'context') => {
      if (files.length === 0) return;
      setError(null);
      setBusy(true);
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('kind', kind);
        const res = await uploadCaseImageAction(firmId, caseId, fd);
        if (res.ok && res.image) setImages((list) => [...list, res.image!]);
        else if (res.error) setError(res.error);
      }
      setBusy(false);
    },
    [firmId, caseId],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await deleteCaseImageAction(firmId, caseId, id);
      if (res.ok) setImages((list) => list.filter((i) => i.id !== id));
      else if (res.error) setError(res.error);
    },
    [firmId, caseId],
  );

  const party = images.filter((i) => i.kind === 'party');
  const context = images.filter((i) => i.kind === 'context');

  return (
    <section className="card p-5 space-y-4">
      <p className="eyebrow text-[10px]"><T>Case images</T></p>

      <Group
        title={t('People / parties')}
        hint={t('Photos of the people involved in the matter.')}
        images={party}
        kind="party"
        firmId={firmId}
        caseId={caseId}
        busy={busy}
        onUpload={upload}
        onRemove={remove}
      />
      <Group
        title={t('Case context')}
        hint={t('Scene, objects, or reference images for the matter.')}
        images={context}
        kind="context"
        firmId={firmId}
        caseId={caseId}
        busy={busy}
        onUpload={upload}
        onRemove={remove}
      />

      {error && <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>}
    </section>
  );
}

function Group({
  title,
  hint,
  images,
  kind,
  firmId,
  caseId,
  busy,
  onUpload,
  onRemove,
}: {
  title: string;
  hint: string;
  images: CaseImage[];
  kind: 'party' | 'context';
  firmId: string;
  caseId: string;
  busy: boolean;
  onUpload: (files: File[], kind: 'party' | 'context') => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-medium text-forest-900 dark:text-cream-100" data-no-translate>{title}</p>
          <p className="text-[11px] text-ink-400 dark:text-cream-100/45" data-no-translate>{hint}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2.5 py-1 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40 disabled:opacity-50"
        >
          {busy ? t('Uploading…') : t('Add image')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onUpload(files, kind);
            e.target.value = '';
          }}
        />
      </div>
      {images.length > 0 && (
        <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {images.map((img) => (
            <Thumb key={img.id} img={img} firmId={firmId} caseId={caseId} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function Thumb({
  img,
  firmId,
  caseId,
  onRemove,
}: {
  img: CaseImage;
  firmId: string;
  caseId: string;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getCaseImageUrl(firmId, caseId, img.storagePath).then((r) => {
      if (active && r.ok && r.url) setUrl(r.url);
    });
    return () => {
      active = false;
    };
  }, [firmId, caseId, img.storagePath]);

  const open = async () => {
    if (!url) return;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <div className="relative group aspect-square rounded-lg overflow-hidden ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-100/60 dark:bg-forest-900/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={img.label ?? 'Case image'}
          onClick={open}
          className="h-full w-full object-cover cursor-pointer"
          data-no-translate
        />
      ) : (
        <div className="h-full w-full animate-pulse" />
      )}
      <button
        type="button"
        onClick={() => onRemove(img.id)}
        title={t('Remove')}
        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/55 text-white text-[11px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t('Remove image')}
      >
        ×
      </button>
    </div>
  );
}
