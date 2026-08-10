import { describe, expect, it } from 'vitest';
import {
  markHandoffQrUrl,
  markHandoffRefusal,
  markHandoffState,
  mintMarkHandoff,
  MARK_HANDOFF_REFUSAL_DONE,
  MARK_HANDOFF_REFUSAL_UNAVAILABLE,
  MARK_MINT_REFUSAL_NO_TEMPLATE,
  MARK_MINT_REFUSAL_PHONE_NOT_ALLOWED,
  MARK_MINT_REFUSAL_UNAVAILABLE,
  type MintMarkHandoffDeps,
  type MarkHandoffRow,
} from '../lib/mark-handoff';
import { hashHandoffToken, HANDOFF_SESSION_MINUTES } from '../lib/signing-handoff';

/**
 * The employee's phone handoff, down every refusal.
 *
 * Nothing here touches a database. mintMarkHandoff takes its template lookup,
 * its insert and its QR encoder as arguments precisely so the guards in front
 * of a public endpoint can be exercised without one.
 *
 * The state machine is lib/signing-handoff.ts and is tested in
 * tests/signing-handoff.test.ts. What is checked here is that this module
 * really delegates to it rather than restating it, which is the only reason
 * the two windows and the cookie binding can be claimed for this path too.
 */

const T0 = new Date('2026-08-10T12:00:00.000Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function row(over: Partial<MarkHandoffRow> = {}): MarkHandoffRow {
  return {
    sessionHash: null,
    createdAt: T0,
    expiresAt: minutes(15),
    consumedAt: null,
    markAt: null,
    ...over,
  };
}

describe('markHandoffState', () => {
  it('is claimable before anyone scans it', () => {
    expect(markHandoffState(row(), minutes(1), null)).toBe('claimable');
  });

  it('expires unscanned at the absolute deadline', () => {
    expect(markHandoffState(row(), minutes(16), null)).toBe('expired');
  });

  /** The property the whole feature rests on: the token burns on use. */
  it('is consumed for a device that did not scan it', () => {
    const scanned = row({ consumedAt: minutes(1), sessionHash: hashHandoffToken('a') });
    expect(markHandoffState(scanned, minutes(2), null)).toBe('consumed');
    expect(markHandoffState(scanned, minutes(2), 'someone-else')).toBe('consumed');
  });

  /** The other one: the cookie is what tells the scanning phone apart. */
  it('is bound for the device holding the cookie it was issued', () => {
    const scanned = row({ consumedAt: minutes(1), sessionHash: hashHandoffToken('a') });
    expect(markHandoffState(scanned, minutes(2), 'a')).toBe('bound');
  });

  it('closes the session window the scan opened', () => {
    const scanned = row({ consumedAt: minutes(1), sessionHash: hashHandoffToken('a') });
    expect(
      markHandoffState(scanned, minutes(1 + HANDOFF_SESSION_MINUTES + 1), 'a'),
    ).toBe('expired');
  });

  it('is over once the mark has come back, whoever asks', () => {
    const done = row({
      consumedAt: minutes(1),
      sessionHash: hashHandoffToken('a'),
      markAt: minutes(2),
    });
    expect(markHandoffState(done, minutes(3), 'a')).toBe('already-signed');
  });
});

describe('markHandoffRefusal', () => {
  it('says the same thing for a used, an expired and a stranger code', () => {
    expect(markHandoffRefusal('consumed')).toBe(MARK_HANDOFF_REFUSAL_UNAVAILABLE);
    expect(markHandoffRefusal('expired')).toBe(MARK_HANDOFF_REFUSAL_UNAVAILABLE);
    // Neither should reach it, and a bug in a credential path refuses.
    expect(markHandoffRefusal('claimable')).toBe(MARK_HANDOFF_REFUSAL_UNAVAILABLE);
    expect(markHandoffRefusal('bound')).toBe(MARK_HANDOFF_REFUSAL_UNAVAILABLE);
  });

  it('tells the employee plainly when their own mark already went across', () => {
    expect(markHandoffRefusal('already-signed')).toBe(MARK_HANDOFF_REFUSAL_DONE);
  });
});

describe('markHandoffQrUrl', () => {
  it('builds an absolute address outside the signed-in shell', () => {
    expect(markHandoffQrUrl('https://advottic.com', 'tok')).toBe(
      'https://advottic.com/sign/mark/tok',
    );
  });

  it('keeps a deployment served under a path', () => {
    expect(markHandoffQrUrl('https://x.test/app/', 'tok')).toBe(
      'https://x.test/app/sign/mark/tok',
    );
  });

  it('encodes the token rather than pasting it in', () => {
    expect(markHandoffQrUrl('https://x.test', 'a/b')).toBe(
      'https://x.test/sign/mark/a%2Fb',
    );
  });

  /** A relative QR is not a degraded QR, it is a web search. */
  it('throws rather than guessing at a relative origin', () => {
    expect(() => markHandoffQrUrl('/app', 'tok')).toThrow();
    expect(() => markHandoffQrUrl('ftp://x.test', 'tok')).toThrow();
  });

  it('throws without a token', () => {
    expect(() => markHandoffQrUrl('https://x.test', '  ')).toThrow();
  });
});

function deps(over: Partial<MintMarkHandoffDeps> = {}): MintMarkHandoffDeps {
  return {
    origin: 'https://advottic.com',
    loadTemplate: async () => ({ id: 't1', name: 'NDA', signatureMethods: null }),
    createHandoff: async () => ({ ok: true, rawToken: 'raw', handoffId: 'h1' }),
    encode: (url) => `<svg data-url="${url}"></svg>`,
    ...over,
  };
}

describe('mintMarkHandoff', () => {
  it('mints for an unrestricted template', async () => {
    const res = await mintMarkHandoff('t1', deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.handoffId).toBe('h1');
    expect(res.svg).toContain('https://advottic.com/sign/mark/raw');
    expect(res.expiresInSeconds).toBe(15 * 60);
  });

  it('mints when the firm named the phone among the methods it accepts', async () => {
    const res = await mintMarkHandoff(
      't1',
      deps({
        loadTemplate: async () => ({
          id: 't1',
          name: 'NDA',
          signatureMethods: ['type', 'phone'],
        }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  /**
   * The restriction, honoured before the employee walks to another room. The
   * submission gate refuses this too; this is the courtesy in front of it.
   */
  it('refuses when the firm forbade the phone', async () => {
    const res = await mintMarkHandoff(
      't1',
      deps({
        loadTemplate: async () => ({
          id: 't1',
          name: 'NDA',
          signatureMethods: ['draw', 'type'],
        }),
      }),
    );
    expect(res).toEqual({ ok: false, error: MARK_MINT_REFUSAL_PHONE_NOT_ALLOWED });
  });

  /**
   * A column the database does not have yet is not a restriction.
   * 20260814_signature_methods.sql is unapplied, and an adapter that cannot
   * read the column must not refuse every handoff in the product.
   */
  it('treats an unreadable restriction as no restriction', async () => {
    const res = await mintMarkHandoff(
      't1',
      deps({ loadTemplate: async () => ({ id: 't1', name: 'NDA' }) }),
    );
    expect(res.ok).toBe(true);
  });

  it('refuses a template the caller may not reach', async () => {
    const res = await mintMarkHandoff('t1', deps({ loadTemplate: async () => null }));
    expect(res).toEqual({ ok: false, error: MARK_MINT_REFUSAL_NO_TEMPLATE });
  });

  it('refuses an empty or non-string template id without a lookup', async () => {
    let looked = 0;
    const d = deps({
      loadTemplate: async () => {
        looked += 1;
        return { id: 't1', name: 'NDA', signatureMethods: null };
      },
    });
    expect(await mintMarkHandoff('   ', d)).toEqual({
      ok: false,
      error: MARK_MINT_REFUSAL_NO_TEMPLATE,
    });
    expect(await mintMarkHandoff({ id: 't1' }, d)).toEqual({
      ok: false,
      error: MARK_MINT_REFUSAL_NO_TEMPLATE,
    });
    expect(looked).toBe(0);
  });

  /** PostgREST resolves with { error } rather than throwing, so a failed
   *  insert has to become a refusal and not a QR nothing will match. */
  it('refuses when the row could not be written', async () => {
    const res = await mintMarkHandoff(
      't1',
      deps({ createHandoff: async () => ({ ok: false }) }),
    );
    expect(res).toEqual({ ok: false, error: MARK_MINT_REFUSAL_UNAVAILABLE });
  });

  it('refuses rather than showing a broken image when the origin is unusable', async () => {
    const res = await mintMarkHandoff('t1', deps({ origin: 'not-a-url' }));
    expect(res).toEqual({ ok: false, error: MARK_MINT_REFUSAL_UNAVAILABLE });
  });

  /** The id the QR carries is the handoff token and never anything else. */
  it('encodes only the handoff token', async () => {
    const res = await mintMarkHandoff(
      'template-uuid',
      deps({
        createHandoff: async () => ({
          ok: true,
          rawToken: 'handoff-secret',
          handoffId: 'row-uuid',
        }),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.svg).toContain('handoff-secret');
    expect(res.svg).not.toContain('template-uuid');
    expect(res.svg).not.toContain('row-uuid');
  });

  /** The lookup is the adapter's and is scoped to the session's own firm, so
   *  the id that reaches it is the one the caller sent and nothing else is. */
  it('passes the caller id to the lookup and the looked-up id onward', async () => {
    const seen: string[] = [];
    await mintMarkHandoff(
      '  t1  ',
      deps({
        loadTemplate: async (id) => {
          seen.push(`load:${id}`);
          return { id: 'canonical', name: 'NDA', signatureMethods: null };
        },
        createHandoff: async (id) => {
          seen.push(`create:${id}`);
          return { ok: true, rawToken: 'raw', handoffId: 'h1' };
        },
      }),
    );
    expect(seen).toEqual(['load:t1', 'create:canonical']);
  });
});
