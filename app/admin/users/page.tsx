import { adminListUsers } from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { TIER_LABEL, REPRESENTATION_LABEL } from '@/lib/types';
import { freeTrialWindowEnds, listTrialUsers } from '@/lib/user-trials';
import { ENTITLEMENT_TIER_SLUGS, isEntitlementTierSlug } from '@/lib/entitlements';
import { levelAppliesFrom, tierSlugLabel } from '@/lib/trial-entitlement';
import { UserToggles } from './user-toggles';
import {
  UserTrialConsole,
  type StartableUser,
  type UserTrialView,
} from './trial-controls';
import { LocaleTime } from '@/components/LocaleTime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminUsersPage() {
  const [users, me, trialList] = await Promise.all([
    adminListUsers(),
    getCurrentUser(),
    listTrialUsers(),
  ]);
  const adminCount = users.filter((u) => u.isAdmin).length;

  // An unreadable list is NOT an empty one, and the difference matters here:
  // "nobody is on a clock" plus a Start a trial control offering everybody is
  // how somebody already on a trial gets given a second one.
  const trialsUnavailable = !trialList.ok;
  const trialUsers = trialList.ok ? trialList.rows : [];

  // The email lives on auth.users rather than on profiles, so lib/user-trials
  // does not carry it and the join happens here, against the list this page
  // already holds.
  const byId = new Map(users.map((u) => [u.id, u]));

  // When each of these people's AUTOMATIC signup trial ends. While that window
  // is open, isFullAccessTrial unlocks every feature regardless of the plan
  // level set here, so a row that showed the level without saying so would be
  // asserting a restriction the product does not apply. There are two trials
  // in this product and only one of them is granted by an operator.
  const freeWindows = await freeTrialWindowEnds(
    trialUsers.map((t) => {
      const u = byId.get(t.id) ?? null;
      return {
        userId: t.id,
        email: u?.email ?? null,
        createdAt: u?.createdAt ?? null,
      };
    }),
  );
  // One clock for one render of one list.
  const now = new Date();

  const trialRows: UserTrialView[] = trialUsers.map((t) => {
    const u = byId.get(t.id) ?? null;
    return {
      id: t.id,
      email: u?.email ?? null,
      displayName: t.displayName ?? u?.displayName ?? null,
      trialEndsAt: t.trialEndsAt,
      daysRemaining: t.daysRemaining,
      trialTier: t.trialTier,
      // Resolved on the server because the vocabulary is derived from the
      // price table, which is a server module. A level the table no longer
      // defines has to be shown AS one rather than quietly labelled.
      trialTierKnown: isEntitlementTierSlug(t.trialTier),
      resolvedSource: t.resolved.source,
      resolvedTier: t.resolved.tierSlug,
      // Null unless the level is genuinely not applying yet. The rule lives
      // in lib/trial-entitlement.ts so a test can reach it: vitest runs under
      // node with no jsdom, and a decision left in this file is a decision
      // nothing can exercise.
      freeTrialEndsAt: levelAppliesFrom(
        {
          source: t.resolved.source,
          freeTrialEndsAt: freeWindows.get(t.id) ?? null,
        },
        now,
      ),
      lastActorEmail: t.lastActorEmail,
      lastActionAt: t.lastActionAt,
    };
  });

  // Everybody the trials list does not already hold. The billing flag rides
  // along rather than filtering the list: a trial on a paying account is inert
  // rather than forbidden, so the control says which ones those are instead of
  // quietly hiding them.
  const onTheClock = new Set(trialRows.map((r) => r.id));
  const startableUsers: StartableUser[] = users
    .filter((u) => !onTheClock.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email || null,
      displayName: u.displayName,
      billingActive:
        u.subscriptionStatus === 'active' || u.subscriptionStatus === 'trialing',
    }));

  const tierOptions = ENTITLEMENT_TIER_SLUGS.map((slug) => ({
    slug,
    label: tierSlugLabel(slug),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          {users.length} user{users.length === 1 ? '' : 's'} · {adminCount} admin
          {adminCount === 1 ? '' : 's'}
        </p>
        {adminCount < 2 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-700/40 rounded-md px-3 py-1.5">
            At least 2 admins are required. Promote another user before
            demoting yourself.
          </p>
        )}
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-600 dark:text-cream-100/70">
            Trials and plan levels
          </h2>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
            {trialsUnavailable ? 'Not loaded' : `${trialRows.length} on a clock`}
          </p>
        </div>
        <UserTrialConsole
          rows={trialRows}
          startable={startableUsers}
          tierOptions={tierOptions}
          unavailable={trialsUnavailable}
        />
      </section>

      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-600 dark:text-cream-100/70">
        All users
      </h2>

      <p className="md:hidden text-[11px] text-ink-500 dark:text-cream-100/55 -mt-2">
        Swipe horizontally to see all columns →
      </p>
      <div
        className="card overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-ink-50 border-b border-ink-200 dark:bg-white/5 dark:border-white/10">
            <tr className="text-left">
              <Th>User</Th>
              <Th>Representation</Th>
              <Th>Plan</Th>
              <Th>Sub status</Th>
              <Th>Cases</Th>
              <Th>Last sign-in</Th>
              <Th>Joined</Th>
              <Th>Access</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-white/5">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-ink-50/40 dark:hover:bg-white/5">
                <Td>
                  <div className="font-medium text-ink-950 dark:text-cream-100">
                    {u.displayName || u.email || u.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-ink-500 dark:text-cream-100/55">{u.email}</div>
                  {u.organization && (
                    <div className="text-xs text-ink-500 dark:text-cream-100/55">{u.organization}</div>
                  )}
                  {!u.consentedAt && (
                    <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mt-0.5">
                      No consent yet
                    </div>
                  )}
                </Td>
                <Td>
                  {u.representation ? (
                    <span className="text-ink-800 dark:text-cream-100/85 text-xs">
                      {REPRESENTATION_LABEL[u.representation]}
                    </span>
                  ) : (
                    <span className="text-ink-400 dark:text-cream-100/40">-</span>
                  )}
                </Td>
                <Td>
                  {u.subscriptionTier ? (
                    <span
                      className={`badge ${
                        u.subscriptionTier === 'pro'
                          ? 'bg-gold-500 text-forest-950'
                          : u.subscriptionTier === 'standard'
                            ? 'bg-forest-900 text-cream-200 dark:bg-white/15 dark:text-cream-100'
                            : 'bg-ink-100 text-ink-800 dark:bg-white/10 dark:text-cream-100/85'
                      }`}
                    >
                      {TIER_LABEL[u.subscriptionTier]}
                    </span>
                  ) : (
                    <span className="text-ink-400 dark:text-cream-100/40">-</span>
                  )}
                </Td>
                <Td>
                  {u.subscriptionStatus ? (
                    <span
                      className={`badge ${
                        u.subscriptionStatus === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/40'
                          : u.subscriptionStatus === 'trialing'
                            ? 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-700/40'
                            : u.subscriptionStatus === 'past_due' ||
                              u.subscriptionStatus === 'unpaid'
                              ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/40'
                              : u.subscriptionStatus === 'canceled' ||
                                u.subscriptionStatus === 'inactive'
                                ? 'bg-ink-100 text-ink-700 dark:bg-white/10 dark:text-cream-100/70'
                                : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-700/40'
                      }`}
                    >
                      {u.subscriptionStatus}
                    </span>
                  ) : (
                    <span className="text-ink-400 dark:text-cream-100/40 text-xs">none</span>
                  )}
                </Td>
                <Td className="tabular-nums text-ink-800 dark:text-cream-100/85">
                  {u.caseCount}
                </Td>
                <Td className="text-ink-700 dark:text-cream-100/75">
                  {u.lastSignInAt ? (
                    <LocaleTime iso={u.lastSignInAt} />
                  ) : (
                    <span className="text-ink-400 dark:text-cream-100/40">never</span>
                  )}
                </Td>
                <Td className="text-ink-700 dark:text-cream-100/75">
                  <LocaleTime iso={u.createdAt} mode="date" />
                </Td>
                <Td>
                  <UserToggles
                    userId={u.id}
                    initialIsAdmin={u.isAdmin}
                    initialIsBlocked={u.isBlocked}
                    isSelf={me?.id === u.id}
                    isPermanentAdmin={u.isPermanentAdmin}
                  />
                  {u.isPermanentAdmin && (
                    <p className="text-[10.5px] text-gold-700 dark:text-gold-300 mt-1.5 font-medium uppercase tracking-wider">
                      Permanent admin
                    </p>
                  )}
                  {u.isBlocked && (
                    <p className="text-[10.5px] text-rose-700 dark:text-rose-300 mt-1.5 font-medium uppercase tracking-wider">
                      Blocked
                    </p>
                  )}
                </Td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="p-8 text-center text-sm text-ink-500 dark:text-cream-100/55"
                >
                  No users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-500 dark:text-cream-100/55">
        Toggle admin to grant or revoke admin access. Toggle "Active" off to block a user from
        signing in. Blocked users see a friendly message pointing them at{' '}
        <a
          className="underline hover:text-ink-800 dark:hover:text-cream-100"
          href="mailto:contact@advottic.com"
        >
          contact@advottic.com
        </a>
        .
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/60">
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
