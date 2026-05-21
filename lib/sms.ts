/**
 * Twilio SMS helper.
 *
 * Env-gated: when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
 * are NOT set, sendSms is a no-op that returns { ok: false,
 * error: 'sms-not-configured' }. The caller surfaces that as a
 * deliberate degraded state (e.g. Safe Witness sends email-only)
 * instead of crashing.
 *
 * Phone numbers must be in E.164 (+1XXXXXXXXXX). Anything else is
 * rejected upstream; we don't try to normalize here because a wrong
 * guess on country code is worse than a clean failure.
 */

export type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

function isE164(s: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(s);
}

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM?.trim(),
  );
}

export async function sendSms(input: {
  to: string;
  body: string;
}): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token || !from) {
    return { ok: false, error: 'sms-not-configured' };
  }
  const to = input.to.trim();
  if (!isE164(to)) {
    return { ok: false, error: `phone must be E.164 (+CountryNNN), got: ${to}` };
  }
  // Body cap: SMS providers split anything over ~1600 chars across
  // multiple segments, with each segment billed separately. Cap at
  // 1000 to keep cost predictable; Safe Witness is meant to be a
  // short "I need you" not a transcript.
  const body = input.body.slice(0, 1000);

  // Twilio REST API: POST application/x-www-form-urlencoded with
  // Basic auth (sid:token base64).
  //
  // TWILIO_FROM can be either:
  //   - a raw E.164 phone number (e.g. "+19528000086") -> sent via
  //     the `From` parameter, which is fine for trial accounts but
  //     gets carrier-rejected (warning 30034) for US A2P traffic
  //     unless the number is independently registered.
  //   - a Messaging Service SID (starts with "MG", followed by 32
  //     hex chars) -> sent via `MessagingServiceSid`. This is the
  //     A2P-compliant path: the service is linked to a registered
  //     10DLC campaign, so US carriers (T-Mobile, AT&T, Verizon)
  //     accept the message instead of dropping it.
  // We auto-detect which form was supplied so the env can be flipped
  // without a code change.
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const isMessagingServiceSid = /^MG[0-9a-f]{32}$/i.test(from);
  const form = isMessagingServiceSid
    ? new URLSearchParams({ MessagingServiceSid: from, To: to, Body: body })
    : new URLSearchParams({ From: from, To: to, Body: body });
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Twilio ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { sid?: string };
    return { ok: true, sid: json.sid ?? 'unknown' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'sms-send-failed',
    };
  }
}
