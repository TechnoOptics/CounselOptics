'use client';

import { useState } from 'react';

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
    <section id="sectors" className="space-y-8">
      <header className="max-w-2xl">
        <p className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gold-300 mb-3">
          What kind of team are you?
        </p>
        <h2 className="font-display text-3xl sm:text-[40px] font-medium tracking-[-0.02em] leading-[1.05] text-cream-100">
          The capabilities that matter, sized to your work.
        </h2>
        <p className="mt-3 text-[15px] sm:text-[16px] leading-relaxed text-cream-100/75 max-w-xl">
          Pick the sector that fits and the feature list re-orders. The kernel is the same for
          everyone; the call-outs change based on who&apos;s buying.
        </p>
      </header>

      {/* Sector tabs */}
      <div role="tablist" aria-label="Choose your sector" className="flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={sector === s.key}
            type="button"
            onClick={() => setSector(s.key)}
            className={`group inline-flex items-baseline gap-2 rounded-full border px-4 py-2 text-sm font-medium tracking-tight transition-all ${
              sector === s.key
                ? 'border-gold-400 bg-gold-metal text-forest-950 shadow-gold-glow'
                : 'border-cream-100/20 bg-cream-100/5 text-cream-100 hover:border-gold-400/40 hover:bg-cream-100/10'
            }`}
          >
            <span>{s.label}</span>
            {/* The selected tab paints `bg-gold-metal`, and forest-950
                at 65% on that gold measured 3.50:1 for a 10px tagline.
                The alpha was doing nothing the gold ground did not
                already do - it is the quiet half of the pair either way
                - so it goes, taking the tagline to 5.7:1. */}
            <span
              className={`text-[10px] tracking-wide ${
                sector === s.key ? 'text-forest-950' : 'text-cream-100/60 group-hover:text-cream-100/65'
              }`}
            >
              {s.tagline}
            </span>
          </button>
        ))}
      </div>

      {/* Feature grid for the selected sector */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <article
            key={f.title}
            className={`relative rounded-2xl border p-6 backdrop-blur transition-colors ${
              f.primary
                ? 'border-gold-400/30 bg-gradient-to-br from-cream-100/8 via-cream-100/4 to-transparent ring-1 ring-gold-400/15'
                : 'border-cream-100/15 bg-cream-100/5'
            }`}
          >
            {f.primary && (
              <span className="absolute top-4 right-4 text-[9px] tracking-[0.18em] uppercase font-semibold text-gold-300 bg-gold-400/10 border border-gold-400/30 rounded-full px-2 py-0.5">
                Top fit
              </span>
            )}
            <h3 className="text-[15px] font-semibold tracking-tight text-cream-100 mb-2 pr-16">
              {f.title}
            </h3>
            <p className="text-sm text-cream-100/75 leading-relaxed">{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
