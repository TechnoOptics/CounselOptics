import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { ScimSettings } from '@/components/counsel/ScimSettings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SCIM provisioning · Counsel' };

function resolveBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (env) return `${env}/api/scim/v2`;
  const h = headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (host) return `${proto}://${host}/api/scim/v2`;
  return 'https://advottic.com/api/scim/v2';
}

export default async function ScimSettingsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'admin') {
    redirect('/counsel');
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Enterprise · Provisioning</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Automatic user provisioning (SCIM)
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-cream-100/70">
          Connect {ctx.firm.name} to your identity provider so people are added
          to and removed from your firm directory automatically. When someone
          joins or leaves in Microsoft Entra ID or Okta, their access here keeps
          pace without manual steps.
        </p>
      </header>
      <ScimSettings baseUrl={resolveBaseUrl()} />
    </div>
  );
}
