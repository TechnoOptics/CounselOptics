import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Seventeen tables in the public schema have RLS ENABLED and ZERO policies.
 * For anon and for authenticated that is DENY ALL: only the service-role
 * client can touch them.
 *
 * Reaching one of them through the user-scoped client therefore fails in the
 * quietest way this stack has. A select returns an empty set that no caller
 * can tell apart from "there are no rows". A write matches nothing, and
 * because PostgREST does not raise on a zero-row match, an insert or update
 * whose caller inspects only `error` resolves cleanly and the caller reports
 * success. This codebase has already lost a month of security-audit writes to
 * that shape once.
 *
 * The table list is the audit's record and is deliberately written out rather
 * than derived: it was established against production, and a test that
 * re-derived it from the migrations would drift from the database it is about.
 *
 * WHAT THIS CANNOT TELL YOU: whether a table SHOULD have policies. It only
 * holds the code to the decision that these seventeen are service-role only.
 * If a policy is ever added to one of them, delete it from this list in the
 * same change, or the guard will keep enforcing a rule the schema no longer
 * has.
 */
const POLICYLESS_TABLES = [
  'firm_templates',
  'firm_template_submissions',
  'firm_policies',
  'firm_trainings',
  'firm_training_assignments',
  'firm_meetings',
  'firm_intake_upload_requests',
  'firm_scim_tokens',
  'firm_signature_handoffs',
  'firm_trial_events',
  'user_trial_events',
  'admin_impersonations',
  'rate_limits',
  'signup_history',
  'system_health',
  'ui_translations',
  'watch_link_codes',
] as const;

const root = fileURLToPath(new URL('../', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const USER_BINDING =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?create(?:Server|Browser)Supabase\s*\(/g;
const ADMIN_BINDING =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?createAdminSupabase\s*\(/g;

type Hit = { table: string; receiver: string | null; userScoped: boolean };

function bindings(src: string, re: RegExp): Array<{ ident: string; at: number }> {
  const out: Array<{ ident: string; at: number }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ ident: m[1], at: m.index });
  return out;
}

/**
 * Every read or write of a policyless table in one source file, and which
 * client each one runs on.
 *
 * The receiver is resolved by NEAREST PRECEDING BINDING rather than by a
 * file-wide set, because lib/bella.ts binds the name `supabase` to the
 * user-scoped client in two functions and to the service-role client in
 * twenty more. A file-wide set would call every one of those a violation and
 * the guard would be turned off within a week.
 *
 * This is a heuristic, not a scope analysis: it reads top to bottom and
 * assumes a binding above a call site is the one in effect. That holds for
 * every file in this repo today. It cannot see through a client passed in as
 * a parameter (`admin: SupabaseClient`), which is how most of lib/ reaches
 * these tables; those call sites are counted but never flagged, and the
 * floor assertion below is what stops that turning into an empty pass.
 */
function hits(src: string): Hit[] {
  const stripped = stripComments(src);
  const user = bindings(stripped, USER_BINDING);
  const admin = bindings(stripped, ADMIN_BINDING);
  const out: Hit[] = [];
  for (const table of POLICYLESS_TABLES) {
    const needle = `.from('${table}')`;
    for (let i = stripped.indexOf(needle); i !== -1; i = stripped.indexOf(needle, i + 1)) {
      const before = stripped.slice(0, i).replace(/\s+$/, '');
      // A receiver that does not end in a plain identifier is UNRESOLVED, not
      // safe. `(await createServerSupabase()).from('firm_meetings')` ends in
      // `)`, so this regex returned null, `nearest()` matched nothing, and the
      // hit was recorded as service-role-scoped. The two are separated now and
      // the unresolved ones are asserted separately below, because folding
      // "I could not tell" into "it is fine" is how a scan reports a clean
      // result on a call it never understood.
      const receiver =
        /([A-Za-z_$][\w$]*)(?:\s*\.\s*[\w$]+)*$/.exec(before)?.[1] ?? null;
      const nearest = (list: Array<{ ident: string; at: number }>) =>
        list
          .filter((b) => b.ident === receiver && b.at < i)
          .reduce<number>((best, b) => Math.max(best, b.at), -1);
      const u = nearest(user);
      const a = nearest(admin);
      out.push({ table, receiver, userScoped: u !== -1 && u > a });
    }
  }
  return out;
}

describe('the detector actually detects', () => {
  // Without these the whole file could pass by finding nothing, which is the
  // failure mode of every source scan.

  it('flags a user-scoped read of a policyless table', () => {
    const src = [
      'const supabase = createServerSupabase();',
      "await supabase.from('firm_meetings').select('start_at');",
    ].join('\n');
    expect(hits(src)).toEqual([
      { table: 'firm_meetings', receiver: 'supabase', userScoped: true },
    ]);
  });

  it('clears the same read once it is on the service-role client', () => {
    const src = [
      'const admin = createAdminSupabase();',
      "await admin.from('firm_meetings').select('start_at');",
    ].join('\n');
    expect(hits(src)).toEqual([
      { table: 'firm_meetings', receiver: 'admin', userScoped: false },
    ]);
  });

  it('takes the nearest binding, so one file may hold both clients', () => {
    const src = [
      'function a() {',
      '  const supabase = createServerSupabase();',
      "  return supabase.from('cases').select('id');",
      '}',
      'function b() {',
      '  const supabase = createAdminSupabase();',
      "  return supabase.from('firm_meetings').select('start_at');",
      '}',
    ].join('\n');
    expect(hits(src)).toEqual([
      { table: 'firm_meetings', receiver: 'supabase', userScoped: false },
    ]);
  });

  it('is not satisfied by a comment that merely names the call', () => {
    const src = [
      'const supabase = createServerSupabase();',
      "// await supabase.from('firm_meetings').select('start_at');",
      'const admin = createAdminSupabase();',
    ].join('\n');
    expect(hits(src)).toEqual([]);
  });

  it('reads a chained receiver down to its root', () => {
    const src = [
      'const supabase = createServerSupabase();',
      "await gate.admin.from('firm_policies').select('id');",
    ].join('\n');
    expect(hits(src)).toEqual([
      { table: 'firm_policies', receiver: 'gate', userScoped: false },
    ]);
  });
});

describe('no policyless table is reached through the user-scoped client', () => {
  const all = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]
    .flatMap((file) => hits(readFileSync(join(root, file), 'utf8')).map((h) => ({ file, ...h })));

  it('finds the call sites at all, so an empty pass is impossible', () => {
    // 105 at the time of writing, across all seventeen tables. The floor is
    // what stops a broken scanner from reporting a clean repo.
    expect(all.length).toBeGreaterThanOrEqual(90);
    const tables = new Set(all.map((h) => h.table));
    expect(tables.has('firm_meetings')).toBe(true);
    expect(tables.has('firm_template_submissions')).toBe(true);
  });

  it('routes every one of them through the service-role client', () => {
    const offenders = all
      .filter((h) => h.userScoped)
      .map((h) => `${h.file}: ${h.table} via user-scoped '${h.receiver}'`);
    expect(offenders).toEqual([]);
  });

  /**
   * The third state, kept out of the second on purpose.
   *
   * `(await createServerSupabase()).from('firm_meetings')` has no identifier
   * receiver, so the resolver returns null. Folded into "not user-scoped",
   * that reads as a pass: a DENY-ALL read written that way was reported clean.
   * A null receiver means the scan did not understand the call, and the honest
   * report of that is a separate, empty list.
   *
   * The parameter case (`admin: SupabaseClient`) is different and is disclosed
   * in the header: the receiver IS an identifier, it is simply bound outside
   * the file. Those are counted, not flagged, and the floor above is what
   * stops that becoming an empty pass.
   */
  it('understood the receiver of every call it looked at', () => {
    const unresolved = all
      .filter((h) => h.receiver == null)
      .map((h) => `${h.file}: ${h.table} on an expression this scan cannot read`);
    expect(unresolved).toEqual([]);
  });
});
