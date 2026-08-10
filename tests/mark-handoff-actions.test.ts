import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two public endpoints behind the employee's QR card.
 *
 * Every 'use server' export is a public HTTP endpoint, callable by anyone with
 * any arguments in any order, and the dominant vulnerability shape in this
 * codebase is a module that takes an id from its arguments and writes past RLS
 * with the admin client, gated only by a UI that happens to pass the right
 * thing. Both functions here write past RLS. So what is checked is that
 * neither takes an identity from its caller: the firm and the user come from
 * the session, and the one id that IS an argument is looked up under them.
 */

let user: { id: string } | null = { id: 'employee-1' };
let persona: { kind: string; firm?: { id: string } } = {
  kind: 'employee',
  firm: { id: 'firm-1' },
};

const templateAsks: [string, string][] = [];
const createAsks: Record<string, unknown>[] = [];
const collectAsks: Record<string, unknown>[] = [];
let templateFound: Record<string, unknown> | null = {
  id: 'tpl-1',
  name: 'Mutual NDA',
  signatureMethods: null,
};

vi.mock('../lib/supabase/server', () => ({
  getRealCurrentUser: async () => user,
}));
vi.mock('../lib/persona', () => ({
  getWorkspacePersona: async () => persona,
}));
vi.mock('../lib/firm-templates', () => ({
  getPortalTemplateAction: async (firmId: string, templateId: string) => {
    templateAsks.push([firmId, templateId]);
    return templateFound
      ? { ok: true, template: templateFound }
      : { ok: false, error: 'Template not found.' };
  },
}));
vi.mock('../lib/mark-handoff-queries', () => ({
  createMarkHandoff: async (owner: Record<string, unknown>) => {
    createAsks.push(owner);
    return { ok: true, rawToken: 'raw-token', handoffId: 'h1' };
  },
  collectMarkForOwner: async (input: Record<string, unknown>) => {
    collectAsks.push(input);
    return { mark: 'data:image/png;base64,AAA' };
  },
}));
vi.mock('../lib/qr-svg', () => ({ qrSvg: (url: string) => `<svg>${url}</svg>` }));

const { collectPhoneMarkAction, mintPhoneMarkAction } = await import(
  '../app/portal/forms/[id]/mark-handoff-actions'
);

beforeEach(() => {
  user = { id: 'employee-1' };
  persona = { kind: 'employee', firm: { id: 'firm-1' } };
  templateFound = { id: 'tpl-1', name: 'Mutual NDA', signatureMethods: null };
  templateAsks.length = 0;
  createAsks.length = 0;
  collectAsks.length = 0;
});

describe('mintPhoneMarkAction', () => {
  it('mints for a signed-in employee', async () => {
    const res = await mintPhoneMarkAction('tpl-1');
    expect(res.ok).toBe(true);
  });

  it('writes nothing for a caller with no session', async () => {
    user = null;
    const res = await mintPhoneMarkAction('tpl-1');
    expect(res.ok).toBe(false);
    expect(createAsks).toEqual([]);
    // Not even a lookup: an unauthenticated caller learns nothing about
    // which template ids exist.
    expect(templateAsks).toEqual([]);
  });

  it('writes nothing for a caller who is not an employee of a firm', async () => {
    persona = { kind: 'none' };
    const res = await mintPhoneMarkAction('tpl-1');
    expect(res.ok).toBe(false);
    expect(createAsks).toEqual([]);
    expect(templateAsks).toEqual([]);
  });

  /**
   * The whole point. There is no firm id in the signature of this function,
   * so there is nothing for a caller to substitute.
   */
  it('looks the template up under the session firm, never a supplied one', async () => {
    await mintPhoneMarkAction('tpl-1');
    expect(templateAsks).toEqual([['firm-1', 'tpl-1']]);
  });

  it('writes the row under the session firm and user', async () => {
    await mintPhoneMarkAction('tpl-1');
    expect(createAsks).toEqual([
      { firmId: 'firm-1', userId: 'employee-1', templateId: 'tpl-1' },
    ]);
  });

  /**
   * Written because a mutation that ADDED a firm-id parameter and preferred it
   * over the session's went green: every test above passes one argument, so
   * none of them could see a second one being honoured. That is the exact
   * shape this file exists to prevent, so it is now called the way an attacker
   * would call it, with arguments the signature does not admit.
   */
  it('ignores anything a caller passes beyond the template id', async () => {
    await (
      mintPhoneMarkAction as unknown as (
        a: string,
        ...rest: unknown[]
      ) => Promise<unknown>
    )('tpl-1', 'firm-2', { firmId: 'firm-2' }, 'attacker-1');

    expect(templateAsks).toEqual([['firm-1', 'tpl-1']]);
    expect(createAsks).toEqual([
      { firmId: 'firm-1', userId: 'employee-1', templateId: 'tpl-1' },
    ]);
  });

  it('refuses a template this session cannot reach', async () => {
    templateFound = null;
    const res = await mintPhoneMarkAction('someone-elses-template');
    expect(res.ok).toBe(false);
    expect(createAsks).toEqual([]);
  });

  it('refuses when the firm forbade the phone on this template', async () => {
    templateFound = {
      id: 'tpl-1',
      name: 'Mutual NDA',
      signatureMethods: ['draw', 'type'],
    };
    const res = await mintPhoneMarkAction('tpl-1');
    expect(res.ok).toBe(false);
    expect(createAsks).toEqual([]);
  });
});

describe('collectPhoneMarkAction', () => {
  it('hands back the mark for the session that owns it', async () => {
    const res = await collectPhoneMarkAction('h1');
    expect(res.mark).toBe('data:image/png;base64,AAA');
    // The handoff id is the caller's, and the user and firm are not. That
    // pairing is what the query layer then filters on.
    expect(collectAsks).toEqual([
      { handoffId: 'h1', userId: 'employee-1', firmId: 'firm-1' },
    ]);
  });

  it('reads nothing for a caller with no session', async () => {
    user = null;
    const res = await collectPhoneMarkAction('h1');
    expect(res.mark).toBe(null);
    expect(collectAsks).toEqual([]);
  });

  it('reads nothing for a caller who is not an employee', async () => {
    persona = { kind: 'counsel', firm: { id: 'firm-1' } };
    const res = await collectPhoneMarkAction('h1');
    expect(res.mark).toBe(null);
    expect(collectAsks).toEqual([]);
  });

  /** Called the way an attacker would, with arguments the signature does not
   *  admit. See the note on the mint above. */
  it('ignores anything a caller passes beyond the handoff id', async () => {
    await (
      collectPhoneMarkAction as unknown as (
        a: string,
        ...rest: unknown[]
      ) => Promise<unknown>
    )('h1', 'firm-2', 'attacker-1');

    expect(collectAsks).toEqual([
      { handoffId: 'h1', userId: 'employee-1', firmId: 'firm-1' },
    ]);
  });

  it('does not query at all for an empty id', async () => {
    const res = await collectPhoneMarkAction('   ');
    expect(res.mark).toBe(null);
    expect(collectAsks).toEqual([]);
  });
});
