import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listMyFirms } from '@/lib/firm-storage';
import { counselAccountRedirect } from '@/lib/counsel-account-routes';
import { TokensPanel } from './tokens-panel';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'API tokens',
  robots: { index: false, follow: false },
};

export default async function ApiTokensPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/profile/api-tokens');

  // Same rule as /profile. A firm member minting a firm integration token
  // should be doing it inside the workspace the token is bound to.
  // See lib/counsel-account-routes.ts.
  const firmDestination = counselAccountRedirect(
    '/profile/api-tokens',
    (await listMyFirms().catch(() => [])).length > 0,
    searchParams,
  );
  if (firmDestination) redirect(firmDestination);

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

      <TokensPanel />
    </div>
  );
}
