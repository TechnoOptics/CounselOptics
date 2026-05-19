'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getFirmBySlug } from './firm-storage';
import { createNotification } from './notifications';
import { sendEmail } from './email';
import {
  classifyEmail,
  isValidEmail,
  type SignupRequestRow,
} from './access-requests';

export type AccessRequestOutcome =
  | { ok: true; kind: 'internal' | 'external' | 'existing'; message: string }
  | { ok: false; error: string };

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') ||
    'https://advottic.com'
  );
}

/**
 * Public, unauthenticated. Provisions an internal employee straight
 * away (they then sign themselves in via the normal magic link - we
 * never create their auth account for them), or queues an external
 * request for a legal-team admin to approve first.
 */
export async function requestWorkspaceAccessAction(
  formData: FormData,
): Promise<AccessRequestOutcome> {
  const fullName = String(formData.get('fullName') ?? '')
    .trim()
    .slice(0, 120);
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  const firmSlug = String(formData.get('firmSlug') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 64);

  if (!fullName) return { ok: false, error: 'Enter your full name.' };
  if (!isValidEmail(email)) {
    return { ok: false, error: 'Enter a valid work email address.' };
  }
  if (!firmSlug) {
    return { ok: false, error: 'Choose your organization.' };
  }

  const firm = await getFirmBySlug(firmSlug);
  if (!firm) {
    return {
      ok: false,
      error: 'We could not find that organization. Check the code with your team.',
    };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable. Try again shortly.' };

  // Already provisioned (or a pending duplicate)? Guide them, do not
  // create a second record.
  const { data: existingEmp } = await admin
    .from('firm_employees')
    .select('id, deactivated_at')
    .eq('firm_id', firm.id)
    .ilike('email', email)
    .maybeSingle();
  if (existingEmp && !(existingEmp as { deactivated_at: string | null }).deactivated_at) {
    return {
      ok: true,
      kind: 'existing',
      message:
        'You already have access. Just sign in with this email to enter your hub.',
    };
  }

  const classification = classifyEmail(
    firm.metadata as Record<string, unknown>,
    email,
  );

  if (classification === 'internal') {
    const { error } = await admin.from('firm_employees').insert({
      firm_id: firm.id,
      user_id: null,
      email,
      display_name: fullName,
      source: 'manual',
      role_key: null,
    });
    if (error) {
      return {
        ok: false,
        error: 'Could not set up your access. Please try again.',
      };
    }
    return {
      ok: true,
      kind: 'internal',
      message: `You're set. Sign in with ${email} to open your ${firm.name} hub.`,
    };
  }

  // External: queue for legal-admin approval. Idempotent - if a
  // pending request already exists, just confirm it (the partial
  // unique index also guards against a race).
  const { data: existingReq } = await admin
    .from('firm_signup_requests')
    .select('id, status')
    .eq('firm_id', firm.id)
    .ilike('email', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingReq) {
    return {
      ok: true,
      kind: 'external',
      message: `Your request to join ${firm.name} is already with their legal team for approval. You'll get an email when it's reviewed.`,
    };
  }
  const { error: insErr } = await admin
    .from('firm_signup_requests')
    .insert({
      firm_id: firm.id,
      email,
      full_name: fullName,
      classification: 'external',
      status: 'pending',
    });
  if (insErr) {
    return {
      ok: true,
      kind: 'external',
      message: `Your request to join ${firm.name} is with their legal team for approval. You'll get an email when it's reviewed.`,
    };
  }

  // Notify the firm's owners/admins (in-app + email). firm_members
  // has NO email column - the address lives on the auth user - so we
  // resolve each admin's email via the admin auth API. Each step is
  // independently best-effort so one failure can't silence the rest.
  try {
    const { data: admins } = await admin
      .from('firm_members')
      .select('user_id, display_name, role')
      .eq('firm_id', firm.id)
      .in('role', ['owner', 'admin']);
    const link = '/counsel/access';
    const html = `<p>${escape(fullName)} (${escape(
      email,
    )}) requested access to <strong>${escape(
      firm.name,
    )}</strong>.</p><p>Review and approve or decline it here: <a href="${siteOrigin()}/counsel/access">${siteOrigin()}/counsel/access</a></p>`;
    for (const a of (admins ?? []) as Array<{ user_id: string }>) {
      await createNotification({
        userId: a.user_id,
        type: 'system',
        title: 'New access request',
        body: `${fullName} (${email}) requested access to ${firm.name}.`,
        link,
      }).then(
        () => undefined,
        () => undefined,
      );
      try {
        const { data: au } = await admin.auth.admin.getUserById(
          a.user_id,
        );
        const to = au?.user?.email;
        if (to) {
          await sendEmail({
            to,
            subject: `Access request: ${fullName} - ${firm.name}`,
            fromName: firm.name,
            html,
          });
        }
      } catch {
        /* per-admin email best-effort */
      }
    }
  } catch {
    /* notification is best-effort; the request is already queued */
  }

  return {
    ok: true,
    kind: 'external',
    message: `Your request to join ${firm.name} has been sent to their legal team for approval. You'll get an email once it's reviewed.`,
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function callerCanReview(
  firmId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only firm owners and admins can do this.' };
  }
  return { ok: true, userId: user.id };
}

export async function approveAccessRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data: reqRow } = await admin
    .from('firm_signup_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  const req = reqRow as SignupRequestRow | null;
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status !== 'pending') {
    return { ok: false, error: 'This request was already reviewed.' };
  }
  const gate = await callerCanReview(req.firm_id);
  if (!gate.ok) return { ok: false, error: gate.error };

  // External accounts get the core request loop only - no internal,
  // employee-centred surfaces. role_key 'external' resolves to no
  // custom role, so resolveEntitlements() returns the safe default.
  const { error: empErr } = await admin.from('firm_employees').insert({
    firm_id: req.firm_id,
    user_id: null,
    email: req.email.toLowerCase(),
    display_name: req.full_name,
    source: 'manual',
    role_key: 'external',
  });
  if (
    empErr &&
    !String(empErr.message ?? '')
      .toLowerCase()
      .includes('duplicate')
  ) {
    return { ok: false, error: 'Could not provision the account.' };
  }
  await admin
    .from('firm_signup_requests')
    .update({
      status: 'approved',
      reviewed_by: gate.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  // Tell the requester they can now sign in.
  try {
    const { data: firmRow } = await admin
      .from('firms')
      .select('name')
      .eq('id', req.firm_id)
      .maybeSingle();
    const firmName = (firmRow as { name?: string } | null)?.name ?? 'your organization';
    await sendEmail({
      to: req.email,
      subject: `You're approved - ${firmName}`,
      fromName: firmName,
      html: `<p>Good news - your access to <strong>${escape(
        firmName,
      )}</strong> was approved.</p><p>Sign in with <strong>${escape(
        req.email,
      )}</strong> to open your hub: <a href="${siteOrigin()}/sign-in?next=/portal">${siteOrigin()}/sign-in</a></p>`,
    });
  } catch {
    /* best-effort */
  }
  revalidatePath('/counsel/access');
  return { ok: true };
}

export async function denyAccessRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data: reqRow } = await admin
    .from('firm_signup_requests')
    .select('firm_id, status')
    .eq('id', requestId)
    .maybeSingle();
  const req = reqRow as { firm_id: string; status: string } | null;
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status !== 'pending') {
    return { ok: false, error: 'This request was already reviewed.' };
  }
  const gate = await callerCanReview(req.firm_id);
  if (!gate.ok) return { ok: false, error: gate.error };
  await admin
    .from('firm_signup_requests')
    .update({
      status: 'denied',
      reviewed_by: gate.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  revalidatePath('/counsel/access');
  return { ok: true };
}
