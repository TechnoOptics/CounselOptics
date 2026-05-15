import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmClients,
  listFirmInvitations,
  listFirmMembers,
  listFirmDocuments,
  listFirmSigningRequests,
  listMyFirms,
  listFirmCases,
} from '@/lib/firm-storage';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';

export const dynamic = 'force-dynamic';

// Audit V5 CR-51: the counsel root used to inherit the consumer
// title template ("Advottic - Build your case") because no per-page
// metadata existed and Next.js falls back to the root layout. Firms
// landing on the dashboard saw a consumer marketing tagline in the
// browser tab, which read as a broken brand on the firm side. The
// absolute title shipped here also bypasses the root template
// suffix so the tab reads cleanly on the firm portal.
export const metadata: Metadata = {
  title: { absolute: 'Dashboard · Advottic Counsel' },
  description:
    'Your firm cockpit: matters, clients, signing, billing, trust ledger.',
};

/**
 * /counsel - firm-side dashboard. Shows the membership at a glance
 * (role, joined-at), counts for the major sections, and a row of
 * "what to do next" prompts.
 *
 * If the signed-in user has no firms yet, redirect to the onboarding
 * wizard. The layout already handles the not-signed-in case.
 */
export default async function CounselDashboard() {
  const myFirms = await listMyFirms();
  if (myFirms.length === 0) redirect('/counsel/onboarding');
  const ctx = (await getActiveFirmContext()) ?? myFirms[0];
  if (!ctx) redirect('/counsel/onboarding');

  const [clients, invitations, members, documents, signing, cases] = await Promise.all([
    listFirmClients(ctx.firm.id),
    listFirmInvitations(ctx.firm.id),
    listFirmMembers(ctx.firm.id),
    listFirmDocuments(ctx.firm.id),
    listFirmSigningRequests(ctx.firm.id),
    listFirmCases(ctx.firm.id),
  ]);

  const pendingSigning = signing.filter((s) => s.status === 'sent' || s.status === 'partial');
  // Audit W20 V3 CR-29: the Cases tile used to render a hardcoded
  // em-dash placeholder ('—', which the audit's text scrape read as
  // an underscore) because listFirmCases wasn't being fetched here.
  // The Cases route itself was already loading the real data, so the
  // tile was the only spot reporting "no data" for an end-user who
  // actually had four open matters. Now we count statuses that map
  // to "currently in flight" - draft is excluded, archived/closed
  // are excluded, the rest count as open + active.
  const openCaseStatuses = new Set([
    'open',
    'under_review',
    'needs_evidence',
    'export_ready',
  ]);
  const openActiveCases = cases.filter((c) => openCaseStatuses.has(c.status));
  const totalCases = cases.length;

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-2">Counsel</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Welcome to {ctx.firm.name}.
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-2xl leading-relaxed">
          You&rsquo;re signed in as {ctx.membership.displayName ?? ctx.membership.email ?? 'a team member'}{' '}
          ({FIRM_ROLE_LABEL[ctx.membership.role].toLowerCase()}). Pick a section below or use the sidebar.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          href="/counsel/cases"
          eyebrow="Cases"
          headline={`${openActiveCases.length} open + active`}
          metric={
            totalCases === 0
              ? 'No matters yet'
              : `${totalCases} total · ${totalCases - openActiveCases.length} closed / archived`
          }
          body="Cases shared with the firm appear here. Use the personal view to start a new case, then attach the firm to it."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/clients"
          eyebrow="Clients"
          headline={String(clients.length)}
          metric={`${clients.filter((c) => c.status === 'active').length} active`}
          body="Invite a client by email. They get an Advottic account and stay linked to your firm."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/team"
          eyebrow="Team"
          headline={`${members.length} member${members.length === 1 ? '' : 's'}`}
          metric={
            invitations.length > 0
              ? `${invitations.length} pending invite${invitations.length === 1 ? '' : 's'}`
              : 'No pending invites'
          }
          body="Add admins, attorneys, paralegals, and staff. Roles control what each person can do."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/documents"
          eyebrow="Documents"
          headline={String(documents.length)}
          metric="Versioned"
          body="Upload contracts, motions, evidence packets. Tag and link to a case or client."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/signing"
          eyebrow="Signing"
          headline={String(pendingSigning.length)}
          metric="awaiting signature"
          body="UETA-aligned: 2-step intent capture, tamper-evident audit chain, SHA-256 document hash. Jurisdictional document-class fit stays with counsel."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/chat"
          eyebrow="Team chat"
          headline="Channels + DMs"
          metric="Realtime"
          body="Real-time via Supabase WebSockets. Messages, edits and deletes propagate in ~100ms; a 60-second heartbeat refetch covers any dropped event."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/meetings"
          eyebrow="Meetings"
          headline="Calendar"
          metric="MS 365 + Zoom"
          body="Connect Microsoft 365 calendar or Zoom from /counsel/meetings. Tokens encrypted at rest; scheduling-from-case ships next."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/settings"
          eyebrow="Firm settings"
          headline="Brand + scope"
          metric="Owner / admin"
          body="Update logo, accent color, jurisdictions, practice areas, and the firm name."
          accent={ctx.firm.accentColor}
        />
      </section>

      {/*
        Audit W20 V3 CR-18 + CR-36: this panel used to surface
        engineering-release-note language ("UETA-aligned 2-step intent
        capture", "tamper-evident SHA-256 audit chain", "real-time via
        Supabase WebSockets", "AES-256-GCM encrypted"). That copy was
        right for HQ staff reading the Operator memo on /admin, but
        wrong for a firm Owner who logged into Counsel expecting
        "what changed for my firm this week." Now: each bullet is
        firm-facing ("your team", "your matters") and the
        implementation-detail prose moved to a staff-only changelog
        surface. The dashboard reads as a feature recap, not a
        runbook excerpt.
      */}
      <section className="card p-5 sm:p-6 ring-1 ring-emerald-300/30 dark:ring-emerald-500/25 bg-emerald-50/30 dark:bg-emerald-950/15">
        <p className="eyebrow mb-2">Your firm on Advottic</p>
        <h2 className="font-display text-lg sm:text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          What your team can do today
        </h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 text-ink-700 dark:text-cream-100/80 leading-relaxed">
          <li>
            <strong>Sign documents inside the vault</strong>. Engagement
            letters, retainers, releases - every signature is captured
            with a verifiable audit trail you can hand to opposing counsel
            without flinching.
          </li>
          <li>
            <strong>Talk to your team in real time</strong>. Channels for
            firm-wide topics, group DMs for the team on a specific
            matter, and 1:1 conversations with role-scoped access.
          </li>
          <li>
            <strong>Schedule with Microsoft 365 + Zoom</strong>. Connect
            once from <Link href="/counsel/meetings" className="underline">Meetings</Link>;
            calendars and meeting links flow into every matter room.
          </li>
          <li>
            <strong>Ask Bella for a citation</strong>. Bella pulls real
            federal + state opinions from CourtListener so your team can
            verify, not just trust.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Tile({
  href,
  eyebrow,
  headline,
  metric,
  body,
  accent,
  warning,
}: {
  href: string;
  eyebrow: string;
  headline: string;
  metric: string;
  body: string;
  accent: string;
  warning?: string;
}) {
  return (
    <Link
      href={href}
      className="card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all group block"
    >
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: accent }}>
        {eyebrow}
      </p>
      <p className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
        {headline}
      </p>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono uppercase tracking-wider">
        {metric}
      </p>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2.5 leading-relaxed">
        {body}
      </p>
      {warning && (
        <p className="text-[11px] text-amber-800 dark:text-amber-200 mt-2.5 leading-relaxed">
          {warning}
        </p>
      )}
    </Link>
  );
}
