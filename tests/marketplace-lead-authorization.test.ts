import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which leads a firm is allowed to answer.
 *
 * respondToLeadAction is a `'use server'` export, so it is a public HTTP
 * endpoint that any signed-in user can call with a firmId and a leadId of
 * their own choosing. It used to check only that the caller belonged to the
 * firm, then look the lead up by id through the SERVICE-ROLE client, which
 * bypasses RLS. firm_leads has no firm SELECT policy at all, so nothing else
 * stood in the way: a firm could answer a lead that had never been routed to
 * it, and the consumer was notified that a firm they had never been shown was
 * interested in their matter, indistinguishable from a real match.
 *
 * The product does model routing. lib/marketplace-storage.ts decides which
 * leads a firm SEES, from the firm's jurisdictions and practice areas plus the
 * lead's status. These tests assert the set a firm may ANSWER is that same
 * set, through that same predicate.
 *
 * The membership gate is held OPEN in every routing test (callerIsFirmMember
 * returns true), so the only thing that can refuse is the gate under test, and
 * each test asserts the exact refusal rather than merely `ok: false`. One test
 * closes the membership gate on purpose to prove the two refusals really are
 * distinguishable, so a routing test cannot be passing on the membership one.
 *
 * Mutations that turn them red, each applied and observed:
 *   - delete the `if (!lead) return` routing gate from respondToLeadAction:
 *     5 red, the four refusal tests plus "never reaches the write".
 *   - make leadIsRoutedToFirm return true unconditionally: 6 red, including
 *     the two predicate tests that drive it directly.
 *   - drop `.select('id')` from the upsert: 1 red. The fake resolves the
 *     awaited builder with `data: null`, which is the old shape, so the
 *     zero-row guard fires on every write and "still answers a lead that was
 *     routed to the firm" goes red. Note it is the HAPPY PATH that catches
 *     this one, not the zero-row test, which keeps passing for the wrong
 *     reason. Both are needed.
 *   - drop the empty-result check after the upsert: 1 red, "a write that
 *     stored nothing is reported as a failure".
 *   - make routedLeadForFirm return null unconditionally: 3 red, so the gate
 *     cannot be satisfied by refusing everything.
 */

const FIRM = 'firm-mn-family';
const ROUTED_LEAD = 'lead-mn-family';
const OTHER_STATE_LEAD = 'lead-tx-family';
const OTHER_AREA_LEAD = 'lead-mn-patent';
const CLOSED_LEAD = 'lead-mn-family-closed';
const MISSING_LEAD = 'lead-does-not-exist';

type LeadRow = {
  id: string;
  user_id: string | null;
  contact_email: string;
  contact_name: string | null;
  summary: string;
  jurisdiction_state: string | null;
  practice_areas: string[] | null;
  status: string;
};

const LEADS: Record<string, LeadRow> = {
  [ROUTED_LEAD]: {
    id: ROUTED_LEAD,
    user_id: 'consumer-1',
    contact_email: 'consumer@example.com',
    contact_name: 'Dana Reyes',
    summary: 'Custody question in Hennepin County.',
    jurisdiction_state: 'MN',
    practice_areas: ['family'],
    status: 'open',
  },
  [OTHER_STATE_LEAD]: {
    id: OTHER_STATE_LEAD,
    user_id: 'consumer-2',
    contact_email: 'stranger@example.com',
    contact_name: 'Sam Alvarez',
    summary: 'Custody question in Travis County.',
    jurisdiction_state: 'TX',
    practice_areas: ['family'],
    status: 'open',
  },
  [OTHER_AREA_LEAD]: {
    id: OTHER_AREA_LEAD,
    user_id: 'consumer-3',
    contact_email: 'inventor@example.com',
    contact_name: 'Lee Park',
    summary: 'Patent filing for a sensor assembly.',
    jurisdiction_state: 'MN',
    practice_areas: ['patent'],
    status: 'open',
  },
  [CLOSED_LEAD]: {
    id: CLOSED_LEAD,
    user_id: 'consumer-4',
    contact_email: 'settled@example.com',
    contact_name: 'Ari Bloom',
    summary: 'Custody question, already placed with counsel.',
    jurisdiction_state: 'MN',
    practice_areas: ['family'],
    status: 'closed',
  },
};

const h = vi.hoisted(() => {
  const s: { current: { upserted: Array<{ id: string }>; isMember: boolean } } = {
    current: { upserted: [{ id: 'resp-1' }], isMember: true },
  };
  const calls: string[] = [];
  const notified: Array<{ userId: string; title: string }> = [];

  function makeAdmin(leads: Record<string, unknown>) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              calls.push(`read:${table}:${val}`);
              if (table === 'firms') {
                // The firm practises family law in Minnesota only. Its name
                // read for the notification comes through the same branch.
                return {
                  data: {
                    name: 'Northline Family Law',
                    jurisdictions: ['US-MN'],
                    practice_areas: ['Family'],
                  },
                  error: null,
                };
              }
              if (table === 'firm_leads') {
                return { data: leads[val] ?? null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        upsert: () => {
          const node: Record<string, unknown> = {
            select: () => {
              calls.push(`upsert:${table}`);
              return Promise.resolve({ data: s.current.upserted, error: null });
            },
            // Awaiting the builder without selecting is exactly the shape the
            // vulnerable version had, and it resolves clean with nothing to
            // inspect. Kept so that removing `.select('id')` fails the
            // assertion rather than the harness.
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`upsert:${table}`);
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  return { s, calls, notified, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(LEADS as unknown as Record<string, unknown>),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'attorney-1', email: 'a@example.com' }),
  getRealCurrentUser: async () => ({ id: 'attorney-1' }),
  requireUser: async () => ({ id: 'attorney-1' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
}));

// Held OPEN by default. A routing test must not be able to pass because the
// membership gate refused for it.
vi.mock('../lib/firm-authz', () => ({
  callerIsFirmMember: async () => h.s.current.isMember,
}));

vi.mock('../lib/notifications', () => ({
  createNotification: async (input: { userId: string; title: string }) => {
    h.notified.push({ userId: input.userId, title: input.title });
    h.calls.push(`notify:${input.userId}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { respondToLeadAction } = await import('../lib/marketplace-actions');
const { leadIsRoutedToFirm } = await import('../lib/marketplace-storage');

/** The single refusal every unanswerable lead has to produce. */
const NOT_ANSWERABLE = 'That lead is not open to your firm.';

function respond(leadId: string) {
  return respondToLeadAction(FIRM, leadId, 'interested', 'We can help.', '$250/hr');
}

function writes(): string[] {
  return h.calls.filter((c) => c.startsWith('upsert:') || c.startsWith('notify:'));
}

describe('respondToLeadAction lead routing', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.notified.length = 0;
    h.s.current = { upserted: [{ id: 'resp-1' }], isMember: true };
  });

  it('refuses a lead in a state the firm does not practise in', async () => {
    const res = await respond(OTHER_STATE_LEAD);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NOT_ANSWERABLE);
  });

  it('refuses a lead outside the firm practice areas', async () => {
    const res = await respond(OTHER_AREA_LEAD);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NOT_ANSWERABLE);
  });

  it('refuses a lead that has already closed', async () => {
    const res = await respond(CLOSED_LEAD);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NOT_ANSWERABLE);
  });

  it('says the same thing about a lead that does not exist', async () => {
    // A caller must not be able to tell a real lead id from an invented one.
    const missing = await respond(MISSING_LEAD);
    h.calls.length = 0;
    const notRouted = await respond(OTHER_STATE_LEAD);
    expect(missing.error).toBe(NOT_ANSWERABLE);
    expect(notRouted.error).toBe(missing.error);
  });

  it('an unroutable lead never reaches the write or the consumer', async () => {
    await respond(OTHER_STATE_LEAD);
    // Nothing was stored, and the stranger whose enquiry this is was never
    // told a firm they have not seen is interested in their matter.
    expect(writes()).toEqual([]);
    expect(h.notified).toEqual([]);
    // And the refusal really came from the routing gate, not from the
    // function never getting far enough to read the lead.
    expect(h.calls).toContain(`read:firm_leads:${OTHER_STATE_LEAD}`);
  });

  it('the membership refusal is a different sentence from the routing one', async () => {
    // Proves the routing tests above are not quietly passing on this gate.
    h.s.current.isMember = false;
    const res = await respond(ROUTED_LEAD);
    expect(res.ok).toBe(false);
    expect(res.error).not.toBe(NOT_ANSWERABLE);
    expect(res.error).toMatch(/not a member/i);
    expect(writes()).toEqual([]);
  });

  it('still answers a lead that was routed to the firm', async () => {
    const res = await respond(ROUTED_LEAD);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(h.calls).toContain('upsert:firm_lead_responses');
    // The consumer who actually asked still hears back.
    expect(h.notified.map((n) => n.userId)).toEqual(['consumer-1']);
  });

  it('a write that stored nothing is reported as a failure', async () => {
    // PostgREST hands a zero-row write back as a success with a null error.
    h.s.current.upserted = [];
    const res = await respond(ROUTED_LEAD);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be saved/i);
    // Not told it worked, and the consumer is not notified about a response
    // that is not in the table.
    expect(h.notified).toEqual([]);
  });
});

describe('leadIsRoutedToFirm', () => {
  // The shared predicate, exercised directly, because it is the single rule
  // both the firm-side inbox and the response gate read.
  const firm = { jurisdictions: ['US-MN'], practice_areas: ['Family'] };

  it('matches on state and practice area, case and US- prefix insensitively', () => {
    expect(
      leadIsRoutedToFirm(firm, { jurisdiction_state: 'mn', practice_areas: ['FAMILY'] }),
    ).toBe(true);
  });

  it('rejects another state', () => {
    expect(
      leadIsRoutedToFirm(firm, { jurisdiction_state: 'TX', practice_areas: ['Family'] }),
    ).toBe(false);
  });

  it('rejects another practice area', () => {
    expect(
      leadIsRoutedToFirm(firm, { jurisdiction_state: 'MN', practice_areas: ['Patent'] }),
    ).toBe(false);
  });

  it('treats a firm that named no jurisdictions as serving all of them', () => {
    expect(
      leadIsRoutedToFirm(
        { jurisdictions: [], practice_areas: ['family'] },
        { jurisdiction_state: 'TX', practice_areas: ['family'] },
      ),
    ).toBe(true);
  });

  it('honours the general-practice opt-in', () => {
    expect(
      leadIsRoutedToFirm(
        { jurisdictions: ['MN'], practice_areas: ['all'] },
        { jurisdiction_state: 'MN', practice_areas: ['anything'] },
      ),
    ).toBe(true);
  });
});
