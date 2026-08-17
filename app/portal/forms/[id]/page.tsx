import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { isPhoneUserAgent } from '@/lib/platform';
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

  /**
   * Whether the person reading this is already holding a phone, established
   * HERE, from the request, and passed down as a boolean.
   *
   * The third of three questions, and until now only two were asked. The
   * template's signature_methods says whether the firm ALLOWS the phone; the
   * probe above says whether the handoff is POSSIBLE in this database; neither
   * says whether there is any point. Offering to show a QR code for the
   * employee to scan with their phone, on their phone, asks them to scan a code
   * with the device displaying it.
   *
   * It is read off the request rather than resolved in the browser, and that is
   * the whole of the care here. app/billing/tier-card.tsx resolved the device in
   * a client effect that runs once with no retry; on the remote-URL WebView the
   * first paint beat it, so the page rendered the wrong control and shipped,
   * which was the 5th App Store rejection (2.1(b), 2026-07-02). A header is
   * present before the first byte of HTML, so this cannot be raced, cannot
   * hydrate to something else, and cannot flicker.
   */
  const viewerOnPhone = isPhoneUserAgent(headers().get('user-agent'));

  return (
    <FormFillClient
      template={res.template}
      firmId={persona.firm.id}
      firmName={persona.firm.name}
      employeeName={persona.employee.displayName ?? ''}
      employeeEmail={persona.employee.email ?? ''}
      phoneHandoffAvailable={phoneHandoffAvailable}
      viewerOnPhone={viewerOnPhone}
    />
  );
}
