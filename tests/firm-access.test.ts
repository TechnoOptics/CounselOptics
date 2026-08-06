import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  toInstant,
  firmAccessState,
  seatCheck,
  counselAccessRedirect,
  isAccessEndedError,
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
      listMyFirms: async () => [
        { firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' }, membership: { role: 'owner' } },
      ],
      getActiveFirmContext: async () => ({
        firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' },
        membership: { role: 'owner' },
      }),
    }));
    // The real lib/firm-access is deliberately NOT mocked: the allowlist under
    // test is the one that ships.
    vi.doMock('@/lib/firm-trials', () => ({ firmTrialState: async () => state }));
    vi.doMock('@/lib/firm-settings', () => ({
      getFirmSurfaceSettings: async () => ({ hideSearch: false, hideTimeBilling: false }),
      DEFAULT_FIRM_SURFACE_SETTINGS: { hideSearch: false, hideTimeBilling: false },
    }));
    vi.doMock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
    vi.doMock('@/lib/counsel-guest', () => ({
      getGuestContext: async () => null,
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
   * actions in lib/firm-actions.ts alone and roughly 290 across 44 'use
   * server' modules; the full sweep is its own task. The report says so
   * rather than implying this is finished.
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
  ];

  it('gates the firm write paths that create new work product', () => {
    for (const { label, src, fn } of GATED) {
      expect(bodyOf(src, fn), label).toMatch(/requireActiveFirm\(/);
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
   */
  const FIRST_WRITE =
    /\.(insert|upsert|update|delete)\(|\.upload\(|scheduleFirmMeeting\(|importFileAsCaseEvidence\(|deleteEventsByHashes\(/;

  it('calls the gate BEFORE the first write, in every gated action', () => {
    for (const { label, src, fn } of GATED) {
      const body = bodyOf(src, fn);
      const gate = body.indexOf('requireActiveFirm(');
      expect(gate, `${label} has no gate`).toBeGreaterThan(-1);
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
  // who sees the refusal is app/counsel/error.tsx, which cannot let the
  // action continue because the request is already over by the time it runs.
  it('never wraps the action gate in a catch', () => {
    for (const src of [firmActions, evidenceActions, signingActions]) {
      for (const m of src.matchAll(/requireActiveFirm\(/g)) {
        const around = src.slice(
          Math.max(0, (m.index ?? 0) - 200),
          (m.index ?? 0) + 200,
        );
        expect(around).not.toMatch(/catch/);
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
