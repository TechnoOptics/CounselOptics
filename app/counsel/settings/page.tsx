import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmWebhooksAction } from '@/lib/firm-actions';
import { readMenuConfig } from '@/lib/menu-config';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
import {
  firmDocumentLayoutInput,
  normalizeDocumentLayout,
} from '@/lib/document-layout';
import { getFirmSurfaceSettings, getFirmTicketPrefix } from '@/lib/firm-settings';
import { readPartnerConfig } from '@/lib/partner-config-core';
import { SettingsForm } from './settings-form';
import { WebhookManager } from './webhook-manager';
import { PartnerIntegrationManager } from './partner-integration-manager';
import { MenuCustomizer } from './menu-customizer';
import { FirmSurfaceToggles } from './firm-surface-toggles';
import { DocumentLayoutBuilder } from './document-layout-builder';
import { PageHeader } from '@/components/counsel/ui';
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
  const surface = await getFirmSurfaceSettings(ctx.firm.id);
  // Read separately from the surface toggles above. See getFirmTicketPrefix:
  // ticket_prefix arrives with a migration that is not applied, and naming it
  // in that read's column list would take the toggles down with it.
  const ticketPrefix = await getFirmTicketPrefix(ctx.firm.id);
  const partnerConfig = readPartnerConfig(ctx.firm.metadata);
  const letterheadDesign = firmLetterheadDesign(ctx.firm.metadata);
  // Null when the firm has never configured one, which is what lets the builder
  // offer "go back to the standard layout" only where there is something to go
  // back from.
  const storedLayout = firmDocumentLayoutInput(ctx.firm.metadata);
  return (
    <div className="space-y-10 animate-fade-up">
      <PageHeader
        eyebrow={<T>Firm settings</T>}
        title={ctx.firm.name}
        subtitle={
          <T>Update the firm&rsquo;s name, brand, jurisdictions, and practice areas.</T>
        }
      />
      <SettingsForm
        firmId={ctx.firm.id}
        letterheadDesign={letterheadDesign}
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
      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Document layout</T></p>
          <h2 className="font-display text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Where things sit on the page</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            <T>Set the margins, place your letterhead, and add a watermark and a
            footer to the documents Advottic produces. A single template can
            override any part of this in the forms editor. Changes apply to
            documents produced from now on; anything already sent for signature
            keeps the layout it went out with.</T>
          </p>
        </header>
        <DocumentLayoutBuilder
          firmId={ctx.firm.id}
          initial={storedLayout === null ? null : normalizeDocumentLayout(storedLayout)}
          has={{
            design: letterheadDesign,
            hasImage: Boolean(ctx.firm.letterheadUrl),
            hasLogo: Boolean(ctx.firm.logoUrl),
          }}
          brandName={ctx.firm.name}
        />
      </section>
      <MenuCustomizer
        firmId={ctx.firm.id}
        initial={readMenuConfig(ctx.firm.metadata)}
      />
      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Workspace surfaces</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Turn off what you don&rsquo;t use</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            <T>Hide entire surfaces of the workspace for everyone at your firm.
            These are off by default, so nothing changes until you turn one on.</T>
          </p>
        </header>
        <FirmSurfaceToggles firmId={ctx.firm.id} initial={{ ...surface, ticketPrefix }} />
      </section>
      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Outbound webhooks</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Slack, Microsoft Teams, and custom JSON endpoints</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
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
      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Partner app integration</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Legal requests filed from your company app</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            <T>When employees file legal requests from a company app connected
            through the partner API, these settings control what they are asked,
            the confirmation they see (state your usual response time), how
            events are pushed back to the app, and when the team is reminded
            about unanswered requests.</T>
          </p>
        </header>
        <PartnerIntegrationManager firmId={ctx.firm.id} initial={partnerConfig} />
      </section>
      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Enterprise</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Single sign-on and automatic provisioning</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            <T>Connect your identity provider so people are added and removed
            automatically as they join or leave, and sign in with your
            organization&rsquo;s credentials.</T>
          </p>
        </header>
        <a
          href="/counsel/settings/scim"
          className="inline-flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-2"
        >
          <T>Set up SSO &amp; provisioning</T>
        </a>
      </section>

      <section className="space-y-3 pt-2 border-t border-edge">
        <header>
          <p className="eyebrow mb-1"><T>Data export &amp; backup</T></p>
          <h2 className="text-xl font-medium tracking-[-0.005em] text-foreground">
            <T>Keep your own copy</T>
          </h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
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
          href="/api/firm/export"
          className="inline-flex items-center gap-2 rounded-lg bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 px-4 py-2 text-sm font-medium transition hover:brightness-110"
        >
          <T>Download data archive (JSON)</T>
        </a>
      </section>
    </div>
  );
}
