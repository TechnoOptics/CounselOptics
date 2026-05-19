import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My requests · Portal' };

const STATUS_TONE: Record<string, string> = {
  in_progress:
    'bg-forest-800/50 text-cream-100/85 ring-forest-700/40',
  conflict_check_passed:
    'bg-emerald-950/30 text-emerald-200 ring-emerald-700/40',
  conflict_check_flagged:
    'bg-amber-950/30 text-amber-200 ring-amber-700/40',
  engaged:
    'bg-emerald-950/30 text-emerald-200 ring-emerald-700/40',
  rejected: 'bg-forest-800/50 text-cream-100/85 ring-forest-700/40',
};

// Employees see plain-language status, never the firm's internal
// conflict-check vocabulary.
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'Received',
  conflict_check_passed: 'In review',
  conflict_check_flagged: 'In review',
  engaged: 'Accepted',
  rejected: 'Closed',
};

export default async function PortalHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  // Strictly the employee's OWN requests in THIS firm. Service-role
  // read, but the filter is pinned to (firm_id, created_by = me) so
  // there is no way to see anyone else's - same containment pattern
  // as lib/notifications.ts.
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

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100">
          My requests
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Everything you&rsquo;ve sent to legal, and where it stands.
          Need something new? File a request or run a quick document
          review.
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
        <h2 className="font-display text-lg font-medium text-cream-100">
          Recent
        </h2>
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
              const tone =
                STATUS_TONE[r.status] ?? STATUS_TONE.in_progress;
              const label =
                STATUS_LABEL[r.status] ?? r.status.replace(/_/g, ' ');
              const ans = (r.intake_answers ?? {}) as Record<
                string,
                unknown
              >;
              const due = String(ans.due_by ?? '').trim();
              const priority = String(ans.priority ?? '').trim();
              const msgCount = Array.isArray(ans.thread)
                ? (ans.thread as unknown[]).length
                : 0;
              return (
                <li key={r.id}>
                  <Link
                    href={`/portal/${r.id}`}
                    className="block popup-panel p-4 hover:bg-cream-100/[0.03] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-cream-100 truncate">
                        {r.client_name}
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
