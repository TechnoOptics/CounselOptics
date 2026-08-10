import 'server-only';
import { createAdminSupabase, isServiceRoleConfigured } from './supabase/admin';
import { getCurrentUser } from './supabase/server';
import { freeTrialWindowEnd } from './storage';
import {
  paidFromSubscription,
  resolveAccountEntitlement,
  trialDaysRemaining,
  type ResolvedEntitlement,
  type TrialGrant,
} from './trial-entitlement';

/**
 * The only module that reads or writes an INDIVIDUAL user's trial state and
 * its audit table. The organization equivalent is lib/firm-trials.ts, and
 * this deliberately mirrors it rather than inventing a second design.
 *
 * server-only, because every export here uses the admin client by design:
 * user_trial_events has RLS on and no policy, so it is closed to every client
 * and reachable only from here, under isCurrentUserAdmin.
 *
 * WHAT IS DIFFERENT FROM THE ORGANIZATION SIDE, and why:
 *
 *   No suspension. profiles.is_blocked already exists, driven by
 *   setUserBlockedAction and shown as the Active toggle in HQ. A second
 *   lockout flag would be two answers to "is this account closed".
 *
 *   No seat limit. An individual is one seat.
 *
 *   Those two levers are replaced by the two an individual trial needs: the
 *   plan level, and clearing the trial outright. Five verbs either way.
 *
 * WHAT IS THE SAME, and must stay the same: extend and restart are separate
 * actions, days are a count and never a date, every write records the actor
 * twice, and no entitlement is ever cached. The resolution is computed against
 * a fresh clock every time it is asked for, because a cached answer outlives
 * the trial end and reintroduces exactly the staleness that having no
 * scheduled job removes.
 */

export type UserTrialRow = {
  id: string;
  /**
   * No email here. It lives on auth.users, not on profiles, and this module
   * is not going to page the whole auth list to get it. The HQ users page
   * already holds every user's email from adminListUsers and joins on the id.
   */
  displayName: string | null;
  trialEndsAt: string | null;
  /** As stored. See TrialFirmRow.trialTier for why this is not narrowed. */
  trialTier: string | null;
  /** Whole days until the end date, negative once passed, null with no date. */
  daysRemaining: number | null;
  /**
   * What the account is actually entitled to right now, with the paid
   * subscription taking precedence over the trial. This is the number an
   * operator is deciding against, so the view shows the resolved answer rather
   * than leaving them to work out whether the trial is doing anything.
   */
  resolved: ResolvedEntitlement;
  /** The email of whoever last moved this trial, and when. */
  lastActorEmail: string | null;
  lastActionAt: string | null;
  lastAction: string | null;
};

/**
 * Same discriminated shape listTrialFirms returns, and for the same reason: an
 * empty array cannot say whether nobody is on a clock or the read never
 * happened, and those two are opposites.
 */
export type UserTrialList =
  | { ok: true; rows: UserTrialRow[] }
  | { ok: false; reason: string };

/** The one stored fact grant and extend need. Fails closed, like the firm one. */
export type UserTrialSnapshot =
  | { ok: true; trialEndsAt: string | null }
  | { ok: false; error: string };

/**
 * These kinds are also the values of the CHECK constraint on
 * user_trial_events.action in
 * supabase/migrations/20260808_trial_plan_level_and_user_trials.sql. Adding a
 * kind here without adding it there makes every audit insert for that kind
 * fail, which is a silent gap in the trail rather than a failed action,
 * because the write lands first. Change both together.
 */
export type UserTrialAction =
  | { kind: 'granted'; days: number }
  | { kind: 'extended'; days: number }
  | { kind: 'reset'; days: number }
  | { kind: 'tier_changed'; tierSlug: string | null }
  | { kind: 'cleared' };

export type UserTrialActionInput = {
  userId: string;
  actorUserId: string;
  /** Required and nullable, so a caller with only an id has to say so. */
  actorEmail: string | null;
  action: UserTrialAction;
  note: string | null;
};

const DAY_MS = 86_400_000;

/** The two trial columns, named once so the selects cannot drift apart. */
const PROFILE_TRIAL_COLUMNS = 'trial_ends_at, trial_tier';

/**
 * KEY PRESENCE, not value. The failure being caught is an ABSENT COLUMN, and
 * `row.trial_tier === undefined` cannot tell an absent column from a null one
 * because reading either yields undefined. `in` can, and a null column is
 * legitimate while a missing one means a select forgot it.
 *
 * Throwing is the fail-closed choice, and matches lib/firm-trials.ts.
 */
function requireProfileColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
): void {
  for (const column of columns) {
    if (!(column in row)) {
      throw new Error(`user-trials read a profiles row without ${column}.`);
    }
  }
}

/**
 * An ISO string, or null when the arithmetic did not land on a real instant.
 * `new Date(NaN).toISOString()` throws, and this is meant to REFUSE a bad
 * action rather than explode inside one.
 */
function isoInstant(ms: number): string | null {
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

let loggedMissingAdminInList = false;

function missingAdminReason(): string {
  return isServiceRoleConfigured()
    ? 'SUPABASE_SERVICE_ROLE_KEY is set, so the missing piece is the Supabase URL'
    : 'SUPABASE_SERVICE_ROLE_KEY is not configured';
}

/**
 * The trial an account is carrying, in the shape the resolver takes.
 *
 * Returns a grant of two nulls when the trial cannot be read, which resolves
 * to no uplift. That is the closed direction: a database fault must not hand
 * somebody a plan level, and it must not take a PAID one away either, which it
 * cannot, because the resolver reads the subscription independently.
 */
export async function userTrialGrant(userId: string): Promise<TrialGrant> {
  const empty: TrialGrant = { trialTierSlug: null, trialEndsAt: null };
  const admin = createAdminSupabase();
  if (!admin) return empty;

  const { data, error } = await admin
    .from('profiles')
    .select(PROFILE_TRIAL_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('userTrialGrant: could not read the profile', error.message);
    return empty;
  }
  if (!data) return empty;

  const row = data as Record<string, unknown>;
  // A truthy row missing either column is a select that lost one, and reading
  // it as "no trial" would be silently correct-looking. It IS the closed
  // direction here, so it does not throw; it does get said out loud.
  if (!('trial_ends_at' in row) || !('trial_tier' in row)) {
    console.error('userTrialGrant: a profiles row came back without its trial columns.');
    return empty;
  }

  return {
    trialTierSlug: (row.trial_tier as string | null) ?? null,
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
  };
}

/**
 * The signed-in caller's trial, for the consumer feature gates.
 *
 * A separate export rather than an argument to userTrialGrant because the four
 * gates that need it already have a session and do not all have a user id to
 * hand, and threading one through four modules to save one lookup is the kind
 * of plumbing that gets a site skipped.
 *
 * It resolves the EFFECTIVE user rather than the real one, unlike the audit
 * path. HQ's "act as" overlay exists to see what that account sees, so the
 * entitlement question here is about the account being viewed. The audit
 * question, which is who moved a lever, is the opposite and uses
 * getRealCurrentUser.
 */
export async function currentUserTrialGrant(): Promise<TrialGrant> {
  const user = await getCurrentUser();
  if (!user) return { trialTierSlug: null, trialEndsAt: null };
  return userTrialGrant(user.id);
}

/**
 * When each of these people's AUTOMATIC signup trial ends, keyed by user id,
 * or null when they have no anchor to count from.
 *
 * This exists so the HQ user surface can stop asserting something the product
 * does not do. There are two trials in this codebase and only one of them is
 * granted by an operator. The automatic one is the email-and-device-anchored
 * window read by getEffectiveTrialState, and while it is open,
 * isFullAccessTrial unlocks EVERY feature regardless of any plan level, so an
 * HQ level set on somebody in their first week does nothing until the window
 * closes. A screen that shows the level without saying that is a label
 * claiming behaviour nothing implements.
 *
 * The arithmetic is not repeated here. freeTrialWindowEnd in lib/storage.ts is
 * the single definition, and this batches the two reads it needs.
 *
 * A read failure yields nulls rather than throwing. The surface then says it
 * could not determine the window, which is honest; taking the HQ page down
 * because one auxiliary table was unreadable is not an improvement.
 */
export async function freeTrialWindowEnds(
  people: ReadonlyArray<{ userId: string; email: string | null; createdAt: string | null }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (people.length === 0) return out;

  const admin = createAdminSupabase();
  if (!admin) {
    for (const p of people) out.set(p.userId, null);
    return out;
  }

  const emails = people
    .map((p) => p.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));
  const ids = people.map((p) => p.userId);

  const [signupResp, deviceResp] = await Promise.all([
    emails.length
      ? admin.from('signup_history').select('email, first_signup_at').in('email', emails)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('device_trial_history')
      .select('latest_user_id, first_seen_at')
      .in('latest_user_id', ids)
      .order('first_seen_at', { ascending: true }),
  ]);

  if (signupResp.error) {
    console.error('freeTrialWindowEnds: could not read signup_history', signupResp.error.message);
  }
  if (deviceResp.error) {
    console.error(
      'freeTrialWindowEnds: could not read device_trial_history',
      deviceResp.error.message,
    );
  }

  const byEmail = new Map<string, string | null>();
  for (const r of (signupResp.data ?? []) as Array<{
    email: string;
    first_signup_at: string | null;
  }>) {
    byEmail.set(r.email, r.first_signup_at);
  }

  // Ordered oldest first, so the first row seen for a user is their earliest
  // device. Same anchor getEffectiveTrialState takes.
  const byDevice = new Map<string, string | null>();
  for (const r of (deviceResp.data ?? []) as Array<{
    latest_user_id: string;
    first_seen_at: string | null;
  }>) {
    if (byDevice.has(r.latest_user_id)) continue;
    byDevice.set(r.latest_user_id, r.first_seen_at);
  }

  for (const p of people) {
    const email = p.email?.trim().toLowerCase() ?? null;
    // Same fallback getEffectiveTrialState uses: no signup_history row means
    // the account's own creation time is the anchor.
    const emailFirst = (email ? byEmail.get(email) : null) ?? p.createdAt ?? null;
    out.set(p.userId, freeTrialWindowEnd(emailFirst, byDevice.get(p.userId) ?? null));
  }
  return out;
}

/** See UserTrialSnapshot: this reads its own row and fails closed. */
export async function readUserTrialSnapshot(
  userId: string,
): Promise<UserTrialSnapshot> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Unavailable. Please try again.' };

  const { data, error } = await admin
    .from('profiles')
    .select('trial_ends_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('readUserTrialSnapshot: could not read the profile', error.message);
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  if (!data) return { ok: false, error: 'That user no longer exists.' };

  const row = data as { trial_ends_at?: string | null };
  // A truthy row with no trial_ends_at key must refuse, not read as "no
  // trial". `?? null` treats a missing key the same as a present null, which
  // is the fail-open direction this precondition exists to prevent.
  if (!('trial_ends_at' in row)) {
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  return { ok: true, trialEndsAt: row.trial_ends_at ?? null };
}

/**
 * Every user currently on a trial clock, with what the trial actually grants
 * them and who last moved it.
 */
export async function listTrialUsers(): Promise<UserTrialList> {
  const admin = createAdminSupabase();
  if (!admin) {
    if (!loggedMissingAdminInList) {
      loggedMissingAdminInList = true;
      console.error(
        'listTrialUsers: no admin client, so the HQ user trials list is UNREADABLE and will render as though nobody were on a trial.',
        missingAdminReason(),
      );
    }
    return { ok: false, reason: missingAdminReason() };
  }

  const { data, error } = await admin
    .from('profiles')
    .select(`id, display_name, ${PROFILE_TRIAL_COLUMNS}`)
    .not('trial_ends_at', 'is', null)
    .order('trial_ends_at', { ascending: true });

  if (error) {
    console.error('listTrialUsers: could not read profiles', error.message);
    return { ok: false, reason: error.message };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { ok: true, rows: [] };
  const ids = rows.map((r) => r.id as string);

  // The subscription is read for EVERY user on the list, not only the ones
  // whose trial looks live, because the resolved answer for a payer is the
  // paid one and an operator needs to see that before they extend anything.
  const [subsResp, eventsResp] = await Promise.all([
    admin.from('subscriptions').select('user_id, status, price_id').in('user_id', ids),
    admin
      .from('user_trial_events')
      .select('user_id, action, actor_email, created_at')
      .in('user_id', ids)
      .order('created_at', { ascending: false }),
  ]);

  const subs = new Map<string, { status: string | null; priceId: string | null }>();
  for (const s of (subsResp.data ?? []) as Array<{
    user_id: string;
    status: string | null;
    price_id: string | null;
  }>) {
    subs.set(s.user_id, { status: s.status, priceId: s.price_id });
  }

  // Newest first, so the first row seen for a user is the latest one.
  const latest = new Map<
    string,
    { action: string; actorEmail: string | null; createdAt: string }
  >();
  for (const e of (eventsResp.data ?? []) as Array<{
    user_id: string;
    action: string;
    actor_email: string | null;
    created_at: string;
  }>) {
    if (latest.has(e.user_id)) continue;
    latest.set(e.user_id, {
      action: e.action,
      actorEmail: e.actor_email,
      createdAt: e.created_at,
    });
  }

  // One clock for one render of one list. Computed here and thrown away with
  // the response; nothing about it is cached.
  const now = new Date();
  return {
    ok: true,
    rows: rows.map((r) => {
      const id = r.id as string;
      const grant: TrialGrant = {
        trialTierSlug: (r.trial_tier as string | null) ?? null,
        trialEndsAt: (r.trial_ends_at as string | null) ?? null,
      };
      const last = latest.get(id) ?? null;
      return {
        id,
        displayName: (r.display_name as string | null) ?? null,
        trialEndsAt: grant.trialEndsAt as string | null,
        trialTier: grant.trialTierSlug,
        daysRemaining: trialDaysRemaining(grant.trialEndsAt, now),
        resolved: resolveAccountEntitlement(
          paidFromSubscription(subs.get(id) ?? null),
          grant,
          now,
        ),
        lastActorEmail: last?.actorEmail ?? null,
        lastActionAt: last?.createdAt ?? null,
        lastAction: last?.action ?? null,
      };
    }),
  };
}

/**
 * Extend moves the existing end date forward. Restart sets it to today plus N.
 * They are separate on purpose, and the difference is money: a trial that
 * lapsed last week gives seven fewer usable days from an extension than from a
 * restart, which is the intent. Do not fold these into one action with a flag.
 *
 * The days are a count and never a date string, because a date from an HQ form
 * is zone-less and would be read as UTC midnight or as server-local time
 * depending on its shape.
 *
 * Neither extend nor restart lifts a BLOCK. profiles.is_blocked is the
 * individual equivalent of a firm's suspension, it is checked at sign-in rather
 * than compared against any date, and it stays until it is explicitly cleared.
 * That is correct: a date change must not silently readmit an account somebody
 * closed on purpose. What this function owes is that it is not SILENT about it,
 * which is why the success branch carries `blocked`.
 */
export async function applyUserTrialAction(
  input: UserTrialActionInput,
): Promise<{ ok: true; blocked: boolean } | { ok: false; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Unavailable. Please try again.' };

  const { data: before, error: beforeErr } = await admin
    .from('profiles')
    .select(PROFILE_TRIAL_COLUMNS)
    .eq('id', input.userId)
    .maybeSingle();

  if (beforeErr) {
    console.error('applyUserTrialAction: could not read the profile', beforeErr.message);
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  if (!before) return { ok: false, error: 'That user no longer exists.' };

  // Without this the extend branch is the one place a dropped column does not
  // fail: prev.trial_ends_at would be undefined, extend would fall through to
  // today plus N, and 'extended' would silently become 'reset'. It errs toward
  // granting MORE. Worse, previous_value would land null, stating the account
  // had no trial before, which is the trail lying in the affirmative
  // direction.
  //
  // It throws rather than returning { ok: false } because a select that lost a
  // column is a defect no admin can act on, and reporting it as "Unavailable"
  // would let it live in production behind a retry button.
  requireProfileColumns(before as Record<string, unknown>, [
    'trial_ends_at',
    'trial_tier',
  ]);

  const prev = before as { trial_ends_at: string | null; trial_tier: string | null };

  let patch: Record<string, unknown> = {};
  let previousValue: string | null = null;
  let newValue: string | null = null;

  switch (input.action.kind) {
    case 'granted':
    case 'reset': {
      const next = isoInstant(Date.now() + input.action.days * DAY_MS);
      if (!next) return { ok: false, error: 'That is not a valid number of days.' };
      patch = { trial_ends_at: next };
      previousValue = prev.trial_ends_at;
      newValue = next;
      break;
    }
    case 'extended': {
      // `== null` and not truthiness. Falling through to Date.now() is only
      // correct for an account that genuinely has no trial end; a truthy test
      // would also treat a stored empty string as "no trial" and grant today
      // plus N off the back of it, where `== null` lets the value through to
      // isoInstant, which refuses. Every wrong answer on this line grants more
      // than was asked for.
      const baseMs =
        prev.trial_ends_at == null
          ? Date.now()
          : new Date(prev.trial_ends_at).getTime();
      const next = isoInstant(baseMs + input.action.days * DAY_MS);
      if (!next) {
        return { ok: false, error: 'Could not extend from the current trial end date.' };
      }
      patch = { trial_ends_at: next };
      previousValue = prev.trial_ends_at;
      newValue = next;
      break;
    }
    case 'tier_changed': {
      patch = { trial_tier: input.action.tierSlug };
      previousValue = prev.trial_tier;
      newValue = input.action.tierSlug;
      break;
    }
    case 'cleared': {
      // The level goes with the date. Leaving a level behind on an account
      // with no clock is a value that grants nothing but reads, on any later
      // screen, as though the account were on a plan.
      patch = { trial_ends_at: null, trial_tier: null };
      previousValue = prev.trial_ends_at;
      newValue = null;
      break;
    }
  }

  // THE WRITE READS ITS ROW BACK, and both columns are load-bearing. Same
  // shape as applyTrialAction in lib/firm-trials.ts, for the same two reasons.
  //
  // `id` is the proof. PostgREST does not raise an error when an UPDATE matches
  // nothing, so a bare `{ error: null }` says the statement ran and says nothing
  // about whether this account changed. Without it, an extension that matched no
  // row returned ok and filed an audit row asserting a new end date while the
  // stored date never moved.
  //
  // `is_blocked` is this side's answer to "will the person feel it". It is the
  // individual equivalent of a firm's suspended_at: a blocked account is signed
  // straight back out at app/auth/callback/route.ts:253, so its trial dates are
  // unreachable no matter what they say. It is read HERE, from the row this
  // statement wrote, because unblocking and extending are separate levers on the
  // same HQ page and nothing serialises them.
  const { data: written, error: updateErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', input.userId)
    .select('id, is_blocked');

  if (updateErr) {
    console.error('applyUserTrialAction: update failed', updateErr.message);
    return { ok: false, error: 'Unavailable. Please try again.' };
  }

  const writtenRows = (written ?? []) as Array<Record<string, unknown>>;
  // No error and no row is the silent case. The account was read a few lines
  // above, so this is a row that went away underneath us rather than a wrong id,
  // and it must not be reported as a change. Nothing is audited: an audit row
  // here would assert an extension nobody received.
  if (writtenRows.length === 0) {
    console.error(
      'applyUserTrialAction: the update matched no row, so nothing was written',
      JSON.stringify({ userId: input.userId, action: input.action.kind }),
    );
    return {
      ok: false,
      error: 'That change did not save. Nothing was written. Try again.',
    };
  }
  if (!('is_blocked' in writtenRows[0])) {
    throw new Error('user-trials read back a profiles row without is_blocked.');
  }
  const blocked = writtenRows[0].is_blocked === true;

  const { error: auditErr } = await admin.from('user_trial_events').insert({
    user_id: input.userId,
    action: input.action.kind,
    actor_user_id: input.actorUserId,
    actor_email: input.actorEmail,
    previous_value: previousValue,
    new_value: newValue,
    note: input.note,
  });

  // The state change already landed. A failed audit write is worth shouting
  // about but must not be reported as a failed action, because 'extended' is
  // the one action that is not idempotent: an admin who retries a "failure"
  // that actually succeeded doubles the grant. A real change with no audit row
  // is recoverable from this log line; an audit row for a change that never
  // happened makes the trail lie in the affirmative direction.
  //
  // The note and the actor email are deliberately not logged. Neither belongs
  // in a log a third party retains, and the actor id identifies the row well
  // enough to reconstruct it minutes later.
  if (auditErr) {
    console.error(
      'applyUserTrialAction: AUDIT WRITE FAILED, the state change already landed',
      JSON.stringify({
        userId: input.userId,
        action: input.action.kind,
        actorUserId: input.actorUserId,
        previousValue,
        newValue,
      }),
      auditErr.message,
    );
  }

  return { ok: true, blocked };
}
