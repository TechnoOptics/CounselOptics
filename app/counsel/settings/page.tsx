import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmWebhooksAction } from '@/lib/firm-actions';
import { readMenuConfig } from '@/lib/menu-config';
import { SettingsForm } from './settings-form';
import { WebhookManager } from './webhook-manager';
import { MenuCustomizer } from './menu-customizer';

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
        <p className="eyebrow mb-1">Firm settings</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {ctx.firm.name}
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Update the firm&rsquo;s name, brand, jurisdictions, and practice areas.
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
          <p className="eyebrow mb-1">Outbound webhooks</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-forest-900 dark:text-cream-100">
            Slack, Microsoft Teams, and custom JSON endpoints
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Fan chat activity out to your existing team tools. Paste an
            Incoming Webhook URL once and every new message in matching
            channels echoes there. By default we send only metadata
            (sender, channel name, link); flip <em>include message body</em>{' '}
            to mirror full content - leave it off if the channel can carry
            privileged material.
          </p>
        </header>
        <WebhookManager
          firmId={ctx.firm.id}
          initialWebhooks={webhooksResult.webhooks ?? []}
        />
      </section>
    </div>
  );
}
