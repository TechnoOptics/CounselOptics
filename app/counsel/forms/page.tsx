import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplatesAction } from '@/lib/firm-templates';
import { FormsManageClient } from './forms-manage-client';
import { StandardTemplates } from './standard-templates';
import { SEED_TEMPLATES } from '@/lib/seed-templates';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
import {
  firmDocumentLayoutInput,
  normalizeDocumentLayout,
} from '@/lib/document-layout';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

/**
 * The document import on this page is a one-shot generation that restates a
 * whole agreement, which runs in minutes rather than seconds. Without this the
 * platform's default cuts the request off and the editor is left with no
 * proposal and no explanation.
 */
export const maxDuration = 300;

export const metadata = { title: 'Form templates · Counsel' };

/**
 * Legal-team management of self-service form templates. Everything published
 * here appears in every employee's Hub under Forms (fill, sign, export),
 * which is the whole point: NDA-class requests stop arriving as tickets.
 */
export default async function CounselFormsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const res = await listFirmTemplatesAction(ctx.firm.id);
  // The firm's own layout, so the editor can show a template author what they
  // are inheriting and what taking a band over would change.
  const firmLayout = normalizeDocumentLayout(firmDocumentLayoutInput(ctx.firm.metadata));
  // listFirmTemplatesAction already excludes archived rows, so this is
  // exactly what the list below renders.
  const templates = res.templates ?? [];
  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · self-service</T>}
        title={<T>Form templates</T>}
        // How to write a placeholder is not a fact about this list, it is an
        // instruction for the body editor, and the editor already gives it at
        // the field it applies to (app/counsel/forms/document-tab.tsx). It was
        // a third line of syntax on a page whose job is to show what the firm
        // has published.
        subtitle={
          <T>
            Publish configured documents (an NDA, a vendor form) and employees
            fill, sign, and export them from their Hub without opening a ticket.
          </T>
        }
      />
      {/* The firm's OWN templates are what this page is a list of, so they
          come first. The standard documents are one of the two ways to make
          one, kept as a disclosure under the list rather than a block of
          somebody else's paperwork above it, and open on the one occasion it
          is the fastest thing on the screen: a firm with nothing yet. */}
      <FormsManageClient
        firmId={ctx.firm.id}
        initialTemplates={templates}
        firmLayout={firmLayout}
        letterhead={{
          design: firmLetterheadDesign(ctx.firm.metadata),
          hasImage: Boolean(ctx.firm.letterheadUrl),
          hasLogo: Boolean(ctx.firm.logoUrl),
        }}
        brandName={ctx.firm.name}
        standardTemplates={
          <StandardTemplates
            firmId={ctx.firm.id}
            // Only what the list needs. The body is the largest field on a seed
            // template and would otherwise be serialized into the page for every
            // template on every load.
            templates={SEED_TEMPLATES.map((t) => ({
              slug: t.slug,
              name: t.name,
              description: t.description,
              category: t.category,
              notes: t.notes,
            }))}
            installedNames={templates.map((t) => t.name)}
          />
        }
      />
    </div>
  );
}
