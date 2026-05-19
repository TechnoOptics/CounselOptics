import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { CreateIntakeForm } from '@/app/counsel/intake/create-intake-form';

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
        <p className="eyebrow mb-2">{persona.firm.name}</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-cream-100">
          File a request to legal
        </h1>
        <p className="text-sm text-cream-100/70 mt-1.5 leading-relaxed">
          Pick the type, give legal what they need to act, and submit.
          You can track it from My requests.
        </p>
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
