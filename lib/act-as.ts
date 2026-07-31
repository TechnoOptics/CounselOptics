import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies, headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from './supabase/server';
import { cookieDomainForHost } from './supabase/cookie-domain';

/**
 * "Act as" overlay for HQ admin support ("Sign in as user" / "View as owner").
 *
 * The old approach signed the admin in AS the target via a magic link. Because
 * Supabase's session cookie is shared across the whole `.advottic.com` domain,
 * that OVERWROTE the admin's own session (so every tab became the target) and
 * ending it signed everyone out. You cannot hold two Supabase logins in one
 * browser.
 *
 * This overlay avoids the collision entirely: the admin keeps their real
 * session cookie untouched. A SEPARATE, signed, HTTP-only cookie (`adv_act_as`)
 * carries a freshly-minted target ACCESS TOKEN. lib/supabase/server.ts, when it
 * sees a valid overlay, builds the request's user-scoped Supabase client with
 * the target's token instead of the admin's cookie, so the whole app renders
 * as the target (RLS returns their rows, getCurrentUser() returns them). Ending
 * just deletes this one cookie; the admin is instantly back, no logout.
 *
 * Safety: the overlay is honoured ONLY when the cookie's HMAC signature (keyed
 * by the service-role secret, which only the server knows) verifies AND it
 * hasn't expired. The cookie is HTTP-only and set solely by the admin-gated
 * impersonate route, so a non-admin can neither read nor forge it. Every reader
 * fails CLOSED: any problem → the overlay is treated as absent and normal auth
 * proceeds unchanged.
 */

export const ACT_AS_COOKIE = 'adv_act_as';
// Post-mint ceiling. Supabase access tokens live ~1h; we cap the overlay to the
// same window so a stale token simply deactivates the overlay (fail-safe).
const MAX_TTL_MS = 60 * 60 * 1000;

type ActAsEnvelope = {
  /** Target user being acted as. */
  t: string;
  /** Admin who started it (audit / restore). */
  a: string;
  /** Target email (banner display). */
  e: string;
  /** Absolute expiry, ms epoch. */
  x: number;
  /** Target access token (JWT) used to authorize DB reads as the target. */
  tok: string;
};

export type ActAsState = {
  targetUserId: string;
  adminUserId: string;
  targetEmail: string;
  accessToken: string;
  expiresAt: number;
};

function signingSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function encode(env: ActAsEnvelope, secret: string): string {
  const payload = Buffer.from(JSON.stringify(env), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function decode(raw: string, secret: string): ActAsEnvelope | null {
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload, secret);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ActAsEnvelope;
  } catch {
    return null;
  }
}

/**
 * Read + verify the active overlay, or null. Fails closed on ANY problem
 * (no cookie, bad signature, expired, misconfigured) so normal auth is never
 * affected. Synchronous so lib/supabase/server.ts can stay synchronous.
 */
export function readActAs(): ActAsState | null {
  try {
    const secret = signingSecret();
    if (!secret) return null;
    const raw = cookies().get(ACT_AS_COOKIE)?.value;
    if (!raw) return null;
    const env = decode(raw, secret);
    if (!env || !env.t || !env.tok) return null;
    if (typeof env.x !== 'number' || Date.now() >= env.x) return null;
    return {
      targetUserId: env.t,
      adminUserId: env.a,
      targetEmail: env.e,
      accessToken: env.tok,
      expiresAt: env.x,
    };
  } catch {
    return null;
  }
}

/** Set the overlay cookie (called from the admin-gated impersonate route). */
export function startActAs(input: {
  targetUserId: string;
  adminUserId: string;
  targetEmail: string;
  accessToken: string;
  /** Token expiry (ms epoch) from Supabase; clamped to MAX_TTL_MS. */
  tokenExpiresAt: number;
}): boolean {
  const secret = signingSecret();
  if (!secret) return false;
  const exp = Math.min(input.tokenExpiresAt, Date.now() + MAX_TTL_MS);
  const env: ActAsEnvelope = {
    t: input.targetUserId,
    a: input.adminUserId,
    e: input.targetEmail,
    x: exp,
    tok: input.accessToken,
  };
  const host = headers().get('host');
  const domain = cookieDomainForHost(host);
  cookies().set({
    name: ACT_AS_COOKIE,
    value: encode(env, secret),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor((exp - Date.now()) / 1000),
    ...(domain ? { domain } : {}),
  });
  return true;
}

/** Clear the overlay cookie, instantly restoring the admin's own session. */
export function stopActAs(): void {
  try {
    const host = headers().get('host');
    const domain = cookieDomainForHost(host);
    cookies().set({
      name: ACT_AS_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      ...(domain ? { domain } : {}),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Mint a real Supabase session for the target user, server-side, without any
 * browser round-trip: generate a magic-link token then verify it to exchange
 * for an access/refresh token pair. Returns null on failure.
 */
export async function mintTargetSession(
  email: string,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  const service = signingSecret();
  if (!url || !anon || !service) return null;
  try {
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const hashed = linkData?.properties?.hashed_token;
    if (linkErr || !hashed) return null;

    const anonClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: hashed,
    });
    const session = verifyData?.session;
    if (verifyErr || !session?.access_token) return null;
    const expiresAt = session.expires_at
      ? session.expires_at * 1000
      : Date.now() + MAX_TTL_MS;
    return { accessToken: session.access_token, expiresAt };
  } catch {
    return null;
  }
}
