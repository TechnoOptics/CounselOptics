import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmWebhooksAction } from '@/lib/firm-actions';
import { readMenuConfig } from '@/lib/menu-config';
import { SettingsForm } from './settings-form';
import { WebhookManager } from './webhook-manager';
import { MenuCustomizer } from './menu-customizer';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Firm settings · Counsel' };

export default async function CounselSettingsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'admin') {
    redirect('/counsel');
  }
  // Load webhooks server-side so the manager mounts with real state
  // and the operator never sees the empty-list flicker.
  const webhooksResult = await listFirmWebhooksAction(ctx.firm.id);
  return (
    <div className="space-y-10 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>Firm settings</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {ctx.firm.name}
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>Update the firm&rsquo;s name, brand, jurisdictions, and practice areas.</T>
        </p>
      </header>
      <SettingsForm
        firmId={ctx.firm.id}
        defaultValues={{
          name: ctx.firm.name,
          accentColor: ctx.firm.accentColor,
          logoUrl: ctx.firm.logoUrl ?? '',
          letterheadUrl: ctx.firm.letterheadUrl ?? '',
          jurisdictions: ctx.firm.jurisdictions,
          practiceAreas: ctx.firm.practiceAreas,
          hideAdvotticLogo:
            (ctx.firm.metadata as Record<string, unknown> | null)
              ?.hideAdvotticLogo === true,
          brandName: String(
            (ctx.firm.metadata as Record<string, unknown> | null)
              ?.brandName ?? '',
          ),
          portalTagline: String(
            (ctx.firm.metadata as Record<string, unknown> | null)
              ?.portalTagline ?? '',
          ),
        }}
      />
      <MenuCustomizer
        firmId={ctx.firm.id}
        initial={readMenuConfig(ctx.firm.metadata)}
      />
      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <header>
          <p className="eyebrow mb-1"><T>Outbound webhooks</T></p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Slack, Microsoft Teams, and custom JSON endpoints</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Fan chat activity out to your existing team tools. Paste an
            Incoming Webhook URL once and every new message in matching
            channels echoes there. By default we send only metadata
            (sender, channel name, link); flip</T> <em><T>include message body</T></em>{' '}
            <T>to mirror full content - leave it off if the channel can carry
            privileged material.</T>
          </p>
        </header>
        <WebhookManager
          firmId={ctx.firm.id}
          initialWebhooks={webhooksResult.webhooks ?? []}
        />
      </section>
      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <header>
          <p className="eyebrow mb-1"><T>Enterprise</T></p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Single sign-on and automatic provisioning</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Connect your identity provider so people are added and removed
            automatically as they join or leave, and sign in with your
            organization&rsquo;s credentials.</T>
          </p>
        </header>
        <a
          href="/counsel/settings/scim"
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-forest-900 transition hover:bg-ink-50 dark:border-forest-700/40 dark:text-cream-100 dark:hover:bg-forest-900/40"
        >
          <T>Set up SSO &amp; provisioning</T>
        </a>
      </section>

      <section className="space-y-3 pt-2 border-t border-ink-200 dark:border-forest-700/40">
        <header>
          <p className="eyebrow mb-1"><T>Data export &amp; backup</T></p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            <T>Keep your own copy</T>
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Download a portable JSON archive of</T> {ctx.firm.name}
            <T>&rsquo;s
            operational data (matters, clients, people, documents metadata,
            billing, trust ledger, projects) to store on your own servers. The
            archive excludes secrets and document file bytes. Scheduled backups
            straight to your own data warehouse or bucket are available on
            request.</T>
          </p>
        </header>
        <a
          href="/api/counsel/firm-export"
          className="inline-flex items-center gap-2 rounded-lg bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 px-4 py-2 text-sm font-medium transition hover:brightness-110"
        >
          <T>Download data archive (JSON)</T>
        </a>
      </section>
    </div>
  );
}
