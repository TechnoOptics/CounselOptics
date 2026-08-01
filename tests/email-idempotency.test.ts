import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail, invoiceEmailIdempotencyKey } from '../lib/email';

/**
 * sendEmail aborts at 8 seconds. A provider that accepts the message but
 * answers slowly is indistinguishable, from here, from one that never got
 * it: the call reports ok:false, sendInvoiceAction rolls the invoice back
 * to draft, and the firm sends again. The client then has two copies of
 * the same bill in their inbox.
 *
 * A provider-side idempotency key closes that: Resend replays the original
 * response for a repeated key instead of sending a second message, so the
 * retry succeeds without the client seeing anything twice.
 */

type Captured = { headers: Record<string, string>; body: Record<string, unknown> };

const calls: Captured[] = [];

beforeEach(() => {
  calls.length = 0;
  process.env.RESEND_API_KEY = 're_test_fake';
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    calls.push({
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe('sendEmail idempotency key', () => {
  it('passes the key to the provider so a retry is not a second send', async () => {
    const res = await sendEmail({
      to: 'client@example.com',
      subject: 'Invoice INV-00001',
      html: '<p>invoice</p>',
      idempotencyKey: 'invoice-inv-1-abc',
    });

    expect(res.ok).toBe(true);
    expect(calls[0].headers['Idempotency-Key']).toBe('invoice-inv-1-abc');
  });

  it('sends no key when the caller does not ask for one', async () => {
    // Most mail is genuinely re-sendable (a second invite, a second
    // reminder). Only the callers that mean "this exact message, once"
    // should be deduped.
    await sendEmail({
      to: 'client@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });

    expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
  });
});

describe('invoiceEmailIdempotencyKey', () => {
  it('is stable across a retry of the same bill to the same client', async () => {
    const first = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'client@example.com',
    });
    const retry = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'client@example.com',
    });

    expect(first).toBe(retry);
  });

  it('changes when the firm corrects the client address', async () => {
    // The usual reason a firm sends the same invoice twice is that the
    // first address was wrong. That is a real second send and must not be
    // suppressed - the key has to move with the recipient.
    const wrong = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'typo@example.com',
    });
    const corrected = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'client@example.com',
    });

    expect(wrong).not.toBe(corrected);
  });

  it('changes when the amount changes', async () => {
    // A draft is editable. If the total moved between attempts, the client
    // is owed the corrected bill, not a replay of the old one.
    const before = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'client@example.com',
    });
    const after = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 52000,
      clientEmail: 'client@example.com',
    });

    expect(before).not.toBe(after);
  });

  it('fits inside the provider key length limit', async () => {
    const key = invoiceEmailIdempotencyKey({
      invoiceId: 'inv-1',
      totalCents: 45000,
      clientEmail: 'a'.repeat(300) + '@example.com',
    });

    expect(key.length).toBeLessThanOrEqual(256);
  });
});
