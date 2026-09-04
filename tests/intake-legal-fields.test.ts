import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';

/**
 * The legal team's own fields on a request, and the one rule over them: no
 * legal-only value may reach the employee who filed the request.
 *
 * The employee's page reads through the service-role client behind a
 * hand-written gate and selects intake_answers whole, so the rule has two
 * halves. A legal-only field is a real column (never a key in that jsonb),
 * and the column is named in the employee page's SELECT guard. This file
 * holds both halves together, plus the write path that must refuse rather
 * than fall back into the jsonb when the column is not there yet.
 *
 * Every source anchor strips comments first and asserts a CALL rather than a
 * name: a comment explaining a fix contains the string a guard searches for,
 * and this repo has found guards passing while the thing they guarded was
 * gone.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const codeOf = (rel: string) => stripComments(read(rel));

/** SQL comments, so a migration's prose cannot satisfy a check either. */
const stripSql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const COUNSEL_PAGE = 'app/counsel/intake/[id]/page.tsx';
const PORTAL_PAGE = 'app/portal/[id]/page.tsx';
const ACTIONS = 'lib/firm-actions.ts';
const GUARD = 'tests/employee-payload-scope.test.ts';
const MIGRATIONS = [
  'supabase/migrations/20260903_intake_legal_fields_internal.sql',
  'supabase/migrations/20260903_intake_legal_fields_contract.sql',
];
const DEADLINES = 'lib/deadlines.ts';

/* ------------------------------------------------------------------ */
/* Mocks for the action under test. Same shape as intake-decision.      */
/* ------------------------------------------------------------------ */

type Scenario = {
  authorized: boolean;
  /** Whether the related case belongs to this firm. */
  caseOwned: boolean;
  /** Rows the fake reports the UPDATE as having affected. */
  written: Array<{ id: string }>;
  /** The error the UPDATE comes back with, if any. */
  writeError: { code?: string; message?: string } | null;
  /** The update payload the fake last received. */
  payload: Record<string, unknown> | null;
  calls: string[];
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: {
      authorized: true,
      caseOwned: true,
      written: [{ id: 'intake-1' }],
      writeError: null,
      payload: null,
      calls: [],
    },
  };

  function makeAdmin() {
    return {
      from: (table: string) => {
        let updating: Record<string, unknown> | null = null;
        const node: Record<string, unknown> = {};
        node.eq = () => node;
        node.select = () => {
          if (updating) {
            s.current.calls.push(`write:${table}`);
            return Promise.resolve({
              data: s.current.writeError ? null : s.current.written,
              error: s.current.writeError,
            });
          }
          s.current.calls.push(`read:${table}`);
          return node;
        };
        node.maybeSingle = async () =>
          table === 'cases'
            ? { data: s.current.caseOwned ? { id: 'case-1' } : null, error: null }
            : { data: { firm_id: 'firm-1' }, error: null };
        node.update = (payload: Record<string, unknown>) => {
          updating = payload;
          s.current.payload = payload;
          return node;
        };
        return node;
      },
    };
  }

  return { s, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'lawyer-1', email: 'a@example.com' }),
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'lawyer-1' }),
}));

vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerHasFirmRole: async () => h.s.current.authorized,
  callerIsFirmMember: async () => h.s.current.authorized,
  requireActiveFirm: async () => {},
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache: (fn: unknown) => fn,
}));

const { setIntakeLegalFieldsAction } = await import('../lib/firm-actions');
const {
  LEGAL_ONLY_INTAKE_COLUMNS,
  ADMINISTRATIVE_TOOLS_FAMILIES,
  LEGAL_FIELD_UNSAVED_ERROR,
  EXPIRY_NOTICE_LEAD_DAYS,
  expiryNoticeDue,
  normalizeLegalFieldsWrite,
  readIntakeLegalFields,
  resolveLegalFieldColumnFallback,
  showsAdministrativeTools,
} = await import('../lib/intake-legal-fields');
const { PORTAL_REQUEST_FAMILIES } = await import('../lib/portal-request-families');

beforeEach(() => {
  h.s.current = {
    authorized: true,
    caseOwned: true,
    written: [{ id: 'intake-1' }],
    writeError: null,
    payload: null,
    calls: [],
  };
});

const CASE_ID = '8f0e2c1a-4b7d-4e2f-9a3c-1d2e3f4a5b6c';

/* ------------------------------------------------------------------ */
/* 1. Every legal-only column is named in the employee SELECT guard.    */
/* ------------------------------------------------------------------ */

describe('every legal-only column is one the employee page is forbidden to select', () => {
  /** The LEGAL_ONLY_COLUMNS array literal in the guard, parsed out of its source. */
  function guardedColumns(): string[] {
    const src = codeOf(GUARD);
    const at = src.indexOf('const LEGAL_ONLY_COLUMNS = [');
    expect(at, 'the employee guard no longer declares LEGAL_ONLY_COLUMNS').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('];', at));
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }

  /**
   * Mutation: add a column to LEGAL_ONLY_INTAKE_COLUMNS without adding it to
   * the guard. This goes red, and it is the mutation the whole boundary
   * depends on: a column the module can write that the guard does not know
   * about is one a later edit to the employee SELECT would ship.
   */
  it.each(LEGAL_ONLY_INTAKE_COLUMNS)('%s is in LEGAL_ONLY_COLUMNS', (col) => {
    expect(guardedColumns()).toContain(col);
  });

  /**
   * Mutation: reference a legal-only column on the employee page, whether or
   * not it is selected. A page that names the column is one edit away from
   * selecting it, and the column list is the only boundary there is.
   */
  it.each(LEGAL_ONLY_INTAKE_COLUMNS)('the employee page never names %s', (col) => {
    expect(codeOf(PORTAL_PAGE)).not.toMatch(new RegExp(`\\b${col}\\b`));
  });

  /** Mutation: import the block or its module on the employee page. */
  it('the employee page does not render the block or read its module', () => {
    const src = codeOf(PORTAL_PAGE);
    expect(src).not.toContain('<AdministrativeTools');
    expect(src).not.toContain('intake-legal-fields');
    expect(src).not.toContain('readIntakeLegalFields(');
  });
});

/* ------------------------------------------------------------------ */
/* 2. Nothing writes a legal-only value into intake_answers.            */
/* ------------------------------------------------------------------ */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe('no legal-only value is ever stored in intake_answers', () => {
  /**
   * Mutation: in setIntakeLegalFieldsAction, write
   * `update.intake_answers = { ...answers, completed_on }`. This goes red.
   *
   * Swept over lib/ and app/, not just the action, because the jsonb is
   * written from a dozen places and any of them could pick up a legal-only
   * key. The pattern is a legal-only column name within a short distance of
   * `answers` on the same line, in either order.
   */
  it('no file in lib/ or app/ puts a legal-only column near an answers write', () => {
    const cols = LEGAL_ONLY_INTAKE_COLUMNS.join('|');
    const near = new RegExp(
      `answers[^\\n]{0,60}\\b(${cols})\\b|\\b(${cols})\\b[^\\n]{0,60}answers`,
    );
    const offenders = [...sourceFiles('lib'), ...sourceFiles('app')].filter((f) =>
      near.test(codeOf(f)),
    );
    expect(offenders).toEqual([]);
  });

  /** The write itself never touches the column at all. */
  it('the action body does not mention intake_answers', () => {
    const src = codeOf(ACTIONS);
    const at = src.indexOf('export async function setIntakeLegalFieldsAction');
    expect(at, 'setIntakeLegalFieldsAction is missing').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\nexport ', at + 1));
    expect(body).not.toContain('intake_answers');
  });

  /** And at runtime the payload it sends carries columns only. */
  it('sends the columns and nothing else', async () => {
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      relatedCaseId: CASE_ID,
      completedOn: '2026-09-03',
      multipleDocuments: true,
    });
    expect(res).toEqual({ ok: true });
    expect(h.s.current.payload).not.toBeNull();
    const keys = Object.keys(h.s.current.payload ?? {}).sort();
    expect(keys).toEqual(
      ['completed_on', 'multiple_documents', 'related_case_id', 'updated_at'].sort(),
    );
    expect(h.s.current.payload).toMatchObject({
      related_case_id: CASE_ID,
      completed_on: '2026-09-03',
      multiple_documents: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. The write is gated in the action, and refuses without the column. */
/* ------------------------------------------------------------------ */

describe('the write is gated on the server', () => {
  /** Mutation: drop the role gate. */
  it('refuses a caller without a managing role, and writes nothing', async () => {
    h.s.current.authorized = false;
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      completedOn: '2026-09-03',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owners, admins or attorneys/i);
    expect(h.s.current.payload).toBeNull();
    expect(h.s.current.calls).toEqual([]);
  });

  /** Mutation: skip the ownership read on the case. */
  it('refuses a related matter that is not the firm\'s own', async () => {
    h.s.current.caseOwned = false;
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      relatedCaseId: CASE_ID,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not one of this firm/i);
    expect(h.s.current.payload).toBeNull();
    expect(h.s.current.calls).toContain('read:cases');
  });

  /** Clearing the link needs no ownership read: there is nothing to own. */
  it('clears the related matter without asking whose it was', async () => {
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      relatedCaseId: '',
    });
    expect(res).toEqual({ ok: true });
    expect(h.s.current.calls).not.toContain('read:cases');
    expect(h.s.current.payload).toMatchObject({ related_case_id: null });
  });

  /** Mutation: let a bad date through to Postgres. */
  it('refuses a malformed date before reading anything', async () => {
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      completedOn: 'end of the month',
    });
    expect(res).toEqual({ ok: false, error: 'Pick a valid date.' });
    expect(h.s.current.calls).toEqual([]);
  });

  /**
   * The column arrives with a migration the owner applies. Until then the
   * write must refuse in a plain sentence, never retry without the field.
   *
   * Mutation: retry without the column, or surface the raw Postgres message.
   */
  it('refuses with one plain sentence when the column is not there yet', async () => {
    h.s.current.writeError = {
      code: 'PGRST204',
      message: "Could not find the 'completed_on' column of 'firm_matter_intakes'",
    };
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      completedOn: '2026-09-03',
    });
    expect(res).toEqual({ ok: false, error: LEGAL_FIELD_UNSAVED_ERROR });
    // One write attempted, none retried.
    expect(h.s.current.calls.filter((c) => c.startsWith('write:'))).toHaveLength(1);
  });

  it('surfaces any other write error as itself', async () => {
    h.s.current.writeError = { code: '23503', message: 'violates foreign key' };
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      completedOn: '2026-09-03',
    });
    expect(res).toEqual({ ok: false, error: 'violates foreign key' });
  });

  /** Mutation: drop the .select('id') and a matched-nothing write reads as saved. */
  it('reports a write that matched no row as not saved', async () => {
    h.s.current.written = [];
    const res = await setIntakeLegalFieldsAction('firm-1', 'intake-1', {
      multipleDocuments: false,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be saved/i);
  });

  /**
   * Read off the source as well, because the fake above cannot tell a gate
   * that is called from one that is imported and left on the shelf.
   *
   * Mutation: replace the role check with `true`, or drop requireActiveFirm.
   */
  it('calls the role gate, the access gate, and confirms the row it wrote', () => {
    const src = codeOf(ACTIONS);
    const at = src.indexOf('export async function setIntakeLegalFieldsAction');
    const body = src.slice(at, src.indexOf('\nexport ', at + 1));
    expect(body).toMatch(/await callerHasFirmRole\(firmId, FIRM_MANAGE_ROLES\)/);
    expect(body).toContain('await requireActiveFirm(firmId)');
    expect(body).toMatch(/\.eq\('firm_id', firmId\)/);
    expect(body).toMatch(/\.select\('id'\)/);
    expect(body).toContain('normalizeLegalFieldsWrite(');
    expect(body).toContain('resolveLegalFieldColumnFallback(');
  });
});

/* ------------------------------------------------------------------ */
/* 4. The pure rules.                                                   */
/* ------------------------------------------------------------------ */

describe('normalizeLegalFieldsWrite', () => {
  it('refuses an empty write rather than sending updated_at alone', () => {
    expect(normalizeLegalFieldsWrite({})).toEqual({ ok: false, error: 'Nothing to save.' });
  });

  it('treats an empty string as clearing a date or a link', () => {
    expect(normalizeLegalFieldsWrite({ completedOn: '' })).toEqual({
      ok: true,
      update: { completed_on: null },
    });
    expect(normalizeLegalFieldsWrite({ relatedCaseId: null })).toEqual({
      ok: true,
      update: { related_case_id: null },
    });
  });

  it('refuses a case id that is not a uuid', () => {
    expect(normalizeLegalFieldsWrite({ relatedCaseId: 'case-1' })).toEqual({
      ok: false,
      error: 'Pick a matter from the list.',
    });
  });

  it('coerces the flag to a real boolean', () => {
    expect(
      normalizeLegalFieldsWrite({ multipleDocuments: 'yes' as unknown as boolean }),
    ).toEqual({ ok: true, update: { multiple_documents: false } });
  });

  /**
   * Mutation: leave expiry_notified_at alone when the date moves. The sweep
   * fires once per stamp, so a moved date would be a date nobody is told
   * about.
   */
  it('re-arms the expiry notice when the expiration date changes', () => {
    expect(normalizeLegalFieldsWrite({ expiresOn: '2027-01-31' })).toEqual({
      ok: true,
      update: { expires_on: '2027-01-31', expiry_notified_at: null },
    });
    expect(normalizeLegalFieldsWrite({ expiresOn: '' })).toEqual({
      ok: true,
      update: { expires_on: null, expiry_notified_at: null },
    });
    // The other dates do not touch the stamp.
    expect(normalizeLegalFieldsWrite({ effectiveOn: '2027-01-01' })).toEqual({
      ok: true,
      update: { effective_on: '2027-01-01' },
    });
  });

  /** The stamp is the sweep's to write. No client input reaches it directly. */
  it('never takes expiry_notified_at from the client', () => {
    const res = normalizeLegalFieldsWrite({
      notifyOnExpiry: true,
      ...({ expiryNotifiedAt: '2026-01-01T00:00:00Z' } as object),
    });
    expect(res).toEqual({ ok: true, update: { notify_on_expiry: true } });
  });

  /** Mutation: write a key the column list does not name. */
  it('only ever writes columns in LEGAL_ONLY_INTAKE_COLUMNS', () => {
    const res = normalizeLegalFieldsWrite({
      relatedCaseId: CASE_ID,
      completedOn: '2026-01-02',
      multipleDocuments: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const key of Object.keys(res.update)) {
      expect(LEGAL_ONLY_INTAKE_COLUMNS as readonly string[]).toContain(key);
    }
  });
});

describe('resolveLegalFieldColumnFallback', () => {
  /** Mutation: return 'retry-without-column'. There is no such branch. */
  it('aborts on an unknown legal-only column and never proposes a retry', () => {
    for (const col of LEGAL_ONLY_INTAKE_COLUMNS) {
      expect(
        resolveLegalFieldColumnFallback({
          error: { code: 'PGRST204', message: `Could not find the '${col}' column` },
        }),
      ).toBe('abort-column-missing');
      expect(
        resolveLegalFieldColumnFallback({
          error: { code: '42703', message: `column "${col}" does not exist` },
        }),
      ).toBe('abort-column-missing');
    }
  });

  it('surfaces anything else, including an unknown column that is not ours', () => {
    expect(resolveLegalFieldColumnFallback({ error: null })).toBe('surface-error');
    expect(
      resolveLegalFieldColumnFallback({
        error: { code: 'PGRST204', message: "Could not find the 'delivery_mode' column" },
      }),
    ).toBe('surface-error');
    expect(
      resolveLegalFieldColumnFallback({
        error: { code: '23505', message: 'duplicate key completed_on' },
      }),
    ).toBe('surface-error');
  });

  it('says in plain words that the update is pending', () => {
    expect(LEGAL_FIELD_UNSAVED_ERROR).toMatch(/not saved/);
    expect(LEGAL_FIELD_UNSAVED_ERROR).toMatch(/pending update/);
    expect(LEGAL_FIELD_UNSAVED_ERROR).not.toMatch(/PGRST|column/);
  });
});

describe('a row without the columns yet reads as unset', () => {
  /** Mutation: throw on a missing key, or read `undefined` as a string. */
  it('reads absent columns as null and false', () => {
    const unset = {
      relatedCaseId: null,
      completedOn: null,
      multipleDocuments: false,
      effectiveOn: null,
      expiresOn: null,
      notifyOnExpiry: false,
    };
    expect(readIntakeLegalFields({ id: 'x', status: 'in_progress' })).toEqual(unset);
    expect(readIntakeLegalFields(null)).toEqual(unset);
  });

  it('reads present columns as themselves', () => {
    expect(
      readIntakeLegalFields({
        related_case_id: CASE_ID,
        completed_on: '2026-09-01',
        multiple_documents: true,
        effective_on: '2026-01-01',
        expires_on: '2026-12-31',
        notify_on_expiry: true,
      }),
    ).toEqual({
      relatedCaseId: CASE_ID,
      completedOn: '2026-09-01',
      multipleDocuments: true,
      effectiveOn: '2026-01-01',
      expiresOn: '2026-12-31',
      notifyOnExpiry: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. Which families show the block, and where it renders.              */
/* ------------------------------------------------------------------ */

describe('the block belongs to the families that have been given it', () => {
  it('names only real families', () => {
    const keys = PORTAL_REQUEST_FAMILIES.map((f) => f.key);
    for (const k of ADMINISTRATIVE_TOOLS_FAMILIES) expect(keys).toContain(k);
  });

  /** Mutation: show the block on every ticket, family or not. */
  it('shows on every type of a named family and on nothing else', () => {
    for (const family of PORTAL_REQUEST_FAMILIES) {
      const expected = ADMINISTRATIVE_TOOLS_FAMILIES.includes(family.key);
      for (const type of family.types) {
        expect(showsAdministrativeTools(type), `${type} (${family.key})`).toBe(expected);
      }
    }
    expect(showsAdministrativeTools('New case / matter')).toBe(false);
    expect(showsAdministrativeTools(null)).toBe(false);
    expect(showsAdministrativeTools('')).toBe(false);
  });

  it('has been given to the internal, contract and drop box families', () => {
    expect(ADMINISTRATIVE_TOOLS_FAMILIES).toContain('internal');
    expect(ADMINISTRATIVE_TOOLS_FAMILIES).toContain('contract');
    expect(ADMINISTRATIVE_TOOLS_FAMILIES).toContain('dropbox');
  });

  /**
   * The drop box is where the owner's rule was spoken: the legal team's
   * status and tools on the legal side, none of it to the employee. Its
   * Status is the workflow state the management block already carries, so
   * the employee's SELECT guard has to name that column too, and the
   * employee page must not read it by any other route.
   *
   * Mutation: remove 'workflow_state' from LEGAL_ONLY_COLUMNS, or read the
   * column on the employee page.
   */
  it('keeps the drop box status on the legal side', () => {
    const guard = codeOf(GUARD);
    const at = guard.indexOf('const LEGAL_ONLY_COLUMNS = [');
    expect(guard.slice(at, guard.indexOf('];', at))).toContain("'workflow_state'");
    const portal = codeOf(PORTAL_PAGE);
    expect(portal).not.toMatch(/\bworkflow_state\b/);
    expect(portal).not.toContain('workflowStateOf(');
    expect(portal).not.toContain('WORKFLOW_LABEL');
    // What the employee reads instead: the four-word label off the
    // lifecycle status, which every workflow write keeps in the right lane.
    expect(portal).toContain('portalStatusLabel(intake.status)');
  });
});

describe('the block renders in the legal team rail and nowhere else', () => {
  /**
   * Mutation: move <AdministrativeTools> above <aside>, or render it twice,
   * or render it without asking showsAdministrativeTools.
   */
  it('is drawn once, in the rail, behind the family gate', () => {
    const src = codeOf(COUNSEL_PAGE);
    const aside = src.indexOf('<aside');
    expect(aside).toBeGreaterThan(-1);
    const draws = [...src.matchAll(/<AdministrativeTools/g)];
    expect(draws).toHaveLength(1);
    expect(draws[0].index).toBeGreaterThan(aside);
    expect(src).toMatch(/showsAdministrativeTools\(\s*intake\.matter_type\s*\)/);
    expect(src).toMatch(/showAdmin && \(\s*<AdministrativeTools/);
    expect(src).toContain('readIntakeLegalFields(intake)');
  });

  /** Close notes is the decision reason, not a second field. */
  it('feeds Close notes from the decision the dialog already wrote', () => {
    const src = codeOf(COUNSEL_PAGE);
    expect(src).toMatch(/closeNotes=\{decision\?\.reason/);
  });

  /** Mutation: fetch the firm's matters on every ticket. */
  it('lists the firm matters only when the block shows', () => {
    const src = codeOf(COUNSEL_PAGE);
    expect(src).toMatch(/showAdmin\s*\?\s*\(await listFirmCases\(ctx\.firm\.id\)\)/);
  });
});

/* ------------------------------------------------------------------ */
/* 6. The migration says what the code believes.                        */
/* ------------------------------------------------------------------ */

describe('the migration is written and not assumed', () => {
  /** Mutation: add a column to the module without a migration naming it. */
  it.each(LEGAL_ONLY_INTAKE_COLUMNS)('some migration adds %s', (col) => {
    const sql = MIGRATIONS.map((m) => stripSql(read(m))).join('\n');
    expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\b`));
  });

  it('links the related matter to the cases table and lets it go when the matter does', () => {
    const sql = stripSql(read(MIGRATIONS[0]));
    expect(sql).toMatch(/related_case_id uuid references public\.cases\(id\) on delete set null/);
  });

  /**
   * Nothing in this family's migration touches the seven-value status CHECK
   * or the jsonb. lib/intake-workflow.ts explains why the CHECK is left alone.
   */
  it.each(MIGRATIONS)('%s leaves status and intake_answers alone', (m) => {
    const sql = stripSql(read(m)).toLowerCase();
    expect(sql).not.toContain('intake_answers');
    expect(sql).not.toMatch(/status/);
    expect(sql).not.toContain('reminder');
  });
});

/* ------------------------------------------------------------------ */
/* 7. The expiry notice: a flag that actually notifies somebody.        */
/* ------------------------------------------------------------------ */

describe('the expiry notice is due once, ahead of the date, and only when asked', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const expires = '2026-12-31';
  const at = Date.parse(expires);

  it('is not due without the flag, or after a stamp', () => {
    expect(
      expiryNoticeDue({ expiresOn: expires, notifyOnExpiry: false, notifiedAt: null, now: at }),
    ).toBe(false);
    expect(
      expiryNoticeDue({
        expiresOn: expires,
        notifyOnExpiry: true,
        notifiedAt: '2026-11-01T00:00:00Z',
        now: at,
      }),
    ).toBe(false);
    expect(
      expiryNoticeDue({ expiresOn: null, notifyOnExpiry: true, notifiedAt: null, now: at }),
    ).toBe(false);
    expect(
      expiryNoticeDue({ expiresOn: 'soon', notifyOnExpiry: true, notifiedAt: null, now: at }),
    ).toBe(false);
  });

  /** Mutation: compare against the date itself rather than LEAD days before it. */
  it('becomes due LEAD days before the date and stays due after it', () => {
    const lead = EXPIRY_NOTICE_LEAD_DAYS * DAY;
    const base = { expiresOn: expires, notifyOnExpiry: true, notifiedAt: null };
    expect(expiryNoticeDue({ ...base, now: at - lead - DAY })).toBe(false);
    expect(expiryNoticeDue({ ...base, now: at - lead })).toBe(true);
    expect(expiryNoticeDue({ ...base, now: at })).toBe(true);
    expect(expiryNoticeDue({ ...base, now: at + 40 * DAY })).toBe(true);
  });

  it('gives the legal team a month, which is what the block says', () => {
    expect(EXPIRY_NOTICE_LEAD_DAYS).toBe(30);
    const block = codeOf('app/counsel/intake/[id]/administrative-tools.tsx');
    expect(block).toContain('EXPIRY_NOTICE_LEAD_DAYS');
    expect(block, 'the lead is spelled as a literal in the block').not.toMatch(/\b30 days\b/);
  });

  /**
   * The sweep reads the columns, stamps before it sends, asks the pure rule
   * whether it is due, and tells the legal team only.
   *
   * Mutation: send before stamping, or link the requester's portal, or
   * re-implement the due rule inline.
   */
  it('is honoured by the deadlines sweep, legal team only, stamp first', () => {
    const src = codeOf(DEADLINES);
    const at = src.indexOf("'notify_on_expiry', true");
    expect(at, 'the sweep never filters on the flag').toBeGreaterThan(-1);
    const block = src.slice(at);
    expect(block).toMatch(/\.is\('expiry_notified_at', null\)/);
    expect(block).toContain('expiryNoticeDue(');
    const stamp = block.indexOf("update({ expiry_notified_at:");
    const send = block.indexOf('createNotification({');
    expect(stamp, 'the sweep never stamps').toBeGreaterThan(-1);
    expect(send, 'the sweep never sends').toBeGreaterThan(-1);
    expect(stamp, 'the notice goes out before the stamp is written').toBeLessThan(send);
    // The stamp is a claim, not a blind write: it only lands on a row nobody
    // else has stamped, and a lost claim sends nothing.
    expect(block.slice(stamp, send)).toMatch(/\.is\('expiry_notified_at', null\)[\s\S]*?\.select\('id'\)/);
    expect(block, 'the requester is told about a legal-only flag').not.toContain('/portal/');
    expect(block).toContain('/counsel/intake/');
  });

  /** A missing column is a quiet skip, not a broken cron. */
  it('skips quietly while the columns are absent', () => {
    const src = codeOf(DEADLINES);
    const at = src.indexOf("'notify_on_expiry', true");
    const before = src.slice(Math.max(0, at - 400), at + 600);
    expect(before).toMatch(/error:\s*expiryErr/);
    expect(before).toMatch(/expiryErr\s*\?\s*\[\]/);
  });
});
