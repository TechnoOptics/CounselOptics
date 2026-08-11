import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmPoliciesAction } from '@/lib/firm-policies';
import { PoliciesManageClient } from './policies-manage-client';
import { PageHeader } from '@/components/counsel/ui';
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
      <PageHeader
        eyebrow={<T>Counsel · self-service</T>}
        title={<T>Policy library</T>}
        // What the checker returns to an employee (a confidence score, the
        // passages a policy prohibits) is a description of a screen nobody
        // reaches from here. What matters to the person maintaining this
        // library is that the corpus is what gets checked.
        subtitle={
          <T>
            Paste the company&apos;s policies here. Employees check drafts and
            questions against them from their Hub before anything reaches your
            inbox.
          </T>
        }
      />
      <PoliciesManageClient firmId={ctx.firm.id} initialPolicies={res.policies ?? []} />
    </div>
  );
}
