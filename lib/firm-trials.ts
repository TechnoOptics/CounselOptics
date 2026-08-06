import 'server-only';
import { createAdminSupabase, isServiceRoleConfigured } from './supabase/admin';
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
 *
 * The presence test is a named function rather than an inline condition
 * because all three reads in this file owe it, including the write path in
 * applyTrialAction, which reads one column more than these two.
 */
function requireFirmColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
): void {
  for (const column of columns) {
    if (!(column in row)) {
      throw new Error(`firm-trials read a firms row without ${column}.`);
    }
  }
}

function toFirmAccessInput(row: Record<string, unknown>): FirmAccessInput {
  requireFirmColumns(row, ['trial_ends_at', 'suspended_at']);
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

/**
 * Log-once latches for the single case in which this file cannot reach the
 * database at all: createAdminSupabase returned null.
 *
 * These are LATCHES and not cached state, and the difference is the whole
 * reason they are allowed to exist here. A latch records only whether this
 * process has already said the thing out loud. It holds no row, no
 * FirmAccessState, no timestamp; nothing reads it except the line that sets
 * it; and it has no correct value that it could drift away from, so it cannot
 * go stale. The no-caching rule at the top of this file is about access state,
 * and it does not reach these. Do not delete them as "state".
 *
 * They exist because the failure they announce is otherwise completely silent,
 * and it is the most expensive silent failure this feature has. With no admin
 * client, firmTrialState returns 'active' for every organization forever, so
 * every expired trial and every suspension stops being enforced;
 * applyTrialAction refuses every write; and listTrialFirms returns an empty
 * array, so the HQ trials page renders as though no organization were on a
 * trial and looks entirely calm. The commercial control is off end to end with
 * no signal anywhere. One line per process per call site is the smallest thing
 * that makes that findable without logging on every single request.
 *
 * One latch per call site rather than one shared, because the two lines answer
 * different questions asked by different people: the enforcement line explains
 * why nobody is being cut off, and the HQ line explains why the page is empty.
 * A single shared latch would let whichever fired first swallow the other.
 */
let loggedMissingAdminInState = false;
let loggedMissingAdminInList = false;

/**
 * createAdminSupabase returns null for a missing Supabase URL as well as for a
 * missing service-role key, so name which one it is. A log line that sends
 * someone to the wrong environment variable is barely better than no log line.
 */
function missingAdminReason(): string {
  return isServiceRoleConfigured()
    ? 'SUPABASE_SERVICE_ROLE_KEY is set, so the missing piece is the Supabase URL'
    : 'SUPABASE_SERVICE_ROLE_KEY is not configured';
}

export async function listTrialFirms(): Promise<TrialFirmRow[]> {
  const admin = createAdminSupabase();
  // An empty array here is indistinguishable from "no organization is on a
  // trial", which is the one surface an operator would check to notice that
  // enforcement had stopped. Say once that the list is unreadable rather than
  // empty.
  if (!admin) {
    if (!loggedMissingAdminInList) {
      loggedMissingAdminInList = true;
      console.error(
        'listTrialFirms: no admin client, so the HQ trials list is UNREADABLE and will render as though no organization were on a trial.',
        missingAdminReason(),
      );
    }
    return [];
  }

  // A suspended organization that never had a trial is FOUND by this filter.
  // That is a property of the query and holds no matter what is indexed,
  // because a disjunction is evaluated over the table rather than looked up.
  //
  // Indexing is a separate question and 20260801_firm_trials.sql answers it
  // with a partial index per branch. Both are needed or neither is used:
  // Postgres can combine index scans across an OR only with a BitmapOr, and
  // it cannot build one unless every branch is covered. If a later change
  // drops either index the results stay correct and the read becomes a scan.
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
  //
  // It is a fail-open, so it does not get to be quiet as well. Unlogged, this
  // branch turns every organization active forever and no surface in the
  // product shows a difference. The latch keeps that to one line per process
  // instead of one per request.
  if (!admin) {
    if (!loggedMissingAdminInState) {
      loggedMissingAdminInState = true;
      console.error(
        'firmTrialState: no admin client, so trial and suspension enforcement is OFF for every organization until this is fixed.',
        missingAdminReason(),
      );
    }
    return 'active';
  }

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
 * Whether an organization is SUSPENDED, as distinct from merely lapsed.
 *
 * firmAccessState deliberately collapses both into 'export_only', because for
 * every write path the answer is the same: no. This is the one place the
 * difference is load-bearing, and it exists rather than a third
 * FirmAccessState so that the union stays two-membered and the exhaustive
 * switches over it keep their meaning.
 *
 * The caller is the counsel shell's co-counsel guest branch. A guest is an
 * outside attorney the firm invited onto one matter, and a lapsed TRIAL is a
 * billing fact about the firm, not a reason to take a matter away from the
 * lawyer working it. A SUSPENSION is the abuse-response state, and while it
 * holds, an account the firm itself provisioned is a channel the suspension is
 * meant to close rather than a neutral third party. So the guest read
 * exemption is narrowed to lapsed trials, and this is the question that
 * narrows it.
 *
 * Presence, not a date, matching firmAccessState exactly. Throws on a read it
 * could not complete, for the same reason firmTrialState does: "could not
 * determine" is not "not suspended".
 *
 * Callers: the counsel shell's co-counsel guest branch, and the four matter
 * route handlers a guest can reach by URL, which render no layout and so
 * cannot rely on the shell.
 *
 * FAIL DIRECTIONS, all four, because only one of them is permissive and it
 * should not have to be inferred:
 *
 *   read error        -> throws  (fail closed)
 *   organization gone -> throws  (fail closed)
 *   column missing    -> throws  (fail closed)
 *   no admin client   -> false   (FAIL OPEN, and the only one)
 */
export async function firmSuspended(firmId: string): Promise<boolean> {
  const admin = createAdminSupabase();
  // THE ONE BRANCH OF THIS FUNCTION THAT IS NOT FAIL-CLOSED, said plainly so
  // nobody has to work it out from the absence of a throw. It is deliberate
  // and it matches firmTrialState exactly, which is what makes it consistent
  // rather than an oversight: a missing service-role key is a deployment
  // fault affecting every organization at once, not a fact about this one,
  // and locking the whole customer base out of the product on an unset
  // environment variable is the worse outcome. Every other way this function
  // can fail throws.
  if (!admin) return false;

  const { data, error } = await admin
    .from('firms')
    .select('suspended_at')
    .eq('id', firmId)
    .maybeSingle();

  if (error) {
    console.error('firmSuspended: read failed', error.message);
    throw new Error(
      'firm-trials could not determine access for this organization.',
    );
  }
  if (!data) {
    throw new Error(
      'firm-trials was asked about an organization that does not exist.',
    );
  }
  const row = data as Record<string, unknown>;
  if (!('suspended_at' in row)) {
    throw new Error('firm-trials read a firms row without its access columns.');
  }
  return row.suspended_at != null;
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

  // The same key-presence gate the two reads use, extended to seat_limit,
  // which is the one column only this path reads.
  //
  // Without it this function is the single place where a dropped column does
  // not fail. If FIRM_ACCESS_COLUMNS or the select above ever loses
  // trial_ends_at, firmTrialState and listTrialFirms both throw, and this
  // function does not: prev.trial_ends_at would be undefined, the extend
  // branch would fall through to today plus N, and 'extended' would silently
  // become 'reset', which is exactly what the comment above this function says
  // must not happen. It errs toward granting MORE access. Worse, previousValue
  // would then be undefined, supabase-js drops undefined from an insert
  // payload, and the audit row would land with previous_value null, stating
  // that the organization had no trial before. That is the trail lying in the
  // affirmative direction, which the ordering note further down argues is the
  // worst failure available here.
  //
  // This throws rather than returning { ok: false }, unlike every other refusal
  // in this function. The result union carries messages an admin can act on; a
  // select that lost a column is a defect in this file that no admin can do
  // anything about, and quietly reporting it as "Unavailable" would let it live
  // in production behind a retry button.
  requireFirmColumns(before as Record<string, unknown>, [
    'trial_ends_at',
    'suspended_at',
    'seat_limit',
  ]);

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
      // `== null` and not truthiness, which is the same distinction the gate
      // above exists to draw. Falling through to Date.now() is only correct
      // for an organization that genuinely has no trial end. A truthy test
      // also treats a stored empty string as "no trial" and grants today plus
      // N off the back of it, where `== null` lets the value through to
      // isoInstant, which refuses. Every wrong answer on this line grants more
      // access than was asked for, so it is spelled explicitly.
      const baseMs =
        prev.trial_ends_at == null
          ? Date.now()
          : new Date(prev.trial_ends_at).getTime();
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
