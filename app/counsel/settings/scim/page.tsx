import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { ScimSettings } from '@/components/counsel/ScimSettings';
import { SamlSsoSetup } from '@/components/counsel/SamlSsoSetup';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SSO & provisioning · Counsel' };

/**
 * Supabase Auth's SAML service-provider endpoints are derived from the
 * project URL: <project>/auth/v1/sso/saml/{acs,metadata}. We surface
 * them so an admin can register their IdP without digging through docs.
 */
function ssoEndpoints(): { acsUrl: string; metadataUrl: string } | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return {
    acsUrl: `${base}/auth/v1/sso/saml/acs`,
    metadataUrl: `${base}/auth/v1/sso/saml/metadata`,
  };
}

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

  const sso = ssoEndpoints();

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Enterprise · SSO &amp; provisioning</T>}
        title={<T>Single sign-on &amp; automatic provisioning</T>}
        subtitle={
          <>
            <T>Let</T> {ctx.firm.name}
            <T>&rsquo;s people sign in with your identity provider
            (SAML SSO) and keep your firm directory in sync automatically (SCIM).
            When someone joins or leaves in Microsoft Entra ID or Okta, their
            access here keeps pace without manual steps.</T>
          </>
        }
      />

      {sso && (
        <section className="space-y-3">
          <div>
            <p className="eyebrow mb-1"><T>SAML single sign-on</T></p>
            <h2 className="text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
              <T>Connect your identity provider</T>
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-cream-100/70">
              <T>Give these service-provider values to your IdP, then send your
              metadata URL and email domain to Advottic to register the
              connection (that last step is on our side). Once it&rsquo;s live,
              the &ldquo;Sign in with your organization&rdquo; option on the
              sign-in page works for anyone on that domain.</T>
            </p>
          </div>
          <SamlSsoSetup
            acsUrl={sso.acsUrl}
            metadataUrl={sso.metadataUrl}
            entityId={sso.metadataUrl}
          />
        </section>
      )}

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <div>
          <p className="eyebrow mb-1"><T>SCIM provisioning</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Automatic user provisioning</T>
          </h2>
        </div>
        <ScimSettings baseUrl={resolveBaseUrl()} />
      </section>
    </div>
  );
}
