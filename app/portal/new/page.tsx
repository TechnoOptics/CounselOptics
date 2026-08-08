import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { CreateIntakeForm } from '@/app/counsel/intake/create-intake-form';
import { PageHeader } from '@/components/counsel/ui';
import { familyByKey } from '@/lib/portal-request-families';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New request · Portal' };

export default async function PortalNewRequestPage({
  searchParams,
}: {
  searchParams?: { family?: string };
}) {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // Filing is a gated capability - a view-only role can't reach this.
  if (!persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const submittedBy =
    persona.employee.displayName || persona.employee.email;

  // Which home tile they came in through, if any. Untrusted: it is a
  // query string, so an unknown value is simply no family and the form
  // offers everything, which is what it offered before tiles existed.
  const family = familyByKey(searchParams?.family);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <div>
        <div className="mb-4">
          <Link
            href="/portal"
            className="inline-block text-sm text-muted hover:text-foreground"
          >
            &larr; Back to my requests
          </Link>
        </div>
        <PageHeader
          size="lg"
          eyebrow={persona.firm.name}
          title={family ? family.title : 'File a request to legal'}
          subtitle={
            family
              ? `${family.blurb} You can track it from My requests.`
              : 'Pick the type, give legal what they need to act, and submit. You can track it from My requests.'
          }
        />
        {family && (
          <p className="mt-3 text-[12.5px] text-muted">
            Not the right one?{' '}
            <Link href="/portal/new" className="text-accent-text underline">
              See every request type
            </Link>
            .
          </p>
        )}
      </div>

      <CreateIntakeForm
        firmId={persona.firm.id}
        defaultSubmittedBy={submittedBy}
        employeeMode
        redirectBase="/portal"
        family={family?.key ?? null}
      />
    </div>
  );
}
