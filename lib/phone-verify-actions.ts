'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { startPhoneVerification, checkPhoneVerification, isPhoneVerifyConfigured } from './phone-verify';

export type PhoneVerifyActionResult = { ok: boolean; error?: string };

/** Step 1: send a one-time code to the given phone number via SMS. Does
 * NOT persist the number yet - that happens only after the code checks
 * out, in confirmPhoneVerificationCodeAction, so an unverified number a
 * user mistypes never lands in profiles. */
export async function startPhoneVerificationAction(phone: string): Promise<PhoneVerifyActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };
  if (!isPhoneVerifyConfigured()) {
    return { ok: false, error: 'Phone verification is not available right now.' };
  }
  const result = await startPhoneVerification(phone);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

/** Step 2: check the code and, if approved, record the verified phone
 * number and timestamp on the caller's own profile row. */
export async function confirmPhoneVerificationCodeAction(
  phone: string,
  code: string,
): Promise<PhoneVerifyActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };
  if (!isPhoneVerifyConfigured()) {
    return { ok: false, error: 'Phone verification is not available right now.' };
  }
  const result = await checkPhoneVerification(phone, code);
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.approved) return { ok: false, error: 'That code is incorrect or expired.' };

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ phone_number: phone.trim(), phone_verified_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  return { ok: true };
}
