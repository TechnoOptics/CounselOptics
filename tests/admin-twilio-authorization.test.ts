import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';

/**
 * Who may spend money on Twilio and file the company's registration details.
 *
 * Both routes under app/api/admin/twilio gated on a Set of email addresses
 * written into the route file. An allowlist in source is stale the moment
 * anyone joins or leaves: it keeps granting access to an address after the
 * person behind it is gone, revoking HQ admin in the database does nothing to
 * it, and it is invisible to whoever manages admin access, who has no reason
 * to look inside a route handler. Both now use isCurrentUserAdmin, the HQ
 * axis, which reads profiles.is_admin.
 *
 * The stakes: buy-tf purchases a phone number on the company's Twilio account
 * on every call, and submit-tf-verification files the company's EIN and
 * business contact with Twilio. Neither is recoverable by refreshing a page.
 *
 * The fakes are held wide OPEN so only the gate can refuse. The caller is
 * always signed in, so the 401 branch can never be what answers; the Twilio
 * environment is fully configured, so the 503 branches cannot fire; and fetch
 * is stubbed with a working Twilio conversation, so a network failure cannot
 * masquerade as a refusal. Every refusal test asserts that fetch was never
 * called at all, which is the thing that actually matters.
 *
 * Mutations that turn them red, each applied and observed:
 *   - drop the isCurrentUserAdmin check from buy-tf: 3 red, its refusal test,
 *     "buys nothing", and the source guard.
 *   - drop it from submit-tf-verification: 3 red, the same shape.
 *   - reinstate the `new Set(['contact@advottic.com'])` allowlist in buy-tf:
 *     3 red, the address-collection guard, the HQ-axis guard, and the happy
 *     path, since the stubbed caller's address is not on the list.
 *   - invert the gate so it refuses everyone: 6 red, both happy paths
 *     included, so a guard that refuses everything does not pass.
 */

const h = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('@/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'someone@example.com' }),
  getRealCurrentUser: async () => ({ id: 'user-1' }),
  requireUser: async () => ({ id: 'user-1' }),
  isCurrentUserAdmin: async () => h.isAdmin,
  createServerSupabase: () => ({}),
}));

const buyTf = (await import('@/app/api/admin/twilio/buy-tf/route')).POST;
const submitTf = (
  await import('@/app/api/admin/twilio/submit-tf-verification/route')
).POST;

type TwilioRequest = Parameters<typeof buyTf>[0];

const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** Every URL the route handed to fetch. Empty means Twilio was never reached. */
let fetched: string[] = [];
const originalFetch = globalThis.fetch;

/** A Twilio that says yes to everything, so only the gate can refuse. */
function installTwilioStub() {
  fetched = [];
  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    fetched.push(href);
    const body = href.includes('AvailablePhoneNumbers')
      ? { available_phone_numbers: [{ phone_number: '+18005550100' }] }
      : { sid: 'PN00000000000000000000000000000000', phone_number: '+18005550100' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function jsonRequest(body: unknown): TwilioRequest {
  return {
    json: async () => body,
  } as unknown as TwilioRequest;
}

describe('app/api/admin/twilio authorization', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
    process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_FROM = 'MG00000000000000000000000000000000';
    h.isAdmin = true;
    installTwilioStub();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k] as string;
    }
    globalThis.fetch = originalFetch;
  });

  it('buy-tf refuses a signed-in non-admin', async () => {
    h.isAdmin = false;
    const res = await buyTf(jsonRequest({}));
    expect(res.status).toBe(403);
    // 403, not 401: the caller is signed in, so the sign-in branch is not
    // what answered.
    expect(await res.json()).toEqual({ error: 'Admin only.' });
  });

  it('buy-tf buys nothing for a non-admin', async () => {
    h.isAdmin = false;
    await buyTf(jsonRequest({}));
    // The refusal is worth nothing if the purchase already went out.
    expect(fetched).toEqual([]);
  });

  it('buy-tf still works for an HQ admin', async () => {
    h.isAdmin = true;
    const res = await buyTf(jsonRequest({}));
    expect(res.status).toBe(200);
    expect(fetched.some((u) => u.includes('AvailablePhoneNumbers'))).toBe(true);
    expect(fetched.some((u) => u.includes('IncomingPhoneNumbers'))).toBe(true);
  });

  it('submit-tf-verification refuses a signed-in non-admin', async () => {
    h.isAdmin = false;
    const res = await submitTf(
      jsonRequest({ phone_number_sid: 'PN00000000000000000000000000000000', ein: '123456789' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin only.' });
  });

  it('submit-tf-verification files nothing for a non-admin', async () => {
    h.isAdmin = false;
    await submitTf(
      jsonRequest({ phone_number_sid: 'PN00000000000000000000000000000000', ein: '123456789' }),
    );
    // The company EIN and business contact never leave the process.
    expect(fetched).toEqual([]);
  });

  it('submit-tf-verification still works for an HQ admin', async () => {
    h.isAdmin = true;
    const res = await submitTf(
      jsonRequest({ phone_number_sid: 'PN00000000000000000000000000000000', ein: '123456789' }),
    );
    expect(res.status).toBe(200);
    expect(fetched.some((u) => u.includes('Tollfree/Verifications'))).toBe(true);
  });
});

const ADMIN_API_DIR = fileURLToPath(new URL('../app/api/admin', import.meta.url));

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** An email address written as a string literal. */
const ADDRESS = String.raw`['"\`][^'"\`\s]+@[^'"\`\s]+\.[a-z]{2,}['"\`]`;

/**
 * A COLLECTION of addresses, which is what an allowlist is, as opposed to the
 * single addresses submit-tf-verification legitimately files with Twilio as
 * the business contact. Matches `new Set([...'a@b.com'...])` and
 * `const X = [...'a@b.com'...]`.
 */
const ADDRESS_COLLECTION = new RegExp(
  String.raw`(new Set\s*(<[^>]*>)?\s*\(\s*\[|=\s*\[)[^\]]*${ADDRESS}`,
  'i',
);

describe('no route handler carries its own admin allowlist', () => {
  it('no app/api/admin route decides access from a list of addresses', () => {
    // Deliberately NOT "every route must call isCurrentUserAdmin". Two do not
    // and are right not to: app/api/admin/impersonate reads profiles.is_admin
    // off the REAL session on purpose, because isCurrentUserAdmin honours an
    // act-as overlay and an active overlay must not bootstrap another one, and
    // impersonate/stop only clears the caller's own cookie. Asserting the
    // stronger rule would have to be relaxed for those, and a guard with
    // exceptions is one edit away from having one more.
    const offenders: string[] = [];
    for (const file of tsFilesUnder(ADMIN_API_DIR)) {
      // Comments go through the shared helper, so a comment explaining the old
      // allowlist cannot trip this and, in the direction that actually hurts,
      // a hand-rolled stripper cannot silently delete the code being looked
      // for. See tests/support/strip-comments.ts.
      const src = stripComments(readFileSync(file, 'utf8'));
      if (ADDRESS_COLLECTION.test(src)) {
        offenders.push(`${file}: address collection`);
      }
      if (/ADMIN_EMAILS|ALLOWED_EMAILS|ADMIN_ALLOWLIST/.test(src)) {
        offenders.push(`${file}: allowlist constant`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('both twilio routes name the HQ axis', () => {
    for (const leaf of ['buy-tf', 'submit-tf-verification']) {
      const src = stripComments(
        readFileSync(join(ADMIN_API_DIR, 'twilio', leaf, 'route.ts'), 'utf8'),
      );
      expect(src).toMatch(/isCurrentUserAdmin\(\)/);
    }
  });
});
