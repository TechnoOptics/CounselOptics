'use server';

import { headers } from 'next/headers';
import { createAdminSupabase } from './supabase/admin';
import { checkRateLimit } from './rate-limit';
import { sendEmail, buildSignInCodeEmailHtml } from './email';

/**
 * App-owned, BRANDED sign-in code.
 *
 * When a user picks "Email me a sign-in code" on /sign-in we would otherwise
 * rely on Supabase's built-in (unbranded) magic-link email. Instead, for an
 * EXISTING account we mint the one-time code ourselves with the admin
 * `generateLink` API (which returns the same `email_otp` Supabase's own email
 * would carry, WITHOUT sending anything) and deliver it through our premium
 * Resend template (lib/email.ts `buildSignInCodeEmailHtml`). The user then types
 * the code, and the existing `verifyOtp({ type: 'email' })` path verifies it
 * exactly as before.
 *
 * FAIL-SAFE: this never becomes a way to break sign-in. If anything goes wrong -
 * no admin client, the account doesn't exist yet (new signup), generateLink
 * fails, or the branded send fails - we return `{ fallback: true }` and the
 * client falls back to Supabase's own `signInWithOtp` (its plain email). So the
 * worst case is the old, unbranded-but-working email; the code path is additive.
 *
 * KNOWN, UNFIXED: `delivered` vs `fallback` is an account-existence oracle.
 * `generateLink({ type: 'magiclink' })` only resolves for an account that
 * already exists, so a caller who reads which of the two comes back learns
 * whether an address is registered, one address at a time. The IP bucket below
 * is what currently makes walking a list slow; it is a cap, not a fix.
 *
 * It is deliberately still here. The two outcomes are not cosmetic - they pick
 * which of two different sends happens, and the fallback is the ONLY path that
 * creates the account for a brand new user, via the browser's own
 * `signInWithOtp({ shouldCreateUser: true })`. Collapsing them to one response
 * means the server has to own both sends, which moves account creation and the
 * magic link's PKCE verifier off the browser. That is a change to the signup
 * funnel, it cannot be verified without a real Supabase project and a real
 * mailbox, and getting it wrong breaks sign-in for every new user. See the
 * branch report for the two candidate designs; this needs a decision, not a
 * drive-by.
 */

export type SignInCodeResult =
  | { ok: true; delivered: true }
  | { ok: true; fallback: true }
  | { ok: false; error: string };

function clientIp(): string {
  const h = headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export async function requestSignInCode(rawEmail: string): Promise<SignInCodeResult> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  // Throttle by email and by IP so this custom path can't be used to blast
  // codes at a mailbox. Generous enough for a real person retrying.
  //
  // failClosed on both buckets. This is the sign-in surface, so it is exactly
  // the brute-force target the security-bucket mode in lib/rate-limit.ts
  // exists for: an attacker who can make the store error out must not be
  // handed an uncapped path to mint sign-in codes. The store being merely
  // unconfigured still allows (see checkRateLimit), so local dev sign-in is
  // unaffected.
  const ip = clientIp();
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimit(`auth:signin-code:email:${email}`, {
      limit: 4,
      windowSeconds: 300,
      failClosed: true,
    }),
    checkRateLimit(`auth:signin-code:ip:${ip}`, {
      limit: 12,
      windowSeconds: 300,
      failClosed: true,
    }),
  ]);
  if (!emailOk || !ipOk) {
    return {
      ok: false,
      error: 'Too many code requests. Wait a minute, then try again.',
    };
  }

  const admin = createAdminSupabase();
  if (!admin) return { ok: true, fallback: true };

  try {
    // magiclink only resolves for an EXISTING user. New signups fall back to
    // Supabase's own signInWithOtp (which creates the user + sends its email).
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const code = (data?.properties as { email_otp?: string } | undefined)?.email_otp;
    if (error || !code) return { ok: true, fallback: true };

    const sent = await sendEmail({
      to: email,
      // Pin the sender display name to Advottic so the code never appears to
      // come from "Supabase" (the built-in fallback path's sender). The address
      // stays the DKIM/DMARC-aligned invites@advottic.com.
      fromName: 'Advottic',
      subject: 'Your Advottic sign-in code',
      html: buildSignInCodeEmailHtml({ code }),
      text: `Your Advottic sign-in code is ${code}. Enter it on the sign-in screen. It expires in 60 minutes and can be used once. If you didn't request it, you can ignore this email.`,
    });
    if (!sent.ok) return { ok: true, fallback: true };
    return { ok: true, delivered: true };
  } catch {
    return { ok: true, fallback: true };
  }
}
