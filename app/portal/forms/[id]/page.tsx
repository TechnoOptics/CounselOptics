import { redirect, notFound } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { getPortalTemplateAction } from '@/lib/firm-templates';
import { markHandoffFeatureAvailable } from '@/lib/mark-handoff-queries';
import { FormFillClient } from './form-fill-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Fill form · Hub' };

export default async function PortalFormFillPage({ params }: { params: { id: string } }) {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const res = await getPortalTemplateAction(persona.firm.id, params.id);
  if (!res.ok || !res.template) notFound();

  /**
   * Whether the phone handoff exists in this database, asked here rather than
   * inferred on the page.
   *
   * The template's signature_methods says whether the firm ALLOWS the phone,
   * and a missing column there reads as no restriction, which is correct.
   * Nothing said whether the phone was POSSIBLE, so with
   * 20260815_mark_handoffs.sql unapplied the form offered a route whose table
   * does not exist. One narrow select, and it fails closed.
   */
  const phoneHandoffAvailable = await markHandoffFeatureAvailable();

  return (
    <FormFillClient
      template={res.template}
      firmId={persona.firm.id}
      firmName={persona.firm.name}
      employeeName={persona.employee.displayName ?? ''}
      employeeEmail={persona.employee.email ?? ''}
      phoneHandoffAvailable={phoneHandoffAvailable}
    />
  );
}
