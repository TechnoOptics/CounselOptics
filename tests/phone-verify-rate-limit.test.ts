import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * startPhoneVerificationAction sends an SMS, on our Twilio bill, to whatever
 * number it is handed. Being signed in was the only thing in the way, so one
 * account could walk a list of numbers, and a pile of accounts could be
 * pointed at one person's phone.
 *
 * As with the other security buckets, checkRateLimit is NOT mocked here. The
 * real limiter runs against a fake `check_rate_limit` RPC that counts per key,
 * so these tests exercise the actual call site and the actual fail mode.
 *
 * Neighbouring gates are held open on purpose: the caller is signed in, Twilio
 * reads as configured, and the send itself succeeds. If a cap failed to fire,
 * the action would return ok and `sms.sent` would tick up, so every assertion
 * below distinguishes "the cap refused" from "something else refused".
 */

const state = vi.hoisted(() => ({
  storeDown: false,
  counts: new Map<string, number>(),
  userId: 'user-1',
  sent: [] as string[],
  reset() {
    this.storeDown = false;
    this.counts = new Map<string, number>();
    this.userId = 'user-1';
    this.sent = [];
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    // Stands in for the check_rate_limit SQL function: count this key, say
    // whether it is still inside its limit.
    rpc: async (
      _fn: string,
      args: { p_key: string; p_limit: number; p_window_seconds: number },
    ) => {
      if (state.storeDown) {
        return { data: null, error: { message: 'rate limit store is unreachable' } };
      }
      const next = (state.counts.get(args.p_key) ?? 0) + 1;
      state.counts.set(args.p_key, next);
      return { data: next <= args.p_limit, error: null };
    },
  }),
  isServiceRoleConfigured: () => true,
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: state.userId }),
  createServerSupabase: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));

vi.mock('@/lib/phone-verify', () => ({
  isPhoneVerifyConfigured: () => true,
  startPhoneVerification: async (phone: string) => {
    state.sent.push(phone);
    return { ok: true as const, status: 'pending' };
  },
  checkPhoneVerification: async () => ({ ok: true as const, approved: true }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { startPhoneVerificationAction } = await import('@/lib/phone-verify-actions');

const TOO_MANY =
  'Too many codes requested for that number. Wait a few minutes, then try again.';

beforeEach(() => {
  state.reset();
});

describe('the phone verification send is capped', () => {
  it('sends for a normal first request, so the cap is not simply refusing everything', async () => {
    const res = await startPhoneVerificationAction('+15551230001');
    expect(res).toEqual({ ok: true });
    expect(state.sent).toEqual(['+15551230001']);
  });

  it('stops one caller from walking a list of numbers', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await startPhoneVerificationAction(`+1555123000${i}`);
      expect(res).toEqual({ ok: true });
    }
    // Sixth distinct number from the same account: only the per-caller bucket
    // can catch this, since every number bucket is still on its first use.
    const res = await startPhoneVerificationAction('+15559999999');
    expect(res).toEqual({ ok: false, error: TOO_MANY });
    expect(state.sent).toHaveLength(5);
    expect(state.sent).not.toContain('+15559999999');
  });

  it('stops a pile of accounts from being pointed at one number', async () => {
    const victim = '+15557654321';
    for (let i = 0; i < 5; i += 1) {
      state.userId = `user-${i}`;
      const res = await startPhoneVerificationAction(victim);
      expect(res).toEqual({ ok: true });
    }
    // Sixth account, never seen before, so its own caller bucket is empty.
    // Only the per-number bucket can catch this one.
    state.userId = 'user-brand-new';
    const res = await startPhoneVerificationAction(victim);
    expect(res).toEqual({ ok: false, error: TOO_MANY });
    expect(state.sent).toHaveLength(5);
  });

  it('refuses rather than sending when the limiter store is down', async () => {
    state.storeDown = true;
    const res = await startPhoneVerificationAction('+15551230001');
    expect(res).toEqual({ ok: false, error: TOO_MANY });
    expect(state.sent).toHaveLength(0);
  });

  it('says the same thing whichever cap ran out, so the refusal names nobody', async () => {
    const victim = '+15550001111';
    for (let i = 0; i < 5; i += 1) {
      state.userId = `user-${i}`;
      await startPhoneVerificationAction(victim);
    }
    state.userId = 'user-brand-new';
    const byNumber = await startPhoneVerificationAction(victim);

    state.reset();
    for (let i = 0; i < 5; i += 1) {
      await startPhoneVerificationAction(`+1555123000${i}`);
    }
    const byCaller = await startPhoneVerificationAction('+15558888888');

    expect(byNumber).toEqual(byCaller);
  });
});
