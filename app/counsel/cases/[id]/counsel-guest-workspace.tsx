import type { GuestCaseSummary } from '@/lib/counsel-guest';
import type { CaseEvidenceAnalytics } from '@/lib/case-analytics';
import type { Approach } from '@/lib/firm-approach-actions';
import { T } from '@/components/i18n/LocaleProvider';
import { SectionHub, type HubSection } from '@/components/counsel/SectionHub';
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
 * matter. Leads with the party dossier + case facts, then presents the rest of
 * the matter as a grid of SECTION TILES (SectionHub) the reader opens one at a
 * time — evidence overview, case analysis, timeline, evidence files, export —
 * rather than one long scroll of everything at once.
 *
 * It deliberately renders NONE of the firm-internal operations (time, trust,
 * invoices, deadlines) and no team/invite controls: those live only on the
 * full firm case page, which a guest never reaches.
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
  subjectType: string | null;
  subjectProfile: Record<string, string> | null;
  posture: string | null;
  hearingNotes: string | null;
  partyImages: { id: string; storagePath: string }[];
}) {
  const place = [kase.jurisdictionCity, kase.jurisdictionState, kase.jurisdictionCountry]
    .filter(Boolean)
    .join(', ');

  const approachCount = approaches.length;
  const sections: HubSection[] = [];
  if (analytics) {
    sections.push({
      key: 'overview',
      title: 'Evidence overview',
      blurb: 'Volume, coverage, and the year-by-year picture of the evidence.',
      meta: `${analytics.total} item${analytics.total === 1 ? '' : 's'}`,
      icon: <ChartIcon />,
      content: <EvidenceDashboard analytics={analytics} caseId={caseId} />,
    });
  }
  if (firmId) {
    sections.push({
      key: 'analysis',
      title: 'Case analysis',
      blurb: 'The assembled arguments and the exhibits they marshal.',
      meta: `${approachCount} approach${approachCount === 1 ? '' : 'es'}`,
      icon: <ScaleIcon />,
      content: <ApproachBuilder firmId={firmId} caseId={caseId} initial={approaches} />,
    });
  }
  sections.push({
    key: 'timeline',
    title: 'Timeline',
    blurb: 'The chronology of events on this matter.',
    icon: <ClockIcon />,
    href: `/counsel/cases/${caseId}/timeline`,
  });
  sections.push({
    key: 'evidence',
    title: 'Evidence files',
    blurb: 'Documents and exhibits gathered for this matter.',
    icon: <FolderIcon />,
    href: `/counsel/cases/${caseId}/evidence`,
  });
  sections.push({
    key: 'export',
    title: 'Export packet',
    blurb: 'Download the evidentiary record as a PDF.',
    icon: <DownloadIcon />,
    href: `/counsel/cases/${caseId}/export`,
  });

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
            You are co-counsel on this matter. Start with the party and the case
            facts below, then open any section to work it. Firm billing and
            internal operations are not shown.
          </T>
        </p>
      </header>

      {/* Party dossier + case facts lead the workspace — the portrait and the
          full record the reader needs before anything else. */}
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

      {/* Section tiles — open one at a time instead of one long scroll. */}
      <div className="space-y-3">
        <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-cream-100/50">
          <T>Explore this matter</T>
        </p>
        <SectionHub sections={sections} />
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

// ── Tile icons (kept simple + on-brand; gold via the tile's text color). ──
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
