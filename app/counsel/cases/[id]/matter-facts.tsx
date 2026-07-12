import { T } from '@/components/i18n/LocaleProvider';
import { ExpandableText } from '@/components/ExpandableText';
import { PartyProfileCard } from './party-profile-card';
import type { SubjectProfile } from '@/lib/types';

/**
 * Read-only "Matter facts" panel for the counsel case page. The investigative
 * subject dossier is the centerpiece: the party's image with the ENTIRE record
 * laid out beside it (posture, party, legal name, aliases, relationship, sex,
 * height, age, address, contact, jurisdiction, hearing). The matter summary is
 * the only thing beneath it. Purely presentational; edits happen elsewhere.
 */
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

  const typedProfile = (subjectProfile ?? {}) as SubjectProfile;

  return (
    <section className="card p-5 space-y-4">
      <p className="eyebrow text-[10px]">
        <T>Matter facts</T>
      </p>

      <PartyProfileCard
        firmId={firmId}
        caseId={caseId}
        posture={posture}
        caseType={caseType}
        subjectName={subjectName}
        subjectType={subjectType}
        profile={typedProfile}
        partyImages={partyImages}
        jurisdiction={jurisdiction}
        hearingAt={hearingAt}
        hearingLocation={hearingLocation}
        hearingNotes={hearingNotes}
      />

      {description && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40">
            <T>Summary</T>
          </p>
          <ExpandableText
            text={description}
            clampChars={320}
            className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700 dark:text-cream-100/85"
          />
        </div>
      )}
    </section>
  );
}
