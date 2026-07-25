import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplatesAction } from '@/lib/firm-templates';
import { FormsManageClient } from './forms-manage-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Form templates · Counsel' };

/**
 * Legal-team management of self-service form templates. Everything published
 * here appears in every employee's Hub under Forms — fill, sign, export —
 * which is the whole point: NDA-class requests stop arriving as tickets.
 */
export default async function CounselFormsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const res = await listFirmTemplatesAction(ctx.firm.id);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="eyebrow mb-1">Counsel · self-service</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Form templates
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-cream-100/70">
          Publish configured documents — an NDA, a vendor form — and employees fill, sign, and
          export them from their Hub without opening a ticket. Use{' '}
          <code className="rounded bg-cream-100 px-1 text-[12px] dark:bg-forest-800">{'{{field_key}}'}</code>{' '}
          placeholders in the body; each becomes an input on the employee&apos;s form.
        </p>
      </header>
      <FormsManageClient firmId={ctx.firm.id} initialTemplates={res.templates ?? []} />
    </div>
  );
}
