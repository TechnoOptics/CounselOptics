import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifySignatureChain } from '../lib/esign-audit';

/**
 * What the signature chain proves, and what it does not.
 *
 * The chain is offered as evidence in legal matters, so the difference
 * between "these events are unmodified" and "these are all the events" is
 * not a nicety. A hash chain gives the first and cannot give the second: an
 * event that was never written leaves nothing behind, because the next
 * writer read whatever the tail was at the time and hashed against that. The
 * surviving rows are then a perfectly consistent chain with a hole in it.
 *
 * This file pins three things:
 *
 *   1. Tampering is still caught. A modified event and an event deleted from
 *      the middle both break the walk. This is the property that must not
 *      regress, and it is asserted first for that reason.
 *   2. A chain with a hole in it does NOT report the same thing as a whole
 *      one, when the missing event is corroborated by a row written by a
 *      different statement (firm_signatures.signed_at,
 *      firm_signing_requests.status).
 *   3. A passing result never claims completeness. `establishes` says in
 *      words what ok:true covers, and `completeness` is never a value that
 *      means "proven", because nothing in this table can mean that.
 *
 * Mutations this file is meant to catch:
 *   - delete the `prev_event_hash !== lastHash` check
 *       -> "catches an event deleted from the middle" goes red.
 *   - delete the `recomputed !== e.event_hash` check
 *       -> "catches an altered event" goes red.
 *   - make findChainGaps always return state 'intact'
 *       -> the three "reports a dropped ... event" assertions go red.
 *   - drop `establishes` / `gaps` / `completeness` from the ok:true result
 *       -> "a passing chain says what it does not establish" goes red.
 *   - remove the rows.length === 0 guard in findChainGaps
 *       -> "says nothing about a request with no chain at all" goes red.
 */

type Row = {
  id: string;
  signing_request_id: string;
  signature_id: string | null;
  event_type: string;
  user_id: string | null;
  signer_email: string | null;
  signer_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  document_sha256: string | null;
  prev_event_hash: string | null;
  event_hash: string;
  created_at: string;
};

const REQ = 'req-1';

/** An hour ago, well clear of the grace window the gap probe applies. */
const settledAt = (offsetMs: number) =>
  new Date(Date.now() - 3_600_000 + offsetMs).toISOString();

/**
 * Build a real chain the way lib/esign-audit.ts writes one: each event
 * hashes sha256(prev_event_hash || canonical_payload). Hand-writing the
 * hashes is the point, since a fake that just asserts "verified" would pin
 * nothing.
 */
function chain(
  specs: Array<{
    id: string;
    type: string;
    signatureId?: string | null;
    email?: string | null;
  }>,
): Row[] {
  let prev: string | null = null;
  return specs.map((spec, i) => {
    const created_at = settledAt(i * 1000);
    const payload = JSON.stringify({
      request: REQ,
      signature: spec.signatureId ?? null,
      type: spec.type,
      user: null,
      email: spec.email?.toLowerCase() ?? null,
      name: null,
      ip: null,
      ua: null,
      doc: null,
      ts: created_at,
    });
    const event_hash = crypto
      .createHash('sha256')
      .update((prev ?? '') + '|' + payload)
      .digest('hex');
    const row: Row = {
      id: spec.id,
      signing_request_id: REQ,
      signature_id: spec.signatureId ?? null,
      event_type: spec.type,
      user_id: null,
      signer_email: spec.email ?? null,
      signer_name: null,
      ip_address: null,
      user_agent: null,
      document_sha256: null,
      prev_event_hash: prev,
      event_hash,
      created_at,
    };
    prev = event_hash;
    return row;
  });
}

type World = {
  events: Row[];
  signatures: Array<{
    id: string;
    signer_email: string | null;
    signed_at: string | null;
  }>;
  request: { status: string; completed_at: string | null } | null;
  signaturesError?: { message: string };
};

/**
 * A supabase-shaped fake over three tables. The corroborating reads are held
 * open (they succeed and return real rows) so that only the thing under test
 * can be what fails.
 */
function makeAdmin(world: World) {
  return {
    from: (table: string) => {
      if (table === 'firm_signature_events') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: world.events, error: null }),
            }),
          }),
        };
      }
      if (table === 'firm_signatures') {
        return {
          select: () => ({
            eq: async () =>
              world.signaturesError
                ? { data: null, error: world.signaturesError }
                : { data: world.signatures, error: null },
          }),
        };
      }
      if (table === 'firm_signing_requests') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: world.request, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A complete, well-formed chain for a two-signer request that completed. */
function completeWorld(): World {
  return {
    events: chain([
      { id: 'e1', type: 'request_created' },
      { id: 'e2', type: 'request_sent' },
      { id: 'e3', type: 'signed', signatureId: 'sig-a', email: 'a@x.com' },
      { id: 'e4', type: 'signed', signatureId: 'sig-b', email: 'b@x.com' },
      { id: 'e5', type: 'completed' },
    ]),
    signatures: [
      { id: 'sig-a', signer_email: 'a@x.com', signed_at: settledAt(2000) },
      { id: 'sig-b', signer_email: 'b@x.com', signed_at: settledAt(3000) },
    ],
    request: { status: 'completed', completed_at: settledAt(4000) },
  };
}

describe('tampering is still caught (must not regress)', () => {
  it('catches an event deleted from the middle', async () => {
    const w = completeWorld();
    // Remove e3. e4 still carries prev_event_hash = hash(e3), which is no
    // longer the event in front of it, so the walk must break.
    w.events = w.events.filter((e) => e.id !== 'e3');
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.brokenAt).toBe('e4');
    expect(v.reason).toContain('prev_event_hash');
  });

  it('catches an altered event', async () => {
    const w = completeWorld();
    // Same hashes, different payload: someone edited the row in place.
    w.events[2].signer_email = 'attacker@x.com';
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.brokenAt).toBe('e3');
    expect(v.reason).toContain('event_hash');
  });

  it('catches events removed from the head', async () => {
    const w = completeWorld();
    w.events = w.events.slice(2);
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    expect(v.ok).toBe(false);
  });

  it('passes a chain that is whole', async () => {
    const v = await verifySignatureChain(makeAdmin(completeWorld()), REQ);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error(v.reason);
    expect(v.events).toBe(5);
    expect(v.gaps).toEqual([]);
    expect(v.completeness).toBe('intact');
  });
});

describe('a chain with a hole does not report the same thing as a whole one', () => {
  /**
   * The hole here is the one the hash chain is blind to: the `signed` event
   * for sig-b was never written, so e5 chained off e3 and every hash in the
   * surviving chain is correct. The walk cannot tell this from a request
   * that only ever had one signer. firm_signatures.signed_at can, because a
   * different statement wrote it.
   */
  function holedWorld(): World {
    const w = completeWorld();
    w.events = chain([
      { id: 'e1', type: 'request_created' },
      { id: 'e2', type: 'request_sent' },
      { id: 'e3', type: 'signed', signatureId: 'sig-a', email: 'a@x.com' },
      { id: 'e5', type: 'completed' },
    ]);
    return w;
  }

  it('still walks clean, which is exactly the problem', async () => {
    const v = await verifySignatureChain(makeAdmin(holedWorld()), REQ);
    // Nothing was tampered with, so this is not a break.
    expect(v.ok).toBe(true);
  });

  it('reports a dropped signed event as a gap', async () => {
    const v = await verifySignatureChain(makeAdmin(holedWorld()), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.completeness).toBe('gap_found');
    expect(v.gaps).toHaveLength(1);
    expect(v.gaps[0].missing).toContain('b@x.com');
    expect(v.gaps[0].attestedBy).toContain('sig-b');
  });

  it('does not report the same result as the whole chain', async () => {
    const whole = await verifySignatureChain(makeAdmin(completeWorld()), REQ);
    const holed = await verifySignatureChain(makeAdmin(holedWorld()), REQ);
    if (!whole.ok || !holed.ok) throw new Error('both should walk clean');
    expect(holed.completeness).not.toBe(whole.completeness);
    expect(holed.establishes).not.toBe(whole.establishes);
    expect(holed.establishes).toContain('NOT in the chain');
  });

  it('reports a dropped completed event as a gap', async () => {
    const w = completeWorld();
    w.events = chain([
      { id: 'e1', type: 'request_created' },
      { id: 'e2', type: 'request_sent' },
      { id: 'e3', type: 'signed', signatureId: 'sig-a', email: 'a@x.com' },
      { id: 'e4', type: 'signed', signatureId: 'sig-b', email: 'b@x.com' },
    ]);
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.completeness).toBe('gap_found');
    expect(v.gaps.map((g) => g.missing)).toContain('completed event');
  });

  it('leaves a signature signed moments ago alone', async () => {
    // lib/signature-write.ts sets signed_at before it appends the event, so
    // a read landing between the two must not cry gap over a hole that is
    // about to be filled.
    const w = completeWorld();
    w.events = chain([
      { id: 'e1', type: 'request_created' },
      { id: 'e3', type: 'signed', signatureId: 'sig-a', email: 'a@x.com' },
    ]);
    w.signatures[1].signed_at = new Date().toISOString();
    w.request = { status: 'partially_signed', completed_at: null };
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.completeness).toBe('intact');
  });
});

describe('a passing chain never claims more than it proves', () => {
  it('says what it does not establish', async () => {
    const v = await verifySignatureChain(makeAdmin(completeWorld()), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.establishes).toContain('unmodified and in recorded order');
    expect(v.establishes).toContain('never written');
    // The one sentence that must never appear in any form.
    expect(v.establishes).not.toMatch(/all the events|every event happened/i);
  });

  it('says nothing about a request with no chain at all', async () => {
    // Requests created before the audit trail shipped have no events.
    // Reporting those as holed would light up every historical record,
    // which is worse than a verifier that stays quiet.
    const w = completeWorld();
    w.events = [];
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.completeness).toBe('not_checked');
    expect(v.gaps).toEqual([]);
  });

  it('does not claim a clean bill when it could not corroborate', async () => {
    const w = holedButUnreadable();
    const v = await verifySignatureChain(makeAdmin(w), REQ);
    if (!v.ok) throw new Error(v.reason);
    expect(v.completeness).toBe('not_checked');
    expect(v.establishes).toContain('not checked');
  });

  function holedButUnreadable(): World {
    const w = completeWorld();
    w.signaturesError = { message: 'permission denied for relation' };
    return w;
  }
});
