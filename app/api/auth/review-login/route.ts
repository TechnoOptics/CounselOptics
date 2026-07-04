import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from '@/lib/supabase/server';
import { cookieDomainForHost } from '@/lib/supabase/cookie-domain';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/review-login
 *
 * App-store-review sign-in bypass. Our consumer sign-in is OTP
 * email codes only (no password, no magic-link button), which an
 * App Store / Play reviewer can't complete because they can't read
 * the code emailed to a real inbox. This route lets a single,
 * designated reviewer account sign in with a FIXED code instead.
 *
 * Security model:
 *   - Only ONE email (REVIEW_EMAIL) is accepted, AND only with the
 *     exact REVIEW_CODE. Any other email or a wrong code is 401.
 *   - The review account is a sandbox user with zero real data; it
 *     sees the same empty-state UI any brand-new user would.
 *   - The fixed code can be rotated via the REVIEW_LOGIN_CODE env
 *     var without a code change.
 *
 * How the session is established without a password:
 *   1. Ensure the review user exists (admin createUser, idempotent).
 *   2. Mint a one-time magic-link token with the service-role admin
 *      client (generateLink).
 *   3. Verify that token server-side so Supabase issues real session
 *      cookies, which we attach to the JSON response. The browser
 *      then has a normal authenticated session.
 */
const REVIEW_EMAIL =
  process.env.REVIEW_LOGIN_EMAIL?.trim().toLowerCase() ||
  'appreview@advottic.com';
// 6-digit fixed code the reviewer types into the OTP field. Override
// in env to rotate. Only ever valid for REVIEW_EMAIL.
const REVIEW_CODE = process.env.REVIEW_LOGIN_CODE?.trim() || '478213';

export async function POST(req: NextRequest) {
  // A fixed, env-rotatable code is inherently brute-forceable if left
  // unthrottled - rate limit by IP before checking credentials at all.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  // Fail CLOSED: this is an auth code gate, so a store error must not
  // hand out an uncapped guessing window.
  const allowed = await checkRateLimit(`auth:review-login:${ip}`, {
    limit: 5,
    windowSeconds: 15 * 60,
    failClosed: true,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429 },
    );
  }

  let body: { email?: string; code?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body -> falls through to 401 */
  }
  const email = body.email?.trim().toLowerCase() ?? '';
  const code = body.code?.trim() ?? '';

  if (email !== REVIEW_EMAIL || code !== REVIEW_CODE) {
    return NextResponse.json(
      { error: 'Invalid review credentials.' },
      { status: 401 },
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const admin = createAdminSupabase();
  if (!supabaseUrl || !anonKey || !admin) {
    return NextResponse.json(
      { error: 'Auth is not configured for review login.' },
      { status: 503 },
    );
  }

  // 1. Ensure the review user exists. createUser is idempotent for
  //    our purposes: a duplicate just errors and we ignore it.
  await admin.auth.admin
    .createUser({
      email: REVIEW_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: 'App Reviewer', is_app_review: true },
    })
    .catch(() => {
      /* already exists - fine */
    });

  // 2. Mint a one-time magic-link token for the review user.
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: REVIEW_EMAIL,
    });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json(
      { error: linkErr?.message ?? 'Could not create review session.' },
      { status: 500 },
    );
  }

  // 3. Verify the token server-side so Supabase sets session cookies.
  //    Attach those cookies to the response we send back.
  const response = NextResponse.json({ ok: true });
  const cookieDomain = cookieDomainForHost(req.headers.get('host'));
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            ...(cookieDomain ? { domain: cookieDomain } : {}),
          });
        });
      },
    },
  });

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyErr) {
    return NextResponse.json(
      { error: verifyErr.message },
      { status: 500 },
    );
  }
  return response;
}
