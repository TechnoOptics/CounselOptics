'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerHasFirmRole, FIRM_MANAGE_ROLES } from './firm-authz';

/**
 * Co-counsel referral actions. The proposing firm files a referral
 * with a target firm + agreed split %; the target firm accepts or
 * declines. Once accepted and the matter resolves, both firms can
 * record paid amounts to track who has been paid and what's owed.
 *
 * Bar-rule note: Model Rule 1.5(e) and the analogous state rules
 * require client consent in writing AND that the total fee is
 * reasonable. The schema captures client_consent_at +
 * client_consent_audit; the UI requires both before the referral
 * advances to "accepted."
 */

export async function proposeReferralAction(
  referringFirmId: string,
  input: {
    referredFirmId: string;
    caseId?: string | null;
    matterSummary: string;
    proposedSplitPercent: number;
    state: string;
  },
): Promise<{ ok: boolean; error?: string; referralId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (
    input.proposedSplitPercent < 0 ||
    input.proposedSplitPercent > 100
  ) {
    return { ok: false, error: 'Split must be between 0 and 100.' };
  }
  if (input.matterSummary.trim().length < 20) {
    return {
      ok: false,
      error: 'Matter summary must be at least 20 characters.',
    };
  }
  if (referringFirmId === input.referredFirmId) {
    return { ok: false, error: 'Cannot refer to your own firm.' };
  }

  // Same role set the cocounsel_referrals write policy allows, so a read-only
  // staff account gets calm copy instead of a raw policy error.
  if (!(await callerHasFirmRole(referringFirmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only an owner, admin, or attorney at that firm can propose a referral.',
    };
  }

  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from('cocounsel_referrals')
    .insert({
      referring_firm_id: referringFirmId,
      referred_firm_id: input.referredFirmId,
      case_id: input.caseId ?? null,
      matter_summary: input.matterSummary,
      proposed_split_percent: input.proposedSplitPercent,
      state: input.state.toUpperCase().replace(/^US-/, ''),
      status: 'proposed',
      proposed_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  const referralId = (data as { id: string }).id;

  // Notify owner / admin / attorney members of the target firm.
  const admin = createAdminSupabase();
  if (admin) {
    const { createNotification } = await import('./notifications');
    const { data: members } = await admin
      .from('firm_members')
      .select('user_id, role')
      .eq('firm_id', input.referredFirmId)
      .in('role', ['owner', 'admin', 'attorney']);
    const { data: refFirm } = await admin
      .from('firms')
      .select('name')
      .eq('id', referringFirmId)
      .maybeSingle();
    const refName = (refFirm as { name?: string } | null)?.name ?? 'Another firm';
    for (const m of (members ?? []) as Array<{ user_id: string }>) {
      await createNotification({
        userId: m.user_id,
        type: 'system',
        title: `Co-counsel referral from ${refName}`,
        body: `${input.matterSummary.slice(0, 160)}${input.matterSummary.length > 160 ? '...' : ''}`,
        link: `/counsel/referrals/${referralId}`,
      });
    }
  }

  revalidatePath('/counsel/referrals');
  return { ok: true, referralId };
}

export async function respondToReferralAction(
  firmId: string,
  referralId: string,
  responseType: 'accepted' | 'declined',
  clientConsentAudit: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // The referral RLS policy admits an owner/admin/attorney of EITHER firm, so
  // matching the row's referred_firm_id against a caller-supplied firmId is not
  // enough on its own: without this check an attorney at the referring firm
  // could accept (and file the client-consent record) on the other firm's
  // behalf.
  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only an owner, admin, or attorney at that firm can respond to a referral.',
    };
  }
  const supabase = createServerSupabase();

  const { data: ref } = await supabase
    .from('cocounsel_referrals')
    .select('id, referred_firm_id, referring_firm_id, status')
    .eq('id', referralId)
    .maybeSingle();
  if (!ref) return { ok: false, error: 'Referral not found.' };
  const r = ref as {
    id: string;
    referred_firm_id: string;
    referring_firm_id: string;
    status: string;
  };
  if (r.referred_firm_id !== firmId) {
    return { ok: false, error: 'You can only respond to referrals targeting your firm.' };
  }
  if (r.status !== 'proposed') {
    return { ok: false, error: `Referral is already ${r.status}.` };
  }
  if (responseType === 'accepted' && !clientConsentAudit?.trim()) {
    return {
      ok: false,
      error:
        'Client consent in writing is required by Model Rule 1.5(e). Paste or describe the consent record.',
    };
  }

  const updates: Record<string, unknown> = {
    status: responseType,
    accepted_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (responseType === 'accepted') {
    updates.client_consent_at = new Date().toISOString();
    updates.client_consent_audit = clientConsentAudit?.trim();
  }

  const { error } = await supabase
    .from('cocounsel_referrals')
    .update(updates)
    .eq('id', referralId);
  if (error) return { ok: false, error: error.message };

  // Notify the proposing firm.
  const admin = createAdminSupabase();
  if (admin) {
    const { createNotification } = await import('./notifications');
    const { data: members } = await admin
      .from('firm_members')
      .select('user_id, role')
      .eq('firm_id', r.referring_firm_id)
      .in('role', ['owner', 'admin', 'attorney']);
    for (const m of (members ?? []) as Array<{ user_id: string }>) {
      await createNotification({
        userId: m.user_id,
        type: 'system',
        title: `Referral ${responseType}`,
        body:
          responseType === 'accepted'
            ? 'The other firm accepted. Coordinate scope and start the engagement.'
            : 'The other firm passed.',
        link: `/counsel/referrals/${referralId}`,
      });
    }
  }
  revalidatePath('/counsel/referrals');
  revalidatePath(`/counsel/referrals/${referralId}`);
  return { ok: true };
}

export async function recordReferralPaymentAction(
  firmId: string,
  referralId: string,
  side: 'referring' | 'referred',
  paidCents: number,
): Promise<{ ok: boolean; error?: string }> {
  // Whole non-negative cents only. `NaN < 0` is false, so a bare `< 0` guard
  // lets NaN through and writes a null figure into a fee-split record (the
  // same trap lib/trust-accounting.ts documents avoiding).
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    return { ok: false, error: 'Enter the amount paid in whole cents.' };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // firmId is caller-supplied and was previously only compared against the
  // referral row, never against the caller's own memberships. Because the RLS
  // policy admits either firm's owner/admin/attorney, that let one side record
  // (or zero out) the counterparty firm's fee-split receipts.
  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only an owner, admin, or attorney at that firm can record a payment.',
    };
  }
  const supabase = createServerSupabase();
  const { data: ref } = await supabase
    .from('cocounsel_referrals')
    .select('id, referring_firm_id, referred_firm_id, status')
    .eq('id', referralId)
    .maybeSingle();
  if (!ref) return { ok: false, error: 'Referral not found.' };
  const r = ref as {
    id: string;
    referring_firm_id: string;
    referred_firm_id: string;
    status: string;
  };
  // A fee split only exists once both firms have agreed to it.
  if (r.status !== 'accepted') {
    return { ok: false, error: 'Payments can only be recorded on an accepted referral.' };
  }
  // Only the side recording its own payment can update its column.
  if (side === 'referring' && r.referring_firm_id !== firmId) {
    return { ok: false, error: 'Wrong firm for that side.' };
  }
  if (side === 'referred' && r.referred_firm_id !== firmId) {
    return { ok: false, error: 'Wrong firm for that side.' };
  }

  const column = side === 'referring' ? 'referring_paid_cents' : 'referred_paid_cents';
  const { error } = await supabase
    .from('cocounsel_referrals')
    .update({ [column]: paidCents, updated_at: new Date().toISOString() })
    .eq('id', referralId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/referrals/${referralId}`);
  return { ok: true };
}
