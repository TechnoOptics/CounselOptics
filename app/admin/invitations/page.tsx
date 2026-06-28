import { adminListGrants } from '@/lib/hq-storage';
import { FIRM_TYPE_LABEL } from '@/lib/firm-types';
import { InviteForm } from './invite-form';
import { GrantActions } from './grant-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Counsel invitations · Advottic HQ' } };

export default async function HqInvitationsPage() {
  const grants = await adminListGrants();
  const outbound = grants.filter((g) => g.kind === 'outbound');
  const application = grants.filter((g) => g.kind === 'application');

  const pendingOutbound = outbound.filter((g) => g.status === 'pending');
  const acceptedOutbound = outbound.filter((g) => g.status === 'redeemed');
  const expiredOutbound = outbound.filter((g) => g.status === 'expired');

  return (
    <div className="space-y-8 animate-fade-up">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="card p-6 space-y-3 self-start">
          <div>
            <p className="eyebrow mb-1">Send an invitation</p>
            <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
              Reserve a Counsel workspace
            </h2>
            <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
              Skip the application form. Mints a single-use setup link, emails it to the
              contact, and surfaces it below until they redeem it.
            </p>
          </div>
          <InviteForm />
        </div>

        <div className="space-y-5">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">Outbound invitations</p>
              <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
                Direct outreach to firms
              </h2>
            </div>
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 tabular-nums">
              {pendingOutbound.length} pending · {acceptedOutbound.length} redeemed
              {expiredOutbound.length > 0 && ` · ${expiredOutbound.length} expired`}
            </p>
          </header>

          {outbound.length === 0 ? (
            <div className="card p-8 text-center text-sm text-ink-500 dark:text-cream-100/55">
              No outbound invitations yet. Use the form to send the first one.
            </div>
          ) : (
            <ul className="space-y-3">
              {outbound.map((g) => (
                <GrantCard key={g.id} g={g} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {application.length > 0 && (
        <section className="space-y-3">
          <header>
            <p className="eyebrow mb-1">From access requests</p>
            <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
              Grants minted from approved applications
            </h2>
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
              These were created when an application on the request queue was approved.
            </p>
          </header>
          <ul className="space-y-3">
            {application.map((g) => (
              <GrantCard key={g.id} g={g} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GrantCard({ g }: { g: Awaited<ReturnType<typeof adminListGrants>>[number] }) {
  const expiresIn =
    g.status === 'pending'
      ? Math.max(
          0,
          Math.round((new Date(g.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;
  return (
    <li className="card p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg text-forest-900 dark:text-cream-100 truncate">
            {g.organizationName}
          </p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            {FIRM_TYPE_LABEL[g.firmType]} ·{' '}
            <a
              href={`mailto:${g.email}`}
              className="hover:underline"
            >
              {g.email}
            </a>
          </p>
        </div>
        <StatusBadge status={g.status} />
      </div>
      {g.inviteNote && (
        <p className="text-[13px] text-ink-700 dark:text-cream-100/75 leading-relaxed bg-ink-50/40 dark:bg-forest-900/40 rounded-md px-3 py-2 border border-ink-200/40 dark:border-forest-700/30 whitespace-pre-wrap">
          {g.inviteNote}
        </p>
      )}
      <p className="text-[11px] text-ink-500 dark:text-cream-100/70 font-mono tabular-nums">
        Sent {new Date(g.grantedAt).toLocaleString()}
        {g.acceptedAt
          ? ` · Redeemed ${new Date(g.acceptedAt).toLocaleString()}`
          : expiresIn !== null
            ? ` · ${expiresIn} day${expiresIn === 1 ? '' : 's'} left`
            : ` · Expired ${new Date(g.expiresAt).toLocaleDateString()}`}
      </p>
      {g.status === 'pending' && <GrantActions grantId={g.id} />}
    </li>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'redeemed' | 'expired' }) {
  const tone =
    status === 'pending'
      ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
      : status === 'redeemed'
        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
        : 'bg-ink-100 text-ink-700 dark:bg-forest-800/40 dark:text-cream-100/65';
  return (
    <span className={`badge text-[10px] tracking-wider ${tone}`}>{status.toUpperCase()}</span>
  );
}
