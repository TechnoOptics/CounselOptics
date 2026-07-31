'use client';

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/platform';
import { T } from '@/components/i18n/LocaleProvider';
import { getCaseImageUrl } from '@/lib/case-images-actions';
import type { SubjectProfile } from '@/lib/types';

/**
 * Party dossier, the investigative centerpiece of the matter facts. Presents
 * the opposing party as a proper case file: a large ring-framed portrait (or
 * business logo) with survey-style corner ticks, a classification header, and
 * the ENTIRE subject record laid out beside it (posture, party, legal name,
 * aliases, relationship, physical descriptors, contact, address, jurisdiction,
 * hearing), followed by the free-text relevance / role blocks. The matter
 * summary sits beneath this card (in MatterFacts), never inside it.
 *
 * Read-only; edits live in Edit details, and the featured image is chosen in
 * the Case images panel. The image resolves client-side via a short-TTL signed
 * URL, so this stays a self-contained client child of the server-rendered
 * MatterFacts.
 */

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  person: 'Person',
  business: 'Business',
  entity: 'Entity / organization',
  state: 'State / government',
  matter: 'Matter',
};

function fmtHearing(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function PartyProfileCard({
  firmId,
  caseId,
  posture,
  caseType,
  subjectName,
  subjectType,
  profile,
  partyImages,
  jurisdiction,
  hearingAt,
  hearingLocation,
  hearingNotes,
}: {
  firmId: string;
  caseId: string;
  posture: string;
  caseType: string;
  subjectName: string;
  subjectType: string | null;
  profile: SubjectProfile;
  /** All party-kind case images, so we can fall back to the first when none is featured. */
  partyImages: { id: string; storagePath: string }[];
  jurisdiction: string;
  hearingAt: string | null;
  hearingLocation: string | null;
  hearingNotes: string | null;
}) {
  const isPerson = subjectType === 'person' || subjectType == null;
  const isBusiness = subjectType === 'business';
  const classification = isBusiness ? 'Entity' : isPerson ? 'Individual' : 'Subject';

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

  // The full identity record beside the portrait, in the reading order the firm
  // asked for (posture, party, legal name, alias, relationship, sex, height,
  // age, address, then everything else). Only non-empty values render.
  const partyLabel = subjectType && SUBJECT_TYPE_LABEL[subjectType] ? SUBJECT_TYPE_LABEL[subjectType] : '';
  const rows: { label: string; value: string; wide?: boolean }[] = [
    { label: 'Posture', value: posture ? posture.charAt(0).toUpperCase() + posture.slice(1) : '' },
    { label: 'Opposing party', value: [subjectName, partyLabel].filter(Boolean).join(' · ') },
    { label: 'Matter type', value: caseType },
    { label: 'Legal name', value: profile.legalName ?? '' },
    { label: 'Also known as / alias', value: profile.alsoKnownAs ?? '' },
    { label: 'Relationship', value: profile.relationship ?? '' },
    { label: 'Sex', value: profile.gender ?? '' },
    { label: 'Height', value: profile.height ?? '' },
    { label: 'Age', value: profile.age ?? '' },
    { label: 'Date of birth (approx.)', value: profile.dateOfBirthApprox ?? '' },
    { label: 'Race', value: profile.race ?? '' },
    { label: 'Address', value: profile.address ?? '', wide: true },
    { label: 'Status in matter', value: profile.caseStatus ?? '' },
    { label: 'Location', value: profile.location ?? '' },
    { label: 'Primary contact', value: profile.primaryContactName ?? '' },
    { label: 'Entity type', value: profile.businessType ?? '' },
    { label: 'Registration / EIN', value: profile.registrationNumber ?? '' },
    { label: 'Email', value: profile.email ?? '' },
    { label: 'Phone', value: profile.phone ?? '' },
    { label: 'Website', value: profile.website ?? '' },
    { label: 'Agency / department', value: profile.agencyOrDepartment ?? '' },
    { label: 'Jurisdiction level', value: profile.jurisdictionLevel ?? '' },
    { label: 'Jurisdiction', value: jurisdiction },
    { label: 'Other descriptors', value: profile.otherDescriptors ?? '', wide: true },
    {
      label: 'Next hearing',
      value: hearingAt
        ? [fmtHearing(hearingAt), (hearingLocation ?? '').trim()].filter(Boolean).join(' · ')
        : '',
      wide: true,
    },
  ].filter((r) => r.value.trim().length > 0);

  const open = async () => {
    if (!url) return;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, toolbarColor: '#0b0b0d' });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-forest-950/[0.03] to-transparent p-4 ring-1 ring-ink-200/70 dark:from-forest-950/50 dark:to-forest-900/20 dark:ring-forest-700/40 sm:p-5">
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
      <div className="relative mb-4 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-600 dark:text-gold-400/90">
          <T>Subject dossier</T>
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300/90">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
          <T>{classification}</T>
        </span>
      </div>

      <div className="relative flex flex-col gap-5 sm:flex-row sm:gap-6">
        {/* Portrait (person) / logo (business), enlarged and survey-framed. */}
        <div className="mx-auto shrink-0 sm:mx-0">
          <div className="relative">
            <div
              className={`relative h-60 w-48 overflow-hidden sm:h-72 sm:w-56 ${
                isBusiness ? 'rounded-lg bg-white dark:bg-cream-50/95' : 'rounded-lg bg-cream-100/70 dark:bg-forest-950/60'
              } ring-1 ring-ink-300/60 shadow-sm dark:ring-forest-700/50`}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={subjectName}
                  onClick={open}
                  className={`h-full w-full cursor-pointer transition-transform duration-500 hover:scale-[1.03] ${
                    isBusiness ? 'object-contain p-4' : 'object-cover'
                  }`}
                  data-no-translate
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-ink-300 dark:text-cream-100/25">
                  {isBusiness ? <BuildingIcon /> : <PersonIcon />}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-forest-950/75 to-transparent px-2 pb-1.5 pt-6">
                <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-cream-50/80">
                  {url ? <T>On file</T> : <T>No image</T>}
                </p>
              </div>
            </div>
            <CornerTicks />
          </div>
        </div>

        {/* The full record beside the portrait. */}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400 dark:text-cream-100/40">
              <T>{isBusiness ? 'Opposing party (business)' : 'Opposing party'}</T>
            </p>
            <p
              className="mt-0.5 font-display text-[22px] font-semibold leading-tight text-forest-900 dark:text-cream-100"
              data-no-translate
            >
              {subjectName}
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {rows.map((r) => (
              <Field key={r.label} label={r.label} value={r.value} className={r.wide ? 'sm:col-span-2' : ''} />
            ))}
          </dl>

          {(profile.partyRelevance ?? '').trim() && (
            <Block label="Relevance to the matter" value={profile.partyRelevance!} />
          )}
          {(profile.roleContext ?? '').trim() && (
            <Block label="Role in the matter" value={profile.roleContext!} accent />
          )}
          {(hearingNotes ?? '').trim() && (
            <Block label="Hearing notes" value={hearingNotes!} />
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

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
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

/** A full-width free-text block (relevance / role / hearing notes). */
function Block({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={
        accent
          ? 'rounded-lg border-l-2 border-gold-500/60 bg-gold-500/[0.05] px-3 py-2'
          : 'rounded-lg bg-ink-50/60 px-3 py-2 dark:bg-forest-900/40'
      }
    >
      <p
        className={`mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] ${
          accent ? 'text-gold-700 dark:text-gold-400/80' : 'text-ink-400 dark:text-cream-100/40'
        }`}
      >
        <T>{label}</T>
      </p>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700 dark:text-cream-100/85" data-no-translate>
        {value}
      </p>
    </div>
  );
}

function PersonIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
