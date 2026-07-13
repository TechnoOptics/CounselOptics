import Link from 'next/link';
import type { GuestCaseSummary } from '@/lib/counsel-guest';
import type { CaseEvidenceAnalytics } from '@/lib/case-analytics';
import type { Approach } from '@/lib/firm-approach-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { SectionPanel } from '@/components/counsel/SectionPanel';
import { ExportPacketTile } from '@/components/counsel/ExportPacketTile';
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
 * outside attorney scoped to a single matter. Leads with the party dossier +
 * case facts, then presents the rest as collapsible SECTION PANELS the reader
 * opens one at a time (evidence overview, case analysis) plus quick links into
 * the timeline, evidence files and export - rather than one long scroll.
 *
 * Renders NONE of the firm-internal operations (time, trust, invoices).
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
  firstName,
}: {
  kase: GuestCaseSummary;
  firmId: string | null;
  caseId: string;
  approaches: Approach[];
  analytics: CaseEvidenceAnalytics | null;
  subjectType: string | null;
  subjectProfile: Record<string, string> | null;
  posture: string | null;
  hearingNotes: string | null;
  partyImages: { id: string; storagePath: string }[];
  /** Counsel's first name, so the workspace can address them directly. */
  firstName?: string | null;
}) {
  const place = [kase.jurisdictionCity, kase.jurisdictionState, kase.jurisdictionCountry]
    .filter(Boolean)
    .join(', ');
  const approachCount = approaches.length;

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
          {firstName ? (
            <>
              <span data-no-translate>{firstName}</span>
              <T>, you are co-counsel on this matter. Start with the party and the
              case facts below, then open any section to work it. Firm billing and
              internal operations are not shown.</T>
            </>
          ) : (
            <T>
              You are co-counsel on this matter. Start with the party and the case
              facts below, then open any section to work it. Firm billing and
              internal operations are not shown.
            </T>
          )}
        </p>
      </header>

      {/* Party dossier + case facts lead the workspace. */}
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

      {/* In-place sections, in the order counsel works them: the assembled
          case analysis first, then the evidence overview. Open one when you
          want it. */}
      <div className="space-y-3">
        {firmId && (
          <SectionPanel
            title="Case analysis"
            blurb="The assembled arguments and the exhibits they marshal."
            meta={`${approachCount} approach${approachCount === 1 ? '' : 'es'}`}
            icon={<ScaleIcon />}
          >
            <ApproachBuilder firmId={firmId} caseId={caseId} initial={approaches} />
          </SectionPanel>
        )}
        {analytics && (
          <SectionPanel
            title="Evidence overview"
            blurb="Volume, coverage, and the year-by-year picture of the evidence."
            meta={`${analytics.total} item${analytics.total === 1 ? '' : 's'}`}
            icon={<ChartIcon />}
          >
            <EvidenceDashboard analytics={analytics} caseId={caseId} />
          </SectionPanel>
        )}
      </div>

      {/* Quick links into the routed sections, at the bottom. */}
      <div className="space-y-3">
        <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-cream-100/50">
          <T>Explore this matter</T>
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <NavTile href={`/counsel/cases/${caseId}/timeline`} title="Timeline" blurb="The chronology of events on this matter." icon={<ClockIcon />} />
          <NavTile href={`/counsel/cases/${caseId}/evidence`} title="Evidence files" blurb="Documents and exhibits gathered for this matter." icon={<FolderIcon />} />
          <ExportPacketTile href={`/counsel/cases/${caseId}/export`} title="Export packet" blurb="Download the evidentiary record as a PDF." icon={<DownloadIcon />} />
        </div>
      </div>
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

function NavTile({ href, title, blurb, icon }: { href: string; title: string; blurb: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-cream-50/10 bg-forest-900/30 p-4 transition-all hover:border-gold-metal/30 hover:bg-forest-900/55"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-gold-metal/12 text-gold-metal ring-1 ring-gold-metal/25">
          {icon}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-cream-100/40 transition-transform group-hover:translate-x-0.5">
          <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="mt-3 text-[15px] font-semibold text-cream-50">
        <T>{title}</T>
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-cream-100/55">
        <T>{blurb}</T>
      </p>
    </Link>
  );
}

// ── Tile icons ──
function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ScaleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 006 0L5 7Zm14 0l-3 6a3 3 0 006 0l-3-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
