import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { portalPolicyCountAction } from '@/lib/firm-policies';
import { PolicyCheckClient } from './policy-check-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Check a document · Hub' };

/**
 * Employee self-service policy check: paste a draft or a question, get a
 * confidence score against the company's own policies with the risky
 * passages flagged. This is research the employee can do themselves before (or
 * instead of) opening a ticket with legal.
 */
export default async function PortalCheckPage() {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  const { count } = await portalPolicyCountAction(persona.firm.id);
  return <PolicyCheckClient firmId={persona.firm.id} policyCount={count} />;
}
