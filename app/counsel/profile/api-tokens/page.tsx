import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';
import { TokensPanel } from '@/app/profile/api-tokens/tokens-panel';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'API tokens · Counsel',
  robots: { index: false, follow: false },
};

/**
 * API tokens inside the firm workspace. Same panel as the consumer
 * route, different shell and a back link that keeps the user in
 * Counsel instead of ejecting them into the consumer app.
 */
export default async function CounselApiTokensPage() {
  if (!isSupabaseConfigured()) redirect('/counsel');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/profile/api-tokens');

  return (
    <div className="max-w-3xl space-y-8 animate-fade-up">
      <PageHeader
        backLink={
          <Link
            href="/counsel/profile"
            className="text-sm text-muted hover:text-foreground"
          >
            &larr; <T>Your account</T>
          </Link>
        }
        eyebrow={<T>Integrations</T>}
        title={<T>API tokens</T>}
        subtitle={
          <T>
            Tokens for the Advottic API at /api/v1. The full token is shown
            once, at creation, and only a hashed copy is kept. Owners and
            admins can scope a token to the firm so another system can file
            work on the firm&rsquo;s behalf.
          </T>
        }
      />

      <TokensPanel />
    </div>
  );
}
