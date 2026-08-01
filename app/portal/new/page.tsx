import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { CreateIntakeForm } from '@/app/counsel/intake/create-intake-form';
import { PageHeader } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New request · Portal' };

export default async function PortalNewRequestPage() {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // Filing is a gated capability - a view-only role can't reach this.
  if (!persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const submittedBy =
    persona.employee.displayName || persona.employee.email;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <div>
        <div className="mb-4">
          <Link
            href="/portal"
            className="inline-block text-sm text-cream-100/60 hover:text-cream-100"
          >
            &larr; Back to my requests
          </Link>
        </div>
        <PageHeader
          size="lg"
          eyebrow={persona.firm.name}
          title="File a request to legal"
          subtitle="Pick the type, give legal what they need to act, and submit. You can track it from My requests."
        />
      </div>

      <CreateIntakeForm
        firmId={persona.firm.id}
        defaultSubmittedBy={submittedBy}
        employeeMode
        redirectBase="/portal"
      />
    </div>
  );
}
