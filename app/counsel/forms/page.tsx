import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplatesAction } from '@/lib/firm-templates';
import { FormsManageClient } from './forms-manage-client';
import { StandardTemplates } from './standard-templates';
import { SEED_TEMPLATES } from '@/lib/seed-templates';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

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
  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · self-service</T>}
        title={<T>Form templates</T>}
        subtitle={
          <>
            Publish configured documents (an NDA, a vendor form) and employees fill, sign, and
            export them from their Hub without opening a ticket. Use{' '}
            <code className="rounded bg-cream-100 px-1 text-[12px] dark:bg-forest-800">{'{{field_key}}'}</code>{' '}
            placeholders in the body; each becomes an input on the employee&apos;s form.
          </>
        }
      />
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
        installedNames={(res.templates ?? [])
          .filter((t) => t.status !== 'archived')
          .map((t) => t.name)}
      />
      <FormsManageClient firmId={ctx.firm.id} initialTemplates={res.templates ?? []} />
    </div>
  );
}
