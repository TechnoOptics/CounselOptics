'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Firm-provisioned, case-scoped GUEST accounts.
 *
 * A firm owner/admin mints a guest identity directly from a matter's People
 * panel: a login handle + a temporary password the guest must change on first
 * login. The identity is FIRM-OWNED and deliberately kept separate from any
 * personal Advottic account the same person might self-sign-up for - we mint a
 * synthetic, guest-namespaced email so it never merges with a real inbox.
 *
 * Everything here is service-role (the caller is not the case row owner) and
 * authorizes owner/admin of the matter's firm server-side. Reuses the existing
 * case_collaborators grant (role 'attorney') for the actual matter access, so
 * the guest resolves to the SAME 'counsel_guest' persona as an email-invited
 * co-counsel (lib/persona.ts, lib/counsel-guest.ts).
 */

// Guest logins live on their own namespace so they never collide with a real
// inbox and can never be reached by password reset to a personal address. Kept
// in sync with the same literal in app/guest-login/guest-login-form.tsx (a
// 'use server' module can only export async functions, so it can't be shared).
const GUEST_EMAIL_DOMAIN = 'guest.advottic.com';
const MIN_PASSWORD_LEN = 12;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/** Turn a firm-chosen base into a safe login handle stem. */
function slugHandle(base: string): string {
  const s = base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
  return s || 'guest';
}

/** A readable but strong temporary password (no ambiguous characters). */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i]! % alphabet.length];
  // Guarantee it satisfies any digit/letter policy.
  return `${out.slice(0, 6)}-${out.slice(6, 11)}-${out.slice(11)}`;
}

/** Caller is owner/admin of `firmId`. */
async function callerIsFirmAdmin(
  admin: AdminClient,
  firmId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

/**
 * Create a firm-owned guest for a matter. Returns the login handle + the
 * one-time temporary password (shown to the firm ONCE - never stored in
 * readable form; auth stores only the hash).
 */
export async function createFirmGuestAccountAction(
  caseId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  error?: string;
  username?: string;
  tempPassword?: string;
}> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (caseRow as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return { ok: false, error: 'Matter not found.' };
  if (!(await callerIsFirmAdmin(admin, firmId, user.id))) {
    return {
      ok: false,
      error: 'Only firm owners or admins can create guest accounts.',
    };
  }

  const displayName = String(formData.get('displayName') ?? '').trim().slice(0, 120);
  const base = String(formData.get('username') ?? '').trim() || displayName;
  if (!base) {
    return { ok: false, error: 'Enter a name or username for the guest.' };
  }

  // Build a globally-unique login handle so username + password is enough to
  // sign in (no firm slug needed). Retry a few times on the rare collision.
  const stem = slugHandle(base);
  let username = '';
  let email = '';
  let userId: string | null = null;
  const tempPassword = generateTempPassword();
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = randomBytes(2).toString('hex'); // 4 hex chars
    const candidate = `${stem}-${suffix}`;
    const candidateEmail = `${candidate}@${GUEST_EMAIL_DOMAIN}`;
    const created = await admin.auth.admin.createUser({
      email: candidateEmail,
      password: tempPassword,
      email_confirm: true, // password login, no verification email
      user_metadata: {
        full_name: displayName || candidate,
        is_firm_guest: true,
        firm_id: firmId,
      },
    });
    if (!created.error && created.data.user) {
      username = candidate;
      email = candidateEmail;
      userId = created.data.user.id;
      break;
    }
    // Email-already-exists => handle collision; try another suffix.
    if (!/already|exists|registered|duplicate/i.test(created.error?.message ?? '')) {
      return {
        ok: false,
        error: created.error?.message ?? 'Could not create the guest account.',
      };
    }
  }
  if (!userId) {
    return { ok: false, error: 'Could not allocate a unique username. Try again.' };
  }

  // Record the firm-owned guest identity (force-change on first login).
  const { error: guestErr } = await admin.from('firm_guest_accounts').insert({
    firm_id: firmId,
    user_id: userId,
    username,
    created_by: user.id,
    must_change_password: true,
  });
  if (guestErr) {
    // Roll back the orphaned auth user so a retry is clean.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return { ok: false, error: guestErr.message };
  }

  // Grant matter access via the shared collaborator system (role 'attorney' =
  // co-counsel), already linked to the new user and accepted.
  const { error: collabErr } = await admin.from('case_collaborators').upsert(
    {
      case_id: caseId,
      email,
      role: 'attorney',
      user_id: userId,
      invited_by: user.id,
      accepted_at: new Date().toISOString(),
    },
    { onConflict: 'case_id,email' },
  );
  if (collabErr) {
    return { ok: false, error: collabErr.message };
  }

  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true, username, tempPassword };
}

/**
 * Deactivate (or reactivate) a firm-owned guest. Deactivation cuts access
 * INSTANTLY - the persona resolver treats a deactivated guest as no-access on
 * the next request. Owner/admin of the guest's firm only.
 */
export async function setFirmGuestActiveAction(
  guestAccountId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: guestRow } = await admin
    .from('firm_guest_accounts')
    .select('id, firm_id')
    .eq('id', guestAccountId)
    .maybeSingle();
  const g = guestRow as { id: string; firm_id: string } | null;
  if (!g) return { ok: false, error: 'Guest not found.' };
  if (!(await callerIsFirmAdmin(admin, g.firm_id, user.id))) {
    return { ok: false, error: 'Not authorized to manage this guest.' };
  }

  const { error } = await admin
    .from('firm_guest_accounts')
    .update({
      deactivated_at: active ? null : new Date().toISOString(),
      deactivated_by: active ? null : user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', guestAccountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Self-service password change for a provisioned guest - the first-login
 * force-change flow. The guest is already authenticated (they signed in with
 * the temp password), so we set the new password on their own account and
 * clear the must_change_password flag. Refuses if the caller is not an active
 * provisioned guest.
 */
export async function setGuestPasswordAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: guestRow } = await admin
    .from('firm_guest_accounts')
    .select('id, deactivated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  const g = guestRow as { id: string; deactivated_at: string | null } | null;
  if (!g) return { ok: false, error: 'No guest account on this login.' };
  if (g.deactivated_at) return { ok: false, error: 'This guest account is inactive.' };

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < MIN_PASSWORD_LEN) {
    return {
      ok: false,
      error: `Choose a password of at least ${MIN_PASSWORD_LEN} characters.`,
    };
  }
  if (password !== confirm) {
    return { ok: false, error: 'The two passwords do not match.' };
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
    password,
  });
  if (updErr) return { ok: false, error: updErr.message };

  const { error: flagErr } = await admin
    .from('firm_guest_accounts')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', g.id);
  if (flagErr) return { ok: false, error: flagErr.message };

  return { ok: true };
}
