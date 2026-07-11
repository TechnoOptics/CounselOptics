import { listCollaboratorsAsFirm } from '@/lib/storage';
import { listCaseGuestAccounts } from '@/lib/counsel-guest';
import { MatterInviteForm } from './matter-invite-form';

/**
 * Server-rendered "People on this matter" panel for the counsel case
 * detail page. Fetches the matter's collaborators through the service-role
 * client (the firm member viewing this is not the case row owner, so RLS
 * would otherwise hide them) and hands them to the client invite form.
 *
 * `canManage` gates the invite/remove controls in the UI; the underlying
 * server actions re-authorize on every call, so this is presentation-only.
 */
export async function CaseInvitePanel({
  caseId,
  firmId,
  canManage,
  canProvisionGuests = false,
}: {
  caseId: string;
  firmId: string;
  canManage: boolean;
  /** Owner/admin only: create + deactivate firm-provisioned guest accounts. */
  canProvisionGuests?: boolean;
}) {
  const [collaborators, guestAccounts] = await Promise.all([
    listCollaboratorsAsFirm(caseId, firmId).catch(() => []),
    canProvisionGuests
      ? listCaseGuestAccounts(caseId, firmId).catch(() => [])
      : Promise.resolve([]),
  ]);
  return (
    <MatterInviteForm
      caseId={caseId}
      collaborators={collaborators}
      canManage={canManage}
      canProvisionGuests={canProvisionGuests}
      guestAccounts={guestAccounts}
    />
  );
}
