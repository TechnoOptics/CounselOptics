import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { portalStatusLabel, portalStatusColor } from '@/lib/portal-status';
import {
  loadPortalOpenRequests,
  isOpenStatus,
  type PortalRequestRow,
} from '@/lib/portal-open-requests';
import {
  PORTAL_REQUEST_FAMILIES,
  familyByKey,
  familyOfType,
} from '@/lib/portal-request-families';
import { StatusPill } from '@/components/counsel/StatusPill';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { ViewStrip, Toolbar, MonoRef } from '@/components/counsel/patterns';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My requests · Hub' };

// Status label + colour are shared with the request page - see
// lib/portal-status.ts.

/** What the row is called: what you asked for, not your own name. */
function rowTitle(r: PortalRequestRow): string {
  const ans = (r.intake_answers ?? {}) as Record<string, unknown>;
  return (
    String(ans.subject ?? '').trim() ||
    (r.matter_type ?? '').trim() ||
    r.client_name
  );
}

/**
 * Free-text search over what an employee can actually see of their own
 * request: its title, its type, and the summary they wrote. Done in
 * memory over the hundred rows already loaded rather than as a second
 * query, because the scope is already resolved and a `ilike` would have
 * to re-derive it.
 */
function matchesQuery(r: PortalRequestRow, q: string): boolean {
  if (!q) return true;
  const ans = (r.intake_answers ?? {}) as Record<string, unknown>;
  const hay = [
    rowTitle(r),
    r.matter_type ?? '',
    r.client_name,
    String(ans.priority ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export default async function PortalRequestsPage({
  searchParams,
}: {
  searchParams?: { family?: string; q?: string; view?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/requests');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // External parties don't file internal requests; this section isn't theirs.
  if (persona.external === true || !persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const { rows } = await loadPortalOpenRequests(user.id, persona.firm.id);

  // Both filters come off the query string and neither is trusted. An
  // unknown family is no family, which shows everything, and that is
  // also what the "Everything" view is.
  const family = familyByKey(searchParams?.family);
  const q = (searchParams?.q ?? '').trim().slice(0, 120);
  const searched = rows.filter((r) => matchesQuery(r, q));
  const shown = family
    ? searched.filter((r) => familyOfType(r.matter_type)?.key === family.key)
    : searched;

  // Every view's count is the number of rows that view would show,
  // computed by the same predicate that filters them. A count that came
  // from anywhere else is the defect this strip exists to avoid.
  const views = [
    { key: 'all', label: 'Everything', count: searched.length },
    ...PORTAL_REQUEST_FAMILIES.map((f) => ({
      key: f.key,
      label: f.title,
      count: searched.filter((r) => familyOfType(r.matter_type)?.key === f.key)
        .length,
    })),
  ];
  const viewHref = (key: string) => {
    const params = new URLSearchParams();
    if (key !== 'all') params.set('family', key);
    if (q) params.set('q', q);
    const qs = params.toString();
    return qs ? `/portal/requests?${qs}` : '/portal/requests';
  };

  const openCount = shown.filter((r) => isOpenStatus(r.status)).length;
  const replyCounts = new Map<string, number>();
  const admin = createAdminSupabase();
  if (admin && shown.length > 0) {
    // Reply counts come from firm_intake_messages, not the legacy
    // intake_answers.thread jsonb - that array stopped being written when
    // the conversation moved to its own table, so newer requests silently
    // showed no messages at all. Only 'shared' counts: counting internal
    // notes would leak both their existence and how many there are.
    const { data: msgRows } = await admin
      .from('firm_intake_messages')
      .select('intake_id')
      .in('intake_id', shown.map((r) => r.id))
      .eq('visibility', 'shared')
      .is('deleted_at', null);
    for (const m of (msgRows ?? []) as { intake_id: string }[]) {
      replyCounts.set(m.intake_id, (replyCounts.get(m.intake_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={persona.firm.name}
        title={family ? family.title : 'My requests'}
        subtitle={
          family
            ? `${family.blurb} ${shown.length} filed, ${openCount} still open.`
            : `Everything you have sent to legal and where it stands. ${rows.length} filed, ${openCount} still open.`
        }
        action={
          <Link
            href={family ? `/portal/new?family=${family.key}` : '/portal/new'}
            className="btn font-semibold"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-on)',
            }}
          >
            New request
          </Link>
        }
      />

      <ViewStrip
        label="Filter requests by type"
        options={views}
        active={family?.key ?? 'all'}
        href={viewHref}
      />

      <Toolbar
        note={`${shown.length} ${shown.length === 1 ? 'request' : 'requests'}`}
      >
        <form action="/portal/requests" method="GET" className="flex gap-2">
          {family && (
            <input type="hidden" name="family" value={family.key} />
          )}
          <input
            name="q"
            type="search"
            defaultValue={q}
            autoComplete="off"
            aria-label="Search your requests"
            className="input h-8 w-56 max-w-full py-1 text-[13px]"
            placeholder="Search your requests"
          />
          <button
            type="submit"
            className="rounded-lg border border-edge px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:text-foreground"
          >
            Search
          </button>
          {q && (
            <Link
              href={
                family
                  ? `/portal/requests?family=${family.key}`
                  : '/portal/requests'
              }
              className="self-center text-[12.5px] text-muted underline hover:text-foreground"
            >
              Clear
            </Link>
          )}
        </form>
      </Toolbar>

      <section className="space-y-3">
        {shown.length === 0 ? (
          <EmptyState
            title={
              q
                ? `Nothing matches "${q}".`
                : family
                  ? `You have not filed a ${family.title.toLowerCase()} yet.`
                  : 'You have not filed anything yet.'
            }
            sub={
              q
                ? 'Try fewer words, or clear the search to see everything.'
                : undefined
            }
            action={
              <Link
                href={
                  family ? `/portal/new?family=${family.key}` : '/portal/new'
                }
                className="inline-block text-[13px] text-accent-text underline"
              >
                {family ? family.startLabel : 'File your first request'}
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2">
            {shown.map((r) => {
              // Never fall back to the raw status: that printed the firm's
              // internal vocabulary ("converted") straight at the employee.
              const label = portalStatusLabel(r.status);
              const color = portalStatusColor(label);
              const ans = (r.intake_answers ?? {}) as Record<string, unknown>;
              const due = String(ans.due_by ?? '').trim();
              const priority = String(ans.priority ?? '').trim();
              const msgCount = replyCounts.get(r.id) ?? 0;
              const rowFamily = familyOfType(r.matter_type);
              return (
                <li key={r.id}>
                  <Link
                    href={`/portal/${r.id}`}
                    className="block rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-edge-bright"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="truncate font-semibold text-foreground"
                        data-no-translate
                      >
                        {rowTitle(r)}
                      </p>
                      <StatusPill color={color} size="sm">
                        {label}
                      </StatusPill>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                      {rowFamily && (
                        <MonoRef className="uppercase">
                          {rowFamily.code}
                        </MonoRef>
                      )}
                      <span data-no-translate>
                        {r.matter_type ?? 'Request'}
                      </span>
                      {priority && <span>· {priority} priority</span>}
                      {due && <span>· due {due}</span>}
                      <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                      {msgCount > 0 && (
                        <span>
                          · {msgCount} message{msgCount === 1 ? '' : 's'}
                        </span>
                      )}
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
