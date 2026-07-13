import Link from 'next/link';
import type { GuestCaseSummary } from '@/lib/counsel-guest';
import type { CaseEvidenceAnalytics } from '@/lib/case-analytics';
import type { Approach } from '@/lib/firm-approach-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { EvidenceDashboard } from './evidence-dashboard';
import { ApproachBuilder } from './approach-builder';
import { MatterFacts } from './matter-facts';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  under_review: 'Under review',
  needs_evidence: 'Needs evidence',
  export_ready: 'Export ready',
  closed: 'Closed',
  archived: 'Archived',
};

/**
 * The CO-COUNSEL case workspace: the firm-framed Counsel interface for an
 * outside attorney (case_collaborators role 'attorney') scoped to a single
 * matter. Unlike the minimal GuestCaseView, this gives co-counsel the actual
 * case TOOLS - the evidence dashboard, the approach/analysis builder, and the
 * links into the timeline, evidence and PDF export - so they can work the
 * matter alongside the firm.
 *
 * It deliberately renders NONE of the firm-internal operations (time, trust,
 * invoices, deadlines) and no team/invite controls: those live only on the
 * full firm case page, which a guest never reaches (the page early-returns
 * this workspace before any of them are constructed). Every tool here is
 * scoped to this one matter and re-verified server-side on each action.
 */
export function CounselGuestWorkspace({
  kase,
  firmId,
  caseId,
  approaches,
  analytics,
  subjectType,
  subjectProfile,
  posture,
  hearingNotes,
  partyImages,
}: {
  kase: GuestCaseSummary;
  firmId: string | null;
  caseId: string;
  approaches: Approach[];
  analytics: CaseEvidenceAnalytics | null;
  /** Extra matter facts (beyond the guest summary) so the party dossier -
   *  portrait + full record - can lead the workspace like the firm page. */
  subjectType: string | null;
  subjectProfile: Record<string, string> | null;
  posture: string | null;
  hearingNotes: string | null;
  partyImages: { id: string; storagePath: string }[];
}) {
  const place = [kase.jurisdictionCity, kase.jurisdictionState, kase.jurisdictionCountry]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="space-y-8">
      <header className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-gold-300">
          <T>Co-counsel</T>
        </p>
        <h1
          className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100 mt-1 break-words"
          data-no-translate
        >
          {kase.title}
        </h1>
        <p className="text-sm text-cream-100/70 mt-2 max-w-2xl">
          <T>
            You are co-counsel on this matter. Work the case alongside the firm:
            review the evidence, build the argument, and export the record. Firm
            billing and internal operations are not shown.
          </T>
        </p>
      </header>

      {/* Party dossier leads the workspace: the subject's portrait + the full
          record, then the summary - the same read the firm sees. Falls back to
          a plain particulars card if the firm can't be resolved. */}
      {firmId ? (
        <MatterFacts
          firmId={firmId}
          caseId={caseId}
          posture={posture ?? 'claimant'}
          caseType={kase.caseType ?? ''}
          subjectName={kase.subjectName ?? ''}
          subjectType={subjectType}
          subjectProfile={subjectProfile}
          partyImages={partyImages}
          jurisdictionCountry={kase.jurisdictionCountry}
          jurisdictionState={kase.jurisdictionState}
          jurisdictionCity={kase.jurisdictionCity}
          description={kase.description}
          hearingAt={kase.hearingAt}
          hearingLocation={kase.hearingLocation}
          hearingNotes={hearingNotes}
        />
      ) : (
        <section className="card p-5 grid gap-4 sm:grid-cols-2">
          {kase.subjectName && <Field label="Subject" value={kase.subjectName} />}
          {kase.caseType && <Field label="Matter type" value={kase.caseType} />}
          {kase.status && (
            <Field label="Status" value={STATUS_LABEL[kase.status] ?? kase.status} />
          )}
          {place && <Field label="Jurisdiction" value={place} />}
        </section>
      )}

      {/* Case-work sections - the same tools the firm reaches, scoped here. */}
      <nav className="grid gap-3 sm:grid-cols-3">
        <GuestLink
          href={`/counsel/cases/${caseId}/timeline`}
          title="Timeline"
          blurb="The chronology of events on this matter."
        />
        <GuestLink
          href={`/counsel/cases/${caseId}/evidence`}
          title="Evidence"
          blurb="Documents and exhibits gathered for this matter."
        />
        <GuestLink
          href={`/counsel/cases/${caseId}/export`}
          title="Export"
          blurb="Download the evidentiary record as a PDF."
        />
      </nav>

      {analytics ? <EvidenceDashboard analytics={analytics} caseId={caseId} /> : null}

      {firmId ? (
        <ApproachBuilder firmId={firmId} caseId={caseId} initial={approaches} />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-cream-100/55">
        <T>{label}</T>
      </p>
      <p className="text-sm text-cream-100/90 mt-0.5" data-no-translate>
        {value}
      </p>
    </div>
  );
}

function GuestLink({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="card p-4 hover:ring-1 hover:ring-gold-300/40 transition block"
    >
      <p className="text-sm font-semibold text-cream-100">
        <T>{title}</T>
      </p>
      <p className="text-[12px] text-cream-100/60 mt-1">
        <T>{blurb}</T>
      </p>
    </Link>
  );
}
