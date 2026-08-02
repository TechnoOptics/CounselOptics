import Link from 'next/link';
import type { GuestCaseSummary } from '@/lib/counsel-guest';
import { T } from '@/components/i18n/LocaleProvider';
import { PageHeader } from '@/components/counsel/ui';

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
 * The matter overview a case-scoped Counsel GUEST (co-counsel) sees. It is the
 * firm-framed Counsel view - NOT the consumer app - but strictly limited to
 * what an outside collaborator should see: the matter's particulars plus links
 * into the timeline, evidence, and export. It deliberately renders NONE of the
 * firm-internal operations (time, billing, trust, invoices, deadlines, team,
 * chat) that the full firm case page shows.
 */
export function GuestCaseView({ kase }: { kase: GuestCaseSummary }) {
  const place = [kase.jurisdictionCity, kase.jurisdictionState, kase.jurisdictionCountry]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrowVariant="plain"
        eyebrow={<T>Guest access</T>}
        title={<span data-no-translate>{kase.title}</span>}
        subtitleClassName="mt-2"
        subtitle={
          <T>
            You have been added to this matter as co-counsel. You can review the
            timeline and evidence, and export the evidentiary record.
          </T>
        }
      />

      <section className="card p-5 grid gap-4 sm:grid-cols-2">
        {kase.subjectName && (
          <Field label="Subject" value={kase.subjectName} />
        )}
        {kase.caseType && <Field label="Matter type" value={kase.caseType} />}
        {kase.status && (
          <Field
            label="Status"
            value={STATUS_LABEL[kase.status] ?? kase.status}
          />
        )}
        {place && <Field label="Jurisdiction" value={place} />}
        {kase.hearingAt && (
          <Field
            label="Hearing"
            value={
              new Date(kase.hearingAt).toLocaleString() +
              (kase.hearingLocation ? ` · ${kase.hearingLocation}` : '')
            }
          />
        )}
      </section>

      {kase.description && (
        <section className="card p-5">
          <h2 className="text-[11px] uppercase tracking-[0.12em] font-semibold text-cream-100/55 mb-2">
            <T>Summary</T>
          </h2>
          <p
            className="text-sm text-cream-100/80 whitespace-pre-wrap leading-relaxed"
            data-no-translate
          >
            {kase.description}
          </p>
        </section>
      )}

      <nav className="grid gap-3 sm:grid-cols-3">
        <GuestLink
          href={`/counsel/cases/${kase.id}/timeline`}
          title="Timeline"
          blurb="The chronology of events on this matter."
        />
        <GuestLink
          href={`/counsel/cases/${kase.id}/evidence`}
          title="Evidence"
          blurb="Documents and exhibits gathered for this matter."
        />
        <GuestLink
          href={`/counsel/cases/${kase.id}/export`}
          title="Export"
          blurb="Download the evidentiary timeline as a PDF."
        />
      </nav>
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

function GuestLink({
  href,
  title,
  blurb,
}: {
  href: string;
  title: string;
  blurb: string;
}) {
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
