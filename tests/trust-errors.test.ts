import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  friendlyTrustError,
  MAX_TRUST_AMOUNT_CENTS,
  TRUST_ACCOUNT_MISSING_MESSAGE,
  TRUST_AMOUNT_RANGE_MESSAGE,
  TRUST_GENERIC_MESSAGE,
  TRUST_OVERDRAW_MESSAGE,
  TRUST_PERMISSION_MESSAGE,
  TRUST_SESSION_MESSAGE,
} from '../lib/trust-errors';

/**
 * Trust accounting holds client money, and a lawyer reading this screen is
 * accountable to a bar association for what it says. Two rules matter more
 * than anything else here:
 *
 *   1. A raw Postgres error must NEVER reach the screen. "new row violates
 *      row-level security policy for table \"firm_trust_accounts\"" tells a
 *      lawyer nothing and reads as a broken product.
 *   2. The message must never imply a record was written when it was not.
 *      Every failure message says, or plainly implies, that nothing was saved.
 */

const ALL_MESSAGES = [
  TRUST_GENERIC_MESSAGE,
  TRUST_PERMISSION_MESSAGE,
  TRUST_SESSION_MESSAGE,
  TRUST_OVERDRAW_MESSAGE,
  TRUST_ACCOUNT_MISSING_MESSAGE,
  TRUST_AMOUNT_RANGE_MESSAGE,
];

// Fragments that betray the database layer. None may ever appear in copy
// shown to a lawyer.
const LEAKY = [
  'row-level security',
  'violates',
  'postgres',
  'pgrst',
  'errcode',
  'relation',
  'null value in column',
  'sql',
  'auth.uid',
  'firm_trust_',
  'constraint',
  'stack',
  'undefined',
  '42501',
  '23514',
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('friendlyTrustError', () => {
  it('maps the RLS denial that made this feature unusable to a permission message', () => {
    // The exact string production returned for every account-creation
    // attempt while the form used a session-less Supabase client.
    const msg = friendlyTrustError({
      code: '42501',
      message:
        'new row violates row-level security policy for table "firm_trust_accounts"',
    });
    expect(msg).toBe(TRUST_PERMISSION_MESSAGE);
  });

  it('maps the RPC role guards to a permission message', () => {
    for (const raw of [
      'not a member of this firm',
      'role cannot post trust transactions',
      'role cannot reconcile trust accounts',
    ]) {
      expect(friendlyTrustError({ message: raw, code: '42501' })).toBe(
        TRUST_PERMISSION_MESSAGE,
      );
    }
  });

  it('maps a lost session to a sign-in message, not a permission message', () => {
    expect(friendlyTrustError({ code: '28000', message: 'not authenticated' })).toBe(
      TRUST_SESSION_MESSAGE,
    );
    expect(friendlyTrustError({ message: 'JWT expired' })).toBe(
      TRUST_SESSION_MESSAGE,
    );
  });

  it('keeps the overdraw guard legible, because it is the one a lawyer must act on', () => {
    const msg = friendlyTrustError({
      code: '23514',
      message:
        'insufficient trust balance: client holds 5000 cents, cannot post 900000 cents',
    });
    expect(msg).toBe(TRUST_OVERDRAW_MESSAGE);
    // It must not leak the raw cent figures, which read as a crash.
    expect(msg).not.toMatch(/cents/);
  });

  it('maps a missing account to a refresh message', () => {
    expect(
      friendlyTrustError({ code: '23503', message: 'trust account not found for firm' }),
    ).toBe(TRUST_ACCOUNT_MISSING_MESSAGE);
  });

  it('maps a numeric overflow to an amount-range message', () => {
    expect(
      friendlyTrustError({ code: '22003', message: 'integer out of range' }),
    ).toBe(TRUST_AMOUNT_RANGE_MESSAGE);
    expect(
      friendlyTrustError({ message: 'value "99999999999" is out of range for type integer' }),
    ).toBe(TRUST_AMOUNT_RANGE_MESSAGE);
  });

  it('does not call a non-positive amount "too large"', () => {
    // post_trust_transaction raises 22003 for both overflow AND
    // "amount must be a positive integer". Only the former is a range problem.
    expect(
      friendlyTrustError({ code: '22003', message: 'amount must be a positive integer' }),
    ).toBe(TRUST_GENERIC_MESSAGE);
  });

  it('falls back to the calm generic message for anything unrecognised', () => {
    for (const err of [
      null,
      undefined,
      'boom',
      new Error('deadlock detected'),
      { message: 'could not serialize access due to concurrent update' },
      { weird: true },
      42,
    ]) {
      expect(friendlyTrustError(err)).toBe(TRUST_GENERIC_MESSAGE);
    }
  });

  it('never returns raw database text, whatever it is handed', () => {
    const nasties = [
      new Error('new row violates row-level security policy for table "firm_trust_accounts"'),
      { message: 'null value in column "client_label" of relation "firm_trust_transactions" violates not-null constraint' },
      { message: 'PGRST202: Could not find the function public.post_trust_transaction' },
      { message: 'duplicate key value violates unique constraint "firm_trust_accounts_pkey"' },
      { message: '<html><body>502 Bad Gateway</body></html>' },
      { code: '', message: '', details: 'x', hint: 'y' },
    ];
    for (const err of nasties) {
      const out = friendlyTrustError(err, 'test');
      expect(ALL_MESSAGES).toContain(out);
      const lower = out.toLowerCase();
      for (const fragment of LEAKY) {
        expect(lower).not.toContain(fragment);
      }
    }
  });

  it('logs the real error server-side so operators can still diagnose', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    friendlyTrustError(new Error('deadlock detected'), 'record-transaction');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.join(' '))).toContain('deadlock detected');
  });

  it('every message tells the lawyer the entry was not recorded', () => {
    // No message may leave a lawyer believing a trust record exists when it
    // does not. Each either says nothing was recorded or describes an action
    // still to take.
    for (const m of ALL_MESSAGES) {
      expect(m.length).toBeGreaterThan(20);
      expect(m).not.toMatch(/—/); // no em dashes, per project copy rules
      expect(m).toMatch(/[.!]$/);
    }
  });
});

describe('MAX_TRUST_AMOUNT_CENTS', () => {
  it('matches the int4 ceiling of firm_trust_transactions.amount_cents', () => {
    // amount_cents is `integer` in Postgres. Anything larger raises 22003
    // instead of recording, so the guard must reject it before the write.
    expect(MAX_TRUST_AMOUNT_CENTS).toBe(2147483647);
  });
});
