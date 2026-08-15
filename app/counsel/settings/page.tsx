import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { firmVocabulary } from '@/lib/firm-vocabulary';
import { listFirmWebhooksAction } from '@/lib/firm-actions';
import { readMenuConfig } from '@/lib/menu-config';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
import {
  firmDocumentLayoutInput,
  normalizeDocumentLayout,
} from '@/lib/document-layout';
import { getFirmSurfaceSettings, getFirmTicketPrefix } from '@/lib/firm-settings';
import { getFirmMatterPrefix } from '@/lib/matter-numbers';
import { readPartnerConfig } from '@/lib/partner-config-core';
import { SettingsForm } from './settings-form';
import { WebhookManager } from './webhook-manager';
import { PartnerIntegrationManager } from './partner-integration-manager';
import { MenuCustomizer } from './menu-customizer';
import { FirmSurfaceToggles } from './firm-surface-toggles';
import { DocumentLayoutBuilder } from './document-layout-builder';
import { PageHeader } from '@/components/counsel/ui';
import { PanelCard } from '@/components/counsel/patterns';
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
  const surface = await getFirmSurfaceSettings(ctx.firm.id, ctx.firm);
  // Read separately from the surface toggles above. See getFirmTicketPrefix:
  // ticket_prefix arrives with a migration that is not applied, and naming it
  // in that read's column list would take the toggles down with it.
  const ticketPrefix = await getFirmTicketPrefix(ctx.firm.id);
  // Same reasoning again for the matter prefix, which arrives with
  // supabase/migrations/20260813_matter_number.sql.
  const matterPrefix = await getFirmMatterPrefix(ctx.firm.id);
  const partnerConfig = readPartnerConfig(ctx.firm.metadata);
  const letterheadDesign = firmLetterheadDesign(ctx.firm.metadata);
  // Null when the firm has never configured one, which is what lets the builder
  // offer "go back to the standard layout" only where there is something to go
  // back from.
  const storedLayout = firmDocumentLayoutInput(ctx.firm.metadata);
  return (
    /*
      A configuration surface, not a list: the page header, then one card
      per thing that can be set, each with the uppercase letterspaced
      header the detail pattern uses. No metric strip and no segmented
      views, because a settings page has no metrics and its cards are not
      views of one set - they are separate settings that are all in
      force at once.
    */
    <div className="space-y-4 animate-fade-up">
      <PageHeader
        eyebrow={<T>Firm settings</T>}
        title={ctx.firm.name}
        subtitle={
          <T>Update the firm&rsquo;s name, brand, jurisdictions, and practice areas.</T>
        }
        className="mb-6"
      />
      <PanelCard title={<T>Identity and brand</T>}>
      <SettingsForm
        firmId={ctx.firm.id}
        vocab={firmVocabulary(ctx.firm.firmType)}
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
      </PanelCard>

      <PanelCard title={<T>Document layout</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Where things sit on the page</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>Set the margins, place your letterhead, and add a watermark and a
          footer to the documents Advottic produces. A single template can
          override any part of this in the forms editor. Changes apply to
          documents produced from now on; anything already sent for signature
          keeps the layout it went out with.</T>
        </p>
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
      </PanelCard>

      <PanelCard title={<T>Menu and navigation</T>}>
        <MenuCustomizer
          firmId={ctx.firm.id}
          initial={readMenuConfig(ctx.firm.metadata)}
        />
      </PanelCard>

      <PanelCard title={<T>Workspace surfaces</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>What kind of legal team you are, and what you use</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>Your workspace type sets sensible starting points: an in-house team
          is not shown billing, invoices or a referral marketplace, and the
          people it advises are called employees rather than clients. Every one
          of those starting points can be overridden here, and an override always
          wins. Nothing you have already filed is ever removed.</T>
        </p>
        <FirmSurfaceToggles
          firmId={ctx.firm.id}
          initial={{ ...surface, ticketPrefix, matterPrefix }}
        />
      </PanelCard>

      <PanelCard title={<T>Outbound webhooks</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Slack, Microsoft Teams, and custom JSON endpoints</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>Fan chat activity out to your existing team tools. Paste an
          Incoming Webhook URL once and every new message in matching
          channels echoes there. By default we send only metadata
          (sender, channel name, link); flip</T> <em><T>include message body</T></em>{' '}
          <T>to mirror full content - leave it off if the channel can carry
          privileged material.</T>
        </p>
        <WebhookManager
          firmId={ctx.firm.id}
          initialWebhooks={webhooksResult.webhooks ?? []}
        />
      </PanelCard>

      <PanelCard title={<T>Partner app integration</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Legal requests filed from your company app</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>When employees file legal requests from a company app connected
          through the partner API, these settings control what they are asked,
          the confirmation they see (state your usual response time), how
          events are pushed back to the app, and when the team is reminded
          about unanswered requests.</T>
        </p>
        <PartnerIntegrationManager firmId={ctx.firm.id} initial={partnerConfig} />
      </PanelCard>

      <PanelCard title={<T>Enterprise</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Single sign-on and automatic provisioning</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>Connect your identity provider so people are added and removed
          automatically as they join or leave, and sign in with your
          organization&rsquo;s credentials.</T>
        </p>
        <a href="/counsel/settings/scim" className="btn-secondary">
          <T>Set up SSO &amp; provisioning</T>
        </a>
      </PanelCard>

      <PanelCard title={<T>Data export and backup</T>}>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Keep your own copy</T>
        </p>
        <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          <T>Download a portable JSON archive of</T>{' '}
          <span data-no-translate>{ctx.firm.name}</span>
          <T>&rsquo;s
          operational data (matters, clients, people, documents metadata,
          billing, trust ledger, projects) to store on your own servers. The
          archive excludes secrets and document file bytes. Scheduled backups
          straight to your own data warehouse or bucket are available on
          request.</T>
        </p>
        {/* btn-primary rather than a hand-written forest/gold pair. The
            literal classes were a light-mode fill and a dark-mode fill
            written out at the call site, which is the drift the token
            set exists to end. */}
        <a href="/api/firm/export" className="btn-primary">
          <T>Download data archive (JSON)</T>
        </a>
      </PanelCard>
    </div>
  );
}
