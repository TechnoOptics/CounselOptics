import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRM_MATTER_ROLE_REFUSAL } from '../lib/firm-authz';

/**
 * What `staff` may reach, and the gate that finally says so in code.
 *
 * lib/firm-types.ts describes the role to a firm owner, in writing, at the
 * moment they send the invitation: "Read-only access to non-privileged
 * surfaces. Useful for receptionists or billing staff."
 * supabase/migrations/20260731_staff_role_read_scope.sql is APPLIED and acts
 * on that promise, removing `staff` from cases_firm_member_select and
 * firm_documents_member_select. So the product's own copy and its own database
 * agree, and neither of them is what the firm-native matter tools were asking:
 * every action in lib/firm-timeline-actions.ts, lib/firm-approach-actions.ts
 * and lib/firm-legal-review-actions.ts asked only for MEMBERSHIP and then went
 * through the service-role client, where RLS does not apply. Three matter
 * mutations in lib/firm-actions.ts did the same, and so did
 * listMatterCollaboratorsAction, which was missed on the first pass and is the
 * only READ of the seven: everything else here was a write, and a fix aimed at
 * mutations went straight past it. What it hands back is not a list of names.
 * lib/storage.ts listCollaboratorsAsFirm selects `*` from case_collaborators
 * and collaboratorFromRow carries `witness_statement` onto every Collaborator
 * it builds, so the endpoint was reading a witness's own account of a matter
 * out to a receptionist.
 *
 * HOW THIS SUITE AVOIDS THE THREE FALSE GREENS.
 *
 *   - lib/firm-authz is NOT mocked. The fake supabase client below serves the
 *     real callerFirmRole its membership row, so the real callerHasFirmRole
 *     and the real FIRM_POSTING_ROLES decide every case here. Widening that
 *     constant to include 'staff' therefore turns this file red, which a
 *     boolean stub for callerHasFirmRole would have hidden.
 *   - Every neighbouring gate is held OPEN. The matter exists, the caller is
 *     signed in, the organization's access is live, and the admin client is
 *     available. The only thing that can refuse is the role.
 *   - Refusal and side effect are separate assertions. `adminCalls` records
 *     every table the SERVICE-ROLE client touched, and it is empty exactly
 *     when the gate ran before the work. A gate moved below the read still
 *     returns the same refusal and would leave entries in there.
 *
 * Mutations, each verified red:
 *   - add 'staff' to FIRM_POSTING_ROLES: every refusal case goes red.
 *   - delete the role check from any one of the four assertFirmCase /
 *     matter-mutation sites: that module's refusal goes red.
 *   - move a role check BELOW its lookup: the refusal assertion stays green
 *     and the adminCalls assertion goes red.
 *   - answer the role refusal only when the matter exists: "tells a staff
 *     member nothing about whether the matter exists" goes red.
 *   - put listMatterCollaboratorsAction back on callerIsFirmMember: "is handed
 *     no collaborator, and no witness statement with them" goes red on the
 *     returned list and on the collaborator read alike.
 */

type Role = 'owner' | 'admin' | 'attorney' | 'paralegal' | 'staff' | null;

const h = vi.hoisted(() => {
  const s = {
    /** The caller's firm_members.role, or null for "not a member". */
    role: 'paralegal' as Role,
    /** Whether the matter id resolves. Held true so only the role refuses. */
    caseExists: true,
    /** Whether the caller is an outside co-counsel guest on this matter. */
    isGuest: false,
  };
  /** Every table the SERVICE-ROLE client was asked to touch, in order. */
  const adminCalls: string[] = [];

  const EVENT_ROW = {
    id: 'ev-1',
    case_id: 'case-1',
    created_by: 'user-1',
    occurred_at: null,
    occurred_precision: 'unknown',
    kind: 'note',
    title: 'Note',
    description: null,
    media: [],
    source_label: null,
    ai_summary: null,
    ai_extracted: {},
    ai_status: 'skipped',
    ai_error: null,
    people: [],
    position: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };

  const APPROACH_ROW = {
    id: 'ap-1',
    case_id: 'case-1',
    title: 'Approach 1',
    prompt: 'prove it',
    connections: '',
    generated: null,
    gen_status: 'idle',
    gen_error: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };

  /**
   * One collaborator, carrying the thing this is really about. The sentinel is
   * asserted BOTH ways: a role that may read matters gets it, so the test
   * cannot pass by the endpoint quietly returning nothing to everybody.
   */
  const WITNESS_STATEMENT = 'He was already on the stairs when I came in.';

  const COLLABORATOR_ROW = {
    id: 'collab-1',
    case_id: 'case-1',
    user_id: 'user-9',
    email: 'witness@example.com',
    role: 'witness',
    invited_by: 'user-1',
    invited_at: '2026-08-01T00:00:00.000Z',
    accepted_at: null,
    witness_statement: WITNESS_STATEMENT,
    witness_statement_updated_at: '2026-08-02T00:00:00.000Z',
  };

  const READ: Record<string, unknown> = {
    case_timeline_events: [],
    case_people: [],
    case_timeline_narratives: null,
    case_approaches: [],
    case_legal_reviews: null,
    case_collaborators: [COLLABORATOR_ROW],
    cases: { id: 'case-1', firm_id: 'firm-1', title: 'Matter', text_normalizations: null },
    firm_members: { user_id: 'user-2' },
  };

  const WRITE: Record<string, unknown> = {
    case_timeline_events: EVENT_ROW,
    case_approaches: APPROACH_ROW,
    cases: { id: 'case-new' },
  };

  /** One chainable node that records the table the moment it resolves. */
  function adminNode(table: string, op: string) {
    const settle = () => {
      adminCalls.push(`${table}:${op}`);
      const data = op === 'select' ? READ[table] ?? null : WRITE[table] ?? { id: 'x' };
      return { data, error: null, count: 0 };
    };
    const n: Record<string, unknown> = {};
    for (const k of ['eq', 'in', 'is', 'neq', 'gte', 'lte', 'limit', 'order', 'select']) {
      n[k] = () => n;
    }
    n.single = async () => settle();
    n.maybeSingle = async () => settle();
    n.then = (resolve: (v: unknown) => unknown) => resolve(settle());
    return n;
  }

  function makeAdmin() {
    return {
      from: (table: string) => ({
        select: () => adminNode(table, 'select'),
        insert: () => adminNode(table, 'insert'),
        update: () => adminNode(table, 'update'),
        upsert: () => adminNode(table, 'upsert'),
        delete: () => adminNode(table, 'delete'),
      }),
    };
  }

  /**
   * The USER-scoped client. It answers the membership read that the REAL
   * lib/firm-authz makes, and the matter read that each module's own
   * assertFirmCase makes. Nothing here is recorded: reading your own
   * membership row is not the side effect under test.
   */
  function makeUserClient() {
    return {
      from: (table: string) => ({
        select: () => {
          const n: Record<string, unknown> = {};
          n.eq = () => n;
          n.maybeSingle = async () => ({
            data:
              table === 'firm_members'
                ? s.role
                  ? { id: 'm-1', role: s.role }
                  : null
                : s.caseExists
                  ? { id: 'case-1' }
                  : null,
            error: null,
          });
          return n;
        },
      }),
    };
  }

  return { s, adminCalls, makeAdmin, makeUserClient, WITNESS_STATEMENT };
});

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  requireUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => h.makeUserClient(),
}));

// Held OPEN. An organization whose access had ended would refuse for its own
// reason and every case below would pass without the role gate existing.
vi.mock('../lib/firm-trials', () => ({
  firmTrialState: async () => 'active',
}));

vi.mock('../lib/counsel-guest', () => ({
  guestCanReadCase: async () => h.s.isGuest,
}));

// AI off, so the approach path saves without starting a background job. This
// is downstream of the gate and is not what any case here is about.
vi.mock('../lib/timeline-ai', () => ({
  aiConfigured: () => false,
  buildNarrative: async () => ({ error: 'off' }),
}));
vi.mock('../lib/timeline-entitlement', () => ({
  resolveTimelineAccess: async () => 'firm',
}));

vi.mock('../lib/email', () => ({
  sendEmail: async () => {},
  buildMeetingInviteEmailHtml: () => '',
  buildSigningRequestEmailHtml: () => '',
  buildSigningCodeEmailHtml: () => '',
}));

const { getFirmTimelineBundle, createFirmTimelineEvent, updateFirmTimelineEvent } =
  await import('../lib/firm-timeline-actions');
const { listFirmApproaches, createFirmApproach } = await import(
  '../lib/firm-approach-actions'
);
const { getFirmLegalReview } = await import('../lib/firm-legal-review-actions');
const {
  createFirmCaseAction,
  updateFirmCaseAction,
  setCaseAssigneeAction,
  listMatterCollaboratorsAction,
} = await import('../lib/firm-actions');

const CASE_INPUT = { title: 'Matter', subject: 'Someone' };

beforeEach(() => {
  h.adminCalls.length = 0;
  h.s.role = 'paralegal';
  h.s.caseExists = true;
  h.s.isGuest = false;
});

describe('a staff member cannot reach a matter’s privileged material', () => {
  beforeEach(() => {
    h.s.role = 'staff';
  });

  it('is handed no timeline, and the service-role client is never reached', async () => {
    const bundle = await getFirmTimelineBundle('firm-1', 'case-1');
    expect(bundle.events).toEqual([]);
    expect(bundle.people).toEqual([]);
    expect(bundle.narrative).toBeNull();
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot add an event to a matter’s timeline', async () => {
    const res = await createFirmTimelineEvent('firm-1', 'case-1', new FormData());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot edit an event on a matter’s timeline', async () => {
    const res = await updateFirmTimelineEvent('firm-1', 'case-1', 'ev-1', {
      title: 'rewritten',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot list the firm’s case approaches', async () => {
    const res = await listFirmApproaches('firm-1', 'case-1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(res.approaches).toBeUndefined();
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot save a new case approach', async () => {
    const res = await createFirmApproach('firm-1', 'case-1', {
      title: 'Theory',
      prompt: 'prove it',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot read the firm’s legal review of a matter', async () => {
    const res = await getFirmLegalReview('firm-1', 'case-1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(res.review).toBeUndefined();
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot open a matter', async () => {
    const res = await createFirmCaseAction('firm-1', CASE_INPUT);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot edit a matter', async () => {
    const res = await updateFirmCaseAction('firm-1', 'case-1', CASE_INPUT);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    expect(h.adminCalls).toEqual([]);
  });

  it('cannot reassign a matter', async () => {
    const res = await setCaseAssigneeAction('case-1', 'user-2');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(FIRM_MATTER_ROLE_REFUSAL);
    // This one reads the matter first, because the argument carries no firm
    // id and the row is the only thing that says which organization to ask
    // about. What must not happen is the UPDATE.
    expect(h.adminCalls).toEqual(['cases:select']);
  });

  it('is handed no collaborator, and no witness statement with them', async () => {
    const list = await listMatterCollaboratorsAction('case-1');
    expect(list).toEqual([]);
    // The matter row IS read first, because the argument carries no firm id
    // and that row is the only thing that says which organization to ask
    // about. What must not happen is the collaborator read, and its absence
    // here is what says the gate ran before the work rather than after it.
    expect(h.adminCalls).toEqual(['cases:select']);
    expect(h.adminCalls).not.toContain('case_collaborators:select');
  });

  it('tells a staff member nothing about whether the matter exists', async () => {
    h.s.caseExists = true;
    const real = await listFirmApproaches('firm-1', 'case-1');
    h.adminCalls.length = 0;
    h.s.caseExists = false;
    const imaginary = await listFirmApproaches('firm-1', 'case-nonexistent');
    expect(real.error).toBe(imaginary.error);
    expect(real.ok).toBe(false);
    expect(imaginary.ok).toBe(false);
  });
});

describe('the roles that run matters are untouched', () => {
  for (const role of ['owner', 'admin', 'attorney', 'paralegal'] as const) {
    it(`${role} still builds a matter’s timeline`, async () => {
      h.s.role = role;
      const res = await createFirmTimelineEvent('firm-1', 'case-1', new FormData());
      expect(res.ok).toBe(true);
      expect(h.adminCalls).toContain('case_timeline_events:insert');
    });

    it(`${role} still saves a case approach`, async () => {
      h.s.role = role;
      const res = await createFirmApproach('firm-1', 'case-1', {
        title: 'Theory',
        prompt: 'prove it',
      });
      expect(res.ok).toBe(true);
      expect(h.adminCalls).toContain('case_approaches:insert');
    });

    it(`${role} still opens and edits a matter`, async () => {
      h.s.role = role;
      expect((await createFirmCaseAction('firm-1', CASE_INPUT)).ok).toBe(true);
      expect((await updateFirmCaseAction('firm-1', 'case-1', CASE_INPUT)).ok).toBe(true);
      expect((await setCaseAssigneeAction('case-1', 'user-2')).ok).toBe(true);
      expect(h.adminCalls).toContain('cases:insert');
      expect(h.adminCalls).toContain('cases:update');
    });

    it(`${role} still reads the legal review and the approaches`, async () => {
      h.s.role = role;
      expect((await getFirmLegalReview('firm-1', 'case-1')).ok).toBe(true);
      expect((await listFirmApproaches('firm-1', 'case-1')).ok).toBe(true);
    });

    it(`${role} still sees who is on the matter, witness statement and all`, async () => {
      h.s.role = role;
      const list = await listMatterCollaboratorsAction('case-1');
      expect(list).toHaveLength(1);
      // The sentinel proves the endpoint really is a witness-statement
      // channel, so the staff refusal above is about something worth
      // refusing rather than about an endpoint that returns nothing anyway.
      expect(list[0].witnessStatement).toBe(h.WITNESS_STATEMENT);
      expect(h.adminCalls).toContain('case_collaborators:select');
    });
  }
});

describe('an outside co-counsel guest is unaffected', () => {
  beforeEach(() => {
    // Not a firm member at all, so no firm role. The guest grant is the only
    // thing admitting them, exactly as before.
    h.s.role = null;
    h.s.isGuest = true;
  });

  it('still builds the timeline of the matter they are assigned to', async () => {
    const res = await createFirmTimelineEvent('firm-1', 'case-1', new FormData());
    expect(res.ok).toBe(true);
  });

  it('still saves a case approach on that matter', async () => {
    const res = await createFirmApproach('firm-1', 'case-1', {
      title: 'Theory',
      prompt: 'prove it',
    });
    expect(res.ok).toBe(true);
  });

  it('is still refused when the grant does not cover the matter', async () => {
    h.s.isGuest = false;
    const res = await createFirmApproach('firm-1', 'case-1', {
      title: 'Theory',
      prompt: 'prove it',
    });
    expect(res.ok).toBe(false);
    expect(h.adminCalls).toEqual([]);
  });
});
