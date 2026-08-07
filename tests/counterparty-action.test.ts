import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTERPARTY_REFUSAL_COPY } from '../lib/counterparty-fields';

/**
 * The endpoint that stores what the other side typed, driven rather than read.
 *
 * EVERY `'use server'` EXPORT IS A PUBLIC HTTP ENDPOINT. This one is callable
 * by anyone with any arguments, and until now nothing in this repo called it
 * at all: resolveCounterpartySubmission has a test for every refusal it can
 * return, and the adapter that has to ASK it had none. Two of the three things
 * held here are exactly that gap.
 *
 *   - The caller is refused unless they are the counterparty. The employee who
 *     counter-signs holds a valid token for the same request and, being
 *     internal, passes the code gate without a code, so their submission used
 *     to land on their own signature row.
 *   - The write is conditional on the signature not having landed. That filter
 *     was cited as what stops a value arriving after the signature it would
 *     have changed, and removing it left the suite green: the read-time
 *     refusal is tested, the write-time one was not.
 *   - Nothing is written at all when the caller is refused.
 *
 * The pattern is tests/signature-write-gates.ts's: the database and the
 * request headers are faked and everything that decides anything is real.
 */

type SigRow = {
  id: string;
  signing_request_id: string;
  signer_email: string;
  signed_at: string | null;
  response: string | null;
  access_code_hash: string | null;
  access_code_verified_at: string | null;
  counterparty_values?: unknown;
};

const world = {
  signature: {} as SigRow,
  /** Set just before the update runs: the interleaving window. */
  onWrite: null as null | (() => void),
  /** Every update the action attempted, with the filters it carried. */
  writes: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }>,
};

const FIELDS = [
  {
    key: 'entity_name',
    label: 'Your registered entity name',
    type: 'text',
    required: true,
    party: 'counterparty',
  },
];
const BOXES = [{ key: 'entity_name', page: 1, x: 100, y: 500, widthPt: 200, heightPt: 16 }];

const events: Array<Record<string, unknown>> = [];

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: async (_admin: unknown, e: Record<string, unknown>) => {
    events.push(e);
  },
  sha256: (v: string) => `sha(${v})`,
}));
vi.mock('next/headers', () => ({ headers: () => new Map() }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain,
        update(next: Record<string, unknown>) {
          patch = next;
          return chain;
        },
        eq(col: string, value: unknown) {
          filters.push(['eq', col, value]);
          return chain;
        },
        is(col: string, value: unknown) {
          filters.push(['is', col, value]);
          return chain;
        },
        async maybeSingle() {
          if (patch) {
            world.onWrite?.();
            world.writes.push({ patch, filters: [...filters] });
            const blocked = filters.some(
              ([op, col]) => op === 'is' && col === 'signed_at' && world.signature.signed_at,
            );
            if (blocked) return { data: null, error: null };
            Object.assign(world.signature, patch);
            return { data: { id: world.signature.id }, error: null };
          }
          if (table === 'firm_signatures') return { data: { ...world.signature }, error: null };
          if (table === 'firm_signing_requests') {
            return {
              data: { id: 'req-1', status: 'sent', document_sha256: 'a'.repeat(64) },
              error: null,
            };
          }
          if (table === 'firm_template_submissions') {
            return {
              data: {
                id: 'sub-1',
                firm_id: 'firm-1',
                template_id: 'tpl-1',
                field_boxes: BOXES,
                recipient_email: 'buyer@wren.test',
              },
              error: null,
            };
          }
          if (table === 'firm_templates') return { data: { fields: FIELDS }, error: null };
          throw new Error(`unexpected read on ${table}`);
        },
      };
      return chain;
    },
  }),
}));

const { submitCounterpartyFieldsAction } = await import(
  '@/app/sign/[token]/counterparty-actions'
);

const VALUES = { entity_name: 'Wren Supply Co.' };

beforeEach(() => {
  world.signature = {
    id: 'sig-1',
    signing_request_id: 'req-1',
    signer_email: 'buyer@wren.test',
    signed_at: null,
    response: null,
    // External signer, code already entered.
    access_code_hash: 'hash',
    access_code_verified_at: '2026-08-06T10:00:00.000Z',
  };
  world.onWrite = null;
  world.writes = [];
  events.length = 0;
});

describe('submitCounterpartyFieldsAction', () => {
  it('stores what the counterparty typed', async () => {
    const out = await submitCounterpartyFieldsAction('tok-1', VALUES);
    expect(out).toEqual({ ok: true, values: VALUES });
    expect(world.signature.counterparty_values).toEqual(VALUES);
    expect(events.map((e) => e.eventType)).toContain('counterparty_fields_submitted');
  });

  it('refuses a signer on the same request who is not the counterparty', async () => {
    // The employee at order 2. Their token resolves, their request is open,
    // and being internal they carry no access code to be missing.
    world.signature.signer_email = 'priya@firm.test';
    world.signature.access_code_hash = null;
    world.signature.access_code_verified_at = null;

    const out = await submitCounterpartyFieldsAction('tok-2', VALUES);

    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ error: COUNTERPARTY_REFUSAL_COPY['not-your-details'] });
    // And above all: nothing landed on their row.
    expect(world.writes).toHaveLength(0);
    expect(world.signature.counterparty_values).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it('refuses a row that already carries a signature, before it writes', async () => {
    world.signature.signed_at = '2026-08-06T12:00:00.000Z';
    const out = await submitCounterpartyFieldsAction('tok-1', VALUES);
    expect(out).toMatchObject({ error: COUNTERPARTY_REFUSAL_COPY['already-signed'] });
    expect(world.writes).toHaveLength(0);
  });

  /**
   * THE WRITE-TIME FILTER. The read above and the write below are two
   * moments, and the signature can land between them: the signer submits the
   * form in one tab and the pad in another, or finishes on a phone. A value
   * written after the signature would change what the signature was over, so
   * the database decides and not the read.
   */
  it('makes the write conditional on the signature not having landed', async () => {
    world.onWrite = () => {
      world.signature.signed_at = '2026-08-06T12:00:00.000Z';
    };

    const out = await submitCounterpartyFieldsAction('tok-1', VALUES);

    expect(world.writes).toHaveLength(1);
    expect(world.writes[0].filters).toContainEqual(['is', 'signed_at', null]);
    // The row moved under it, so the update matched nothing and the action
    // says so rather than reporting a success it did not have.
    expect(out).toMatchObject({ error: COUNTERPARTY_REFUSAL_COPY['already-signed'] });
    expect(world.signature.counterparty_values).toBeUndefined();
    expect(events).toHaveLength(0);
  });
});
