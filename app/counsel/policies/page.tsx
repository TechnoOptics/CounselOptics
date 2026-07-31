import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmPoliciesAction } from '@/lib/firm-policies';
import { PoliciesManageClient } from './policies-manage-client';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Policy library · Counsel' };

/**
 * The firm's policy library: the corpus behind the employee "Check a
 * document" tool. Everything here is what the checker compares against, so
 * keeping it current directly reduces "can I do this?" tickets.
 */
export default async function CounselPoliciesPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const res = await listFirmPoliciesAction(ctx.firm.id);
  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>Counsel · self-service</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Policy library</T>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-cream-100/70">
          Paste the company&apos;s policies here. Employees check drafts and questions against them
          from their Hub (with a confidence score and the exact passages your policies prohibit or
          caution) before anything reaches your inbox.
        </p>
      </header>
      <PoliciesManageClient firmId={ctx.firm.id} initialPolicies={res.policies ?? []} />
    </div>
  );
}
