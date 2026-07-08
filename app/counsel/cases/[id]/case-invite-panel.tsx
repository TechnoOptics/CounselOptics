import { listCollaboratorsAsFirm } from '@/lib/storage';
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
}: {
  caseId: string;
  firmId: string;
  canManage: boolean;
}) {
  const collaborators = await listCollaboratorsAsFirm(caseId, firmId).catch(
    () => [],
  );
  return (
    <MatterInviteForm
      caseId={caseId}
      collaborators={collaborators}
      canManage={canManage}
    />
  );
}
