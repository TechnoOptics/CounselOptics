'use client';

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/platform';
import { T } from '@/components/i18n/LocaleProvider';
import { getCaseImageUrl } from '@/lib/case-images-actions';
import type { SubjectProfile } from '@/lib/types';

/**
 * Party dossier — the investigative centerpiece of the matter facts. Presents
 * the opposing party as a proper case file: a large ring-framed portrait (or
 * business logo) with survey-style corner ticks, a classification header, and
 * the "prove-the-case" record laid out beside it (status, location, relevance,
 * physical descriptors, and the free-text role context). Read-only; edits live
 * in Edit details, and the featured image is chosen in the Case images panel.
 *
 * The image resolves client-side via a short-TTL signed URL (same as the
 * case-image thumbnails), so this stays a self-contained client child of the
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

  const classification = isBusiness
    ? 'Entity'
    : isPerson
      ? 'Individual'
      : 'Subject';

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
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-forest-950/[0.03] to-transparent p-4 ring-1 ring-ink-200/70 dark:from-forest-950/50 dark:to-forest-900/20 dark:ring-forest-700/40">
      {/* Faint grid wash, evidence-board texture. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      {/* Classification header bar. */}
      <div className="relative mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-600 dark:text-gold-400/90">
          <T>Subject dossier</T>
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300/90">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
          <T>{classification}</T>
        </span>
      </div>

      <div className="relative flex flex-col gap-5 sm:flex-row">
        {/* Portrait (person) / logo (business), enlarged and survey-framed. */}
        <div className="shrink-0">
          <div className="relative">
            <div
              className={`relative h-44 w-36 overflow-hidden ${
                isBusiness
                  ? 'rounded-lg bg-white dark:bg-cream-50/95'
                  : 'rounded-lg bg-cream-100/70 dark:bg-forest-950/60'
              } ring-1 ring-ink-300/60 shadow-sm dark:ring-forest-700/50`}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={subjectName}
                  onClick={open}
                  className={`h-full w-full cursor-pointer transition-transform duration-500 hover:scale-[1.03] ${
                    isBusiness ? 'object-contain p-3' : 'object-cover'
                  }`}
                  data-no-translate
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-ink-300 dark:text-cream-100/25">
                  {isBusiness ? <BuildingIcon /> : <PersonIcon />}
                </div>
              )}
              {/* Bottom caption strip inside the frame. */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-forest-950/75 to-transparent px-2 pb-1.5 pt-6">
                <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-cream-50/80">
                  {url ? <T>On file</T> : <T>No image</T>}
                </p>
              </div>
            </div>
            {/* Survey corner ticks. */}
            <CornerTicks />
          </div>
        </div>

        {/* Record beside the portrait. */}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
              <T>{isBusiness ? 'Opposing party — business' : 'Opposing party'}</T>
            </p>
            <p
              className="mt-0.5 font-display text-[22px] font-semibold leading-tight text-forest-900 dark:text-cream-100"
              data-no-translate
            >
              {subjectName}
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Field label="Status in matter" value={profile.caseStatus} />
            <Field label="Location" value={profile.location} />
            <Field label="Relevance" value={profile.partyRelevance} className="sm:col-span-2" />
          </dl>

          {hasDescriptors && (
            <div className="pt-0.5">
              <p className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
                <T>Descriptors</T>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {descriptors
                  .filter(([, v]) => (v ?? '').trim())
                  .map(([label, v]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-md bg-ink-50 px-2 py-0.5 text-[11.5px] text-ink-700 ring-1 ring-ink-200/70 dark:bg-forest-800/60 dark:text-cream-100/85 dark:ring-forest-700/40"
                    >
                      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
                        <T>{label}</T>
                      </span>
                      <span data-no-translate>{v}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {(profile.roleContext ?? '').trim() && (
            <div className="rounded-lg border-l-2 border-gold-500/60 bg-gold-500/[0.05] px-3 py-2">
              <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-gold-700 dark:text-gold-400/80">
                <T>Role in the matter</T>
              </p>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700 dark:text-cream-100/85"
                data-no-translate
              >
                {profile.roleContext}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** L-shaped survey ticks at each corner of the portrait frame. */
function CornerTicks() {
  const c = 'absolute h-3 w-3 border-gold-500/70';
  return (
    <>
      <span aria-hidden className={`${c} -left-0.5 -top-0.5 border-l-2 border-t-2 rounded-tl-sm`} />
      <span aria-hidden className={`${c} -right-0.5 -top-0.5 border-r-2 border-t-2 rounded-tr-sm`} />
      <span aria-hidden className={`${c} -bottom-0.5 -left-0.5 border-b-2 border-l-2 rounded-bl-sm`} />
      <span aria-hidden className={`${c} -bottom-0.5 -right-0.5 border-b-2 border-r-2 rounded-br-sm`} />
    </>
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
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
        <T>{label}</T>
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink-800 dark:text-cream-100/90" data-no-translate>
        {value}
      </dd>
    </div>
  );
}

function PersonIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
