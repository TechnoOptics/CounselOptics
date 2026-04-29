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
} from '@/lib/firm-storage';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';

export const dynamic = 'force-dynamic';

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

  const [clients, invitations, members, documents, signing] = await Promise.all([
    listFirmClients(ctx.firm.id),
    listFirmInvitations(ctx.firm.id),
    listFirmMembers(ctx.firm.id),
    listFirmDocuments(ctx.firm.id),
    listFirmSigningRequests(ctx.firm.id),
  ]);

  const pendingSigning = signing.filter((s) => s.status === 'sent' || s.status === 'partial');

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
          headline="Open + active"
          metric="—"
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
          body="In-app e-sign. Signers click a link that stays inside Advottic. Documents never leave."
          accent={ctx.firm.accentColor}
          warning="Outputs are stamped DRAFT - not legally binding in v1."
        />
        <Tile
          href="/counsel/chat"
          eyebrow="Team chat"
          headline="Channels + DMs"
          metric="Polled refresh"
          body="Talk to your team in channels and direct messages. Realtime upgrade coming."
          accent={ctx.firm.accentColor}
        />
        <Tile
          href="/counsel/meetings"
          eyebrow="Meetings"
          headline="Calendar"
          metric="MS 365 + Zoom"
          body="Schedule and capture meetings. OAuth integrations are coming - manual capture works today."
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

      <section className="card p-5 sm:p-6 ring-1 ring-amber-300/40 dark:ring-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20">
        <p className="eyebrow mb-2">Heads up</p>
        <h2 className="font-display text-lg sm:text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          What ships in v1, what&rsquo;s coming
        </h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 text-ink-700 dark:text-cream-100/80 leading-relaxed">
          <li>
            <strong>E-signature</strong> ships in <em>preview mode</em>. Output PDFs are
            watermarked &ldquo;DRAFT - NOT LEGALLY BINDING&rdquo; until the full UETA-compliant
            audit trail lands.
          </li>
          <li>
            <strong>Team chat</strong> uses polled refresh in v1. Real-time WebSockets are a
            planned follow-on.
          </li>
          <li>
            <strong>MS 365 + Zoom</strong> integration buttons are stubbed. Manual meeting
            capture works today; OAuth lands when the developer-portal apps are registered.
          </li>
          <li>
            <strong>Bella</strong> in firm mode receives jurisdiction + practice-area context
            for issue-spotting. No paid case-law APIs yet.
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
