'use client';

import { useState } from 'react';
import { Definitions, FOCUS, H2, BODY, LABEL } from '@/components/marketing/file';

/**
 * Sector picker for the enterprise landing. The user picks who they
 * are - private firm, in-house corporate counsel, in-house non-corp,
 * legal aid / non-profit, government - and the capability list
 * re-renders to show what actually matters to that sector.
 *
 * Solves the "what we have now does not apply to in-house corporate
 * counsel" problem. The shared kernel (matter rooms, encryption,
 * audit) shows up under every sector; sector-specific call-outs
 * (intake forms for firms, contract review for in-house, eligibility
 * intake for legal aid, FOIA workflows for government) get top
 * billing for the sector that asked.
 */

type SectorKey = 'firm' | 'inhouse-corp' | 'inhouse-other' | 'legal-aid' | 'government';

const SECTORS: Array<{ key: SectorKey; label: string; tagline: string }> = [
  { key: 'firm', label: 'Private firm', tagline: 'Solo, boutique, mid-size, big-law' },
  { key: 'inhouse-corp', label: 'In-house corporate counsel', tagline: 'GC office of a company' },
  { key: 'inhouse-other', label: 'In-house, non-corporate', tagline: 'Hospital, school, agency' },
  { key: 'legal-aid', label: 'Legal aid / non-profit', tagline: 'Pro bono + service organizations' },
  { key: 'government', label: 'Government', tagline: 'Prosecutor, public defender, agency counsel' },
];

const FEATURES: Record<SectorKey, Array<{ title: string; body: string; primary?: boolean }>> = {
  firm: [
    {
      title: 'Branded client intake',
      body: "Your firm name, your colors, your domain. The client never sees Advottic until they're already deep in their file. Replaces Typeform / Tally / a fillable PDF.",
      primary: true,
    },
    {
      title: 'Per-matter rooms with role scoping',
      body: 'Counsel, paralegal, client, co-counsel - each role sees what their permissions grant. No more "wrong client folder" mistakes.',
    },
    {
      title: 'Invite collaborators',
      body: 'Pull in signing partners, opposing counsel for limited review, the client. Time-limited, audited, revocable in one click.',
    },
    {
      title: 'In-portal document signing',
      body: 'Engagement letters, retainers, releases - signed inside the encrypted vault. Documents never leave the portal, never sit in a third-party signing tool.',
      primary: true,
    },
    {
      title: 'Advottic Review for case triage',
      body: 'Read a freshly-intaked matter in 30 seconds. Surfaces the issues, calls out evidentiary gaps, drafts the question list for your client call.',
    },
    {
      title: 'Custom pricing, written agreement',
      body: 'Per-seat or per-matter, scoped to your firm size and practice area. Once we agree, billing runs on auto-cadence (monthly, quarterly, annual).',
      primary: true,
    },
  ],
  'inhouse-corp': [
    {
      title: 'Matter rooms for the GC office',
      body: "Litigation hold, contract dispute, regulatory inquiry, employment matter - each gets a private room with the team you scope.",
      primary: true,
    },
    {
      title: 'Outside counsel collaboration',
      body: 'Invite your outside firm into a single matter without giving them access to anything else. Time-limited, audit-logged, billed by them through their own Advottic seat.',
      primary: true,
    },
    {
      title: 'Contract repository + signing',
      body: 'Upload the executed contract, capture key dates and obligations, sign amendments inside the vault. Works alongside your DMS - we are not replacing it.',
      primary: true,
    },
    {
      title: 'Privilege-tight audit log',
      body: 'Every access logged with the actor. When opposing counsel issues a subpoena, you have the receipts. When auditors ask about access, you have the report.',
    },
    {
      title: 'Microsoft Entra / Okta SSO',
      body: 'No new password to manage. Roles map to AD groups, so onboarding new in-house counsel is one click in your IdP.',
    },
    {
      title: 'Custom pricing, enterprise contract',
      body: 'Per-user pricing tied to your headcount. Billed annually with a written agreement. NDA + DPA + BAA available on request.',
      primary: true,
    },
  ],
  'inhouse-other': [
    {
      title: 'Department case rooms',
      body: 'Hospital risk-management matters, school district disputes, agency complaints - each in its own scoped room.',
      primary: true,
    },
    {
      title: 'Compliance-first workflow',
      body: 'Audit log, retention rules tied to your record-keeping policy, deletion windows. Designed for organizations whose evidence is itself regulated.',
      primary: true,
    },
    {
      title: 'In-portal document signing',
      body: 'Sign incident reports, releases, settlement agreements inside the encrypted vault.',
    },
    {
      title: 'External counsel collaboration',
      body: 'Bring outside counsel into a specific matter without exposing the rest of the case docket.',
    },
    {
      title: 'HIPAA / FERPA-aware controls',
      body: 'Healthcare matters get encrypted-PHI handling. Education matters get FERPA-aware sharing controls. Settings are per-matter, not global.',
      primary: true,
    },
    {
      title: 'Custom pricing',
      body: "Sized to your organization. Often a flat per-attorney fee plus per-matter overage if you're high-volume.",
    },
  ],
  'legal-aid': [
    {
      title: 'High-volume client intake',
      body: 'Branded intake link your clients can fill on their phone. Income screening, eligibility, conflict check - all baked in.',
      primary: true,
    },
    {
      title: 'Volunteer attorney scoping',
      body: 'Add a volunteer to one specific matter, time-limited. They see only what they need. Track hours automatically for your annual reports.',
      primary: true,
    },
    {
      title: 'Document signing - no fees per envelope',
      body: 'Built-in. Signing is included in the seat price, not metered. Critical for non-profits whose budgets cannot scale with case volume.',
      primary: true,
    },
    {
      title: 'Bella for client triage',
      body: 'Plain-language legal info on demand for clients who need a basic answer fast. Frees your staff for matters that need real human judgement.',
    },
    {
      title: 'Bulk export for grant reporting',
      body: 'Pull aggregated outcomes data (no PII) for grant applications and impact reports. JSON or PDF.',
    },
    {
      title: 'Non-profit pricing',
      body: 'Steeply discounted per-seat rate. We work with the largest legal aid orgs in the US; ask for the non-profit price card.',
      primary: true,
    },
  ],
  government: [
    {
      title: 'Per-case rooms with chain-of-custody',
      body: "Each docket gets a scoped room. Every exhibit's read/write history is logged for chain-of-custody validation.",
      primary: true,
    },
    {
      title: 'Public defender intake at scale',
      body: 'Magistrate court intake, custody intake, indigency screening - branded forms your office controls.',
      primary: true,
    },
    {
      title: 'FOIA / public-records workflow',
      body: 'Build a record set, redact privileged content inside the vault, export the public version. Audit of every redaction.',
      primary: true,
    },
    {
      title: 'Inter-agency collaboration',
      body: 'Share a specific matter with another agency (DA, AG, county counsel) via time-limited audited link. Never share the whole docket.',
    },
    {
      title: 'CJIS-aware controls',
      body: 'For agencies with CJIS obligations, we can constrain hosting + access controls per the policy. Talk to us about your specific posture.',
    },
    {
      title: 'Government contracting',
      body: 'GSA-style pricing for federal agencies, state contract pricing where available. Annual purchase order, written agreement.',
      primary: true,
    },
  ],
};

export function EnterpriseSectorTabs() {
  const [sector, setSector] = useState<SectorKey>('firm');
  const features = FEATURES[sector];

  return (
    <section id="sectors">
      <p className={LABEL}>What kind of team are you?</p>
      <h2 className={`${H2} mt-2`}>The capabilities that matter, sized to your work.</h2>
      <p className={`${BODY} mt-4`}>
        Pick the sector that fits and the list re-orders. The kernel is the same for everyone; the
        call-outs change based on who is buying.
      </p>
      <div role="tablist" aria-label="Choose your sector" className="mt-6 flex flex-wrap border border-forest-900 dark:border-cream-100/70">
        {SECTORS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={sector === s.key}
            type="button"
            onClick={() => setSector(s.key)}
            className={`min-h-[44px] px-4 text-left font-courier text-[12.5px] uppercase tracking-[0.08em] ${FOCUS} ${
              sector === s.key
                ? 'bg-forest-900 text-cream-50 dark:bg-cream-100 dark:text-forest-950'
                : 'text-forest-900 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10'
            }`}
          >
            {s.label}
            <span className={`ml-2 normal-case tracking-normal ${sector === s.key ? '' : 'opacity-70'}`}>{s.tagline}</span>
          </button>
        ))}
      </div>
      <Definitions
        columns={3}
        items={features.map((f) => ({
          term: f.primary ? `${f.title}. Top fit` : f.title,
          def: f.body,
        }))}
      />
    </section>
  );
}
