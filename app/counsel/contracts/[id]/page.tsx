import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Firm-side contract detail re-uses the consumer detail UI (same
 * shape, same review panel). Redirect to the canonical /contracts/{id}
 * route which RLS gates either by user_id (consumer) or firm_id +
 * firm_members membership (firm).
 */
export default function CounselContractDetail({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/contracts/${params.id}`);
}
