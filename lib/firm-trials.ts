import 'server-only';
import { createAdminSupabase } from './supabase/admin';
import {
  firmAccessState,
  type FirmAccessInput,
  type FirmAccessState,
} from './firm-access';

/**
 * The only module that reads or writes trial state and the audit table.
 *
 * server-only, because every export here uses the admin client by design:
 * firm_trial_events has RLS on and no policy, so it is closed to every
 * client and reachable only from here, under isCurrentUserAdmin.
 *
 * Two properties this file exists to hold, both of which are easy to lose in
 * a later edit:
 *
 * 1. No caller ever builds a FirmAccessInput. firmTrialState returns the
 *    STATE, so the row-to-input mapper lives here once and nowhere else. Do
 *    not add a second export that hands a raw firms row to a route.
 * 2. No access state is ever assigned inside a catch, and no access state is
 *    ever cached. The row may be cached; the state may not, because a cached
 *    'active' outlives the trial end and reintroduces exactly the staleness
 *    that having no scheduled job removes. Every enforcement point calls
 *    firmAccessState against a fresh clock.
 */

export type TrialFirmRow = {
  id: string;
  name: string;
  slug: string;
  trialEndsAt: string | null;
  seatLimit: number | null;
  suspendedAt: string | null;
  memberCount: number;
  state: FirmAccessState;
};

/**
 * These kinds are also the values of the CHECK constraint on
 * firm_trial_events.action. Adding a kind here without adding it there makes
 * every audit insert for that kind fail, which under the ordering below is a
 * silent gap in the trail rather than a failed action. Change both together.
 */
export type TrialAction =
  | { kind: 'granted'; days: number }
  | { kind: 'extended'; days: number }
  | { kind: 'reset'; days: number }
  | { kind: 'suspended' }
  | { kind: 'restored' }
  | { kind: 'seats_changed'; seatLimit: number | null };

/**
 * `actorEmail` is required rather than optional, and typed `| null` rather
 * than left off, so that a caller with only an id has to say so out loud.
 *
 * The audit table records the actor twice on purpose: the uuid resolves only
 * while that user row exists, and the denormalised email is the half that
 * survives the admin being deleted. A nullable column that no writer ever
 * fills is worse than no column, because it looks like an answer and is
 * always null. Making this required means the HQ action layer gets a compile
 * error if it forgets, instead of quietly writing half a record.
 */
export type TrialActionInput = {
  firmId: string;
  actorUserId: string;
  actorEmail: string | null;
  action: TrialAction;
  note: string | null;
};

const DAY_MS = 86_400_000;

/**
 * The two columns firmAccessState needs, named once so the selects in this
 * file cannot drift apart from each other.
 *
 * This constant is for VISIBILITY at the call site and NOT for safety, and
 * the distinction matters enough to write down. select('*') always returns
 * every column; a hand-written list is the only thing that can omit one. So
 * an explicit list is the more dangerous of the two spellings, and the only
 * thing this constant buys back is that the three selects below cannot
 * diverge. Do not cite it as protection.
 */
const FIRM_ACCESS_COLUMNS = 'trial_ends_at, suspended_at';

/**
 * The raw row boundary. This is the single place a database row becomes
 * something lib/firm-access.ts can judge, and therefore the single place
 * `undefined` could be manufactured and handed to a module that can only
 * reject what it is given.
 *
 * The check here is KEY PRESENCE. The inversion against firm-access.ts, which
 * checks the VALUE, is deliberate and the two are complementary. Do not
 * "simplify" either one into a copy of the other.
 *
 * Inside firmAccessState the observable is the value, so `=== undefined` is
 * correct there: it catches a present-but-undefined field from any mapper.
 * Here the failure being caught is an ABSENT COLUMN, and
 * `row.suspended_at === undefined` cannot tell an absent column from a null
 * one, because reading either yields undefined. `in` can, and a null column
 * is legitimate while a missing one means a select forgot it.
 *
 * Throwing is the fail-closed choice and matches firm-access: a caller that
 * cannot establish access gets no answer rather than a permissive one.
 */
function toFirmAccessInput(row: Record<string, unknown>): FirmAccessInput {
  if (!('trial_ends_at' in row) || !('suspended_at' in row)) {
    throw new Error('firm-trials read a firms row without its access columns.');
  }
  return {
    trialEndsAt: row.trial_ends_at as string | null,
    suspendedAt: row.suspended_at as string | null,
  };
}

/**
 * An ISO string, or null when the arithmetic did not land on a real instant.
 *
 * Every date branch in applyTrialAction runs through this, because
 * `new Date(NaN).toISOString()` throws a RangeError and this function is
 * meant to REFUSE a bad action rather than explode inside one. NaN arrives
 * two ways: a non-finite number of days from the HQ form, and an unparseable
 * stored trial_ends_at used as the base of an extension.
 */
function isoInstant(ms: number): string | null {
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export async function listTrialFirms(): Promise<TrialFirmRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  // The filter is deliberately broader than the partial index in
  // 20260801_firm_trials.sql, which covers only `where trial_ends_at is not
  // null`. A suspended organization that never had a trial is still FOUND,
  // because this is a query and not an index lookup; that branch is just
  // answered by a scan rather than by the index. Correctness is unaffected,
  // reads are not.
  const { data, error } = await admin
    .from('firms')
    .select(`id, name, slug, seat_limit, ${FIRM_ACCESS_COLUMNS}`)
    .or('trial_ends_at.not.is.null,suspended_at.not.is.null')
    .order('trial_ends_at', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('listTrialFirms: could not read firms', error.message);
    return [];
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // Same shape as adminListFirms in lib/hq-storage.ts: one select, counted in
  // memory. Display only. Nothing that enforces a seat limit should count
  // members this way.
  const { data: memberRows } = await admin
    .from('firm_members')
    .select('firm_id')
    .in(
      'firm_id',
      rows.map((r) => r.id as string),
    );

  const counts = new Map<string, number>();
  for (const m of (memberRows ?? []) as Array<{ firm_id: string }>) {
    counts.set(m.firm_id, (counts.get(m.firm_id) ?? 0) + 1);
  }

  // One clock for one render of one list. This is not a cached state: the
  // value is computed here and thrown away with the response.
  const now = new Date();
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    trialEndsAt: (r.trial_ends_at as string | null) ?? null,
    seatLimit: (r.seat_limit as number | null) ?? null,
    suspendedAt: (r.suspended_at as string | null) ?? null,
    memberCount: counts.get(r.id as string) ?? 0,
    state: firmAccessState(toFirmAccessInput(r), now),
  }));
}

/**
 * Used by the enforcement layer. Reads the two columns and nothing else, and
 * returns the STATE rather than a row, so no route ever assembles a
 * FirmAccessInput of its own.
 *
 * This function can throw, and that is the design. A throw in middleware is a
 * failed request and a throw in a server component renders the error
 * boundary; both are refusals, which is the correct direction. Callers must
 * not wrap it in a catch that yields an access state.
 */
export async function firmTrialState(
  firmId: string,
): Promise<FirmAccessState> {
  const admin = createAdminSupabase();
  // The one deliberate fail-open in this file, and it is a judgment call
  // rather than an oversight. A null admin client means the service-role key
  // is not configured, which is a deployment fault affecting every
  // organization at once, not a fact about this one. Locking the entire
  // customer base out of the product on a missing environment variable is a
  // worse outcome than briefly not enforcing trials, and it is the same
  // posture the rest of the app takes when Supabase is unconfigured. Nothing
  // else below may return a state it did not compute.
  if (!admin) return 'active';

  const { data, error } = await admin
    .from('firms')
    .select(FIRM_ACCESS_COLUMNS)
    .eq('id', firmId)
    .maybeSingle();

  // "Could not determine access" is not "this request has no organization",
  // and only the second may proceed. Returning 'active' on a read error would
  // turn every transient database fault into a grant, so it throws instead.
  if (error) {
    console.error('firmTrialState: read failed', error.message);
    throw new Error(
      'firm-trials could not determine access for this organization.',
    );
  }
  if (!data) {
    throw new Error(
      'firm-trials was asked about an organization that does not exist.',
    );
  }

  // Fresh clock, every call. Never hoist this, never memoise the result.
  return firmAccessState(
    toFirmAccessInput(data as Record<string, unknown>),
    new Date(),
  );
}

/**
 * Extend moves the existing end date forward. Reset sets it to today plus N.
 * They are separate on purpose: extending a trial that lapsed last week must
 * not silently grant a longer run than intended, and the difference is
 * commercially meaningful.
 *
 * Neither extend nor reset clears suspended_at. A suspended organization
 * stays closed until it is explicitly restored.
 *
 * The days are a count and never a date string, because a date from an HQ
 * form is zone-less and firm-access would read it as local time.
 */
export async function applyTrialAction(
  input: TrialActionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Unavailable. Please try again.' };

  const { data: before, error: beforeErr } = await admin
    .from('firms')
    .select(`seat_limit, ${FIRM_ACCESS_COLUMNS}`)
    .eq('id', input.firmId)
    .maybeSingle();

  // A read failure and a deleted organization are separate answers. Reporting
  // the first as the second sends an admin looking for something that is
  // still there.
  if (beforeErr) {
    console.error(
      'applyTrialAction: could not read the organization',
      beforeErr.message,
    );
    return { ok: false, error: 'Unavailable. Please try again.' };
  }
  if (!before) {
    return { ok: false, error: 'That organization no longer exists.' };
  }

  const prev = before as {
    trial_ends_at: string | null;
    seat_limit: number | null;
    suspended_at: string | null;
  };

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
      const baseMs = prev.trial_ends_at
        ? new Date(prev.trial_ends_at).getTime()
        : Date.now();
      const next = isoInstant(baseMs + input.action.days * DAY_MS);
      if (!next) {
        return {
          ok: false,
          error: 'Could not extend from the current trial end date.',
        };
      }
      patch = { trial_ends_at: next };
      previousValue = prev.trial_ends_at;
      newValue = next;
      break;
    }
    case 'suspended': {
      const at = new Date().toISOString();
      patch = { suspended_at: at };
      previousValue = prev.suspended_at;
      newValue = at;
      break;
    }
    case 'restored': {
      patch = { suspended_at: null };
      previousValue = prev.suspended_at;
      newValue = null;
      break;
    }
    case 'seats_changed': {
      patch = { seat_limit: input.action.seatLimit };
      previousValue = prev.seat_limit == null ? null : String(prev.seat_limit);
      newValue =
        input.action.seatLimit == null ? null : String(input.action.seatLimit);
      break;
    }
  }

  const { error: updateErr } = await admin
    .from('firms')
    .update(patch)
    .eq('id', input.firmId);

  if (updateErr) {
    console.error('applyTrialAction: update failed', updateErr.message);
    return { ok: false, error: 'Unavailable. Please try again.' };
  }

  const { error: auditErr } = await admin.from('firm_trial_events').insert({
    firm_id: input.firmId,
    action: input.action.kind,
    actor_user_id: input.actorUserId,
    actor_email: input.actorEmail,
    previous_value: previousValue,
    new_value: newValue,
    note: input.note,
  });

  // The state change already landed. A failed audit write is worth shouting
  // about but must not be reported as a failed action, because 'extended' is
  // the one action that is not idempotent: it adds days to whatever is
  // already stored, so an admin who retries a "failure" that actually
  // succeeded doubles the grant. The two failure modes are a real change with
  // no audit row, which is recoverable from this log line, against an audit
  // row for a change that never happened, which makes the trail lie in the
  // affirmative direction. The first is the better one to have.
  //
  // The durable fix is one transaction, which means a Postgres function and
  // therefore a migration. Not this task's file.
  //
  // The note and the actor email are deliberately not logged. The note is
  // free text an operator typed, and the id identifies the actor well enough
  // to reconstruct the row minutes later, which is the only window in which
  // anyone acts on this line. Neither belongs in a log a third party retains.
  if (auditErr) {
    console.error(
      'applyTrialAction: AUDIT WRITE FAILED, the state change already landed',
      JSON.stringify({
        firmId: input.firmId,
        action: input.action.kind,
        actorUserId: input.actorUserId,
        previousValue,
        newValue,
      }),
      auditErr.message,
    );
  }

  return { ok: true };
}
