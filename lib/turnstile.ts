/**
 * Cloudflare Turnstile server-side verification.
 *
 * Env-gated like lib/sms.ts: when TURNSTILE_SECRET_KEY is not set,
 * verification is skipped (returns ok: true) rather than blocking every
 * submission - this keeps local/dev/preview environments usable without
 * the secret configured, while production (where the env var is set)
 * gets real bot mitigation.
 */

export type TurnstileResult = { ok: true } | { ok: false; error: string };

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return { ok: true };
  }
  if (!token) {
    return { ok: false, error: 'Please complete the verification challenge.' };
  }

  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      return { ok: false, error: 'Could not verify the challenge. Please try again.' };
    }
    const json = (await res.json()) as { success?: boolean };
    if (!json.success) {
      return { ok: false, error: 'Verification failed. Please try again.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not verify the challenge. Please try again.' };
  }
}
