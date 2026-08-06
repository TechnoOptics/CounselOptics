import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  toInstant,
  firmAccessState,
  seatCheck,
  counselAccessRedirect,
  isAccessEndedError,
  displayableDigest,
  ACCESS_ENDED_PATH,
  ACCESS_ENDED_CODE,
  type FirmAccessInput,
} from '../lib/firm-access';

const ROOT = join(__dirname, '..');

/**
 * The stand-in for the service-role client, so the enforcement tests below run
 * the REAL path: requireActiveFirm -> firmTrialState -> firmAccessState. A
 * test that called firmAccessState directly would prove nothing about the
 * gate, because the failure being hunted here is a catch sitting between the
 * two.
 */
const supa = vi.hoisted(() => ({
  configured: true,
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () =>
    supa.configured
      ? {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: supa.row, error: supa.error }),
              }),
            }),
          }),
        }
      : null,
}));

// lib/firm-authz.ts reaches for the user-scoped client for its role checks.
// Nothing under test here calls one, so the mock exists only to keep
// next/headers out of the Node test environment.
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => {
    throw new Error('the user-scoped client is not part of this test');
  },
  getCurrentUser: async () => null,
  getSupabaseUrl: () => undefined,
}));

const T0 = new Date('2026-08-01T12:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function firm(over: Partial<FirmAccessInput> = {}): FirmAccessInput {
  return { trialEndsAt: null, suspendedAt: null, ...over };
}

describe('toInstant', () => {
  it('accepts a Date unchanged', () => {
    expect(toInstant(T0).getTime()).toBe(T0.getTime());
  });

  it('accepts the ISO string shapes PostgREST actually returns', () => {
    for (const s of [
      '2026-08-01T12:00:00+00:00',
      '2026-08-01T12:00:00.123456+00:00',
      '2026-08-01 12:00:00+00',
    ]) {
      expect(Number.isNaN(toInstant(s).getTime())).toBe(false);
    }
  });

  // Every timestamp this repo WRITES goes through toISOString(), which produces
  // the trailing-Z shape, and any value that round-trips through JSON keeps it.
  it('accepts the trailing-Z shape that toISOString and JSON produce', () => {
    for (const s of ['2026-08-01T12:00:00Z', '2026-08-01T12:00:00.000Z']) {
      expect(toInstant(s).getTime()).toBe(T0.getTime());
    }
  });

  it('throws rather than failing open on an unparseable value', () => {
    expect(() => toInstant('garbage')).toThrow();
    expect(() => toInstant('')).toThrow();
  });

  // The guard has to cover the Date branch too. An Invalid Date object compares
  // false against everything, so letting one through reads as "not yet expired".
  it('throws on an Invalid Date object, not only on a bad string', () => {
    expect(() => toInstant(new Date('garbage'))).toThrow();
  });

  // new Date(null) is the epoch, which is a VALID Date, so the NaN guard alone
  // does not catch it. An epoch "now" is before every trial end, so coercing
  // instead of rejecting would report every expired organization as active.
  it('throws on null and undefined rather than coercing them to the epoch', () => {
    expect(() => toInstant(null as unknown as Date)).toThrow();
    expect(() => toInstant(undefined as unknown as Date)).toThrow();
  });

  // The guard has to reject by TYPE, not merely reject nullish values.
  // Narrowing it to `value == null` would let a number coerce again, and
  // new Date(0) is the epoch, which is the same fail-open through a second
  // door. A deliberate Date object at the epoch is still legitimate.
  it('throws on a number or an object rather than coercing them', () => {
    expect(() => toInstant(0 as unknown as Date)).toThrow();
    expect(() => toInstant({} as unknown as Date)).toThrow();
  });

  it('still accepts a Date deliberately constructed at the epoch', () => {
    expect(toInstant(new Date(0)).getTime()).toBe(0);
  });
});

describe('firmAccessState', () => {
  it('is active when the organization is not on a trial', () => {
    expect(firmAccessState(firm(), T0)).toBe('active');
  });

  it('is active while the trial is running', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(5) }), T0)).toBe('active');
  });

  it('is export_only once the trial end has passed', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(-1) }), T0)).toBe('export_only');
  });

  it('is export_only exactly at the trial end', () => {
    expect(firmAccessState(firm({ trialEndsAt: T0 }), T0)).toBe('export_only');
  });

  it('is export_only when suspended, even with a trial still running', () => {
    const f = firm({ trialEndsAt: days(30), suspendedAt: days(-1) });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('is export_only when suspended and not on a trial at all', () => {
    expect(firmAccessState(firm({ suspendedAt: days(-1) }), T0)).toBe('export_only');
  });

  // Suspension is presence, not a date. Both suspension tests above use a PAST
  // suspendedAt, so without this one the check could be refactored into
  // `suspendedAt != null && toInstant(suspendedAt) <= at` and stay green,
  // silently turning the field into an effective-from date that leaves
  // scheduled organizations open until it arrives.
  it('is export_only the moment suspendedAt is set, even dated in the future', () => {
    expect(firmAccessState(firm({ suspendedAt: days(5) }), T0)).toBe('export_only');
  });

  // A MISSING field must not read as "not suspended". This is the same
  // fail-open as an unparseable value: the type system says it cannot happen,
  // and it arrives from a boundary the type system does not police, such as a
  // .select() that omits the column or a row round-tripped through JSON.
  it('rejects a firm missing suspendedAt instead of reporting active', () => {
    const noSuspended = { trialEndsAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(noSuspended, T0)).toThrow();
  });

  it('rejects a firm missing trialEndsAt instead of reporting active', () => {
    const noTrial = { suspendedAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(noTrial, T0)).toThrow();
  });

  // A key that is present but explicitly undefined is just as absent, and a
  // key-presence test would wave it through. A row mapper writing
  // `suspendedAt: row.suspended_at` off a row that lacks the column produces
  // exactly this, and the consequence is a suspended organization reading as
  // active.
  it('rejects a firm whose suspendedAt is present but undefined', () => {
    const f = { trialEndsAt: null, suspendedAt: undefined } as unknown as FirmAccessInput;
    expect(() => firmAccessState(f, T0)).toThrow();
  });

  it('rejects a firm whose trialEndsAt is present but undefined', () => {
    const f = { trialEndsAt: undefined, suspendedAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(f, T0)).toThrow();
  });

  // The other direction: a present null is the normal shape PostgREST returns
  // for a selected null column, and must stay perfectly acceptable.
  it('accepts explicit nulls for both fields, which is what PostgREST returns', () => {
    expect(firmAccessState({ trialEndsAt: null, suspendedAt: null }, T0)).toBe('active');
  });

  it('reads an expired trial supplied as an ISO STRING as export_only', () => {
    const f = firm({ trialEndsAt: '2026-07-31T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('reads a running trial supplied as an ISO STRING as active', () => {
    const f = firm({ trialEndsAt: '2026-09-01T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('active');
  });

  // The clock is injected, and it is a FirmTimestamp too. If `now` were used
  // raw, a string clock against a Date trial end would compare NaN, which is
  // false, which reads as active forever.
  it('normalises the injected clock when it arrives as an ISO STRING', () => {
    const nowText = '2026-08-01T12:00:00+00:00';
    expect(firmAccessState(firm({ trialEndsAt: days(-1) }), nowText)).toBe('export_only');
    expect(firmAccessState(firm({ trialEndsAt: days(5) }), nowText)).toBe('active');
  });

  it('rejects an unparseable clock instead of reporting active', () => {
    expect(() => firmAccessState(firm({ trialEndsAt: days(-1) }), 'garbage')).toThrow();
  });

  // The clock is validated unconditionally, before any early return. Suspended
  // is the one branch that never consults the clock, so it is the branch a
  // refactor would move the validation below. Pinning it keeps that decision
  // enforced rather than merely commented.
  it('rejects an unparseable clock even on the branch that never reads it', () => {
    expect(() => firmAccessState(firm({ suspendedAt: days(-1) }), 'garbage')).toThrow();
  });

  it('rejects an unparseable trial end instead of reporting active', () => {
    expect(() => firmAccessState(firm({ trialEndsAt: 'garbage' }), T0)).toThrow();
  });

  // Safe by construction, since both operands go through toInstant, but the
  // shape a real caller is most likely to produce: every timestamp a string.
  it('handles the clock and the trial end both arriving as ISO STRINGS', () => {
    const nowText = '2026-08-01T12:00:00+00:00';
    expect(firmAccessState(firm({ trialEndsAt: '2026-07-31T12:00:00+00:00' }), nowText)).toBe('export_only');
    expect(firmAccessState(firm({ trialEndsAt: '2026-09-01T12:00:00+00:00' }), nowText)).toBe('active');
  });
});

describe('seatCheck', () => {
  it('allows adding when there is no limit', () => {
    expect(seatCheck({ seatLimit: null, currentMembers: 99 }).ok).toBe(true);
  });

  it('allows adding below the limit', () => {
    expect(seatCheck({ seatLimit: 5, currentMembers: 4 }).ok).toBe(true);
  });

  it('refuses adding at the limit', () => {
    const r = seatCheck({ seatLimit: 5, currentMembers: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });

  it('refuses adding above the limit, and never reports an ejection', () => {
    const r = seatCheck({ seatLimit: 3, currentMembers: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });

  // A zero seat limit is a real limit, not an absent one. Testing the limit for
  // truthiness rather than for null would turn it into "unlimited".
  it('refuses adding when the limit is zero', () => {
    const r = seatCheck({ seatLimit: 0, currentMembers: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });
});

describe('counselAccessRedirect', () => {
  it('lets an active organization through on every route', () => {
    expect(counselAccessRedirect('/counsel/cases', 'active')).toBeNull();
    expect(counselAccessRedirect(ACCESS_ENDED_PATH, 'active')).toBeNull();
  });

  it('sends an export_only organization to the access-ended page', () => {
    expect(counselAccessRedirect('/counsel/cases', 'export_only')).toBe(
      ACCESS_ENDED_PATH,
    );
  });

  // The whole point of the allowlist. A page that redirects to itself is an
  // INFINITE redirect, and an organization that can never land is worse off
  // than one that was simply locked out: the data this design exists to
  // preserve becomes unreachable.
  it('does not redirect the access-ended page to itself', () => {
    expect(counselAccessRedirect(ACCESS_ENDED_PATH, 'export_only')).toBeNull();
  });

  // "Exactly once", stated as the property rather than as two separate facts:
  // follow the redirect and the destination must produce no further redirect.
  it('redirects a non-export counsel route exactly once', () => {
    const first = counselAccessRedirect('/counsel/cases', 'export_only');
    expect(first).toBe(ACCESS_ENDED_PATH);
    expect(counselAccessRedirect(first as string, 'export_only')).toBeNull();
  });

  // Rule 4 of the plan: the export endpoint must never sit inside the gated
  // set. Nothing routes /api/* through the counsel layout today, so this is
  // the rule written down where a future caller cannot miss it.
  it('never gates the organization export or sign-out', () => {
    expect(counselAccessRedirect('/api/firm/export', 'export_only')).toBeNull();
    expect(counselAccessRedirect('/auth/sign-out', 'export_only')).toBeNull();
  });

  it('never gates static assets', () => {
    expect(
      counselAccessRedirect('/_next/static/chunk.js', 'export_only'),
    ).toBeNull();
  });

  // The gate runs on the user's ACTIVE firm, so an attorney whose current
  // organization has lapsed would otherwise be unable to open an invitation
  // from a DIFFERENT organization that pays: every click on the invitation
  // link lands them back here with no way through. Joining another
  // organization is not using this one.
  it('never gates the invitation-acceptance page', () => {
    expect(counselAccessRedirect('/counsel/accept-invite', 'export_only')).toBeNull();
  });

  /**
   * The export NAMES evidence files it does not carry: exhibits.storage_path
   * and case_timeline_events.media point into the `exhibits` bucket and the
   * bytes stay there. So the evidence download route is the only way a
   * departing organization opens the files its own export lists, and gating it
   * would leave the one open door handing back an index to nothing.
   *
   * It is the same deliberate exemption /api/firm/export has, and it relaxes
   * only the access STATE. The route's own authorization is untouched.
   */
  it('never gates the evidence retrieval route', () => {
    expect(
      counselAccessRedirect(
        '/counsel/cases/8f2a-1234/evidence/download',
        'export_only',
      ),
    ).toBeNull();
  });

  // The exemption is a pattern because the matter id is in the path, so it is
  // worth pinning that it did not become a prefix. Everything else under a
  // matter is still gated, including the surfaces next door to the download.
  it('gates the rest of the matter, including its neighbours', () => {
    for (const p of [
      '/counsel/cases/8f2a-1234',
      '/counsel/cases/8f2a-1234/evidence',
      '/counsel/cases/8f2a-1234/evidence/download/anything-else',
      '/counsel/cases/8f2a-1234/timeline',
      '/counsel/cases/8f2a-1234/export',
    ]) {
      expect(counselAccessRedirect(p, 'export_only'), p).toBe(ACCESS_ENDED_PATH);
    }
  });
});

/**
 * The identity of the refusal, which is what app/counsel/error.tsx matches on.
 *
 * The point of every test here is that the MESSAGE is not the identity. It is
 * copy, it will be edited, and a boundary that matched on it would silently
 * become a boundary that matches nothing.
 */
describe('the access-ended error identity', () => {
  it('recognises what requireActiveFirm actually throws', async () => {
    supa.configured = true;
    supa.row = { trial_ends_at: null, suspended_at: new Date().toISOString() };
    supa.error = null;
    const mod = await import('../lib/firm-authz');
    const caught = await mod
      .requireActiveFirm('firm-1')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(caught).not.toBeNull();
    expect(isAccessEndedError(caught)).toBe(true);
  });

  // The whole reason the class exists. Rewording the copy must not quietly
  // turn a targeted catch into a catch-nothing.
  it('survives a copy edit to the message', async () => {
    const { FirmAccessEndedError } = await import('../lib/firm-authz');
    expect(isAccessEndedError(new FirmAccessEndedError('anything at all'))).toBe(true);
  });

  // Across the server-to-client boundary of a Next error boundary the value
  // arrives as a plain object, and in production the message is redacted
  // before it gets there. `digest` is the field Next carries through.
  it('recognises the redacted plain object a client boundary receives', () => {
    expect(
      isAccessEndedError({
        message: 'An error occurred in the Server Components render.',
        digest: ACCESS_ENDED_CODE,
      }),
    ).toBe(true);
  });

  it('does not recognise an unrelated failure', () => {
    expect(isAccessEndedError(new Error('connection reset'))).toBe(false);
    expect(isAccessEndedError(null)).toBe(false);
    expect(isAccessEndedError('This organization’s access has ended.')).toBe(false);
  });
});

/**
 * The gate itself, driven through the real lookup rather than around it.
 *
 * Every assertion here is about a REFUSAL. The failure this suite exists to
 * catch is a catch block that yields an access state anywhere between
 * requireActiveFirm and firmAccessState, which turns the whole fail-closed
 * design into a fail-open one in two lines.
 */
describe('requireActiveFirm', () => {
  beforeEach(() => {
    supa.configured = true;
    supa.row = { trial_ends_at: null, suspended_at: null };
    supa.error = null;
  });

  async function requireActiveFirm(firmId: string): Promise<void> {
    const mod = await import('../lib/firm-authz');
    return mod.requireActiveFirm(firmId);
  }

  it('allows an organization with no trial and no suspension', async () => {
    await expect(requireActiveFirm('firm-1')).resolves.toBeUndefined();
  });

  it('allows an organization whose trial is still running', async () => {
    supa.row = {
      trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      suspended_at: null,
    };
    await expect(requireActiveFirm('firm-1')).resolves.toBeUndefined();
  });

  // The mutation target. Turning the export_only branch into a return, or
  // wrapping the whole body in a try that swallows, must make this fail.
  it('refuses an organization whose trial has ended', async () => {
    supa.row = {
      trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      suspended_at: null,
    };
    await expect(requireActiveFirm('firm-1')).rejects.toThrow(/access has ended/);
  });

  it('refuses a suspended organization', async () => {
    supa.row = {
      trial_ends_at: null,
      suspended_at: new Date().toISOString(),
    };
    await expect(requireActiveFirm('firm-1')).rejects.toThrow(/access has ended/);
  });

  // The most valuable test in this task. An unparseable stored timestamp makes
  // firmAccessState THROW, and that throw has to travel all the way out of the
  // gate. Anybody who wraps firmTrialState in a catch that yields a state turns
  // this organization from refused into allowed, and this is the only test that
  // can see it: the value is nonsense, so there is no "correct" state to
  // compute and no assertion on a returned state could ever notice.
  it('refuses an organization whose stored timestamp is unparseable', async () => {
    supa.row = { trial_ends_at: 'garbage', suspended_at: null };
    // The message is asserted, not merely "it threw". A bare toThrow() here
    // would pass against a missing export as happily as against a working gate.
    await expect(requireActiveFirm('firm-1')).rejects.toThrow(/unparseable/);
  });

  it('refuses when the row cannot be read at all', async () => {
    supa.row = null;
    supa.error = { message: 'connection reset' };
    await expect(requireActiveFirm('firm-1')).rejects.toThrow(
      /could not determine access/,
    );
  });

  it('refuses when the organization does not exist', async () => {
    supa.row = null;
    await expect(requireActiveFirm('firm-1')).rejects.toThrow(/does not exist/);
  });

  // The one deliberate fail-open, owned by lib/firm-trials.ts: an unconfigured
  // service-role key is a deployment fault affecting every organization at
  // once, not a fact about this one. Pinned here so that if it ever moves it
  // moves on purpose.
  it('allows when the service-role client is not configured at all', async () => {
    supa.configured = false;
    await expect(requireActiveFirm('firm-1')).resolves.toBeUndefined();
  });
});

/**
 * firmSuspended, the one question that separates a lapse from a suspension.
 *
 * FirmAccessState collapses the two into 'export_only' on purpose, because for
 * every write path the answer is the same. The counsel shell's co-counsel
 * guest branch is the single place the difference is load-bearing, and this
 * exists rather than a third access state so the exhaustive switches over that
 * union keep their meaning.
 *
 * It fails CLOSED on a read it could not complete, which for this caller means
 * the guest is sent to the access-ended page rather than admitted on the
 * strength of an answer nobody got.
 */
describe('firmSuspended', () => {
  beforeEach(() => {
    supa.configured = true;
    supa.row = { trial_ends_at: null, suspended_at: null };
    supa.error = null;
  });

  async function firmSuspended(firmId: string): Promise<boolean> {
    const mod = await import('../lib/firm-trials');
    return mod.firmSuspended(firmId);
  }

  it('is false for an organization that is merely lapsed', async () => {
    supa.row = {
      trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      suspended_at: null,
    };
    await expect(firmSuspended('firm-1')).resolves.toBe(false);
  });

  it('is true the moment suspended_at is set', async () => {
    supa.row = { trial_ends_at: null, suspended_at: new Date().toISOString() };
    await expect(firmSuspended('firm-1')).resolves.toBe(true);
  });

  // The mutation target: `if (error) return false` here would quietly readmit
  // a guest of a suspended organization on every transient database blip.
  it('refuses rather than reporting not-suspended on a read failure', async () => {
    supa.row = null;
    supa.error = { message: 'connection reset' };
    await expect(firmSuspended('firm-1')).rejects.toThrow(
      /could not determine access/,
    );
  });

  it('refuses when the organization does not exist', async () => {
    supa.row = null;
    await expect(firmSuspended('firm-1')).rejects.toThrow(/does not exist/);
  });

  // A select that forgot the column reads as "not suspended" without this.
  it('refuses a row that came back without the access column', async () => {
    supa.row = { trial_ends_at: null };
    await expect(firmSuspended('firm-1')).rejects.toThrow(/access columns/);
  });

  // The same deliberate fail-open firmTrialState has, pinned so it can only
  // move on purpose.
  it('is false when the service-role client is not configured at all', async () => {
    supa.configured = false;
    await expect(firmSuspended('firm-1')).resolves.toBe(false);
  });
});

/**
 * The page an export_only organization lands on. Rendered as a server
 * component and read as a tree, because vitest here runs environment: 'node'
 * with no DOM.
 */
describe('the access-ended page', () => {
  // The typographic apostrophe is normalised before comparing, so these
  // assertions pin the WORDS and stay indifferent to the glyph. The page
  // writes &rsquo;, which is this repo's convention in JSX copy everywhere
  // else; the required copy is quoted with a straight apostrophe.
  function textOf(node: unknown): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') {
      return String(node).replace(/’/g, "'");
    }
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    const el = node as { props?: { children?: unknown } };
    return el.props ? textOf(el.props.children) : '';
  }

  function hrefsOf(node: unknown, found: string[] = []): string[] {
    if (node == null || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
      for (const c of node) hrefsOf(c, found);
      return found;
    }
    const el = node as { props?: Record<string, unknown> };
    const href = el.props?.href;
    if (typeof href === 'string') found.push(href);
    if (el.props) hrefsOf(el.props.children, found);
    return found;
  }

  /**
   * `lookup` is the THREE-way answer the page now asks for: the caller holds
   * an admin role, the caller holds some other role, or the membership row
   * could not be read at all. The third is why callerFirmRoleLookup exists;
   * callerHasFirmRole collapses it into the second, which on this page tells
   * an owner to go and ask an owner.
   */
  async function render(
    lookup: { ok: true; role: string | null } | { ok: false },
  ) {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({
      getCurrentUser: async () => ({ id: 'u1', email: 'a@example.com' }),
      isSupabaseConfigured: () => true,
    }));
    vi.doMock('@/lib/firm-storage', () => ({
      getActiveFirmContext: async () => ({
        firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' },
        membership: { role: lookup.ok ? lookup.role : null },
      }),
      listMyFirms: async () => [],
    }));
    vi.doMock('@/lib/firm-authz', () => ({
      FIRM_ADMIN_ROLES: ['owner', 'admin'],
      callerFirmRoleLookup: async () => lookup,
    }));
    vi.doMock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
    const mod = await import('@/app/counsel/access-ended/page');
    return mod.default();
  }

  it('offers the export to an owner, and does not say anything is deleted', async () => {
    const tree = await render({ ok: true, role: 'owner' });
    const text = textOf(tree);
    expect(text).toContain("Your organization's access has ended");
    expect(text).toContain(
      'You can still download everything your organization has in Advottic. Your data is not being deleted.',
    );
    // Copy is a correctness requirement here. Under this design nothing is
    // deleted, so the page must not say or imply that anything will be.
    expect(text).not.toMatch(/will be deleted|deletion|erased|wiped|purged/i);
    expect(hrefsOf(tree)).toContain('/api/firm/export');
  });

  it('explains to an ordinary member, and offers them no export', async () => {
    const tree = await render({ ok: true, role: 'staff' });
    const text = textOf(tree);
    expect(text).toContain("Your organization's access has ended");
    expect(text).toContain(
      'An owner or an administrator at your organization can download your data. Speak to them if you need something from here.',
    );
    expect(hrefsOf(tree)).not.toContain('/api/firm/export');
  });

  // The page that hands the data back is the worst place to report a
  // transient read failure as a fact about the person. Failing closed on the
  // export is right and stays; telling an OWNER to go and ask an owner, with
  // nothing to click, is not. It has to say it could not check, and offer a
  // way to check again.
  it('says it could not check, rather than that they are not an admin', async () => {
    const tree = await render({ ok: false });
    const text = textOf(tree);
    expect(text).toContain("Your organization's access has ended");
    expect(text).toContain('We could not check what you can do here just now');
    expect(text).not.toContain('An owner or an administrator at your organization can download');
    expect(text).not.toMatch(/will be deleted|deletion|erased|wiped|purged/i);
    // Fails closed on the privilege: no export link on an unverified role.
    expect(hrefsOf(tree)).not.toContain('/api/firm/export');
    // And a neutral retry, which is the part that was missing.
    expect(text).toContain('Try again');
    expect(hrefsOf(tree)).toContain(ACCESS_ENDED_PATH);
  });
});

/**
 * The counsel error boundary, rendered for real.
 *
 * This exists because a throw from a gated action reaches a BROWSER in the
 * window between the access state flipping mid-session and that person's next
 * full navigation, which is when a paralegal clicks Save on work in progress.
 * Without the boundary they get "Something went wrong" on a save.
 *
 * renderToStaticMarkup runs the component with its hooks and without a DOM;
 * effects do not run under it, which is fine, because the branch under test is
 * what it renders and not what it reports.
 */
describe('the counsel error boundary', () => {
  // The access-ended page tests above leave a doMock on '@/lib/firm-authz'
  // registered, and it survives resetModules. Drop it, because the error class
  // under test here is a REAL export of that module.
  beforeEach(() => {
    vi.doUnmock('@/lib/firm-authz');
    vi.resetModules();
  });

  async function render(error: unknown) {
    vi.resetModules();
    vi.doMock('next/link', () => ({
      default: ({ href, children }: { href: string; children: unknown }) => ({
        type: 'a',
        props: { href, children },
        key: null,
        $$typeof: Symbol.for('react.element'),
      }),
    }));
    const [{ default: Boundary }, { renderToStaticMarkup }, React] =
      await Promise.all([
        import('@/app/counsel/error'),
        import('react-dom/server'),
        import('react'),
      ]);
    return renderToStaticMarkup(
      React.createElement(Boundary, {
        error: error as Error & { digest?: string },
        reset: () => {},
      }),
    );
  }

  it('renders calm copy for the refusal, and never claims a deletion', async () => {
    const { FirmAccessEndedError } = await import('../lib/firm-authz');
    const html = await render(new FirmAccessEndedError());
    expect(html).toContain('access has ended');
    expect(html).toContain('not being deleted');
    expect(html).not.toContain('Something went wrong');
    expect(html).toContain(ACCESS_ENDED_PATH);
  });

  // The shape a client boundary actually receives in production: a plain
  // object whose message has been redacted, carrying the digest.
  it('recognises the refusal after Next has redacted the message', async () => {
    const html = await render({
      message: 'An error occurred in the Server Components render.',
      digest: ACCESS_ENDED_CODE,
    });
    expect(html).toContain('access has ended');
    expect(html).not.toContain('Something went wrong');
  });

  // The other half. A boundary that showed the access copy for every failure
  // would be worse than no boundary: it would tell a firm its access ended
  // every time anything at all broke.
  it('falls through to the generic copy for anything else', async () => {
    const html = await render(new Error('connection reset'));
    expect(html).toContain('Something went wrong');
    expect(html).not.toContain('access has ended');
  });
});

/**
 * The NEARER boundary, which is the one that actually runs.
 *
 * app/counsel/cases/[id]/error.tsx already existed and sits below
 * app/counsel/error.tsx, so it wins for the entire matter workspace: every
 * gated evidence, signing, chat and timeline action lives under it. A refusal
 * raised there never reaches the segment boundary above, so the segment
 * boundary being correct proved nothing about the surface where the refusal
 * happens.
 *
 * It also PRINTED the digest. Since FirmAccessEndedError sets its digest to
 * the identity code so the identity survives Next's redaction, this boundary
 * was showing a locked-out person the literal string
 * "Reference: FIRM_ACCESS_ENDED".
 */
describe('the matter error boundary', () => {
  beforeEach(() => {
    vi.doUnmock('@/lib/firm-authz');
    vi.resetModules();
  });

  async function render(error: unknown) {
    vi.resetModules();
    vi.doMock('next/link', () => ({
      default: ({ href, children }: { href: string; children: unknown }) => ({
        type: 'a',
        props: { href, children },
        key: null,
        $$typeof: Symbol.for('react.element'),
      }),
    }));
    const [{ default: Boundary }, { renderToStaticMarkup }, React] =
      await Promise.all([
        import('@/app/counsel/cases/[id]/error'),
        import('react-dom/server'),
        import('react'),
      ]);
    return renderToStaticMarkup(
      React.createElement(Boundary, {
        error: error as Error & { digest?: string },
        reset: () => {},
      }),
    );
  }

  it('renders the refusal calmly instead of the generic matter copy', async () => {
    const html = await render({
      message: 'An error occurred in the Server Components render.',
      digest: ACCESS_ENDED_CODE,
    });
    expect(html).toContain('access has ended');
    expect(html).toContain('not being deleted');
    expect(html).toContain(ACCESS_ENDED_PATH);
    expect(html).not.toContain('finish loading');
  });

  // The half that leaked. Whatever else this renders, the internal identifier
  // is never on the page.
  it('never shows the identity code as a support reference', async () => {
    const html = await render({
      message: 'An error occurred in the Server Components render.',
      digest: ACCESS_ENDED_CODE,
    });
    expect(html).not.toContain(ACCESS_ENDED_CODE);
    expect(html).not.toContain('Reference:');
  });

  // And the boundary still does its original job.
  it('keeps the matter copy and the real reference for anything else', async () => {
    const html = await render(
      Object.assign(new Error('connection reset'), { digest: '3899621086' }),
    );
    expect(html).toContain('finish loading');
    expect(html).toContain('3899621086');
    expect(html).not.toContain('access has ended');
  });
});

/**
 * displayableDigest, the rule that stopped the leak above.
 *
 * A digest is normally an opaque hash Next generates so a person can quote a
 * support reference. Ours is a readable identifier, and the rule is general
 * rather than a check for this one code, because the next named digest anyone
 * adds would leak exactly the same way.
 */
describe('displayableDigest', () => {
  it('shows a digest Next generated', () => {
    expect(displayableDigest('3899621086')).toBe('3899621086');
  });

  it('withholds the access-ended identity code', () => {
    expect(displayableDigest(ACCESS_ENDED_CODE)).toBeNull();
  });

  it('withholds any other identifier this codebase might add later', () => {
    expect(displayableDigest('SOME_FUTURE_CODE')).toBeNull();
    expect(displayableDigest('NEXT_REDIRECT;push;/counsel')).toBeNull();
  });

  it('withholds a missing or non-string digest', () => {
    expect(displayableDigest(undefined)).toBeNull();
    expect(displayableDigest(null)).toBeNull();
    expect(displayableDigest(42)).toBeNull();
  });
});

/**
 * The client dispatch, which is where the refusal was being LOST.
 *
 * Every gated action is called inside `startTransition(async () => { const
 * res = await action(...) })`. This is React 18.3.1: startTransition calls
 * scope() and discards the promise it returns, and async rejections becoming
 * boundary errors is a React 19 Actions feature. So the refusal was an
 * unhandled rejection, `res` was never assigned, no error state was set, and
 * the dialog silently did nothing. A person in a locked-out organization
 * clicked Save and the button did not work.
 *
 * runGatedAction is safe where a catch beside the gate is not, and for the
 * same structural reason the boundary is: it runs in the browser, AFTER the
 * server has already refused. The write is gone. The only thing it can decide
 * is what the person is told.
 */
describe('runGatedAction', () => {
  it('turns the refusal into calm copy in the action’s own shape', async () => {
    const { runGatedAction, ACCESS_ENDED_NOTICE } = await import(
      '../lib/gated-action'
    );
    const { FirmAccessEndedError } = await import('../lib/firm-authz');
    const res = await runGatedAction<{ ok: boolean; error?: string }>(async () => {
      throw new FirmAccessEndedError();
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(ACCESS_ENDED_NOTICE);
    expect(ACCESS_ENDED_NOTICE).toContain('not being deleted');
  });

  // The shape the browser actually receives once Next has redacted it.
  it('recognises the refusal after Next has redacted the message', async () => {
    const { runGatedAction, ACCESS_ENDED_NOTICE } = await import(
      '../lib/gated-action'
    );
    const res = await runGatedAction(async () => {
      throw Object.assign(new Error('An error occurred'), {
        digest: ACCESS_ENDED_CODE,
      });
    });
    expect((res as { error: string }).error).toBe(ACCESS_ENDED_NOTICE);
  });

  // The half that stops this becoming a general-purpose swallow. Anything
  // that is not the refusal must come out exactly as it went in, or one
  // helper quietly hides every failure in the counsel app.
  it('rethrows everything that is not the refusal', async () => {
    const { runGatedAction } = await import('../lib/gated-action');
    await expect(
      runGatedAction(async () => {
        throw new Error('connection reset');
      }),
    ).rejects.toThrow('connection reset');
  });

  it('passes a successful result straight through', async () => {
    const { runGatedAction } = await import('../lib/gated-action');
    const res = await runGatedAction(async () => ({ ok: true, id: 'abc' }));
    expect(res).toEqual({ ok: true, id: 'abc' });
  });
});

/**
 * Layer one, the shell redirect, as BEHAVIOUR.
 *
 * A source test that only checks the two tokens are present is blind to the
 * mutation that keeps both and replaces `if (destination) redirect(destination)`
 * with `void destination`. That is the whole layer, deleted, with every token
 * intact. So the layout is rendered against stand-in modules and the redirect
 * is observed.
 */
describe('the counsel shell redirect', () => {
  async function renderLayout(
    state: 'active' | 'export_only',
    pathname: string,
    guest?: { firmId: string | null; suspended: boolean },
  ): Promise<{ redirectedTo: string | null }> {
    vi.resetModules();
    vi.doMock('next/navigation', () => ({
      // Next's redirect throws, and the layout relies on that: nothing after
      // it runs. Mirroring the throw is what makes "did it redirect" and "did
      // it fall through" distinguishable at all.
      redirect: (url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      },
    }));
    vi.doMock('next/headers', () => ({
      headers: () => ({
        get: (k: string) => (k === 'x-pathname' ? pathname : null),
      }),
    }));
    vi.doMock('next/link', () => ({ default: () => null }));
    vi.doMock('@/lib/supabase/server', () => ({
      getCurrentUserResult: async () => ({ user: { id: 'u1' } }),
      isSupabaseConfigured: () => true,
    }));
    vi.doMock('@/lib/firm-storage', () => ({
      // A guest is resolved only when the caller has NO firm membership.
      listMyFirms: async () =>
        guest
          ? []
          : [
              { firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' }, membership: { role: 'owner' } },
            ],
      getActiveFirmContext: async () => ({
        firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' },
        membership: { role: 'owner' },
      }),
    }));
    // The real lib/firm-access is deliberately NOT mocked: the allowlist under
    // test is the one that ships.
    vi.doMock('@/lib/firm-trials', () => ({
      firmTrialState: async () => state,
      firmSuspended: async () => guest?.suspended ?? false,
    }));
    vi.doMock('@/lib/firm-settings', () => ({
      getFirmSurfaceSettings: async () => ({ hideSearch: false, hideTimeBilling: false }),
      DEFAULT_FIRM_SURFACE_SETTINGS: { hideSearch: false, hideTimeBilling: false },
    }));
    vi.doMock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
    vi.doMock('@/lib/counsel-guest', () => ({
      getGuestContext: async () =>
        guest
          ? {
              firmId: guest.firmId,
              firm: { id: guest.firmId, name: 'Rowan and Hale', accentColor: '#caa044' },
              mustChangePassword: false,
            }
          : null,
      guestPathAllowed: () => true,
      guestFallbackPath: () => '/counsel',
    }));
    // The chrome, stubbed. None of these is ever invoked: a server component
    // returns an element tree that merely HOLDS the component function, so
    // the stubs exist only so the layout's imports resolve under node.
    for (const [mod, names] of Object.entries(CHROME)) {
      vi.doMock(mod, () =>
        Object.fromEntries(names.map((n) => [n, () => null])),
      );
    }
    const mod = await import('@/app/counsel/layout');
    try {
      await mod.default({ children: null });
      return { redirectedTo: null };
    } catch (e) {
      const message = (e as Error).message ?? '';
      if (!message.startsWith('NEXT_REDIRECT:')) throw e;
      return { redirectedTo: message.slice('NEXT_REDIRECT:'.length) };
    }
  }

  const CHROME: Record<string, readonly string[]> = {
    '@/components/auth/SessionReconnect': ['SessionReconnect'],
    '@/components/counsel/CounselSidebar': ['CounselSidebar'],
    '@/components/counsel/CounselTrialBanner': ['CounselTrialBanner'],
    '@/components/counsel/CounselHeader': ['CounselHeader'],
    '@/components/counsel/CounselGuestHeader': ['CounselGuestHeader'],
    '@/components/counsel/AskAdvottic': ['AskAdvottic'],
    '@/components/counsel/SidebarFocus': [
      'SidebarCollapseProvider',
      'CounselSidebarShell',
    ],
    '@/components/i18n/LocaleProvider': ['LocaleProvider', 'T'],
  };

  it('sends an export_only organization to the access-ended page', async () => {
    expect((await renderLayout('export_only', '/counsel/cases')).redirectedTo).toBe(
      ACCESS_ENDED_PATH,
    );
  });

  it('lets an active organization through', async () => {
    expect((await renderLayout('active', '/counsel/cases')).redirectedTo).toBeNull();
  });

  // The allowlist reaching all the way through the layout, not merely through
  // the pure function. An attorney at a lapsed organization opening an
  // invitation from one that pays must land on the invitation.
  it('does not trap the invitation page behind the gate', async () => {
    expect(
      (await renderLayout('export_only', '/counsel/accept-invite')).redirectedTo,
    ).toBeNull();
  });

  /**
   * The co-counsel guest exemption, narrowed to LAPSED TRIALS.
   *
   * A guest is an outside attorney the firm invited onto one matter. A lapse
   * is a billing fact about the firm, and cutting the guest off takes a matter
   * away from the lawyer working it to punish a third party for someone else's
   * invoice. A SUSPENSION is the abuse-response state, the same one that
   * justifies stopping outbound mail in Advottic's name, and while it holds an
   * account the firm itself provisioned is a channel the suspension exists to
   * close rather than a neutral third party.
   *
   * Their writes are refused in both states, by requireActiveFirm in the
   * actions, which does not care whether the caller is a member or a guest.
   */
  it('lets a co-counsel guest keep reading when the trial merely lapsed', async () => {
    const res = await renderLayout('export_only', '/counsel/cases/abc', {
      firmId: 'firm-1',
      suspended: false,
    });
    expect(res.redirectedTo).toBeNull();
  });

  it('closes the guest shell when the organization is suspended', async () => {
    const res = await renderLayout('export_only', '/counsel/cases/abc', {
      firmId: 'firm-1',
      suspended: true,
    });
    expect(res.redirectedTo).toBe(ACCESS_ENDED_PATH);
  });

  // Suspension outranks everything, so it closes an organization whose trial
  // is still running too.
  it('closes the guest shell on suspension even mid-trial', async () => {
    const res = await renderLayout('active', '/counsel/cases/abc', {
      firmId: 'firm-1',
      suspended: true,
    });
    expect(res.redirectedTo).toBe(ACCESS_ENDED_PATH);
  });
});

/**
 * The shell half of the two-layer rule, and the seat cap.
 *
 * These read source rather than behaviour, deliberately and with the tradeoff
 * stated: a Next layout and a 'use server' module of this size cannot be
 * rendered under environment: 'node' without a mock harness larger than the
 * code it checks. They catch a deletion, which is the regression that actually
 * happens, and they do not claim to prove the runtime behaviour. The gate that
 * IS proven behaviourally is requireActiveFirm above, which is the half that
 * matters, because the redirect is only a courtesy to a browser.
 */
describe('the enforcement wiring', () => {
  const counselLayout = readFileSync(join(ROOT, 'app/counsel/layout.tsx'), 'utf8');
  const portalLayout = readFileSync(join(ROOT, 'app/portal/layout.tsx'), 'utf8');
  const firmActions = readFileSync(join(ROOT, 'lib/firm-actions.ts'), 'utf8');

  it('gates the counsel shell on a fresh trial state', () => {
    expect(counselLayout).toMatch(/firmTrialState\(/);
    expect(counselLayout).toMatch(/counselAccessRedirect\(/);
  });

  it('gates the portal shell too, and sends people to the same page', () => {
    expect(portalLayout).toMatch(/firmTrialState\(/);
    expect(portalLayout).toMatch(/redirect\(ACCESS_ENDED_PATH\)/);
  });

  // The destination has to be outside every gate in the counsel layout, or a
  // Hub employee redirected there is bounced straight on by the
  // firm-membership check and never sees the page.
  it('leaves the access-ended page outside the counsel layout gates', () => {
    expect(counselLayout).toMatch(
      /isSelfShelledCounselRoute[\s\S]{0,300}\/counsel\/access-ended/,
    );
  });

  // A catch that yields an access state is the two-line fail-open this whole
  // feature is built to avoid. Neither layout may hold the word.
  it('never wraps the shell gate in a catch', () => {
    for (const src of [counselLayout, portalLayout]) {
      const gate = src.slice(src.indexOf('firmTrialState('));
      expect(gate.slice(0, 400)).not.toMatch(/catch/);
    }
  });

  const evidenceActions = readFileSync(join(ROOT, 'lib/case-evidence-actions.ts'), 'utf8');
  const signingActions = readFileSync(join(ROOT, 'lib/signing-actions.ts'), 'utf8');
  const importActions = readFileSync(join(ROOT, 'lib/import-actions.ts'), 'utf8');
  const migrationActions = readFileSync(join(ROOT, 'lib/migration-actions.ts'), 'utf8');
  const accessActions = readFileSync(join(ROOT, 'lib/access-actions.ts'), 'utf8');
  const lettersActions = readFileSync(join(ROOT, 'lib/letters-actions.ts'), 'utf8');

  /**
   * The source of one exported action, from its `export async function` line
   * to the next top-level `export`.
   *
   * KNOWN IMPRECISION, stated because a source-text invariant that looks total
   * is worse than one that admits its edges. The slice runs to the next
   * `\nexport `, so a private helper defined between two exports is counted as
   * part of the earlier one: sendFirmMessageAction's "body" is over 450 lines
   * and createSigningRequestAction's over 400. The PRESENCE half below can
   * therefore be satisfied by a `requireActiveFirm(` token sitting in a
   * sibling helper rather than in the action itself. The ORDERING half mostly
   * compensates, because the gate still has to precede the first write in the
   * same slice, but "mostly" is the honest word: a gate in a helper that
   * happens to be positioned above the action's first write would pass both.
   */
  function bodyOf(src: string, fn: string): string {
    const start = src.indexOf(`export async function ${fn}`);
    expect(start, `${fn} is missing`).toBeGreaterThan(-1);
    const end = src.indexOf('\nexport ', start + 1);
    return src.slice(start, end === -1 ? undefined : end);
  }

  /**
   * The half that is not a courtesy. These actions are public HTTP endpoints,
   * so a person whose browser was redirected to the access-ended page can
   * still call them by hand, and the redirect above does nothing about it.
   *
   * The rule this list follows is TWINS. Gating one path of a pair and
   * leaving the other open gates nothing, because the open one does the same
   * work: two matter-creation paths, two evidence intakes, three points in
   * the signing lifecycle, two ways to add a person. Plus the two paths that
   * send outbound mail and calendar invitations in Advottic's name, which a
   * SUSPENDED organization, the abuse-response state, must not keep doing.
   *
   * It is NOT every firm action in the codebase. There are 57 exported
   * actions in lib/firm-actions.ts alone and 301 across 47 'use server'
   * modules; the full sweep is its own task. The report says so rather than
   * implying this is finished.
   *
   * The second round of twins is the IMPORT surface, all of it reachable from
   * one screen, components/counsel/import/ImportPanels.tsx. Gating the
   * one-at-a-time path and leaving the bulk one open gates nothing, and the
   * bulk one is the higher-volume version of the same write: a matter is
   * created by five paths, not two, and three of them are here.
   */
  const GATED: ReadonlyArray<{ label: string; src: string; fn: string }> = [
    ...[
      'inviteFirmMemberAction',
      'acceptFirmInvitationAction',
      'inviteFirmClientAction',
      'uploadFirmDocumentAction',
      'createSigningRequestAction',
      'createFirmCaseAction',
      'convertIntakeToCaseAction',
      'addFirmEmployeeAction',
      'sendFirmMessageAction',
      'scheduleStandaloneMeetingAction',
    ].map((fn) => ({ label: `firm-actions:${fn}`, src: firmActions, fn })),
    ...['bulkImportCaseEvidenceAction', 'importCaseEvidenceFromUrlsAction'].map(
      (fn) => ({ label: `case-evidence-actions:${fn}`, src: evidenceActions, fn }),
    ),
    ...['recallSigningRequestAction', 'reopenSigningRequestAction'].map((fn) => ({
      label: `signing-actions:${fn}`,
      src: signingActions,
      fn,
    })),
    ...[
      'importClientsCsvAction',
      'importEmployeesCsvAction',
      'importCasesCsvAction',
      'importBulkDocumentAction',
      'importJsonDumpAction',
    ].map((fn) => ({ label: `import-actions:${fn}`, src: importActions, fn })),
    {
      label: 'migration-actions:importMigrationBundleAction',
      src: migrationActions,
      fn: 'importMigrationBundleAction',
    },
    {
      label: 'access-actions:approveAccessRequestAction',
      src: accessActions,
      fn: 'approveAccessRequestAction',
    },
    {
      label: 'letters-actions:saveLetterToCaseAction',
      src: lettersActions,
      fn: 'saveLetterToCaseAction',
    },
  ];

  /** Every module that holds a gate, for the whole-file invariants below. */
  const GATE_SOURCES: ReadonlyArray<{ label: string; src: string }> = [
    { label: 'firm-actions', src: firmActions },
    { label: 'case-evidence-actions', src: evidenceActions },
    { label: 'signing-actions', src: signingActions },
    { label: 'import-actions', src: importActions },
    { label: 'migration-actions', src: migrationActions },
    { label: 'access-actions', src: accessActions },
    { label: 'letters-actions', src: lettersActions },
  ];

  /**
   * The AWAITED form, everywhere, and the `await` is not decoration.
   *
   * `void requireActiveFirm(firmId);` and a bare
   * `requireActiveFirm(firmId);` both leave the token in the body and both
   * make the gate NON-BLOCKING: the action runs straight on while the check
   * is still in flight, and the rejection surfaces later as an unhandled
   * promise nobody reads. That is a fail-open wearing the exact spelling of a
   * gate, so every assertion in this describe matches on `await
   * requireActiveFirm(` rather than on the bare call.
   */
  const GATE_CALL = 'await requireActiveFirm(';

  it('gates the firm write paths that create new work product', () => {
    for (const { label, src, fn } of GATED) {
      expect(bodyOf(src, fn), label).toMatch(/await requireActiveFirm\(/);
    }
  });

  /**
   * The first thing in a gated action that CHANGES something: a database
   * write, a file landing in storage, a calendar invitation going out, or one
   * of the two helpers that wrap an evidence write.
   *
   * The ordering assertion below is the point. Presence is not position: a
   * gate moved BELOW the insert it is meant to prevent leaves the token in
   * the function body, passes any test that greps for it, and creates the
   * matter before refusing. That is the classic "guard that runs after the
   * work" shape, and it is the mutation this test exists to catch.
   *
   * A gated action with no match here fails too, deliberately. It means
   * either the write moved behind a new helper, in which case this list needs
   * it, or the action no longer writes anything and does not belong above.
   *
   * WHAT THIS REGEX STILL CANNOT SEE. Read this before trusting it, because a
   * source-text invariant that looks total is more dangerous than one that
   * states its limits. It is receiver-agnostic, so a different client variable
   * is not a miss, and an action with no match at all fails loudly. The
   * residual danger is the MIXED shape: an early effect this list does not
   * know, then a later write it does, with the gate in between. That passes
   * silently. Specifically it is blind to
   *
   *   - a write behind a helper whose name is not spelled below, which is the
   *     open-ended one. The named helpers are the ones the gated actions use
   *     today; a new wrapper needs adding here on the day it is written.
   *   - a write inside a module this action imports and calls under some
   *     other name, since only the action's own source is read.
   *   - anything reached through a dynamic import or an indirection
   *     (`const write = admin.from(t).insert; await write(...)`).
   *   - a write in a private helper that bodyOf swallowed. See bodyOf.
   *
   * The three shapes it did not see and now does: a writing RPC
   * (post_trust_transaction, create_trust_reconciliation,
   * debit_firm_token_pool, bump_signature_access_attempt are all real here),
   * a storage DELETE, which is `.remove(` and not `.delete(` and appears 39
   * times in this codebase, and a write behind a named helper.
   */
  const FIRST_WRITE =
    /\.(insert|upsert|update|delete)\(|\.upload\(|\.remove\(|\.rpc\(|scheduleFirmMeeting\(|importFileAsCaseEvidence\(|deleteEventsByHashes\(|logCaseActivity\(|logCaseEvent\(|createNotification\(|sendEmail\(/;

  it('calls the gate BEFORE the first write, in every gated action', () => {
    for (const { label, src, fn } of GATED) {
      const body = bodyOf(src, fn);
      const gate = body.indexOf(GATE_CALL);
      expect(gate, `${label} has no awaited gate`).toBeGreaterThan(-1);
      const write = body.search(FIRST_WRITE);
      expect(write, `${label} has no write for the gate to precede`).toBeGreaterThan(-1);
      expect(gate, `${label} gates AFTER the write it is meant to prevent`).toBeLessThan(
        write,
      );
    }
  });

  // Nowhere in a write path may the gate be wrapped in a catch. A catch that
  // lets the action continue is the fail-open this whole feature exists to
  // avoid, and it reads as harmless defensive code. Calm copy for the person
  // who sees the refusal is app/counsel/error.tsx and lib/gated-action.ts,
  // neither of which can let the action continue: the first runs after the
  // request is over, the second in the browser after the server has already
  // refused.
  //
  // Three assertions rather than one, because a wrap has three shapes and no
  // single regex sees all of them.
  //
  // WHAT THESE THREE STILL CANNOT SEE, named rather than implied, because a
  // source-text invariant that looks total is worse than one that states its
  // limits. One shape is left open on purpose:
  //
  //   - gating on a CALLER-SUPPLIED firm id rather than the resolved one,
  //     `await requireActiveFirm(input.firmId)` where the action then writes
  //     against a firm it looked up separately. Every assertion here passes,
  //     and the gate checks the wrong organization. Closing it means knowing
  //     which identifier in each action is the authoritative one, which is a
  //     data-flow question and not a text one, so it is not closed here.
  //
  //     What covers it is the data flow, not the source text, and the reason
  //     is NOT that these actions read the firm id from the session. Most of
  //     them do not: only eight resolve one server-side (requireFirmMember,
  //     getActiveFirmContext, or a firm id read off a row such as
  //     invRow.firm_id or request.firm_id), and the rest take a firmId
  //     parameter straight off the wire. Writing "they resolve it from the
  //     session" here would be a false premise defending a sound decision,
  //     which is worse than saying nothing.
  //
  //     The actual reason: each gated action AUTHORIZES the very identifier
  //     it gates, before gating it (callerIsFirmAdmin, callerIsFirmMember,
  //     callerHasFirmRole, callerCanReview or assertFirmCase, all taking that
  //     same variable), and then WRITES against that same variable. One
  //     identifier runs through the authorization, the gate and the write, so
  //     the gate cannot be checking a different organization from the one
  //     being written to. Gating one id while writing another would have to
  //     get past the role check on the first id, which is a separate and
  //     larger defect than a disarmed gate.
  //
  // Everything else below is closed. The previous version of these tests also
  // missed a flat `.catch(() => {})` and a non-blocking `void` gate; both now
  // fail.
  //
  // Comments are stripped before any of this. The comment ABOVE several of
  // these gates explains that there is deliberately no try around it, and a
  // test that reads prose cannot tell the explanation from the thing
  // explained.
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /**
   * Stripping is not string-aware, so it has to be checked rather than
   * trusted.
   *
   * `stripComments` deletes from `//` to the end of the line wherever the two
   * characters appear, including inside a string literal, and `/* *\/` the
   * same with a wider blast radius. A gate written on a line that also
   * contains a URL in a string would disappear from the stripped source
   * entirely, and EVERY assertion below reads the stripped source, so one line
   * could hide a gate from all of them at once:
   *
   *     const helpUrl = 'https://example.com/help'; await requireActiveFirm(firmId).catch(() => {});
   *
   * That is not a contrived shape. lib/firm-actions.ts already carries around
   * fourteen `//` occurrences inside string literals, so a gate landing on
   * such a line is an ordinary edit away.
   *
   * So the count of gates in the RAW source must equal the count in the
   * stripped source. Anything stripping removed is a hard failure here rather
   * than a silent exemption below. Nothing is hidden today: raw and stripped
   * agree in all seven modules.
   */
  const gateCode = (label: string, src: string) => {
    const code = stripComments(src);
    expect(
      [...code.matchAll(/await requireActiveFirm\(/g)].length,
      `${label} has a gate that comment-stripping removed, so it would escape every check below. Keep gates off any line that also contains // or /* inside a string`,
    ).toBe([...src.matchAll(/await requireActiveFirm\(/g)].length);
    return code;
  };

  // INDENTATION is the structural half. Every gate sits at the top level of
  // its function body, two spaces in. Anything that nests it - a try, an if,
  // a loop, a callback - indents it further, so `expect('  ')` rejects the
  // multi-line wrap without needing to parse TypeScript. This replaced a
  // window that searched 200 characters either side for the word `catch`,
  // which could not tell a wrapping catch from an unrelated one further down
  // the function and started producing false positives the moment the gate
  // list grew past three files.
  //
  // The COUNT is what makes the indentation check total rather than partial,
  // and it is the half that was missing. The anchored pattern only sees a
  // gate that BEGINS its line, so `if (cond) await requireActiveFirm(id);`
  // written on one line was invisible to it: the anchor never matched, the
  // loop had nothing to reject, and a conditional gate passed. Requiring the
  // anchored matches to account for every occurrence in the file turns "no
  // gate we can see is nested" into "no gate is nested".
  it('never nests the action gate inside a block', () => {
    for (const { label, src } of GATE_SOURCES) {
      const code = gateCode(label, src);
      const every = [...code.matchAll(/await requireActiveFirm\(/g)];
      expect(every.length, `${label} has no gate`).toBeGreaterThan(0);
      const anchored = [...code.matchAll(/^([ \t]*)await requireActiveFirm\(/gm)];
      expect(
        anchored.length,
        `${label} has a gate occurrence that does not begin its own line: either something precedes it on that line (a conditional, an assignment) or the text sits inside a string or template literal`,
      ).toBe(every.length);
      for (const m of anchored) {
        expect(m[1], `${label} indents a gate, so something nests it`).toBe('  ');
      }
    }
  });

  // And the one-line half, which the indentation check alone would miss:
  // `try { await requireActiveFirm(id); } catch {}` written flat. A wrapping
  // try is always BEFORE the gate, so only the text before it is read; a
  // catch further down the function is none of this test's business.
  it('never opens a try immediately before the action gate', () => {
    for (const { label, src } of GATE_SOURCES) {
      const code = gateCode(label, src);
      for (const m of code.matchAll(/await requireActiveFirm\(/g)) {
        const before = code.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
        expect(before, `${label} wraps a gate in a try`).not.toMatch(/\btry\b/);
      }
    }
  });

  /**
   * The one-TOKEN half, which neither assertion above can see.
   *
   *     await requireActiveFirm(firmId).catch(() => {});
   *
   * is flat, sits at two-space indent, begins its own line and has no `try`
   * anywhere before it, so it satisfies both. It also disarms the gate
   * completely: the refusal is swallowed and the action runs on. It is the
   * shortest way to turn this whole feature off, which makes it the shape
   * most likely to arrive by accident, from someone quieting a noisy stack
   * trace or a refactor that "made the action more defensive".
   *
   * Forward rather than backward, and short. A promise-level catch has to
   * attach to the call itself, so it is inside the same statement; 120
   * characters covers the gate call and the tail of its line without reaching
   * the next statement, where an unrelated catch is none of this test's
   * business.
   */
  it('never attaches a catch to the action gate', () => {
    for (const { label, src } of GATE_SOURCES) {
      const code = gateCode(label, src);
      for (const m of code.matchAll(/await requireActiveFirm\(/g)) {
        const at = m.index ?? 0;
        expect(
          code.slice(at, at + 120),
          `${label} attaches a catch to a gate, which swallows the refusal`,
        ).not.toContain('.catch(');
      }
    }
  });

  // The boundary matches on identity, never on copy. Reintroducing a message
  // comparison is the edit that makes one copy tweak silently disarm it.
  it('recognises the refusal by identity in the error boundary', () => {
    const boundary = readFileSync(join(ROOT, 'app/counsel/error.tsx'), 'utf8');
    expect(boundary).toMatch(/isAccessEndedError\(/);
    expect(boundary).not.toMatch(/access has ended\./);
  });

  /**
   * No error boundary anywhere may print a digest raw.
   *
   * FirmAccessEndedError sets its digest to the identity code, because that is
   * the one field Next carries to a client boundary and identity has to
   * survive the crossing. That made the digest readable, and the matter
   * boundary was already printing it: a locked-out person was shown
   * "Reference: FIRM_ACCESS_ENDED". Every boundary goes through
   * displayableDigest instead, which shows Next's generated hash and withholds
   * anything this codebase put there.
   */
  it('never prints an error digest raw, in any boundary', () => {
    const boundaries = [
      'app/error.tsx',
      'app/global-error.tsx',
      'app/counsel/error.tsx',
      'app/counsel/cases/[id]/error.tsx',
    ];
    for (const rel of boundaries) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      // A digest read anywhere other than the type annotation has to be
      // handed to the rule first.
      for (const m of src.matchAll(/\{\s*error[?]?\.digest\s*\}/g)) {
        throw new Error(`${rel} renders error.digest directly: ${m[0]}`);
      }
      if (/error[?]?\.digest/.test(src)) {
        expect(src, `${rel} reads a digest without the rule`).toMatch(
          /displayableDigest\(/,
        );
      }
    }
  });

  /**
   * The NEARER boundary has to know the same identity.
   *
   * app/counsel/cases/[id]/error.tsx wins over app/counsel/error.tsx for the
   * whole matter workspace, which is where every gated evidence, signing, chat
   * and timeline action lives. A segment boundary the refusal never reaches is
   * a boundary that does nothing.
   */
  it('teaches the nearer matter boundary the same identity', () => {
    const boundary = readFileSync(
      join(ROOT, 'app/counsel/cases/[id]/error.tsx'),
      'utf8',
    );
    expect(boundary).toMatch(/isAccessEndedError\(/);
    expect(boundary).not.toMatch(/access has ended\./);
  });

  /**
   * The client half, and the one that decided whether any of this was VISIBLE.
   *
   * Every gated action is dispatched as
   * `startTransition(async () => { const res = await action(...) })`. React
   * 18.3.1's startTransition calls scope() and discards the promise, so a
   * refusal was an unhandled rejection: res never assigned, no error state
   * set, the dialog silently doing nothing. The button just did not work.
   *
   * So every call site of a gated action goes through runGatedAction. One
   * helper rather than fifteen hand-written catches, for the same reason
   * fifteen hand-written catches were refused at the gate.
   *
   * The one exception is declared, not implied: evidence-intake.tsx's bulk
   * loop drives its own retry policy and handles the identity itself, which
   * the test below pins.
   */
  it('dispatches every gated action through runGatedAction', () => {
    const EXEMPT = new Set(['bulkImportCaseEvidenceAction']);
    const names = [...new Set(GATED.map((g) => g.fn))].filter(
      (n) => !EXEMPT.has(n),
    );
    const files = execSync(
      `grep -rlE '(${names.join('|')})\\(' app components --include='*.tsx'`,
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    let seen = 0;
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      for (const name of names) {
        // Calls only. An import lists the name with a comma after it, never
        // an open paren.
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
          seen += 1;
          const before = src.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
          expect(
            before,
            `${rel} calls ${name} without runGatedAction, so a refusal is silently dropped`,
          ).toContain('runGatedAction(() => ');
        }
      }
    }
    // A regex that matched nothing would pass this test while proving
    // nothing. There are more call sites than gated actions, because two
    // surfaces send firm messages.
    expect(seen).toBeGreaterThanOrEqual(names.length);
  });

  /**
   * A refusal is not a transient failure, and the flagship bulk intake was
   * treating it as one: the batch loop wrapped the action in its own
   * try/catch and retried BATCH_RETRIES times before reporting a generic
   * batch failure. So a closed organization was refused three times per batch
   * and then shown Next's redacted message.
   *
   * The identity check has to come BEFORE the retry arithmetic, or the retry
   * happens first and the check only decides what to say afterwards.
   */
  it('never retries the refusal in the bulk evidence intake', () => {
    const src = readFileSync(
      join(ROOT, 'app/counsel/cases/[id]/evidence/evidence-intake.tsx'),
      'utf8',
    );
    const identity = src.indexOf('isAccessEndedError(err)');
    expect(identity, 'the bulk loop does not recognise the refusal').toBeGreaterThan(
      -1,
    );
    const retry = src.indexOf('attempt >= BATCH_RETRIES');
    expect(retry, 'the retry policy moved').toBeGreaterThan(-1);
    expect(
      identity,
      'the refusal is checked after the retry arithmetic, so it is retried first',
    ).toBeLessThan(retry);
    // And the person is told, in the same calm words the boundary uses.
    expect(src).toMatch(/ACCESS_ENDED_NOTICE/);
  });

  /**
   * The retrieval door stays open, deliberately.
   *
   * Task 5's archive names evidence files whose bytes are not in it, so this
   * route is the only way a departing organization opens them. It carries the
   * same exemption /api/firm/export has, and its OWN authorization has to stay
   * intact, which is the half an exemption makes easy to lose.
   *
   * The exemption covers the FIRM'S OWN members. The co-counsel guest branch
   * is separately closed under a suspension, which the sweep below pins.
   */
  it('leaves the evidence retrieval route ungated and fully authorized', () => {
    const route = readFileSync(
      join(ROOT, 'app/counsel/cases/[id]/evidence/download/route.ts'),
      'utf8',
    );
    expect(route).not.toMatch(/requireActiveFirm\(/);
    expect(route).toMatch(/getCurrentUser\(/);
    expect(route).toMatch(/from\('firm_members'\)/);
    expect(route).toMatch(/guestCanReadCase\(/);
    // The matter has to belong to the firm the caller was admitted through.
    expect(route).toMatch(/c\.firm_id !== firmId/);
    // And the firm-member branch keeps the exemption: the suspension check
    // must not have been hoisted above the `if (ctx)` split, which would lock
    // an organization out of the files its own export names.
    expect(route.indexOf('firmSuspended(')).toBeGreaterThan(
      route.indexOf("from('firm_members')"),
    );
  });

  it('checks the seat limit before inserting a firm member', () => {
    const accept = firmActions.slice(
      firmActions.indexOf('export async function acceptFirmInvitationAction'),
      firmActions.indexOf('export async function removeFirmMemberAction'),
    );
    expect(accept).toMatch(/seatCheck\(/);
    expect(accept.indexOf('seatCheck(')).toBeLessThan(
      accept.indexOf(".from('firm_members')\n    .insert("),
    );
  });
});

/**
 * The route handlers, which are the hole the shell narrowing left open.
 *
 * app/counsel/layout.tsx turns a suspended organization's co-counsel guest
 * away, and a ROUTE HANDLER RENDERS NO LAYOUT. Four handlers authorize a guest
 * through guestCanReadCase and then hand back the matter: every evidence file,
 * the full export packet, the approach packet and the matter's search index.
 * Under a suspension all four were reachable by URL, which is precisely the
 * channel a suspension exists to close.
 *
 * This is the same defect the two-layer rule was written to prevent, in a
 * shape that rule did not name. The rule says every 'use server' export is a
 * public endpoint that outlives the redirect. So is every route handler, and
 * unlike an action a route handler is a plain GET a browser can be pointed at.
 *
 * What is NOT closed here, deliberately: the FIRM'S OWN members. The retrieval
 * exemption exists because the organization-wide export names evidence files
 * whose bytes are not in the archive, so gating the firm side would hand a
 * departing organization an index to nothing. A guest is the other case.
 */
describe('the firm matter routes under a suspension', () => {
  /**
   * Every route handler that admits a co-counsel guest, found rather than
   * listed.
   *
   * A hard-coded list of four would pass forever the day a fifth handler is
   * written, and a fifth handler is exactly how this defect arrived. So the
   * set is derived from the codebase.
   *
   * The key is the MODULE, `counsel-guest`, not the one helper name
   * `guestCanReadCase(`. Keying on the call spelling makes the derived set
   * narrower than the rule it is supposed to enforce: a handler that admits a
   * guest without writing that literal escapes the grep entirely and is never
   * checked at all. Two realistic ways in:
   *
   *   const mayRead = mod.guestCanReadCase;      // aliased, no literal call
   *   await guestCanAccessCase(id, firmId);      // a sibling helper
   *
   * Both import from `@/lib/counsel-guest`, so the module key sees them and
   * the assertions below then demand the suspension check. It costs nothing:
   * the wider key selects exactly the same four files today.
   *
   * Erring wide is also the safe direction. A file that merely MENTIONS
   * counsel-guest is pulled into the set and then has to satisfy the
   * assertions, so the failure mode of over-matching is a red test somebody
   * reads, not a door left open.
   */
  const guestRoutes = execSync(
    "grep -rl 'counsel-guest' app --include='route.ts'",
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  it('finds the guest-admitting route handlers', () => {
    // A grep that matched nothing would pass every assertion below while
    // proving nothing at all.
    expect(guestRoutes.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * Position, not presence. The check has to sit AFTER guestCanReadCase, so a
   * caller with no access to the matter learns nothing about the
   * organization's standing, and BEFORE the branch resolves its firm id and
   * the handler proceeds to read the matter.
   *
   * It also has to be inside the guest branch. A firm member reaching the
   * same handler keeps the retrieval exemption, which the assertion in the
   * enforcement-wiring block above pins for the download route.
   */
  it('consults the suspension in every guest branch, after the access check', () => {
    for (const rel of guestRoutes) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const admitted = src.indexOf('guestCanReadCase(params.id');
      const gate = src.indexOf('firmSuspended(');
      const resolved = src.indexOf('firmId = caseFirmId;');
      expect(gate, `${rel} admits a guest without consulting the suspension`).toBeGreaterThan(-1);
      expect(
        admitted,
        `${rel} does not authorize the guest the expected way: it reaches counsel-guest without a literal guestCanReadCase(params.id call, so the ordering below cannot be established. An alias or a sibling helper lands here`,
      ).toBeGreaterThan(-1);
      expect(resolved, `${rel} does not resolve the firm id the expected way`).toBeGreaterThan(-1);
      expect(gate, `${rel} checks the suspension before the access check`).toBeGreaterThan(admitted);
      expect(gate, `${rel} checks the suspension after the branch has already resolved`).toBeLessThan(resolved);
      // Never in a catch. "Could not determine" is not "not suspended", and
      // firmSuspended throws rather than guessing.
      expect(
        src.slice(gate, gate + 120),
        `${rel} attaches a catch to the suspension check`,
      ).not.toContain('.catch(');
    }
  });

  /**
   * And the behaviour, because presence tests are blind to the mutation that
   * keeps the call and drops the `if`.
   *
   * The handlers are invoked against stand-in modules. Only the modules the
   * refusal path touches carry real behaviour; the heavy PDF and archive
   * machinery is stubbed because none of it is reached before the gate, and
   * importing it under node buys nothing.
   */
  type Caller = { guest: boolean; suspended: boolean };

  const ROUTE_LABELS = [
    'evidence download',
    'matter export',
    'approach export',
    'search index',
  ] as const;
  type RouteLabel = (typeof ROUTE_LABELS)[number];

  /** Literal specifiers, so the test bundler can resolve each one. */
  async function importRoute(label: RouteLabel) {
    switch (label) {
      case 'evidence download':
        return import('@/app/counsel/cases/[id]/evidence/download/route');
      case 'matter export':
        return import('@/app/counsel/cases/[id]/export/route');
      case 'approach export':
        return import('@/app/counsel/cases/[id]/approach/[approachId]/export/route');
      case 'search index':
        return import('@/app/counsel/cases/[id]/search-index/route');
    }
  }

  function paramsFor(label: RouteLabel): Record<string, string> {
    return label === 'approach export'
      ? { id: 'case-1', approachId: 'approach-1' }
      : { id: 'case-1' };
  }

  /** A PostgREST-shaped builder: every filter returns itself, and it awaits. */
  function chain(result: { data: unknown; error: unknown }) {
    const builder: Record<string, unknown> = {};
    for (const method of [
      'select', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit', 'range', 'filter',
    ]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = async () => result;
    builder.single = async () => result;
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);
    return builder;
  }

  async function callRoute(
    label: RouteLabel,
    caller: Caller,
  ): Promise<{ status: number | null; error: string | null; asked: number }> {
    vi.resetModules();
    const firmSuspended = vi.fn(async () => caller.suspended);

    vi.doMock('next/server', () => ({
      NextResponse: class {
        constructor(
          public body: unknown,
          public init?: { status?: number },
        ) {}
        static json(body: unknown, init?: { status?: number }) {
          return { status: init?.status ?? 200, body };
        }
      },
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      getCurrentUser: async () => ({ id: 'user-1' }),
      createServerSupabase: () => ({
        from: () => chain({ data: { id: 'membership-1' }, error: null }),
      }),
    }));
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminSupabase: () => ({
        from: (table: string) =>
          chain(
            table === 'cases'
              ? {
                  data: {
                    id: 'case-1',
                    title: 'A matter',
                    firm_id: 'firm-1',
                    subject_name: null,
                    text_normalizations: null,
                  },
                  error: null,
                }
              : { data: [], error: null },
          ),
        storage: {
          from: () => ({
            download: async () => ({ data: null, error: { message: 'stub' } }),
          }),
        },
      }),
    }));
    vi.doMock('@/lib/firm-storage', () => ({
      // A guest is the caller with NO active firm context, exactly as the
      // handlers read it.
      getActiveFirmContext: async () =>
        caller.guest ? null : { firm: { id: 'firm-1' }, membership: { role: 'owner' } },
    }));
    vi.doMock('@/lib/counsel-guest', () => ({
      guestCanReadCase: async () => true,
    }));
    vi.doMock('@/lib/firm-trials', () => ({ firmSuspended }));
    // Everything below is stubbed only so the handlers import under node.
    // None of it is reached before the gate.
    vi.doMock('@/lib/pdf', () => ({
      generateTimelineExhibitPdf: async () => Buffer.from(''),
      normalizeExhibitData: (d: unknown) => d,
      ALL_EXHIBIT_SECTIONS: [],
    }));
    vi.doMock('@/lib/firm-timeline-actions', () => ({
      getFirmTimelineBundle: async () => ({ events: [], entities: [] }),
    }));
    vi.doMock('@/lib/case-activity-log', () => ({ logCaseActivity: async () => {} }));
    vi.doMock('@/lib/exhibit-sheet', () => ({ parseExhibitSheet: async () => null }));
    vi.doMock('@/lib/maps', () => ({ staticMapUrlServer: () => null }));
    vi.doMock('@/lib/entity-normalize', () => ({ canonicalOrg: (s: string) => s }));
    vi.doMock('@/lib/evidence-folders', () => ({
      readEvidenceFolderRegistry: async () => ({}),
      canSeeEvidenceFolder: () => true,
    }));
    vi.doMock('fflate', () => ({ zipSync: () => new Uint8Array() }));

    const mod = await importRoute(label);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = (await mod.GET(new Request('https://advottic.com/x'), {
        params: paramsFor(label),
      } as never)) as { status?: number; body?: { error?: string } };
      status = res?.status ?? null;
      error = res?.body?.error ?? null;
    } catch {
      // A handler that got past the gate and then tripped over a stub is not
      // the refusal, which is all these assertions read.
      status = null;
      error = null;
    }
    return { status, error, asked: firmSuspended.mock.calls.length };
  }

  const REFUSAL = 'This matter is not available right now.';

  for (const label of ROUTE_LABELS) {
    it(`refuses a co-counsel guest at the ${label} route while the organization is suspended`, async () => {
      const res = await callRoute(label, { guest: true, suspended: true });
      expect(res.asked, 'the handler never asked whether the organization is suspended').toBe(1);
      expect(res.status).toBe(403);
      expect(res.error).toBe(REFUSAL);
    });

    it(`lets a co-counsel guest through the ${label} route when the trial merely lapsed`, async () => {
      const res = await callRoute(label, { guest: true, suspended: false });
      expect(res.asked, 'the handler never asked whether the organization is suspended').toBe(1);
      expect(res.error, 'a lapsed trial refused a guest it should have let through').not.toBe(
        REFUSAL,
      );
    });

    /**
     * The firm's own members keep the exemption. This is the assertion that
     * stops a well-meant "close the hole everywhere" edit from locking a
     * departing organization out of the files its own export names.
     */
    it(`never asks about the suspension for a firm member at the ${label} route`, async () => {
      const res = await callRoute(label, { guest: false, suspended: true });
      expect(res.asked, "the firm's own member was gated, which closes the export").toBe(0);
      expect(res.error).not.toBe(REFUSAL);
    });
  }
});
