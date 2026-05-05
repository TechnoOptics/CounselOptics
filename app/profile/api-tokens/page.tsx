import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  createServerSupabase,
  getCurrentUser,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { NewTokenForm } from './new-token-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'API tokens · Advottic',
  robots: { index: false, follow: false },
};

export default async function ApiTokensPage() {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/profile/api-tokens');
  // Use the user-scoped client so RLS does the access check.
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('api_tokens')
    .select(
      'id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at, firm_id',
    )
    .order('created_at', { ascending: false })
    .limit(50);
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
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/profile"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Profile
        </Link>
      </p>

      <header>
        <p className="eyebrow mb-1">Profile · API tokens</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          API tokens
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Personal tokens for the Advottic public API at{' '}
          <code className="font-mono text-[12px]">/api/v1/*</code>. The full
          token is shown ONCE on creation; we keep only a hashed copy. Use
          tokens with the Advottic browser extension, your own automation, or
          to integrate Advottic with another tool.
        </p>
      </header>

      <NewTokenForm />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Active tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No tokens issued yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="card p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                    {t.name}
                  </p>
                  <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono">
                    {t.prefix}... · scopes {t.scopes.join(', ')} ·{' '}
                    {t.last_used_at
                      ? `last used ${new Date(t.last_used_at).toLocaleDateString()}`
                      : 'never used'}
                    {t.firm_id && ' · firm-scoped'}
                  </p>
                </div>
                {t.revoked_at ? (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40">
                    Revoked
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40">
                    Active
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
