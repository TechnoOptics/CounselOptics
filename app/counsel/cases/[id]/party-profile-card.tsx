'use client';

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/platform';
import { T } from '@/components/i18n/LocaleProvider';
import { getCaseImageUrl } from '@/lib/case-images-actions';
import type { SubjectProfile } from '@/lib/types';

/**
 * Party profile portrait card shown at the top of the matter facts, part of the
 * firm "prove-the-case" layer. Renders the party's photo (person) or logo
 * (business) alongside the dossier the firm keeps: name, status in the matter,
 * relevance, location, physical descriptors (person only), and a free-text role
 * context. Purely presentational, read-only; editing happens in Edit details
 * and the featured image is chosen from the Case images panel.
 *
 * The image is resolved client-side via a short-TTL signed URL (same as the
 * case-images thumbnails), so this stays a self-contained client child of the
 * server-rendered MatterFacts.
 */
export function PartyProfileCard({
  firmId,
  caseId,
  subjectName,
  subjectType,
  profile,
  partyImages,
}: {
  firmId: string;
  caseId: string;
  subjectName: string;
  subjectType: string | null;
  profile: SubjectProfile;
  /** All party-kind case images, so we can fall back to the first when none is featured. */
  partyImages: { id: string; storagePath: string }[];
}) {
  const isPerson = subjectType === 'person' || subjectType == null;
  const isBusiness = subjectType === 'business';

  // Choose the featured party image, else the first party image on file.
  const featured =
    partyImages.find((i) => i.id === profile.featuredImageId) ?? partyImages[0] ?? null;

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!featured) {
      setUrl(null);
      return;
    }
    let active = true;
    getCaseImageUrl(firmId, caseId, featured.storagePath).then((r) => {
      if (active && r.ok && r.url) setUrl(r.url);
    });
    return () => {
      active = false;
    };
  }, [firmId, caseId, featured]);

  const descriptors: [string, string | undefined][] = isPerson
    ? [
        ['Gender', profile.gender],
        ['Height', profile.height],
        ['Race', profile.race],
        ['Other', profile.otherDescriptors],
      ]
    : [];
  const hasDescriptors = descriptors.some(([, v]) => (v ?? '').trim());

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
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* Portrait (person) / logo (business). Square, ring-framed; business
          logos sit on a light plate so transparent PNGs read cleanly. */}
      <div className="shrink-0">
        <div
          className={`relative h-28 w-28 overflow-hidden ${
            isBusiness ? 'rounded-lg bg-white dark:bg-cream-50/90' : 'rounded-full bg-cream-100/70 dark:bg-forest-900/50'
          } ring-1 ring-ink-200 dark:ring-forest-700/40`}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={subjectName}
              onClick={open}
              className={`h-full w-full cursor-pointer ${isBusiness ? 'object-contain p-2' : 'object-cover'}`}
              data-no-translate
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-ink-300 dark:text-cream-100/30">
              {isBusiness ? <BuildingIcon /> : <PersonIcon />}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40">
            <T>{isBusiness ? 'Opposing party (business)' : 'Opposing party'}</T>
          </p>
          <p className="text-[15px] font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
            {subjectName}
          </p>
        </div>

        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-[13px]">
          <Field label="Status in matter" value={profile.caseStatus} />
          <Field label="Location" value={profile.location} />
          <Field label="Relevance" value={profile.partyRelevance} className="sm:col-span-2" />
        </dl>

        {hasDescriptors && (
          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40 mb-1">
              <T>Descriptors</T>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {descriptors
                .filter(([, v]) => (v ?? '').trim())
                .map(([label, v]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full bg-ink-50 dark:bg-forest-800/60 px-2 py-0.5 text-[11.5px] text-ink-700 dark:text-cream-100/85"
                  >
                    <span className="text-ink-400 dark:text-cream-100/40"><T>{label}</T>:</span>
                    <span data-no-translate>{v}</span>
                  </span>
                ))}
            </div>
          </div>
        )}

        {(profile.roleContext ?? '').trim() && (
          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40 mb-0.5">
              <T>Role in the matter</T>
            </p>
            <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap" data-no-translate>
              {profile.roleContext}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string | undefined;
  className?: string;
}) {
  if (!(value ?? '').trim()) return null;
  return (
    <div className={`flex flex-col ${className}`}>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40">
        <T>{label}</T>
      </dt>
      <dd className="text-ink-800 dark:text-cream-100/90 whitespace-pre-wrap" data-no-translate>
        {value}
      </dd>
    </div>
  );
}

function PersonIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
