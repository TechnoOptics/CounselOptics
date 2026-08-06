import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organization export, GET /api/firm/export.
 *
 * This route is the whole "you can still get your data" half of the trial
 * design: nothing is deleted when a trial ends, and this is how an
 * organization takes a copy. Three properties are load-bearing and are what
 * these tests hold down.
 *
 *   1. Owner and admin only. The archive holds every matter, document record
 *      and client name the organization has.
 *   2. It works while the organization is export_only. An expired or suspended
 *      organization must still reach its own records, so the route must not
 *      consult access state at all.
 *   3. Every export is audited, once, before the bytes go out. A refused
 *      attempt is audited too.
 *
 * Plus the property that separates a real export from a demo one: the archive
 * only claims to be complete when it can prove it. A table that fails, or that
 * comes back short of the count taken before paging started, must turn
 * `_summary.complete` false.
 *
 * The real lib/firm-authz.ts runs here. Only the two Supabase clients and the
 * audit sink are stood in for, so the role decision under test is the one the
 * product actually makes.
 */

// ── In-memory stand-in for Postgres ────────────────────────────────────────
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  /** The signed-in user, as lib/supabase/server would report them. */
  user: { id: 'user-owner', email: 'owner@example.com' } as {
    id: string;
    email: string;
  } | null,
  /**
   * The REAL caller when an HQ operator is acting as someone. Null means the
   * effective user is the real one, which is the ordinary case.
   */
  realUser: null as { id: string; email: string } | null,
  tables: {} as Record<string, Row[]>,
  /**
   * PostgREST's `db-max-rows`. It is a server setting this codebase does not
   * control, so the route must page correctly at any value, not only 1000.
   */
  serverMaxRows: 1000,
  /** Tables whose reads fail, by name, with the message they fail with. */
  failing: {} as Record<string, string>,
  /**
   * Force the pre-paging count probe to report a different number than the
   * table actually yields, which is what a row disappearing mid-export looks
   * like from the route's side.
   */
  countOverride: {} as Record<string, number>,
  /**
   * Tables whose count probe comes back `{ count: null, error: null }`, which
   * is what supabase-js hands over whenever the Content-Range header is
   * missing or unparsed. It is the "the check did not run" case, and it must
   * never read as "this table holds zero rows".
   */
  countNull: {} as Record<string, boolean>,
  reset() {
    this.user = { id: 'user-owner', email: 'owner@example.com' };
    this.realUser = null;
    this.serverMaxRows = 1000;
    this.failing = {};
    this.countOverride = {};
    this.countNull = {};
    this.tables = {
      firm_members: [
        { id: 'm1', firm_id: 'firm-1', user_id: 'user-owner', role: 'owner' },
        {
          id: 'm2',
          firm_id: 'firm-1',
          user_id: 'user-paralegal',
          role: 'paralegal',
        },
        { id: 'm3', firm_id: 'firm-2', user_id: 'user-other', role: 'owner' },
      ],
      firms: [
        {
          id: 'firm-1',
          name: 'Hale & Rowe',
          slug: 'hale-rowe',
          firm_type: 'firm',
          created_at: '2026-01-04T00:00:00.000Z',
          // Long expired AND suspended. The export must not care.
          trial_ends_at: '2026-02-01T00:00:00.000Z',
          suspended_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      cases: [
        { id: 'c1', firm_id: 'firm-1', title: 'Ours' },
        { id: 'c2', firm_id: 'firm-2', title: 'Someone else' },
      ],
      firm_documents: [
        { id: 'd1', firm_id: 'firm-1', name: 'Retainer.pdf' },
        { id: 'd2', firm_id: 'firm-2', name: 'Not ours.pdf' },
      ],
      // Case substance that DOES carry firm_id, but nullably. A deadline
      // written without a firm id (lib/deadlines-actions.ts writes
      // `input.firmId ?? null`) is invisible to `.eq('firm_id', ...)` and to
      // the count probe that uses the same filter, so it would go missing and
      // the archive would still call itself complete. Both fixtures carry a
      // null firm_id on purpose.
      case_deadlines: [
        { id: 'dl1', case_id: 'c1', firm_id: null, title: 'Answer due' },
        { id: 'dl2', case_id: 'c2', firm_id: null, title: 'Not ours' },
      ],
      case_approaches: [
        { id: 'ap1', case_id: 'c1', firm_id: null, title: 'Negligence per se' },
        { id: 'ap2', case_id: 'c2', firm_id: null, title: 'Not ours' },
      ],
      // Case substance. None of these carry firm_id: they hang off case_id,
      // which is why they need the derived id set rather than the flat filter.
      case_people: [
        { id: 'p1', case_id: 'c1', display_name: 'R. Hohag', role: 'opposing' },
        { id: 'p2', case_id: 'c2', display_name: 'Not ours', role: 'witness' },
      ],
      case_collaborators: [
        { id: 'cl1', case_id: 'c1', email: 'cocounsel@example.com', role: 'attorney' },
        { id: 'cl2', case_id: 'c2', email: 'nope@example.com', role: 'viewer' },
      ],
      case_section_comments: [
        { id: 'sc1', case_id: 'c1', section_type: 'event', body: 'Check this date' },
        { id: 'sc2', case_id: 'c2', section_type: 'event', body: 'Not ours' },
      ],
      case_chat_messages: [
        {
          id: 'cm1',
          case_id: 'c1',
          thread_kind: 'dm',
          // Ends in _key, so the credential-name guard blanks it. That is a
          // known false positive and a cheap one: thread_kind and
          // participants carry the same information.
          thread_key: 'dm:user-a:user-b',
          participants: ['user-a', 'user-b'],
          body: 'Sending the draft',
        },
        { id: 'cm2', case_id: 'c2', thread_kind: 'general', body: 'Not ours' },
      ],
      case_timeline_events: [
        { id: 'e1', case_id: 'c1', title: 'The meeting' },
        { id: 'e2', case_id: 'c2', title: 'Not ours' },
      ],
      case_timeline_narratives: [
        { case_id: 'c1', summary: 'What happened' },
        { case_id: 'c2', summary: 'Not ours' },
      ],
      exhibits: [
        { id: 'x1', case_id: 'c1', label: 'Exhibit A' },
        { id: 'x2', case_id: 'c2', label: 'Not ours' },
      ],
      case_legal_reviews: [
        { id: 'r1', case_id: 'c1', state: 'MN' },
        { id: 'r2', case_id: 'c2', state: 'IA' },
      ],
      case_images: [
        { id: 'i1', case_id: 'c1', label: 'Scene' },
        { id: 'i2', case_id: 'c2', label: 'Not ours' },
      ],
      firm_signing_requests: [
        { id: 'sr1', firm_id: 'firm-1', status: 'completed' },
        { id: 'sr2', firm_id: 'firm-2', status: 'sent' },
      ],
      // Per-signer records: the firm's proof a named person executed a named
      // document at a named time. `token` is an unauthenticated credential
      // (lib/signing-actions.ts looks a signer up by it) and access_code_hash
      // is a secret, so neither may leave the building.
      firm_signatures: [
        {
          id: 'sig1',
          signing_request_id: 'sr1',
          signer_email: 'client@example.com',
          signer_name: 'A. Client',
          signed_at: '2026-05-02T10:00:00.000Z',
          access_code_verified_at: '2026-05-02T09:58:00.000Z',
          access_attempts: 1,
          token: 'live-signing-token-do-not-export',
          access_code_hash: 'sha256-of-the-code',
        },
        {
          id: 'sig2',
          signing_request_id: 'sr2',
          signer_email: 'other@example.com',
          token: 'other-firm-token',
        },
      ],
      // The tamper-evident chain. A signature row asserts someone signed;
      // this is the record that proves it, and the hashes have to survive the
      // archive intact or the chain cannot be verified from it.
      firm_signature_events: [
        {
          id: 'ev1',
          signing_request_id: 'sr1',
          event_type: 'signed',
          prev_event_hash: null,
          event_hash: 'a1b2c3',
        },
        {
          id: 'ev2',
          signing_request_id: 'sr2',
          event_type: 'signed',
          event_hash: 'not-ours',
        },
      ],
      firm_meetings: [
        {
          id: 'mt1',
          firm_id: 'firm-1',
          title: 'Client call',
          join_url: 'https://meet.example.com/abc',
        },
      ],
      firm_channels: [
        { id: 'ch1', firm_id: 'firm-1', name: 'general' },
        { id: 'ch2', firm_id: 'firm-2', name: 'theirs' },
      ],
      // Internal communication, keyed by channel_id rather than firm_id.
      firm_messages: [
        { id: 'msg1', channel_id: 'ch1', body: 'Answer filed this morning.' },
        { id: 'msg2', channel_id: 'ch2', body: 'Not ours' },
      ],
    };
  },
}));

const compare = (a: unknown, b: unknown) => String(a).localeCompare(String(b));

/**
 * A chainable stand-in supporting exactly the calls the route and
 * lib/firm-authz.ts make: select/eq/in/gt/order/limit/maybeSingle, plus the
 * head+count probe, awaited directly.
 *
 * `limit` is capped at `db.serverMaxRows` the way PostgREST caps every
 * response, so a route that trusts its own page size fails here the way it
 * would fail against a server configured differently. There is deliberately
 * no `range`: offset paging is not stable under concurrent writes, so a
 * revert to it should not quietly keep passing.
 */
class Query {
  private table: string;
  private rows: Row[];
  private cols: string[] | null = null;
  private headOnly = false;
  private limitN: number | null = null;
  constructor(table: string) {
    this.table = table;
    this.rows = [...(db.tables[table] ?? [])];
  }
  select(cols?: string, opts?: { head?: boolean; count?: string }) {
    if (cols && cols !== '*') {
      this.cols = cols.split(',').map((c) => c.trim());
    }
    if (opts?.head) this.headOnly = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: readonly unknown[]) {
    this.rows = this.rows.filter((r) => vals.includes(r[col]));
    return this;
  }
  gt(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => compare(r[col], val) > 0);
    return this;
  }
  order(col: string) {
    this.rows = [...this.rows].sort((a, b) => compare(a[col], b[col]));
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  private result() {
    const failure = db.failing[this.table];
    if (failure) {
      return { data: null, count: null, error: { message: failure } };
    }
    if (this.headOnly) {
      // supabase-js reports null whenever Content-Range is missing or
      // unparsed. Treating that as zero is a fail-open, so the route has to
      // notice it rather than certify the table.
      if (db.countNull[this.table]) {
        return { data: null, count: null, error: null };
      }
      const forced = db.countOverride[this.table];
      return {
        data: null,
        count: typeof forced === 'number' ? forced : this.rows.length,
        error: null,
      };
    }
    const cap = Math.min(this.limitN ?? db.serverMaxRows, db.serverMaxRows);
    const page = this.rows.slice(0, cap).map((row) => {
      if (!this.cols) return row;
      const picked: Row = {};
      for (const col of this.cols) {
        if (col in row) picked[col] = row[col];
      }
      return picked;
    });
    return { data: page, count: null, error: null };
  }
  then(
    resolve: (v: {
      data: Row[] | null;
      count: number | null;
      error: { message: string } | null;
    }) => unknown,
  ) {
    return Promise.resolve(this.result()).then(resolve);
  }
}

const client = { from: (table: string) => new Query(table) };

vi.mock('@/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => db.user,
  getRealCurrentUser: async () => db.realUser ?? db.user,
  createServerSupabase: () => client,
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => client,
}));

// The active-organization pointer. The route falls back to this when no
// firmId is supplied.
vi.mock('@/lib/firm-storage', () => ({
  getActiveFirmContext: async () =>
    db.user ? { firm: { id: 'firm-1', slug: 'hale-rowe' } } : null,
}));

const logSecurityEvent = vi.hoisted(() =>
  vi.fn(
    async (_event: {
      kind: string;
      severity?: string;
      userId?: string | null;
      details?: Record<string, unknown>;
    }) => {},
  ),
);
vi.mock('@/lib/security-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security-audit')>();
  return { ...actual, logSecurityEvent };
});

import { GET } from '@/app/api/firm/export/route';
import { GET as legacyGET } from '@/app/api/counsel/firm-export/route';

const request = (url = 'https://app.advottic.com/api/firm/export') =>
  new Request(url, { headers: { 'user-agent': 'vitest' } });

async function archiveOf(res: Response) {
  return JSON.parse(await res.text()) as {
    _meta: { organization: { id: string }; format: string; notes: string[] };
    data: Record<string, Row[]>;
    _summary: {
      tables: Record<string, number>;
      expected: Record<string, number>;
      shortfalls: Record<string, { expected: number; exported: number }>;
      unverified: string[];
      errors: Record<string, string>;
      complete: boolean;
    };
  };
}

beforeEach(() => {
  db.reset();
  logSecurityEvent.mockClear();
});

describe('organization export authorization', () => {
  it('gives a signed-out caller nothing', async () => {
    db.user = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    // Nothing to attribute a refusal to: no identity, no organization.
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });

  it('refuses a paralegal, who is a member but not an admin', async () => {
    db.user = { id: 'user-paralegal', email: 'para@example.com' };
    const res = await GET(request());
    expect(res.status).toBe(403);
  });

  it('records the refusal so a run of attempts is visible', async () => {
    db.user = { id: 'user-paralegal', email: 'para@example.com' };
    await GET(request());
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0][0];
    expect(event.kind).toBe('data_exported');
    expect(event.details?.refused).toBe(true);
    expect(event.details?.firmId).toBe('firm-1');
    // Left unacknowledged so it lands in the triage queue rather than the
    // routine audit stream. Only 'low' is auto-acknowledged by the writer,
    // and 'low' is also what an omitted severity defaults to, so this is the
    // lowest value that actually keeps the event open for triage.
    expect(event.severity).toBe('medium');
  });

  it('refuses an organization the caller does not belong to, and records it', async () => {
    const res = await GET(
      request('https://app.advottic.com/api/firm/export?firmId=firm-2'),
    );
    expect(res.status).toBe(403);
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0][0];
    expect(event.details?.refused).toBe(true);
    expect(event.details?.firmId).toBe('firm-2');
  });

  it('lets the owner through', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('hale-rowe');
  });
});

describe('organization export content', () => {
  it('carries the caller organization rows and no other organization rows', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive._meta.organization.id).toBe('firm-1');
    expect(archive.data.cases.map((c) => c.id)).toEqual(['c1']);
    expect(archive.data.firm_documents.map((d) => d.id)).toEqual(['d1']);
    expect(archive._summary.complete).toBe(true);
    expect(archive._summary.tables.cases).toBe(1);
  });

  it('carries the matters substance, scoped to this organization matters', async () => {
    const archive = await archiveOf(await GET(request()));
    // Evidence, timeline, narrative, exhibits, legal review and images all
    // hang off case_id. Without them the archive holds matter titles and
    // nothing a matter is actually made of.
    expect(archive.data.case_timeline_events.map((e) => e.id)).toEqual(['e1']);
    expect(archive.data.case_timeline_narratives.map((n) => n.case_id)).toEqual([
      'c1',
    ]);
    expect(archive.data.exhibits.map((x) => x.id)).toEqual(['x1']);
    expect(archive.data.case_legal_reviews.map((r) => r.id)).toEqual(['r1']);
    expect(archive.data.case_images.map((i) => i.id)).toEqual(['i1']);
  });

  it('carries the people, the collaborators and the collaboration work product', async () => {
    const archive = await archiveOf(await GET(request()));
    // Persons of interest: written by the firm timeline builder and rendered
    // by the exhibit PDF, so a timeline without them has no cast list.
    expect(archive.data.case_people.map((p) => p.id)).toEqual(['p1']);
    // Who was on the matter.
    expect(archive.data.case_collaborators.map((c) => c.id)).toEqual(['cl1']);
    // The firm timeline collaboration work product.
    expect(archive.data.case_section_comments.map((c) => c.id)).toEqual(['sc1']);
    expect(archive.data.case_chat_messages.map((m) => m.id)).toEqual(['cm1']);
  });

  it('reaches the deadlines and approaches that carry no organization id', async () => {
    // Both fixtures have firm_id null, which is what lib/deadlines-actions.ts
    // writes when no firm is passed and what the case_approaches DDL allows.
    // Reached by firm_id these come back empty, and the count probe, using the
    // same filter, agrees with the empty read: the rows go missing and the
    // archive still calls itself complete.
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.case_deadlines.map((d) => d.id)).toEqual(['dl1']);
    expect(archive.data.case_approaches.map((a) => a.id)).toEqual(['ap1']);
    expect(archive._summary.complete).toBe(true);
  });

  it('carries the signature event chain with its hashes intact', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_signature_events.map((e) => e.id)).toEqual(['ev1']);
    const event = archive.data.firm_signature_events[0];
    // The chain is the whole point. A redaction rule that blanked either hash
    // would leave a record that cannot be verified from the archive.
    expect(event.event_hash).toBe('a1b2c3');
    expect(event.prev_event_hash).toBeNull();
  });

  it('carries the internal messages, scoped through this organization channels', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_channels.map((c) => c.id)).toEqual(['ch1']);
    expect(archive.data.firm_messages.map((m) => m.id)).toEqual(['msg1']);
  });

  it('keeps the invitation time on the per-signer record', async () => {
    db.tables.firm_signatures = [
      {
        id: 'sig1',
        signing_request_id: 'sr1',
        signer_email: 'client@example.com',
        // When the signer was INVITED, which is not signed_at and is what
        // lib/firm-storage.ts orders the signer list by.
        created_at: '2026-05-01T08:00:00.000Z',
        signed_at: '2026-05-02T10:00:00.000Z',
        token: 'live-signing-token-do-not-export',
      },
    ];
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_signatures[0].created_at).toBe(
      '2026-05-01T08:00:00.000Z',
    );
  });

  it('keeps the meeting join link, which is not a key to the organization data', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_meetings[0].join_url).toBe(
      'https://meet.example.com/abc',
    );
  });

  it('carries per-signer signature records without the signing credentials', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_signatures.map((s) => s.id)).toEqual(['sig1']);
    const signature = archive.data.firm_signatures[0];
    expect(signature.signer_email).toBe('client@example.com');
    expect(signature.signed_at).toBe('2026-05-02T10:00:00.000Z');
    expect(signature.access_code_verified_at).toBeTruthy();
    // The signing token is a bearer credential and the access code hash is a
    // secret. Neither belongs in a file the organization keeps forever.
    expect(signature).not.toHaveProperty('token');
    expect(signature).not.toHaveProperty('access_code_hash');
  });

  it('redacts secret-looking columns from tables read whole', async () => {
    db.tables.firm_documents = [
      {
        id: 'd1',
        firm_id: 'firm-1',
        name: 'Retainer.pdf',
        share_token: 'live-share-token',
        webhook_secret: 'shh',
        api_key: 'ak_live_1',
        password_hint: 'the dog',
        access_code_hash: 'sha256',
        // No underscore, so `_key` misses it.
        apikey: 'ak_live_2',
        credential: 'basic dXNlcjpwYXNz',
        passcode: '4821',
        // A Slack-style webhook URL is a bearer credential whose name matches
        // nothing else in the pattern.
        webhook_url: 'https://hooks.example.com/T000/B000/xoxb',
        // A column literally named `key`.
        key: 'sk_live_3',
        // NOT a secret. The bare-key rule is anchored so this survives; an
        // unanchored `key` alternation would blank matter substance.
        key_facts: ['signed on the 4th'],
        // Not a credential either: a link, and the organization's own.
        source_url: 'https://example.com/source',
      },
    ];
    const archive = await archiveOf(await GET(request()));
    const doc = archive.data.firm_documents[0];
    expect(doc.name).toBe('Retainer.pdf');
    for (const column of [
      'share_token',
      'webhook_secret',
      'api_key',
      'password_hint',
      'access_code_hash',
      'apikey',
      'credential',
      'passcode',
      'webhook_url',
      'key',
    ]) {
      expect(doc[column]).toBe('[redacted]');
    }
    expect(doc.key_facts).toEqual(['signed on the 4th']);
    expect(doc.source_url).toBe('https://example.com/source');
  });

  it('blanks the chat thread key, and leaves what recovers it', async () => {
    const archive = await archiveOf(await GET(request()));
    const message = archive.data.case_chat_messages[0];
    // A known false positive of the credential-name guard: thread_key ends in
    // _key. It costs nothing, because the same grouping reads back from the
    // two columns beside it.
    expect(message.thread_key).toBe('[redacted]');
    expect(message.thread_kind).toBe('dm');
    expect(message.participants).toEqual(['user-a', 'user-b']);
  });

  it('says nothing about the organization data being deleted', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive._meta.notes.join(' ').toLowerCase()).not.toMatch(
      /delet|erase|purge|removed after/,
    );
  });
});

describe('the archive only claims completeness it can prove', () => {
  it('pages past the response ceiling', async () => {
    db.tables.firm_documents = Array.from({ length: 2400 }, (_, i) => ({
      id: `doc-${String(i).padStart(5, '0')}`,
      firm_id: 'firm-1',
    }));
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_documents).toHaveLength(2400);
    expect(archive._summary.tables.firm_documents).toBe(2400);
    expect(archive._summary.complete).toBe(true);
  });

  it('pages whole when the server row cap is below the page size', async () => {
    // db-max-rows is a server setting this repo does not control. Terminating
    // on "the page came back shorter than I asked for" is only correct while
    // that setting happens to match PAGE_SIZE.
    db.serverMaxRows = 500;
    db.tables.firm_documents = Array.from({ length: 2400 }, (_, i) => ({
      id: `doc-${String(i).padStart(5, '0')}`,
      firm_id: 'firm-1',
    }));
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_documents).toHaveLength(2400);
    expect(archive._summary.complete).toBe(true);
  });

  it('is not complete when a table fails to read', async () => {
    db.failing.firm_documents = 'boom: connection reset';
    const archive = await archiveOf(await GET(request()));
    expect(archive._summary.errors.firm_documents).toContain('boom');
    expect(archive._summary.complete).toBe(false);
    // The rest of the archive still ships.
    expect(archive.data.cases).toHaveLength(1);
  });

  it('names the tables it could not scope when the matter list fails', async () => {
    db.failing.cases = 'boom: connection reset';
    const archive = await archiveOf(await GET(request()));
    // The case-substance tables hang off the case ids. If the case read
    // failed, exporting them against a partial id list would hand back a
    // fraction of the evidence in a table that looked simply empty.
    for (const table of [
      'case_timeline_events',
      'exhibits',
      'case_legal_reviews',
    ]) {
      expect(archive._summary.errors[table]).toContain('cases');
    }
    expect(archive._summary.complete).toBe(false);
  });

  it('is not complete when a table comes back short of its count', async () => {
    db.countOverride.firm_documents = 5400;
    const archive = await archiveOf(await GET(request()));
    expect(archive._summary.tables.firm_documents).toBe(1);
    expect(archive._summary.expected.firm_documents).toBe(5400);
    expect(archive._summary.shortfalls.firm_documents).toEqual({
      expected: 5400,
      exported: 1,
    });
    expect(archive._summary.complete).toBe(false);
  });

  it('is not complete when the database reports no count at all', async () => {
    // supabase-js gives count: null with no error whenever Content-Range is
    // missing or unparsed. That is the check itself failing to run, so
    // counting it as zero makes every table match, nothing is ever short, and
    // the mechanism that detects a partial archive reports success while dark.
    db.countNull.firm_documents = true;
    const archive = await archiveOf(await GET(request()));
    expect(archive._summary.tables.firm_documents).toBe(1);
    // No number the archive stands behind, so none is offered.
    expect(archive._summary.expected.firm_documents).toBeUndefined();
    expect(archive._summary.shortfalls.firm_documents).toBeUndefined();
    expect(archive._summary.unverified).toContain('firm_documents');
    expect(archive._summary.complete).toBe(false);
  });

  it('carries an unverified matter list down to the matter substance', async () => {
    // A parent whose count went unreported may have handed a partial id list
    // to its children, and a child scoped to a partial list matches its own
    // count and looks clean. The doubt has to travel with the ids.
    db.countNull.cases = true;
    const archive = await archiveOf(await GET(request()));
    expect(archive._summary.unverified).toContain('cases');
    for (const table of ['case_timeline_events', 'exhibits', 'case_people']) {
      expect(archive._summary.unverified).toContain(table);
    }
    expect(archive._summary.complete).toBe(false);
  });
});

describe('the archive says what completeness it is claiming', () => {
  const notesOf = async () =>
    (await archiveOf(await GET(request())))._meta.notes.join(' ');

  it('says what complete certifies, and what it cannot', async () => {
    const notes = await notesOf();
    // A recipient who reads complete: true as "my matter is whole" is being
    // misled by a true statement, so the archive has to say which one it is.
    expect(notes).toContain('does not certify that a matter is whole');
    expect(notes).toMatch(/never appear in _summary\.errors/);
  });

  it('names unverified as a failure rather than a pass', async () => {
    const notes = await notesOf();
    expect(notes).toContain('unverified');
    expect(notes).toContain('the check itself did not run');
  });

  it('says firm_signatures is column-limited and that counts cannot show it', async () => {
    const notes = await notesOf();
    expect(notes).toMatch(/fixed column list/);
    expect(notes).toContain('invisible to the completeness check');
  });

  /**
   * The note has to be right in BOTH directions, and it used to be wrong in
   * both. It told a departing organization that /counsel/documents/<id> was
   * an open question when the allowlist had already answered it in the
   * negative, and that case_timeline_events.media had no download page at all
   * when the evidence download route was exempted from the access gate
   * specifically so that the archive would not be an index to nothing.
   */
  it('states the file limitation without disowning the door that was left open', async () => {
    const notes = await notesOf();
    // Decided, in the negative. Absent from ALWAYS_ALLOWED, so a gated
    // organization is redirected off it.
    expect(notes).toContain('/counsel/documents/<id>');
    expect(notes).toMatch(/NOT reachable once access has ended/);
    expect(notes).not.toMatch(/has not been made/);
    // Decided, in the positive, and the note must say so.
    expect(notes).toContain('case_timeline_events.media');
    expect(notes).toMatch(/can still be downloaded/);
    // exhibits.storage_path is a different table and the evidence download
    // does not serve it, so it stays named as not covered.
    expect(notes).toContain('exhibits.storage_path');
    expect(notes).toMatch(/not covered by the evidence download/);
  });

  it('says why the meeting join link stays', async () => {
    const notes = await notesOf();
    expect(notes).toContain('firm_meetings keeps its join link');
  });
});

describe('the export is exempt from the access gate', () => {
  /**
   * The organization in the fixture is both expired and suspended, which is
   * every way an organization can be export_only. If a future change makes
   * this route consult access state, this is the test that fails.
   */
  it('exports an expired and suspended organization', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const archive = await archiveOf(res);
    expect(archive._summary.complete).toBe(true);
    expect(archive.data.cases).toHaveLength(1);
  });
});

describe('the export is audited', () => {
  it('logs one data_exported event before the transfer, naming the organization', async () => {
    const res = await GET(request());
    // Logged at authorization time, not on completion: a download the client
    // abandons still handed out rows.
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0][0];
    expect(event.kind).toBe('data_exported');
    expect(event.userId).toBe('user-owner');
    expect(event.details?.scope).toBe('organization');
    expect(event.details?.firmId).toBe('firm-1');
    expect(event.details?.refused).toBeFalsy();
    await res.text();
  });

  it('names the real operator when HQ is acting as the owner', async () => {
    db.realUser = { id: 'user-hq', email: 'ops@advottic.com' };
    const res = await GET(request());
    const event = logSecurityEvent.mock.calls[0][0];
    // Logging only the effective user would attribute a whole-organization
    // download to the owner and lose the operator entirely.
    expect(event.details?.actingVia).toEqual({
      operatorId: 'user-hq',
      operatorEmail: 'ops@advottic.com',
    });
    await res.text();
  });

  it('leaves actingVia null when the caller is acting as nobody', async () => {
    const res = await GET(request());
    expect(logSecurityEvent.mock.calls[0][0].details?.actingVia).toBeNull();
    await res.text();
  });
});

describe('the old export path', () => {
  it('redirects to the canonical route and keeps the query string', () => {
    const res = legacyGET(
      request('https://app.advottic.com/api/counsel/firm-export?firmId=firm-9'),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(
      'https://app.advottic.com/api/firm/export?firmId=firm-9',
    );
  });
});
