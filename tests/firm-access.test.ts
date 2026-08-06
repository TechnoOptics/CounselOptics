import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  toInstant,
  firmAccessState,
  seatCheck,
  counselAccessRedirect,
  ACCESS_ENDED_PATH,
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

  async function render(role: 'owner' | 'staff') {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({
      getCurrentUser: async () => ({ id: 'u1', email: 'a@example.com' }),
      isSupabaseConfigured: () => true,
    }));
    vi.doMock('@/lib/firm-storage', () => ({
      getActiveFirmContext: async () => ({
        firm: { id: 'firm-1', name: 'Rowan and Hale', accentColor: '#caa044' },
        membership: { role },
      }),
      listMyFirms: async () => [],
    }));
    vi.doMock('@/lib/firm-authz', () => ({
      FIRM_ADMIN_ROLES: ['owner', 'admin'],
      callerHasFirmRole: async (_firmId: string, roles: readonly string[]) =>
        roles.includes(role),
    }));
    vi.doMock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
    const mod = await import('@/app/counsel/access-ended/page');
    return mod.default();
  }

  it('offers the export to an owner, and does not say anything is deleted', async () => {
    const tree = await render('owner');
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
    const tree = await render('staff');
    const text = textOf(tree);
    expect(text).toContain("Your organization's access has ended");
    expect(text).toContain(
      'An owner or an administrator at your organization can download your data. Speak to them if you need something from here.',
    );
    expect(hrefsOf(tree)).not.toContain('/api/firm/export');
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

  function bodyOf(src: string, fn: string): string {
    const start = src.indexOf(`export async function ${fn}`);
    expect(start, `${fn} is missing`).toBeGreaterThan(-1);
    const end = src.indexOf('\nexport ', start + 1);
    return src.slice(start, end === -1 ? undefined : end);
  }

  // The half that is not a courtesy. These actions are public HTTP endpoints,
  // so a person whose browser was redirected to the access-ended page can
  // still call them by hand, and the redirect above does nothing about it.
  //
  // This list is what an organization would use to keep WORKING after its
  // access ended: new matters, new documents, new signature requests, new
  // people. It is not every firm action in the codebase, and the report says
  // so rather than implying the sweep is finished.
  it('gates the firm write paths that create new work product', () => {
    for (const fn of [
      'inviteFirmMemberAction',
      'acceptFirmInvitationAction',
      'inviteFirmClientAction',
      'uploadFirmDocumentAction',
      'createSigningRequestAction',
      'createFirmCaseAction',
    ]) {
      expect(bodyOf(firmActions, fn), fn).toMatch(/requireActiveFirm\(/);
    }
  });

  // Nowhere in a write path may the gate be wrapped in a catch. A catch that
  // lets the action continue is the fail-open this whole feature exists to
  // avoid, and it reads as harmless defensive code.
  it('never wraps the action gate in a catch', () => {
    for (const m of firmActions.matchAll(/requireActiveFirm\(/g)) {
      const around = firmActions.slice(
        Math.max(0, (m.index ?? 0) - 200),
        (m.index ?? 0) + 200,
      );
      expect(around).not.toMatch(/catch/);
    }
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
