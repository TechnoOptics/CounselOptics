'use client';

import { useRef, useState, useTransition } from 'react';
import {
  addCommunityGalleryImageAction,
  addCommunityLinkAction,
  closeCommunityCaseAction,
  createCommunityCaseAction,
  publishCommunityCaseAction,
  removeCommunityGalleryImageAction,
  removeCommunityLinkAction,
  reopenCommunityCaseAction,
  unpublishCommunityCaseAction,
  updateCommunityCaseAction,
  uploadCommunityBannerAction,
} from '@/lib/community-actions';
import {
  COMMUNITY_CASE_LINK_PLATFORM_LABEL,
  type CommunityCase,
  type CommunityCaseLink,
  type CommunityCaseLinkPlatform,
} from '@/lib/community-types';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type GalleryImageView = { id: string; caption: string | null; url: string };

export function CommunityEditor({
  caseId,
  communityCase,
  links,
  images,
}: {
  caseId: string;
  communityCase: CommunityCase | null;
  links: CommunityCaseLink[];
  images: GalleryImageView[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!communityCase) {
    return (
      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await createCommunityCaseAction(caseId, formData);
            if (!result.ok) setError(result.error ?? 'Could not create page.');
          });
        }}
        className="card p-5 sm:p-6 space-y-5"
      >
        <div>
          <label className="label" htmlFor="displayName">
            Public case name
          </label>
          <input id="displayName" name="displayName" type="text" required maxLength={200} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="publicSummary">
            Tell the community what&apos;s happening
          </label>
          <textarea id="publicSummary" name="publicSummary" rows={5} maxLength={5000} className="input" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bondAmount">
              Bond amount (USD, optional)
            </label>
            <input id="bondAmount" name="bondAmount" type="number" step="0.01" min="0" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="hearingDisplayOverride">
              Hearing date to show publicly
            </label>
            <input
              id="hearingDisplayOverride"
              name="hearingDisplayOverride"
              type="text"
              placeholder="e.g. July 14, 2026"
              className="input"
            />
          </div>
        </div>
        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create page'}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55">
            {communityCase.caseNumber}
          </p>
          <p className="font-display text-lg text-forest-900 dark:text-cream-100 mt-1">
            Status: {communityCase.status}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/cases/${caseId}/community/export?format=pdf`} className="btn-secondary">
            Export packet (PDF)
          </a>
          <a href={`/cases/${caseId}/community/export?format=docx`} className="btn-secondary">
            Export packet (Word)
          </a>
          {communityCase.status !== 'published' && communityCase.status !== 'closed' && (
            <PublishButton communityCaseId={communityCase.id} caseId={caseId} />
          )}
          {communityCase.status === 'published' && (
            <>
              <a
                href={`/community/${communityCase.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                View public page
              </a>
              <UnpublishButton communityCaseId={communityCase.id} caseId={caseId} />
            </>
          )}
          {communityCase.status !== 'closed' && (
            <CloseButton communityCaseId={communityCase.id} caseId={caseId} />
          )}
          {communityCase.status === 'closed' && (
            <ReopenButton communityCaseId={communityCase.id} caseId={caseId} />
          )}
        </div>
      </div>

      {communityCase.duplicateWarning && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold mb-0.5">Possible duplicate</p>
          <p>{communityCase.duplicateWarning}</p>
        </div>
      )}

      <EditDetailsForm caseId={caseId} communityCase={communityCase} />
      <BannerUpload caseId={caseId} communityCase={communityCase} />
      <GalleryEditor caseId={caseId} communityCaseId={communityCase.id} images={images} />
      <LinksEditor caseId={caseId} communityCaseId={communityCase.id} links={links} />
    </div>
  );
}

function EditDetailsForm({
  caseId,
  communityCase,
}: {
  caseId: string;
  communityCase: CommunityCase;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const result = await updateCommunityCaseAction(communityCase.id, caseId, formData);
          if (!result.ok) setError(result.error ?? 'Could not save.');
          else setSaved(true);
        });
      }}
      className="card p-5 sm:p-6 space-y-5"
    >
      <p className="eyebrow">Page details</p>
      <div>
        <label className="label" htmlFor="displayName">
          Public case name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={200}
          defaultValue={communityCase.displayName}
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="publicSummary">
          Tell the community what&apos;s happening
        </label>
        <textarea
          id="publicSummary"
          name="publicSummary"
          rows={5}
          maxLength={5000}
          defaultValue={communityCase.publicSummary ?? ''}
          className="input"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="bondAmount">
            Bond amount (USD)
          </label>
          <input
            id="bondAmount"
            name="bondAmount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              communityCase.bondAmountCents !== null
                ? (communityCase.bondAmountCents / 100).toString()
                : ''
            }
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="hearingDisplayOverride">
            Hearing date to show publicly
          </label>
          <input
            id="hearingDisplayOverride"
            name="hearingDisplayOverride"
            type="text"
            defaultValue={communityCase.hearingDisplayOverride ?? ''}
            className="input"
          />
        </div>
      </div>
      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-700 dark:text-emerald-300">Saved.</p>}
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function BannerUpload({ caseId, communityCase }: { caseId: string; communityCase: CommunityCase }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await uploadCommunityBannerAction(communityCase.id, caseId, formData);
          if (!result.ok) setError(result.error ?? 'Could not upload.');
        });
      }}
      className="card p-5 sm:p-6 space-y-3"
    >
      <p className="eyebrow">Banner image</p>
      <input type="file" name="file" accept="image/*" className="input" required />
      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? 'Uploading…' : communityCase.bannerImagePath ? 'Replace banner' : 'Upload banner'}
      </button>
    </form>
  );
}

const MAX_GALLERY_IMAGES = 12;

function GalleryEditor({
  caseId,
  communityCaseId,
  images,
}: {
  caseId: string;
  communityCaseId: string;
  images: GalleryImageView[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The photo is published, and deleting it deletes the stored file. Putting it
  // back means finding the original and uploading it again.
  const [removing, setRemoving] = useState<GalleryImageView | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">Photo gallery</p>
      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption ?? ''}
                className="w-full aspect-square object-cover rounded-lg border border-ink-200 dark:border-forest-700/40"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => setRemoving(img)}
                className="absolute top-1 right-1 rounded-full bg-forest-950/80 text-white w-6 h-6 text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {images.length < MAX_GALLERY_IMAGES ? (
        <form
          ref={formRef}
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await addCommunityGalleryImageAction(communityCaseId, caseId, formData);
              if (!result.ok) setError(result.error ?? 'Could not upload.');
              else formRef.current?.reset();
            });
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input type="file" name="file" accept="image/*" className="input flex-1 min-w-[160px]" required />
          <input
            type="text"
            name="caption"
            placeholder="Caption (optional)"
            maxLength={200}
            className="input flex-1 min-w-[160px]"
          />
          <button type="submit" className="btn-secondary" disabled={pending}>
            {pending ? 'Uploading…' : 'Add photo'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-ink-500 dark:text-cream-100/55">
          You&apos;ve reached the {MAX_GALLERY_IMAGES}-photo limit. Remove one to add another.
        </p>
      )}
      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

      {removing && (
        <ConfirmDialog
          question="Remove this photo?"
          detail="It comes off your public page and the file is deleted. To put it back you would need the original again."
          confirmLabel="Remove"
          cancelLabel="Keep it"
          busy={pending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const img = removing;
            setRemoving(null);
            setError(null);
            startTransition(async () => {
              const result = await removeCommunityGalleryImageAction(img.id, caseId);
              if (!result.ok) setError(result.error ?? 'Could not remove image.');
            });
          }}
        />
      )}
    </div>
  );
}

const LINK_PLATFORMS: CommunityCaseLinkPlatform[] = [
  'gofundme',
  'cashapp',
  'zelle',
  'venmo',
  'paypal',
  'other',
];

function LinksEditor({
  caseId,
  communityCaseId,
  links,
}: {
  caseId: string;
  communityCaseId: string;
  links: CommunityCaseLink[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">Fundraising &amp; help links</p>
      <p className="text-xs text-ink-500 dark:text-cream-100/55 leading-relaxed">
        These are link-outs to accounts you control. Advottic never processes or holds any
        funds.
      </p>

      <ul className="space-y-2">
        {links.map((link) => (
          <li
            key={link.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 dark:border-forest-700/40 px-3 py-2 text-sm"
          >
            <span>
              <strong>{link.label || COMMUNITY_CASE_LINK_PLATFORM_LABEL[link.platform]}</strong>
              {link.url ? ` · ${link.url}` : link.handle ? ` · ${link.handle}` : ''}
            </span>
            <button
              type="button"
              className="text-rose-700 dark:text-rose-300 text-xs"
              onClick={() => {
                startTransition(async () => {
                  await removeCommunityLinkAction(link.id, caseId);
                });
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await addCommunityLinkAction(communityCaseId, caseId, formData);
            if (!result.ok) setError(result.error ?? 'Could not add link.');
            else formRef.current?.reset();
          });
        }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 items-end"
      >
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="platform">
            Platform
          </label>
          <select id="platform" name="platform" className="input" defaultValue="gofundme">
            {LINK_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {COMMUNITY_CASE_LINK_PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="label">
            Label (optional)
          </label>
          <input id="label" name="label" type="text" className="input" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="url">
            Link
          </label>
          <input id="url" name="url" type="url" className="input" placeholder="https://…" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="handle">
            Handle (e.g. $cashtag)
          </label>
          <input id="handle" name="handle" type="text" className="input" />
        </div>
        {error && <p className="col-span-full text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <button type="submit" className="btn-secondary col-span-full" disabled={pending}>
          Add link
        </button>
      </form>
    </div>
  );
}

function PublishButton({ communityCaseId, caseId }: { communityCaseId: string; caseId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-primary"
      disabled={pending}
      onClick={() => startTransition(async () => { await publishCommunityCaseAction(communityCaseId, caseId); })}
    >
      {pending ? 'Publishing…' : 'Publish'}
    </button>
  );
}

function UnpublishButton({ communityCaseId, caseId }: { communityCaseId: string; caseId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={pending}
      onClick={() => startTransition(async () => { await unpublishCommunityCaseAction(communityCaseId, caseId); })}
    >
      {pending ? 'Unpublishing…' : 'Unpublish'}
    </button>
  );
}

function CloseButton({ communityCaseId, caseId }: { communityCaseId: string; caseId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
        Close page
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <p className="text-xs text-amber-800 dark:text-amber-200">
        Closing takes the page offline immediately. ID photos and signatures on any Letters of
        Support will be permanently deleted in 48 hours - letter text, names, and addresses are
        kept. You can reopen and cancel the deletion any time before then.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Type "close"'
          className="input w-32"
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() => {
            setError(null);
            const formData = new FormData();
            formData.set('confirm', value);
            startTransition(async () => {
              const result = await closeCommunityCaseAction(communityCaseId, caseId, formData);
              if (!result.ok) setError(result.error ?? 'Could not close.');
              else setConfirming(false);
            });
          }}
        >
          {pending ? 'Closing…' : 'Confirm close'}
        </button>
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}

function ReopenButton({ communityCaseId, caseId }: { communityCaseId: string; caseId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await reopenCommunityCaseAction(communityCaseId, caseId);
            if (!result.ok) setError(result.error ?? 'Could not reopen.');
          })
        }
      >
        {pending ? 'Reopening…' : 'Reopen page'}
      </button>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
