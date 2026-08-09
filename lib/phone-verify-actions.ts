'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { startPhoneVerification, checkPhoneVerification, isPhoneVerifyConfigured } from './phone-verify';
import { checkRateLimit } from './rate-limit';

export type PhoneVerifyActionResult = { ok: boolean; error?: string };

/**
 * One message for either cap. Which bucket ran out is not the caller's
 * business: if the per-number cap said so, telling them would confirm that
 * somebody else has been sending codes to that number.
 */
const TOO_MANY =
  'Too many codes requested for that number. Wait a few minutes, then try again.';

/** Step 1: send a one-time code to the given phone number via SMS. Does
 * NOT persist the number yet - that happens only after the code checks
 * out, in confirmPhoneVerificationCodeAction, so an unverified number a
 * user mistypes never lands in profiles.
 *
 * Being signed in was the only thing standing between a caller and an SMS
 * to any number on earth, billed to us. Two caps, because one alone leaves a
 * way through: per caller, so one account cannot walk a list of numbers, and
 * per destination number, so a pile of accounts cannot be pointed at one
 * person's phone. Both fail closed, since a limiter that gives up under load
 * on a surface that spends money and rings a stranger's phone is not a
 * limiter.
 *
 * Keyed on the trimmed number, which is exactly the string
 * startPhoneVerification will send to: it requires strict E.164, so a padded
 * variant that would dodge the key never sends at all. */
export async function startPhoneVerificationAction(phone: string): Promise<PhoneVerifyActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };
  if (!isPhoneVerifyConfigured()) {
    return { ok: false, error: 'Phone verification is not available right now.' };
  }

  const target = (phone ?? '').trim();
  const [callerOk, numberOk] = await Promise.all([
    checkRateLimit(`phone-verify:user:${user.id}`, {
      limit: 5,
      windowSeconds: 900,
      failClosed: true,
    }),
    checkRateLimit(`phone-verify:number:${target}`, {
      limit: 5,
      windowSeconds: 3600,
      failClosed: true,
    }),
  ]);
  if (!callerOk || !numberOk) return { ok: false, error: TOO_MANY };

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
  // The firm-side account page renders the same PhoneVerifyForm from the
  // same two columns, so it needs the same invalidation or a number the
  // attorney just verified keeps showing as unverified there.
  revalidatePath('/counsel/profile');
  return { ok: true };
}
