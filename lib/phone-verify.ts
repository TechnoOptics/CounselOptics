/**
 * Twilio Verify helper for phone-number verification (OTP), used by the
 * Community Case organizer-eligibility gate. This is a distinct Twilio
 * product from lib/sms.ts's raw Messages API (which Safe Witness uses for
 * outbound alerts) - Verify manages code generation, expiry, and attempt
 * limits server-side on Twilio's end, so we never store or compare a code
 * ourselves.
 *
 * Env-gated like lib/sms.ts: reuses the existing TWILIO_ACCOUNT_SID /
 * TWILIO_AUTH_TOKEN, plus one new var, TWILIO_VERIFY_SERVICE_SID (create a
 * Verify Service in the Twilio console - it's a different resource from a
 * phone number or Messaging Service SID). When not configured,
 * isPhoneVerifyConfigured() returns false and callers should surface a
 * "verification unavailable" state rather than crash.
 */

export type StartVerificationResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

export type CheckVerificationResult =
  | { ok: true; approved: boolean }
  | { ok: false; error: string };

function isE164(s: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(s);
}

export function isPhoneVerifyConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_VERIFY_SERVICE_SID?.trim(),
  );
}

function authHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

export async function startPhoneVerification(phone: string): Promise<StartVerificationResult> {
  if (!isPhoneVerifyConfigured()) {
    return { ok: false, error: 'phone-verify-not-configured' };
  }
  const to = phone.trim();
  if (!isE164(to)) {
    return { ok: false, error: `phone must be E.164 (+CountryNNN), got: ${to}` };
  }
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!.trim();
  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, Channel: 'sms' }).toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { status?: string };
    return { ok: true, status: json.status ?? 'pending' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'verification-start-failed' };
  }
}

export async function checkPhoneVerification(phone: string, code: string): Promise<CheckVerificationResult> {
  if (!isPhoneVerifyConfigured()) {
    return { ok: false, error: 'phone-verify-not-configured' };
  }
  const to = phone.trim();
  if (!isE164(to)) {
    return { ok: false, error: `phone must be E.164 (+CountryNNN), got: ${to}` };
  }
  const trimmedCode = code.trim();
  if (!/^\d{4,10}$/.test(trimmedCode)) {
    return { ok: false, error: 'Enter the code exactly as sent.' };
  }
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!.trim();
  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, Code: trimmedCode }).toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { status?: string };
    return { ok: true, approved: json.status === 'approved' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'verification-check-failed' };
  }
}
