import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { portalStatusLabel, portalStatusTone } from '@/lib/portal-status';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My requests · Hub' };

// Status label + tone are shared with the request page - see
// lib/portal-status.ts.

export default async function PortalRequestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/requests');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // External parties don't file internal requests; this section isn't theirs.
  if (persona.external === true || !persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const admin = createAdminSupabase();
  let requests: Array<{
    id: string;
    client_name: string;
    matter_type: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  }> = [];
  if (admin) {
    const { data } = await admin
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at, intake_answers')
      .eq('firm_id', persona.firm.id)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    requests = (data ?? []) as typeof requests;
  }

  // Reply counts come from firm_intake_messages, not the legacy
  // intake_answers.thread jsonb - that array stopped being written when the
  // conversation moved to its own table, so newer requests silently showed
  // no messages at all. Only 'shared' counts: counting internal notes would
  // leak both their existence and how many there are.
  const replyCounts = new Map<string, number>();
  if (admin && requests.length > 0) {
    const { data: msgRows } = await admin
      .from('firm_intake_messages')
      .select('intake_id')
      .in('intake_id', requests.map((r) => r.id))
      .eq('visibility', 'shared')
      .is('deleted_at', null);
    for (const m of (msgRows ?? []) as { intake_id: string }[]) {
      replyCounts.set(m.intake_id, (replyCounts.get(m.intake_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-7 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100">
          My requests
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Everything you&rsquo;ve sent to legal and where it stands.
        </p>
      </header>

      {(persona.entitlements.includes('requests.create') ||
        persona.entitlements.includes('review')) && (
        <div className="flex flex-wrap gap-3">
          {persona.entitlements.includes('requests.create') && (
            <Link
              href="/portal/new"
              className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold"
            >
              New request
            </Link>
          )}
          {persona.entitlements.includes('review') && (
            <Link
              href="/review-my-document"
              className="btn ring-1 ring-forest-700/40 text-cream-100/85 hover:text-cream-100 hover:bg-cream-100/5"
            >
              Advottic Review
            </Link>
          )}
        </div>
      )}

      <section className="space-y-3">
        {requests.length === 0 ? (
          <div className="popup-panel p-6 text-center space-y-2">
            <p className="text-sm text-cream-100/70">
              {persona.entitlements.includes('requests.create')
                ? 'You haven’t filed anything yet.'
                : 'Nothing here yet.'}
            </p>
            {persona.entitlements.includes('requests.create') && (
              <Link
                href="/portal/new"
                className="inline-block text-[13px] underline text-gold-300 hover:text-gold-200"
              >
                File your first request
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => {
              // Never fall back to the raw status: that printed the firm's
              // internal vocabulary ("converted") straight at the employee.
              const label = portalStatusLabel(r.status);
              const tone = portalStatusTone(label);
              const ans = (r.intake_answers ?? {}) as Record<string, unknown>;
              const due = String(ans.due_by ?? '').trim();
              const priority = String(ans.priority ?? '').trim();
              const msgCount = replyCounts.get(r.id) ?? 0;
              // Lead with what you asked for. This showed client_name, which
              // for an in-house requester is their own name - so every row on
              // the employee's own list read identically.
              const title =
                String(ans.subject ?? '').trim() ||
                (r.matter_type ?? '').trim() ||
                r.client_name;
              return (
                <li key={r.id}>
                  <Link
                    href={`/portal/${r.id}`}
                    className="block popup-panel p-4 hover:bg-cream-100/[0.03] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-cream-100 truncate">
                        {title}
                      </p>
                      <span
                        className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                      >
                        {label}
                      </span>
                    </div>
                    <p className="text-[12px] text-cream-100/60 mt-1">
                      {r.matter_type ?? 'Request'}
                      {priority && ` · ${priority} priority`}
                      {due && ` · due ${due}`}
                      {' · '}
                      {new Date(r.created_at).toLocaleDateString()}
                      {msgCount > 0 &&
                        ` · ${msgCount} message${msgCount === 1 ? '' : 's'}`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
