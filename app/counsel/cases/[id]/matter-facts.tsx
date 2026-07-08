import { T } from '@/components/i18n/LocaleProvider';
import { ExpandableText } from '@/components/ExpandableText';
import { PartyProfileCard } from './party-profile-card';
import type { SubjectProfile } from '@/lib/types';

/**
 * Read-only "Matter facts" panel for the counsel case page - the firm
 * equivalent of the personal case's Facts + Subject panels, but framed
 * as case record / work product, not client self-help. Shows posture,
 * type, jurisdiction, hearing, summary, and the opposing-party dossier
 * captured at intake. Purely presentational; edits happen elsewhere.
 */

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  person: 'Person',
  business: 'Business',
  entity: 'Entity / organization',
  state: 'State / government',
  matter: 'Matter',
};

// Ordered dossier fields → human labels. Only non-empty values render.
const PROFILE_FIELDS: [string, string][] = [
  ['legalName', 'Legal name'],
  ['alsoKnownAs', 'Also known as'],
  ['primaryContactName', 'Primary contact'],
  ['relationship', 'Relationship to client'],
  ['businessType', 'Entity type'],
  ['registrationNumber', 'Registration / EIN'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['website', 'Website'],
  ['address', 'Address'],
  ['agencyOrDepartment', 'Agency / department'],
  ['jurisdictionLevel', 'Jurisdiction level'],
  ['dateOfBirthApprox', 'Date of birth (approx.)'],
];

function fmtHearing(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function MatterFacts({
  firmId,
  caseId,
  posture,
  caseType,
  subjectName,
  subjectType,
  subjectProfile,
  partyImages = [],
  jurisdictionCountry,
  jurisdictionState,
  jurisdictionCity,
  description,
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
  subjectProfile: Record<string, string> | null;
  /** Party-kind case images, so the profile card can show the portrait / logo. */
  partyImages?: { id: string; storagePath: string }[];
  jurisdictionCountry: string | null;
  jurisdictionState: string | null;
  jurisdictionCity: string | null;
  description: string | null;
  hearingAt: string | null;
  hearingLocation: string | null;
  hearingNotes: string | null;
}) {
  const jurisdiction = [jurisdictionCity, jurisdictionState, jurisdictionCountry]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');

  const profile = subjectProfile ?? {};
  const dossier = PROFILE_FIELDS.filter(
    ([key]) => (profile[key] ?? '').trim().length > 0,
  );

  // The party profile card renders when the firm has captured anything worth
  // showing: a portrait/logo, or any of the prove-the-case dossier fields.
  const typedProfile = profile as SubjectProfile;
  const hasPartyProfile =
    partyImages.length > 0 ||
    [
      typedProfile.caseStatus,
      typedProfile.partyRelevance,
      typedProfile.location,
      typedProfile.gender,
      typedProfile.height,
      typedProfile.race,
      typedProfile.otherDescriptors,
      typedProfile.roleContext,
    ].some((v) => (v ?? '').trim().length > 0);

  return (
    <section className="card p-5 space-y-4">
      <p className="eyebrow text-[10px]"><T>Matter facts</T></p>

      {hasPartyProfile && (
        <div className="pb-1 border-b border-ink-100 dark:border-forest-700/40">
          <PartyProfileCard
            firmId={firmId}
            caseId={caseId}
            subjectName={subjectName}
            subjectType={subjectType}
            profile={typedProfile}
            partyImages={partyImages}
          />
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
        <Row label="Posture">
          <span className="capitalize" data-no-translate>{posture}</span>
        </Row>
        <Row label="Matter type">
          <span data-no-translate>{caseType}</span>
        </Row>
        <Row label="Opposing party">
          <span data-no-translate>{subjectName}</span>
          {subjectType && SUBJECT_TYPE_LABEL[subjectType] && (
            <span className="text-ink-400 dark:text-cream-100/40">
              {' '}· <T>{SUBJECT_TYPE_LABEL[subjectType]}</T>
            </span>
          )}
        </Row>
        {jurisdiction && (
          <Row label="Jurisdiction">
            <span data-no-translate>{jurisdiction}</span>
          </Row>
        )}
        {hearingAt && (
          <Row label="Next hearing">
            <span data-no-translate>{fmtHearing(hearingAt)}</span>
            {hearingLocation && (
              <span className="text-ink-400 dark:text-cream-100/40" data-no-translate>
                {' '}· {hearingLocation}
              </span>
            )}
          </Row>
        )}
      </dl>

      {hearingNotes && (
        <div className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
          <span className="text-ink-400 dark:text-cream-100/40"><T>Hearing notes</T>: </span>
          <span data-no-translate>{hearingNotes}</span>
        </div>
      )}

      {description && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40 mb-1">
            <T>Summary</T>
          </p>
          <ExpandableText
            text={description}
            clampChars={320}
            className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap"
          />
        </div>
      )}

      {dossier.length > 0 && (
        <div className="pt-1 border-t border-ink-100 dark:border-forest-700/40">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40 mt-3 mb-2">
            <T>Opposing party dossier</T>
          </p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
            {dossier.map(([key, label]) => (
              <Row key={key} label={label}>
                <span data-no-translate>{profile[key]}</span>
              </Row>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40">
        <T>{label}</T>
      </dt>
      <dd className="text-ink-800 dark:text-cream-100/90">{children}</dd>
    </div>
  );
}
