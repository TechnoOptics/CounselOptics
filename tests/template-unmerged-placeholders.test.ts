import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSignedOn,
  mergeTemplateDocument,
  placeholderPattern,
  unmergedPlaceholders,
} from '../lib/firm-template-placeholders';
import { SEED_TEMPLATES } from '../lib/seed-templates';

/**
 * A placeholder nothing will fill in, and the two places it is stopped.
 *
 * THE DEFECT. mergeTemplateDocument substitutes once per KNOWN field key with
 * `text.split('{{key}}').join(value)`. That is exact, case sensitive and
 * whitespace intolerant, and it never looks at the body for anything else. A
 * brace pair it does not recognise is therefore not substituted, not reported
 * and not removed: it survives the merge verbatim and prints on the finished
 * instrument, on the firm's letterhead, in front of the other side.
 *
 * WHY THE EDITOR DOES NOT ALREADY PREVENT IT. The field list is derived from
 * the body, so it looks as though every brace pair must have a field. It does
 * not: extractKeys matches `{{\s*([a-zA-Z0-9_]+)\s*}}` and then LOWERCASES the
 * key, so `{{ client_name }}` and `{{Client_Name}}` each produce a real field
 * row that an author fills in and that the merge cannot find, and
 * `{{client-name}}` produces no field at all because a hyphen is outside the
 * extractor's alphabet. Those three are reachable by typing into the editor.
 *
 * WHAT IS BUILT. A detector, and a save that refuses until the author has
 * answered it. Nothing strips anything: a document with a hole where a
 * sentence used to be is worse than one with a visible token, and the author
 * is the only person who knows which the token was meant to be.
 */

describe('what counts as a placeholder', () => {
  const declared = [{ key: 'client_name' }, { key: 'date' }];

  it('leaves a body whose every token is declared completely alone', () => {
    expect(
      unmergedPlaceholders({
        body: 'This agreement is made on {{date}} with {{client_name}}.',
        fields: declared,
      }),
    ).toEqual([]);
  });

  it('reports a token no field declares', () => {
    expect(
      unmergedPlaceholders({
        body: 'Made with {{clinet_name}} on {{date}}.',
        fields: declared,
      }),
    ).toEqual(['{{clinet_name}}']);
  });

  it('reports a declared key written with spaces inside the braces', () => {
    // The field exists and the author filled it in. The merge still misses it,
    // because it splits on the literal `{{client_name}}`.
    expect(
      unmergedPlaceholders({ body: 'For {{ client_name }}.', fields: declared }),
    ).toEqual(['{{ client_name }}']);
  });

  it('reports a declared key written with capitals', () => {
    expect(
      unmergedPlaceholders({ body: 'For {{Client_Name}}.', fields: declared }),
    ).toEqual(['{{Client_Name}}']);
  });

  it('reports a key the editor cannot even derive a field from', () => {
    expect(
      unmergedPlaceholders({ body: 'For {{client-name}}.', fields: declared }),
    ).toEqual(['{{client-name}}']);
  });

  it('reports a key longer than the forty characters the store keeps', () => {
    const long = 'a'.repeat(44);
    expect(
      unmergedPlaceholders({ body: `x {{${long}}} y`, fields: [{ key: 'a'.repeat(40) }] }),
    ).toEqual([`{{${long}}}`]);
  });

  it('says nothing about the reserved firm keys, which fill from the firm record', () => {
    expect(
      unmergedPlaceholders({
        body: '{{firm_name}} and {{company_name}} agree.',
        fields: [],
      }),
    ).toEqual([]);
  });

  it('reports each distinct token once, in the order it first appears', () => {
    expect(
      unmergedPlaceholders({
        body: '{{beta}} then {{alpha}} then {{beta}} again',
        fields: [],
      }),
    ).toEqual(['{{beta}}', '{{alpha}}']);
  });
});

describe('text that merely contains braces is not flagged', () => {
  // A validator that fires on ordinary drafting is a validator somebody turns
  // off. Each of these is text a real document can carry.
  const cases: [string, string][] = [
    ['a single brace pair', 'Deliver to {the address above} within 5 days.'],
    ['an unclosed double brace', 'The set {{ is opened and never closed.'],
    ['a pair that closes on a later line', 'Schedule {{A\nand the rest of it}} follows.'],
    ['nested set notation', 'The partition {{1,2},{3,4}} is fixed.'],
    ['an empty pair', 'Print {{}} and nothing else.'],
    ['a whole sentence between braces', `Note {{${'word '.repeat(20)}}} ends here.`],
    ['no braces at all', 'Plain drafting with no placeholder anywhere.'],
  ];

  for (const [label, body] of cases) {
    it(label, () => {
      expect(unmergedPlaceholders({ body, fields: [] })).toEqual([]);
    });
  }
});

describe('the detector agrees with the merge it is a statement about', () => {
  /**
   * The load-bearing claim: what this reports is exactly what survives the
   * substitution. Asserted against mergeTemplateDocument itself rather than
   * against a second copy of its rules, because a detector that had its own
   * idea of the syntax would drift the first time the merge was edited.
   */
  const merge = (body: string, fields: { key: string; label: string }[]) =>
    mergeTemplateDocument({
      body,
      fields,
      values: { client_name: 'Northwind Materials LLC', date: 'August 9, 2026' },
      firmName: 'Anderson Foundation',
      signatureName: 'Dana Reyes',
      signerEmail: 'dana@firm.test',
      signedOn: formatSignedOn(new Date('2026-08-09T12:00:00Z')),
      deliveryMode: 'share',
    });

  const fields = [
    { key: 'client_name', label: 'Client name' },
    { key: 'date', label: 'Date' },
  ];

  const bodies = [
    'Made on {{date}} with {{client_name}}.',
    'Made on {{date}} with {{ client_name }}.',
    'Made on {{date}} with {{Client_Name}}.',
    'Made on {{date}} with {{clinet_name}}.',
    'Made on {{date}} with {{client-name}}.',
    '{{firm_name}} agrees with {{client_name}} on {{date}}.',
    'The partition {{1,2},{3,4}} is fixed and {{date}} applies.',
  ];

  for (const body of bodies) {
    it(`matches the merged output for: ${body}`, () => {
      const reported = unmergedPlaceholders({ body, fields });
      const survived: string[] = [];
      for (const m of merge(body, fields).matchAll(placeholderPattern())) {
        if (!survived.includes(m[0])) survived.push(m[0]);
      }
      expect(reported).toEqual(survived);
    });
  }

  it('a body of only known tokens merges to a document with no braces left', () => {
    const merged = merge('Made on {{date}} with {{client_name}}.', fields);
    expect(merged).toContain('Northwind Materials LLC');
    expect(merged).not.toContain('{{');
  });

  it('an unknown token reaches the merged document verbatim, which is the defect', () => {
    // Pinned deliberately. The merge is NOT changed by this work: deleting
    // words from a document nobody asked to have edited is the worse failure,
    // so the token still prints and the gates below are what stop it getting
    // this far.
    expect(merge('Made with {{clinet_name}}.', fields)).toContain('{{clinet_name}}');
  });
});

describe('the standard templates a firm can install', () => {
  it('carry no placeholder the merge cannot fill', () => {
    // installSeedTemplateAction goes through createFirmTemplateAction, so a
    // dirty seed would refuse to install until somebody acknowledged it.
    for (const seed of SEED_TEMPLATES) {
      expect([
        seed.slug,
        unmergedPlaceholders({ body: seed.body, fields: seed.fields }),
      ]).toEqual([seed.slug, []]);
    }
  });
});

const MANAGE = 'app/counsel/forms/forms-manage-client.tsx';
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the template editor puts it in front of the author', () => {
  // Anchored on the source. These are expressions inside a client component,
  // which no test in this repo can render, and this codebase has already been
  // bitten by a client-side control that could be forced false with the whole
  // suite staying green.
  const src = () => readFileSync(join(__dirname, '..', MANAGE), 'utf8');

  it('asks the question of the body and the fields the body produced', () => {
    // The ARGUMENTS, not just the name. A call spelled with constants would
    // contain the function name and report nothing.
    expect(src()).toContain('unmergedPlaceholders({ body, fields })');
  });

  it('holds both Save buttons until the list has been answered', () => {
    const s = src();
    // Twice: publish and draft. A draft is one click from published.
    expect(
      s.split('disabled={busy || !name.trim() || !body.trim() || !placeholdersSettled}')
        .length - 1,
    ).toBe(2);
    expect(s).toContain('acknowledgeUnmergedPlaceholders: unmerged.length > 0');
  });

  it('ties the acknowledgement to the exact tokens that were read', () => {
    // Editing a new stray token into the body clears it. What was agreed to
    // was those tokens, not the idea of tokens.
    //
    // ANCHORED ON THE WHOLE EXPRESSION, and that is a correction. This first
    // asserted only `acknowledgedFor === unmergedSignature`, and weakening the
    // gate to `acknowledgedFor !== null` left the suite green: the checkbox's
    // own `checked=` reads the same comparison, so the substring was still in
    // the file while the control that holds Save had stopped making it. An
    // anchor has to name the expression it is about.
    const s = flat(src());
    expect(s).toContain(
      'const placeholdersSettled = unmerged.length === 0 || acknowledgedFor === unmergedSignature;',
    );
    // And the box writes that same signature, rather than a bare true.
    expect(s).toContain('setAcknowledgedFor(e.target.checked ? unmergedSignature : null)');
  });

  it('says what will happen and how to fix it', () => {
    const s = flat(src());
    expect(s).toContain('prints these exactly as they are written');
    expect(s).toContain('no spaces inside the braces');
  });

  it('shows the same thing on the PDF preview, where the author reads the page', () => {
    expect(flat(src())).toContain(
      'This document still has placeholders nothing will fill in.',
    );
  });

  it('marks a template that was already saved with one', () => {
    // The save gate can only reach the next person who edits a template. The
    // list is what reaches a firm holding one nobody has opened in a year.
    expect(src()).toContain('unmergedPlaceholders({\n            body: tpl.body,');
  });
});

/* -------------------------------------------------------------------------
 * The save gate, run for real against a fake database.
 *
 * createFirmTemplateAction and updateFirmTemplateAction are `'use server'`
 * exports, which makes each a public HTTP endpoint that can be called with any
 * arguments in any order. The acknowledgement is therefore a named argument
 * that has to be sent as `true`; a caller that has never heard of this check
 * refuses closed.
 * ---------------------------------------------------------------------- */

type Row = Record<string, unknown>;

const rows: Row[] = [];
let currentUser: { id: string; email: string } | null = null;
let role: string | null = 'owner';
/** Every insert and update the actions attempted, in order. */
const writes: { kind: 'insert' | 'update'; payload: Row }[] = [];

function makeAdmin() {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      const api: Record<string, unknown> = {};
      const match = (r: Row) => eqs.every(([c, v]) => r[c] === v);
      Object.assign(api, {
        select: () => api,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return api;
        },
        neq: () => api,
        order: () => api,
        maybeSingle: async () => {
          if (table === 'firm_members') {
            return { data: role ? { role } : null, error: null };
          }
          const hit = rows.find(match);
          return { data: hit ? { ...hit } : null, error: null };
        },
        insert: (payload: Row) => {
          writes.push({ kind: 'insert', payload });
          const stored = { id: `tpl-${rows.length + 1}`, created_at: 'now', updated_at: null, ...payload };
          rows.push(stored);
          return {
            select: () => ({ single: async () => ({ data: { ...stored }, error: null }) }),
          };
        },
        update: (payload: Row) => {
          const chain: Record<string, unknown> = {};
          Object.assign(chain, {
            eq: (col: string, val: unknown) => {
              eqs.push([col, val]);
              return chain;
            },
            select: () => ({
              single: async () => {
                writes.push({ kind: 'update', payload });
                const hit = rows.find(match);
                if (!hit) return { data: null, error: null };
                Object.assign(hit, payload);
                return { data: { ...hit }, error: null };
              },
            }),
          });
          return chain;
        },
      });
      return api;
    },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));

const { createFirmTemplateAction, updateFirmTemplateAction } = await import(
  '../lib/firm-templates'
);

const NDA = {
  name: 'Mutual NDA',
  fields: [
    { key: 'client_name', label: 'Client name', type: 'text' as const, required: true },
  ],
};

describe('createFirmTemplateAction', () => {
  beforeEach(() => {
    rows.length = 0;
    writes.length = 0;
    currentUser = { id: 'u1', email: 'dana@firm.test' };
    role = 'owner';
  });

  it('refuses a body with an unknown token, and writes nothing', () => {
    return createFirmTemplateAction('f1', {
      ...NDA,
      body: 'Made with {{clinet_name}}.',
    }).then((res) => {
      expect(res.ok).toBe(false);
      expect(res.unmergedPlaceholders).toEqual(['{{clinet_name}}']);
      // The token is quoted back exactly, so the author can search for it.
      expect(res.error).toContain('{{clinet_name}}');
      expect(writes).toEqual([]);
    });
  });

  it('refuses a declared key written with spaces, which the merge cannot match', async () => {
    const res = await createFirmTemplateAction('f1', {
      ...NDA,
      body: 'Made with {{ client_name }}.',
    });
    expect(res.ok).toBe(false);
    expect(res.unmergedPlaceholders).toEqual(['{{ client_name }}']);
    expect(writes).toEqual([]);
  });

  it('saves a body whose tokens are all declared, with nothing acknowledged', async () => {
    const res = await createFirmTemplateAction('f1', {
      ...NDA,
      body: 'Made with {{client_name}} for {{firm_name}}.',
    });
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.kind === 'insert')).toHaveLength(1);
  });

  it('saves the same broken body once the author has acknowledged it', async () => {
    const res = await createFirmTemplateAction('f1', {
      ...NDA,
      body: 'Made with {{clinet_name}}.',
      acknowledgeUnmergedPlaceholders: true,
    });
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.kind === 'insert')).toHaveLength(1);
  });

  it('checks the body and fields AS STORED, not as they were sent', async () => {
    // sanitizeFields narrows `Client_Name` to `client_name`, so a body naming
    // the key the caller sent would be broken the moment it was stored.
    const res = await createFirmTemplateAction('f1', {
      name: 'Mutual NDA',
      body: 'Made with {{Client_Name}}.',
      fields: [
        { key: 'Client_Name', label: 'Client name', type: 'text', required: true },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.unmergedPlaceholders).toEqual(['{{Client_Name}}']);
  });

  it('refuses a stranger before it says anything about placeholders', async () => {
    role = null;
    const res = await createFirmTemplateAction('f1', {
      ...NDA,
      body: 'Made with {{clinet_name}}.',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('No access to this firm.');
    expect(res.unmergedPlaceholders).toBeUndefined();
  });
});

describe('updateFirmTemplateAction', () => {
  beforeEach(() => {
    rows.length = 0;
    writes.length = 0;
    currentUser = { id: 'u1', email: 'dana@firm.test' };
    role = 'owner';
    rows.push({
      id: 't1',
      firm_id: 'f1',
      name: 'Mutual NDA',
      body: 'Made with {{client_name}}.',
      fields: [{ key: 'client_name', label: 'Client name', type: 'text', required: true }],
      status: 'published',
      created_at: 'now',
      updated_at: null,
    });
  });

  it('refuses a new body that orphans a token, against the stored fields', async () => {
    const res = await updateFirmTemplateAction('f1', 't1', {
      body: 'Made with {{clinet_name}}.',
    });
    expect(res.ok).toBe(false);
    expect(res.unmergedPlaceholders).toEqual(['{{clinet_name}}']);
    expect(writes.filter((w) => w.kind === 'update')).toEqual([]);
  });

  it('refuses a field rename that orphans a token in the stored body', async () => {
    // No body in this patch at all. The stored one still says
    // `{{client_name}}`, and after this rename nothing would fill it.
    const res = await updateFirmTemplateAction('f1', 't1', {
      fields: [{ key: 'customer_name', label: 'Customer', type: 'text', required: true }],
    });
    expect(res.ok).toBe(false);
    expect(res.unmergedPlaceholders).toEqual(['{{client_name}}']);
    expect(writes.filter((w) => w.kind === 'update')).toEqual([]);
  });

  it('lets a body and its matching fields through together', async () => {
    const res = await updateFirmTemplateAction('f1', 't1', {
      body: 'Made with {{customer_name}}.',
      fields: [{ key: 'customer_name', label: 'Customer', type: 'text', required: true }],
    });
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.kind === 'update')).toHaveLength(1);
  });

  it('saves the orphaning body once it is acknowledged', async () => {
    const res = await updateFirmTemplateAction('f1', 't1', {
      body: 'Made with {{clinet_name}}.',
      acknowledgeUnmergedPlaceholders: true,
    });
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.kind === 'update')).toHaveLength(1);
  });

  it('archives a template whose stored body is already broken', async () => {
    // A template saved before any of this existed. Archiving touches neither
    // the body nor the fields, and a gate that fired here would leave a firm
    // unable to put away the very template it was complaining about.
    rows[0].body = 'Made with {{clinet_name}}.';
    const res = await updateFirmTemplateAction('f1', 't1', { status: 'archived' });
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.kind === 'update')).toHaveLength(1);
  });

  it('refuses a template id that is not this firm’s rather than reporting success', async () => {
    // PostgREST answers a zero-row match with no error, so the read that backs
    // this check is also what stops an update on somebody else's id looking
    // like it worked.
    const res = await updateFirmTemplateAction('f1', 'not-mine', {
      fields: [{ key: 'x', label: 'X', type: 'text', required: true }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('That template is no longer available.');
    expect(writes.filter((w) => w.kind === 'update')).toEqual([]);
  });
});
