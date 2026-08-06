import { redirect, notFound } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { getPortalTemplateAction } from '@/lib/firm-templates';
import { FormFillClient } from './form-fill-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Fill form · Hub' };

export default async function PortalFormFillPage({ params }: { params: { id: string } }) {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const res = await getPortalTemplateAction(persona.firm.id, params.id);
  if (!res.ok || !res.template) notFound();

  return (
    <FormFillClient
      template={res.template}
      firmId={persona.firm.id}
      firmName={persona.firm.name}
      firmAccent={persona.firm.accentColor ?? null}
      letterheadUrl={persona.firm.letterheadUrl ?? null}
      logoUrl={persona.firm.logoUrl ?? null}
      employeeName={persona.employee.displayName ?? ''}
      employeeEmail={persona.employee.email ?? ''}
    />
  );
}
