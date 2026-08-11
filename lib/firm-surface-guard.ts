import 'server-only';
import { getFirmSurfaceSettings } from './firm-settings';
import type { WorkspaceSurface } from './firm-workspace';

/**
 * Refuse a write into a surface this firm does not have.
 *
 * A hidden rail item is a DISPLAY choice. Every `'use server'` export is a
 * public HTTP endpoint that stays callable whatever the rail renders, so a
 * hidden surface whose actions still write is not hidden - it is undiscoverable,
 * which is a different and much weaker thing. This repo has shipped that
 * defect more than once; see the note on deleteCaseAction.
 *
 * Deliberately NOT applied to:
 *
 *   - reads. Hiding a surface must never destroy data, and a firm that
 *     switches to in-house keeps every invoice, time entry and trust ledger
 *     row it had. Refusing the reads too would make those rows unreachable,
 *     which is deletion with extra steps. An owner who needs them back sets
 *     the override to shown and the surface returns with everything in it.
 *   - `applyStripeInvoicePayment` and the marketplace's consumer-side
 *     submission. A payment that already happened has to be recorded whatever
 *     the firm's settings say, and a member of the public submitting a request
 *     must not be broken by a firm's display choice.
 */
export type SurfaceRefusal = { ok: false; error: string };

const REFUSAL: Record<WorkspaceSurface, string> = {
  timeBilling:
    'Time and billing are switched off for this workspace. An owner or admin can turn them back on in firm settings.',
  growth:
    'Leads and referrals are switched off for this workspace. An owner or admin can turn them back on in firm settings.',
};

/**
 * Null when the firm has this surface, a refusal when it does not.
 *
 * Returns rather than throws so a caller whose contract is `{ ok, error }`
 * can hand the reason to the person, which is every action this guards.
 */
export async function surfaceRefusal(
  firmId: string,
  surface: WorkspaceSurface,
): Promise<SurfaceRefusal | null> {
  const settings = await getFirmSurfaceSettings(firmId);
  const hidden =
    surface === 'timeBilling' ? settings.hideTimeBilling : settings.hideGrowth;
  return hidden ? { ok: false, error: REFUSAL[surface] } : null;
}

/** The same gate for a caller that would rather not carry a null through. */
export async function firmHasSurface(
  firmId: string,
  surface: WorkspaceSurface,
): Promise<boolean> {
  return (await surfaceRefusal(firmId, surface)) === null;
}
