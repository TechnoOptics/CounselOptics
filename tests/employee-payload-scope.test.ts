import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * WHAT THE EMPLOYEE'S PAGE FETCHES IS THE ONLY THING THAT KEEPS A LEGAL-ONLY
 * FACT AWAY FROM THE EMPLOYEE.
 *
 * The owner's rule, in his words about the drop box: show the legal team's
 * tools "on the legal side but do not show them to the employee since they
 * are legal team tools and do not need to be seen by the employees". That is
 * one record with two audiences, not two designs.
 *
 * It cannot be honoured by omitting a field from a component. A server
 * component's props cross to the browser in the RSC payload, and a value the
 * page holds but does not draw is still a value the page was handed.
 *
 * It is worse than that here. app/portal/[id]/page.tsx reads through
 * createAdminSupabase with a hand-written canViewIntake gate, so RLS is not
 * in the path at all: whatever the query selects, the employee's page may
 * see. The file's own comment already says "Nothing on this page may be added
 * by widening the query above" - and nothing enforced it, which is exactly
 * the shape of defect this repo has been bitten by before, a comment stating
 * a rule that no test holds anyone to.
 *
 * So the boundary is the SELECT list, and this is the guard on it.
 *
 * The precedent this follows rather than invents is lib/intake-conversation.ts,
 * which filters at the query on the reader's role: internal messages are never
 * fetched for an employee (`if (role !== 'legal') q = q.eq('visibility',
 * 'shared')`, line 133) and upload requests are only queried at all when the
 * reader is legal (line 220). Row-level, at the source. This is the same idea
 * one level down, at the column.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const PORTAL = 'app/portal/[id]/page.tsx';

/**
 * Columns of firm_matter_intakes that belong to the legal team. Read off the
 * counsel page's own type declaration, which is the live contract for that
 * table.
 *
 * Each is a legal-team working fact, not something the person who filed the
 * request is owed: who it is assigned to and when they will look at it, the
 * conflict check and its results, the matter it became, and the requester's
 * own contact details as the firm recorded them.
 */
const LEGAL_ONLY_COLUMNS = [
  'assigned_to',
  'follow_up_on',
  'due_on',
  'conflict_check_notes',
  'conflict_results',
  'jurisdiction_state',
  'case_id',
  'client_email',
  'client_phone',
  'opposing_parties',
  'related_parties',
  // The legal team's own fields, added by
  // supabase/migrations/20260903_intake_legal_fields_internal.sql. Real
  // columns precisely so this list can name them; see
  // lib/intake-legal-fields.ts, whose column list
  // tests/intake-legal-fields.test.ts checks against this one.
  'related_case_id',
  'completed_on',
  'multiple_documents',
  // And by 20260903_intake_legal_fields_contract.sql: the contract dates,
  // the expiry notice flag and the sweep's own stamp.
  'effective_on',
  'expires_on',
  'notify_on_expiry',
  'expiry_notified_at',
  // The legal team's nine-state Status (20260816_intake_workflow_state.sql).
  // The employee reads the four-word label lib/portal-status.ts derives from
  // the lifecycle `status`, and nothing finer: the owner's rule for the drop
  // box was that its status is a legal team tool. The counsel page keeps
  // `status` in the right lane on every write, so the label stays truthful.
  'workflow_state',
];

/** The single .select(...) argument on the employee's read of the ticket. */
function employeeSelect(): string {
  const src = stripComments(read(PORTAL));
  const at = src.indexOf("from('firm_matter_intakes')");
  expect(at, 'the employee page no longer reads firm_matter_intakes').toBeGreaterThan(-1);
  const sel = src.indexOf('.select(', at);
  expect(sel, 'the employee read has no .select()').toBeGreaterThan(-1);
  const close = src.indexOf(')', sel);
  return src.slice(sel, close);
}

/**
 * THE SECOND GUARDED QUERY.
 *
 * The employee's page now also reads `firm_signing_requests`, for documents
 * the other party sent in and asked the firm to sign. The same reasoning
 * applies to it as to the query above and for the same reason: it goes
 * through the service-role client behind the same hand-written gate, so RLS
 * is not in the path and the column list IS the boundary.
 *
 * `authorization_note` is the one that matters. It is the legal team's
 * working reasoning on whether the firm should put its name on somebody
 * else's document, written for colleagues who may bind the firm. The
 * employee is owed the DECISION, which the page states in words, and is not
 * owed the reasoning. `authorized_by` is the same kind of fact one step
 * further: which named colleague made the call is an internal matter.
 *
 * This is a SEPARATE case rather than a widening of the one above. Widening
 * the first guard to accept a second table is exactly how a guard stops
 * describing anything.
 */
function employeeSigningSelect(): string {
  const src = stripComments(read(PORTAL));
  const at = src.indexOf("from('firm_signing_requests')");
  expect(at, 'the employee page no longer reads firm_signing_requests').toBeGreaterThan(
    -1,
  );
  const sel = src.indexOf('.select(', at);
  expect(sel, 'the employee signing read has no .select()').toBeGreaterThan(-1);
  const close = src.indexOf(')', sel);
  return src.slice(sel, close);
}

/** Columns of firm_signing_requests that belong to the legal team alone. */
const LEGAL_ONLY_SIGNING_COLUMNS = ['authorization_note', 'authorized_by'];

describe('the employee is never handed the legal team reasoning on a signature', () => {
  /**
   * Mutation: add authorization_note to the select. This goes red.
   *
   * It is the mutation the whole case exists for. The page does not draw the
   * note, and that is not the protection: a server component's props cross to
   * the browser in the RSC payload, so a value this page holds is a value the
   * employee was handed.
   */
  it.each(LEGAL_ONLY_SIGNING_COLUMNS)('does not select %s', (col) => {
    expect(employeeSigningSelect()).not.toContain(col);
  });

  /**
   * Mutation: change the select to '*'. This goes red, and it is how the
   * leak would actually arrive, because a `select('*')` on this table is what
   * lib/firm-storage.ts legitimately does.
   */
  it('names its columns instead of taking the whole row', () => {
    const sel = employeeSigningSelect();
    expect(sel).not.toContain('*');
    expect(sel).toContain('authorization_status');
  });

  /**
   * The row the employee reads must be one on THEIR ticket. The link runs
   * intake -> firm_documents -> firm_signing_requests, and without the
   * document filter this query would return every inbound request in the
   * database, because the admin client is not scoped by anything else.
   *
   * Mutation: drop the `.in('document_id', ...)`. This goes red.
   */
  it('is scoped to documents on this ticket', () => {
    const src = stripComments(read(PORTAL));
    const at = src.indexOf("from('firm_signing_requests')");
    const window = src.slice(at, at + 600);
    expect(window).toMatch(/\.in\(\s*'document_id'/);
    expect(src).toMatch(/from\('firm_documents'\)[\s\S]{0,200}?\.eq\('intake_id', intake\.id\)/);
  });

  /**
   * The signer read is the third hop and carries the same risk one table
   * over: firm_signatures.token is the durable signer credential, and
   * lib/signature-write.ts already records that a select('*') on that table
   * pulled it into memory on a request that had no business holding it.
   *
   * Mutation: widen that select to '*', or add `token` to it. This goes red.
   */
  it('never fetches a signer token onto the employee page', () => {
    const src = stripComments(read(PORTAL));
    const at = src.indexOf("from('firm_signatures')");
    expect(at, 'the employee page no longer reads firm_signatures').toBeGreaterThan(-1);
    const sel = src.indexOf('.select(', at);
    const window = src.slice(sel, src.indexOf(')', sel));
    expect(window).not.toContain('*');
    expect(window).not.toContain('token');
    expect(window).not.toContain('access_code');
  });
});

describe('the employee is never handed a legal-only column', () => {
  /**
   * Mutation: change the select to '*'. This goes red. A star select is how
   * this leak would actually arrive, because it is what the COUNSEL page
   * legitimately does one directory over.
   */
  it('names its columns instead of taking the whole row', () => {
    const sel = employeeSelect();
    expect(sel).not.toContain('*');
    expect(sel).toContain('client_name');
  });

  /**
   * Mutation: add any one of these to the select list. That one goes red.
   */
  it.each(LEGAL_ONLY_COLUMNS)('does not select %s', (col) => {
    expect(employeeSelect()).not.toContain(col);
  });

  /**
   * The select list is load-bearing ONLY because the row is fetched with the
   * service-role client past RLS and gated by hand. If either half of that
   * ever changes, the reasoning above stops being true and this guard should
   * be re-read rather than trusted.
   *
   * Mutation: replace the gate with `const mayView = true`. This goes red.
   *
   * It asserts the CALL and the refusal, not the name. Asserting the name is
   * what the first version of this did, and the mutation above sailed
   * straight through it: `canViewIntake` still appeared in the file, on the
   * import line, with nothing calling it.
   */
  it('still reads past RLS behind a hand-written gate', () => {
    const src = stripComments(read(PORTAL));
    expect(src).toContain('createAdminSupabase()');
    expect(src).toMatch(/await canViewIntake\(\s*admin\s*,/);
    expect(src).toMatch(/if \(!mayView\) notFound\(\)/);
  });
});

/**
 * THE HOLE THIS GUARD DOES NOT CLOSE, PINNED SO IT IS NOT MISTAKEN FOR CLOSED.
 *
 * `intake_answers` is one jsonb column and the employee page selects it
 * whole, so every key in it is in the employee's payload whatever the page
 * draws. Today that is survivable: the keys are the request as the employee
 * filed it, plus a decision they are meant to read.
 *
 * It stops being survivable the moment a legal-only field is stored in there,
 * and this codebase reaches for that column precisely because it avoids a
 * migration. The reference service desk keeps Close Notes, Date Completed,
 * Effective and Expiration dates and Notify-when-expires in an "Administrative
 * tools" section the employee never sees; put any of those in intake_answers
 * and it ships to the employee automatically, with no code change anywhere
 * near this test.
 *
 * This case pins the keys the employee page reads, so that adding a
 * legal-only one is at least a deliberate edit to a file that says why not.
 */
describe('the intake_answers blob is a known hole, not a closed one', () => {
  /**
   * Mutation: read a new key off `ans` in the employee page without adding it
   * here. This goes red, and the reviewer is sent to the comment above.
   */
  it('reads only request-shaped and decision keys out of the blob', () => {
    const src = stripComments(read(PORTAL));
    // Literal reads only: `ans.foo` and `ans['foo']`. The one DYNAMIC read,
    // `ans[k]`, is pinned by the case below instead, because its keys come
    // from a tuple list rather than from the access site.
    const keys = new Set(
      [...src.matchAll(/\bans\.([a-z_]+)|\bans\['([a-z_]+)'\]/g)].map(
        (m) => m[1] ?? m[2],
      ),
    );
    const ALLOWED = new Set([
      'subject',
      'request_type',
      'confidentiality',
      'due_by',
      'expiry',
      'priority',
      'decision',
      'review',
      'attachments',
      // The contract family's shared fields, filed by the employee on the
      // creation form (lib/intake-contract-fields.ts). Their own words, so
      // theirs to read back. Nothing the legal team records about the
      // contract is in here: those are columns, listed above.
      'contract',
    ]);
    const unexpected = [...keys].filter((k) => !ALLOWED.has(k));
    expect(unexpected, `unreviewed intake_answers keys: ${unexpected.join(', ')}`)
      .toEqual([]);
  });

  /**
   * The one dynamic read is the meta strip, whose keys are the four literals
   * in the tuple beside it. A second dynamic read would put keys out of this
   * guard's sight entirely.
   *
   * Mutation: add another `ans[...]` read. This goes red.
   */
  it('takes exactly one dynamic read out of the blob', () => {
    const src = stripComments(read(PORTAL));
    expect([...src.matchAll(/\bans\[[a-z]/g)]).toHaveLength(1);
    for (const k of ['request_type', 'confidentiality', 'due_by', 'expiry']) {
      expect(src, `${k} is no longer the reviewed meta strip`).toContain(`'${k}'`);
    }
  });
});
