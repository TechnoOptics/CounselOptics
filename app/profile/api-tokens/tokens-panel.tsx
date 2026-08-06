import {
  createServerSupabase,
  getCurrentUser,
} from '@/lib/supabase/server';
import { NewTokenForm } from './new-token-form';
// Rendered from the counsel route too, which runs under a LocaleProvider.
// <T> is a client component, so a server component can render it.
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The API tokens surface: the mint form plus the list of issued tokens.
 *
 * It lives here rather than in the page because it is rendered from two
 * routes - /profile/api-tokens in the consumer app and
 * /counsel/profile/api-tokens inside the firm workspace. Each page
 * supplies its own back link and its own sign-in redirect; everything
 * below the header is identical, so there is one copy of it.
 */
export async function TokensPanel() {
  const user = await getCurrentUser();
  if (!user) return null;
  // Use the user-scoped client so RLS does the access check.
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('api_tokens')
    .select(
      'id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at, firm_id',
    )
    .order('created_at', { ascending: false })
    .limit(50);
  // Firms this user can mint an integration token for (owner/admin only).
  const { data: memberships } = await supabase
    .from('firm_members')
    .select('firm_id, role, firms(name)')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);
  const adminFirms = ((memberships ?? []) as Array<{
    firm_id: string;
    firms: { name: string } | { name: string }[] | null;
  }>).map((m) => ({
    id: m.firm_id,
    name:
      (Array.isArray(m.firms) ? m.firms[0]?.name : m.firms?.name) ??
      'Unnamed firm',
  }));
  const tokens = (data ?? []) as Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string;
    firm_id: string | null;
  }>;

  return (
    <>
      <NewTokenForm adminFirms={adminFirms} />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          <T>Active tokens</T>
        </h2>
        {tokens.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            <T>No tokens issued yet.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="card p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="font-semibold text-forest-900 dark:text-cream-100 truncate"
                    data-no-translate
                  >
                    {t.name}
                  </p>
                  {/* Left unwrapped on purpose: the prefix, the scope list and
                      the date are all data, and the connecting words cannot be
                      split out without translating sentence fragments. */}
                  <p
                    className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono"
                    data-no-translate
                  >
                    {t.prefix}... · scopes {t.scopes.join(', ')} ·{' '}
                    {t.last_used_at
                      ? `last used ${new Date(t.last_used_at).toLocaleDateString()}`
                      : 'never used'}
                    {t.firm_id && ' · firm-scoped'}
                  </p>
                </div>
                {t.revoked_at ? (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40">
                    <T>Revoked</T>
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40">
                    <T>Active</T>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
