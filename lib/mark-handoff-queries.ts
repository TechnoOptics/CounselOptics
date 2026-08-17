import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  hashHandoffToken,
  mintHandoffToken,
  HANDOFF_TTL_MINUTES,
  type HandoffState,
} from '@/lib/signing-handoff';
import { markHandoffState } from '@/lib/mark-handoff';
import { decodeSignaturePng } from '@/lib/template-signature';
import { isUnknownTableError } from '@/lib/signer-view';

/**
 * The only module that reads or writes firm_mark_handoffs.
 *
 * server-only, because every export here goes through the admin client and
 * therefore past RLS by design: the table has RLS on and no policy, so it is
 * closed to every client and reachable only from here. That makes the checks
 * written into each function below the whole of the authorization, and it is
 * why they are written as filters on the statement rather than as `if`s around
 * it: a row that does not belong to this session is not found, rather than
 * found and then judged.
 *
 * There is no decision logic here. Whether a handoff may be claimed or used is
 * decided by lib/mark-handoff.ts, which delegates in turn to the pure, unit
 * tested state machine in lib/signing-handoff.ts.
 *
 * EVERY WRITE IS READ BACK. PostgREST resolves with `{ error }` instead of
 * throwing, and matching zero rows is not an error at all, so `.select()` on
 * the way out is the only thing that distinguishes "updated" from "the filter
 * matched nothing". Two of the guards in this file are exactly that filter.
 *
 * A missing table reads as a missing handoff throughout: every read here
 * finds nothing and the one write reports failure. That is NOT the same as
 * the feature degrading, and this header used to say it was. Reading as "no
 * handoff" is what happens AFTER an employee has been offered the phone,
 * fetched it, and tapped the button. Not offering it in the first place is
 * markHandoffFeatureAvailable below, and it is the only thing here that
 * answers "does this feature exist" rather than "is there a handoff".
 */

export const MARK_HANDOFF_COOKIE = 'adv_mark_handoff';

/** Named once. It appears in the probe's statement and in the error message
 *  the probe classifies, and those two must be the same string. */
const MARK_HANDOFF_TABLE = 'firm_mark_handoffs';

/**
 * Does this database have the phone handoff at all?
 *
 * WHY THIS EXISTS AS A SEPARATE QUESTION.
 *
 * The employee's form used to decide whether to offer the phone entirely from
 * firm_templates.signature_methods. Null there means "no restriction
 * recorded", which is correct and deliberately fail-open: a database without
 * 20260814_signature_methods.sql must not thereby refuse every method. But
 * 20260815_mark_handoffs.sql is unapplied too, so that fail-open default was
 * answering a question it knows nothing about, and the form offered a route
 * whose table does not exist. The employee tapped it and was told the feature
 * was unavailable, after being invited to reach for their phone.
 *
 * So the two questions are asked separately and of the right authority. The
 * firm's setting says whether the phone is ALLOWED. This says whether it is
 * POSSIBLE. An offer needs both.
 *
 * FAIL CLOSED, on purpose and in the cheap direction. Anything other than a
 * clean answer means this cannot establish the offer can be honoured, so it
 * is not made. Nothing is lost by being wrong that way: the pad is on the
 * same page, and the mint would have refused anyway.
 *
 * Not cached. One narrow select per form render is not worth a cache that
 * would keep answering "no" for the life of the process after the owner
 * applies the migration, which is exactly the moment somebody is watching to
 * see whether it worked.
 */
export async function markHandoffFeatureAvailable(): Promise<boolean> {
  const admin = createAdminSupabase();
  if (!admin) {
    console.error(
      '[mark-handoff] no service-role client, so signing on a phone cannot be offered.',
    );
    return false;
  }

  try {
    const { error } = await admin.from(MARK_HANDOFF_TABLE).select('id').limit(1);
    if (!error) return true;

    // The expected state until the owner applies the migration. Named so an
    // operator reading this line knows what to run rather than what to debug.
    if (isUnknownTableError(error, MARK_HANDOFF_TABLE)) {
      console.error(
        `[mark-handoff] ${MARK_HANDOFF_TABLE} is absent (${error.code}), so signing on a phone is not offered. Apply supabase/migrations/20260815_mark_handoffs.sql and regenerate supabase/schema-fingerprint.sha256.`,
      );
      return false;
    }

    console.error(
      `[mark-handoff] could not establish whether ${MARK_HANDOFF_TABLE} exists (${error.code ?? 'no code'}: ${error.message ?? 'no message'}), so signing on a phone is not offered.`,
    );
    return false;
  } catch (e) {
    console.error(
      `[mark-handoff] the ${MARK_HANDOFF_TABLE} probe threw, so signing on a phone is not offered:`,
      e,
    );
    return false;
  }
}

/** The columns every read below needs, in one place. */
const HANDOFF_COLS =
  'id, firm_id, user_id, template_id, session_hash, created_at, expires_at, consumed_at, mark_png, mark_sha256, mark_at, collected_at, used_at';

type HandoffRecord = {
  id: string;
  firm_id: string;
  user_id: string;
  template_id: string;
  session_hash: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  mark_png: string | null;
  mark_sha256: string | null;
  mark_at: string | null;
  collected_at: string | null;
  used_at: string | null;
};

function stateOf(row: HandoffRecord, cookie: string | null): HandoffState {
  return markHandoffState(
    {
      sessionHash: row.session_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      markAt: row.mark_at,
    },
    new Date(),
    cookie,
  );
}

/** The fingerprint the desk's submission is later checked against. */
function markFingerprint(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------

/**
 * Mint a row for this session's own firm, user and template.
 *
 * The three ids are the caller's session, resolved by the action above this
 * and never read from a request body. lib/mark-handoff.ts takes this function
 * already closed over them for that reason: there is no identity argument in
 * the pure module that a caller could substitute.
 */
export async function createMarkHandoff(owner: {
  firmId: string;
  userId: string;
  templateId: string;
}): Promise<{ ok: true; rawToken: string; handoffId: string } | { ok: false }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false };

  const rawToken = mintHandoffToken();
  const { data, error } = await admin
    .from('firm_mark_handoffs')
    .insert({
      firm_id: owner.firmId,
      user_id: owner.userId,
      template_id: owner.templateId,
      token_hash: hashHandoffToken(rawToken),
      expires_at: new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .maybeSingle();

  // The insert is read back rather than trusted. Without this a failed write
  // hands out a QR encoding a token no row will ever match, and the employee
  // scans it, waits, and is told nothing is wrong.
  //
  // The employee is told a plain sentence with no cause in it, which is right:
  // the cause is the database's and means nothing to them. It has to reach
  // somebody though, and it used to reach nobody, so this is the operator's
  // copy of it.
  if (error || !data) {
    console.error(
      `[mark-handoff] could not mint a handoff (${error?.code ?? 'no code'}: ${error?.message ?? 'the insert returned no row'}). The employee was told signing on a phone is unavailable.`,
    );
    return { ok: false };
  }
  return { ok: true, rawToken, handoffId: (data as { id: string }).id };
}

export type MarkCollection = {
  /** The picture, on the one call that carries it out. Null every other time. */
  mark: string | null;
  /**
   * When the phone signed, as this server stamped it, or null.
   *
   * Carried out with the picture so the desk can print a date and a time
   * beside it without inventing one. It is deliberately the row's instant and
   * not the collecting browser's: everything else on this path is server time
   * for the reason given on storeMarkForHandoff, and a desk printing
   * `new Date()` would be a fourth clock in a ceremony that has already been
   * bitten by two of them disagreeing about the calendar day.
   */
  markAt: string | null;
  /** A phone has claimed this code. The desk stops offering it to scan. */
  scanned: boolean;
  /** This row has already handed its picture over and never will again. */
  collected: boolean;
};

/**
 * The desk collecting the picture its own phone drew.
 *
 * Scoped by user AND firm in both statements. A handoff id is a uuid a caller
 * supplies, and this is a 'use server' path, so the id alone proves nothing:
 * the filter is what stops one employee reading another's mark, and it is a
 * filter rather than a comparison so a row belonging to somebody else is never
 * loaded at all.
 *
 * WHY THIS IS TWO STATEMENTS AND NOT ONE.
 *
 * It was one, and it destroyed a signature in production. The read and the
 * clearing were the same statement: `.update({ mark_png: null }).select(
 * 'mark_png')`. `UPDATE ... RETURNING` reports the row as it is AFTER the
 * statement, so the read-back was the null this function had just written, and
 * it returned "no mark yet" while stamping the row collected. The desk polled
 * on, showed nothing, logged nothing, and the picture was unreachable forever.
 * The row that proved it: created 02:26:30, consumed 02:26:48, marked 02:26:54,
 * collected 02:26:55, and a laptop with an empty preview and a live QR on it.
 *
 * So the order is now: read the picture, then claim the row, then return the
 * picture the read produced. THE INVARIANT IS THAT collected_at IS STAMPED
 * ONLY ON A CALL THAT CARRIES THE PICTURE OUT. Anything that goes wrong before
 * the claim leaves the mark exactly where it was, because the alternative is
 * deleting somebody's signature from a legal document.
 *
 * Concurrency is still the claim's, not the read's. Two overlapping polls both
 * read the picture; only one can satisfy `.is('collected_at', null)` on the
 * update, and the loser is told it has nothing, which is true of it. That is
 * why the claim is conditional and read back rather than fired and trusted.
 *
 * What stays behind after a claim is mark_sha256, which is what the submission
 * gate checks the desk's eventual upload against. The image is in flight, not
 * at rest: 20260815_mark_handoffs.sql justifies holding a signature PNG in a
 * column on exactly that basis, so the nulling stays.
 */
export async function collectMarkForOwner(input: {
  handoffId: string;
  userId: string;
  firmId: string;
}): Promise<MarkCollection> {
  const nothing: MarkCollection = {
    mark: null,
    markAt: null,
    scanned: false,
    collected: false,
  };
  const admin = createAdminSupabase();
  if (!admin) return nothing;

  // No state predicate on this read. It asks what the row IS, including the
  // two states the desk needs to hear about and cannot infer from silence: a
  // code somebody is signing on right now, and a row whose picture has already
  // gone. Filtering those out here is what made both of them look identical to
  // "nothing has happened yet".
  const { data } = await admin
    .from('firm_mark_handoffs')
    .select('mark_png, mark_at, consumed_at, collected_at')
    .eq('id', input.handoffId)
    .eq('user_id', input.userId)
    .eq('firm_id', input.firmId)
    .maybeSingle();

  const found = data as {
    mark_png: string | null;
    mark_at: string | null;
    consumed_at: string | null;
    collected_at: string | null;
  } | null;
  if (!found) return nothing;

  const state = {
    mark: null,
    markAt: null,
    scanned: Boolean(found.consumed_at),
    collected: Boolean(found.collected_at),
  } satisfies MarkCollection;

  const mark = found.collected_at ? null : found.mark_png;
  if (!mark) return state;

  const { data: claimed } = await admin
    .from('firm_mark_handoffs')
    .update({ collected_at: new Date().toISOString(), mark_png: null })
    .eq('id', input.handoffId)
    .eq('user_id', input.userId)
    .eq('firm_id', input.firmId)
    // Both filters are load-bearing on the way past a race. collected_at is
    // what makes this the one caller that may have the picture; mark_png keeps
    // the stamp off a row that has none, so the column can never say a
    // signature was collected when none existed.
    .is('collected_at', null)
    .not('mark_png', 'is', null)
    .select('id')
    .maybeSingle();

  // The claim is read back rather than assumed, because PostgREST resolves
  // with { error } and counts zero matched rows as a success. No row means
  // another poll got there first, and it is carrying the picture.
  if (!claimed) return state;
  // The instant travels with the picture and only with it. A caller that did
  // not win the claim above is not the one showing this signature, so handing
  // it a time would invite a second surface to print one.
  return { mark, markAt: found.mark_at, scanned: true, collected: false };
}

/**
 * Was this picture drawn on a phone that scanned this employee's own code?
 *
 * The one thing that lets a submission be recorded as method 'phone'. Every
 * part of the answer is the server's: the row is found only under this
 * session's user, firm and template, it must carry a fingerprint left by a
 * bound phone, and the bytes the desk is submitting must hash to it. A desk
 * that draws its own mark and names a real handoff fails the hash; a desk that
 * names somebody else's handoff does not find a row.
 *
 * Spent on success, so one phone mark attests one document. `used_at is null`
 * is a filter on the update and the update is read back, which is what makes
 * that single-use rather than merely intended: two concurrent submissions
 * cannot both match it.
 */
export async function spendPhoneMarkAttestation(input: {
  handoffId: string;
  userId: string;
  firmId: string;
  templateId: string;
  signatureDataUrl: string | undefined;
}): Promise<boolean> {
  const admin = createAdminSupabase();
  if (!admin) return false;

  const decoded = decodeSignaturePng(input.signatureDataUrl);
  if (!decoded.ok) return false;

  const { data } = await admin
    .from('firm_mark_handoffs')
    .update({ used_at: new Date().toISOString() })
    .eq('id', input.handoffId)
    .eq('user_id', input.userId)
    .eq('firm_id', input.firmId)
    .eq('template_id', input.templateId)
    .eq('mark_sha256', markFingerprint(decoded.bytes))
    .is('used_at', null)
    .select('id')
    .maybeSingle();

  return Boolean(data);
}

// ---------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------

/** Read a row by its raw token. Never exported: the token is the phone's. */
async function readByToken(rawToken: string): Promise<HandoffRecord | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin
    .from('firm_mark_handoffs')
    .select(HANDOFF_COLS)
    .eq('token_hash', hashHandoffToken(rawToken))
    .maybeSingle();
  return (data as HandoffRecord | null) ?? null;
}

export type MarkClaimResult =
  | { ok: true; sessionSecret: string }
  | { ok: false; state: HandoffState };

/**
 * First GET consumes the token and binds it to the scanning device.
 *
 * Conditional on consumed_at still being null and read back, so two phones
 * scanning the same screen in the same instant cannot both claim it. The loser
 * is told what every other dead code is told.
 */
export async function claimMarkHandoff(
  rawToken: string,
  ip: string | null,
  userAgent: string | null,
): Promise<MarkClaimResult> {
  const admin = createAdminSupabase();
  const found = admin ? await readByToken(rawToken) : null;
  if (!admin || !found) return { ok: false, state: 'consumed' };

  // No cookie is presented on a claim by definition: this is the first time
  // this device has been seen.
  const state = stateOf(found, null);
  if (state !== 'claimable') {
    return { ok: false, state: state === 'bound' ? 'consumed' : state };
  }

  const sessionSecret = mintHandoffToken();
  const { data } = await admin
    .from('firm_mark_handoffs')
    .update({
      consumed_at: new Date().toISOString(),
      session_hash: hashHandoffToken(sessionSecret),
      consumed_ip: ip,
      consumed_user_agent: userAgent,
    })
    .eq('id', found.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  if (!data) return { ok: false, state: 'consumed' };
  return { ok: true, sessionSecret };
}

export type BoundMarkHandoff = {
  handoffId: string;
  /** Only what the pad prints. No document, no field values, no email. */
  signerLabel: string;
  documentName: string;
  /**
   * The firm's PUBLIC branding, so the phone can show whose paper this is.
   *
   * Added against the grain of the note below, so the reasoning is written
   * here rather than assumed. A firm's name and logo are already public: the
   * logo is served from a public storage bucket and the name is on the
   * letterhead of the document being signed. Neither tells this device
   * anything about the document, the form, the mark, or the session, which is
   * what that note is protecting. And the employee holding the phone works
   * there.
   *
   * Nulls are ordinary and must stay harmless. A firm with no logo uploaded is
   * the common case.
   */
  firmName: string | null;
  firmLogoUrl: string | null;
};

/**
 * Every request from the phone after the claim.
 *
 * The two names it returns are the only things this device is ever told, and
 * both are already on the code the employee is holding up. It is given no
 * route to the document, to the form, to a mark, or to the session that minted
 * it: this function reads a template name and a display name and nothing else.
 */
export async function loadBoundMarkHandoff(
  rawToken: string,
  presentedSessionSecret: string | null,
): Promise<{ ok: true; bound: BoundMarkHandoff } | { ok: false; state: HandoffState }> {
  const found = await readByToken(rawToken);
  if (!found) return { ok: false, state: 'consumed' };

  const state = stateOf(found, presentedSessionSecret);
  if (state !== 'bound') return { ok: false, state };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, state: 'consumed' };

  const { data: tpl } = await admin
    .from('firm_templates')
    .select('name')
    .eq('id', found.template_id)
    .maybeSingle();

  const { data: emp } = await admin
    .from('firm_employees')
    .select('display_name')
    .eq('firm_id', found.firm_id)
    .eq('user_id', found.user_id)
    .maybeSingle();

  // The firm is already on the row, so this is one read and no join chain.
  // Tolerated entirely: branding is decoration on the phone, and a failure to
  // read a logo must never be the reason somebody cannot sign.
  const { data: firmRow } = await admin
    .from('firms')
    .select('name, logo_url')
    .eq('id', found.firm_id)
    .maybeSingle();
  const firm = firmRow as { name?: string | null; logo_url?: string | null } | null;

  return {
    ok: true,
    bound: {
      handoffId: found.id,
      signerLabel:
        (emp as { display_name?: string | null } | null)?.display_name?.trim() ||
        'your signature',
      documentName:
        (tpl as { name?: string | null } | null)?.name?.trim() || 'this document',
      firmName: firm?.name?.trim() || null,
      firmLogoUrl: firm?.logo_url?.trim() || null,
    },
  };
}

/**
 * The phone handing its mark back, which is the only thing it may do.
 *
 * The row is found by the caller's own bound token, never by an id in a
 * request body, so this cannot be pointed at somebody else's handoff. The
 * write is conditional on mark_at still being null and read back, so a phone
 * cannot replace a mark the desk has already collected.
 */
/** What the phone is told when it posts a mark with no affirmation. */
export const MARK_INTENT_REQUIRED =
  'Please affirm your intent to sign before submitting.';

/**
 * Did the caller actually affirm, and is what it sent a real instant?
 *
 * A bare `typeof x === 'string'` accepted '' and 'banana' alike, which made
 * the field a boolean wearing a timestamp's clothes. Parsing is not enough
 * either: `new Date('garbage')` is an Invalid Date whose every comparison is
 * false, so a check written as a comparison would pass it. getTime() is
 * asserted against NaN directly for that reason.
 */
export function affirmedAt(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !Number.isNaN(new Date(value).getTime());
}

export async function storeMarkForHandoff(input: {
  rawToken: string;
  presentedSessionSecret: string | null;
  signatureDataUrl: unknown;
  intentAffirmedAt: unknown;
}): Promise<{ ok: true } | { ok: false; state: HandoffState } | { ok: false; error: string }> {
  const found = await readByToken(input.rawToken);
  if (!found) return { ok: false, state: 'consumed' };

  const state = stateOf(found, input.presentedSessionSecret);
  if (state !== 'bound') return { ok: false, state };

  const decoded = decodeSignaturePng(input.signatureDataUrl);
  if (!decoded.ok) return { ok: false, error: decoded.error };

  // No affirmation, no signature.
  //
  // The pad on the phone will not let anybody submit without ticking the box,
  // but the pad is not the gate: this endpoint is reachable by anything
  // holding the cookie, so the browser's check protects nobody who did not
  // want protecting. Until now an absent field stored null and the mark landed
  // anyway, which produced a signature carrying no affirmation of intent at
  // all - the definitional element of an electronic signature under 15 USC
  // 7006(5) and UETA 2(8).
  //
  // Refused BEFORE the update, so a request without it does not consume the
  // handoff. Otherwise a malformed client would burn the code and the person
  // would have to go back to the desk and mint another.
  if (!affirmedAt(input.intentAffirmedAt)) {
    return { ok: false, error: MARK_INTENT_REQUIRED };
  }

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, state: 'consumed' };

  const { data } = await admin
    .from('firm_mark_handoffs')
    .update({
      // Stored as the caller's data URL so the desk can draw it without a
      // round trip through storage, but the FINGERPRINT beside it is over the
      // decoded bytes this server validated, and it is the fingerprint the
      // submission gate checks.
      mark_png: typeof input.signatureDataUrl === 'string' ? input.signatureDataUrl : null,
      mark_sha256: markFingerprint(decoded.bytes),
      mark_at: new Date().toISOString(),
      // Server time, not the phone's. The client's clock is unverifiable and
      // this column is evidence; what the client's timestamp is FOR is proving
      // it affirmed at all, which affirmedAt above has already established.
      mark_intent_at: new Date().toISOString(),
    })
    .eq('id', found.id)
    .is('mark_at', null)
    .select('id')
    .maybeSingle();

  if (!data) return { ok: false, state: 'consumed' };
  return { ok: true };
}
