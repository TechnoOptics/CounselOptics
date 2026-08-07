import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterpartyFieldsSummary } from '@/app/sign/[token]/counterparty-fields';

/**
 * The employee who counter-signs can reach a signature pad.
 *
 * THE SEAM. Sequential signers put the counterparty at order 1 and the
 * employee at order 2 on ONE signing request. The counterparty's blanks are a
 * property of the REQUEST, so both signers were handed the same intake, while
 * the values already typed are read from the signer's OWN row and were
 * therefore empty for the employee. The pad renders only once the blanks are
 * settled, so the employee opened their link and was shown the other side's
 * blank form with no pad and no way past it: submitting the form was the only
 * thing that would flip it, and submitting wrote the other side's answers onto
 * the employee's own row.
 *
 * Neither slice was wrong alone and neither knew the other existed, which is
 * why the whole suite stayed green with the pad never rendering.
 *
 * Driven through the page itself rather than grepped. It is a server
 * component, which is to say a plain async function returning an element tree,
 * so it can be CALLED here and the props it hands the ceremony read off what
 * it returns. That is the same technique tests/signer-terminal-screen.ts uses
 * and it needs no DOM.
 */

const store = vi.hoisted(() => ({
  /** Who is holding the link. The recipient, or the employee at order 2. */
  signerEmail: 'buyer@wren.test',
  /** The recipient named on the submission behind this request. */
  recipientEmail: 'buyer@wren.test',
  /** What the recipient's own signature row carries. */
  counterpartyValues: null as unknown,
  /**
   * What the employee's row carries. Only ever non-null through a direct
   * call to the action, which is now refused, but the read has to prove it
   * does not pick this up whatever is in it.
   */
  employeeValues: null as unknown,
  /**
   * How this signer proved who they are. An outside party enters the code
   * from their email; an employee is let through on a session that matches
   * their address (resolveInternalSignerGate). Both are set here because the
   * page refuses to render the ceremony at all without one, and a test that
   * never reached the ceremony would pass its assertions for the wrong reason.
   */
  accessCodeRequired: true,
  currentUserEmail: null as string | null,
}));

/** Captured from the ceremony the page renders. */
const surfaceProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

const FIELDS = [
  { key: 'entity_name', label: 'Your registered entity name', type: 'text', required: true, party: 'counterparty' },
];
const BOXES = [{ key: 'entity_name', page: 1, x: 100, y: 500, widthPt: 200, heightPt: 16 }];

vi.mock('@/lib/firm-storage', () => ({
  getSignatureByToken: async () => ({
    signature: {
      id: 'sig-self',
      token: 'tok-1',
      signerEmail: store.signerEmail,
      signerName: 'A Signer',
      signedAt: null,
      response: null,
      accessCodeRequired: store.accessCodeRequired,
      accessVerifiedAt: store.accessCodeRequired ? '2026-08-06T10:00:00.000Z' : null,
      positionPage: 1,
      positionX: 0.1,
      positionY: 0.1,
    },
    request: {
      id: 'req-1',
      status: 'sent',
      message: null,
      completedAt: null,
      signerCanDownload: true,
      signedFilePath: null,
    },
    document: { name: 'Mutual NDA', filePath: 'firm-1/doc-1/nda.pdf', signableFilePath: null },
    firm: { name: 'Anderson Foundation', accentColor: '#c9a24a' },
  }),
}));

/**
 * A fake that answers exactly the reads the intake loaders make and nothing
 * else. Anything unexpected throws, so a change of shape shows up as a failing
 * test rather than as a silent null the page would read as "no blanks".
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        async maybeSingle() {
          if (table === 'firm_template_submissions') {
            return {
              data: {
                id: 'sub-1',
                firm_id: 'firm-1',
                template_id: 'tpl-1',
                field_boxes: BOXES,
                recipient_email: store.recipientEmail,
              },
              error: null,
            };
          }
          if (table === 'firm_templates') return { data: { fields: FIELDS }, error: null };
          if (table === 'firm_signatures') {
            // The signer's own row, by id.
            return {
              data: {
                counterparty_values:
                  store.signerEmail.trim().toLowerCase() ===
                  store.recipientEmail.trim().toLowerCase()
                    ? store.counterpartyValues
                    : store.employeeValues,
              },
              error: null,
            };
          }
          throw new Error(`unexpected maybeSingle on ${table}`);
        },
        // A list read: every signature row on the request. The EMPLOYEE's row
        // is returned first on purpose, for the reason the stamp test states.
        then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
          if (table !== 'firm_signatures') throw new Error(`unexpected list read on ${table}`);
          return Promise.resolve({
            data: [
              {
                id: 'sig-emp',
                signer_email: 'priya@firm.test',
                counterparty_values: store.employeeValues,
              },
              {
                id: 'sig-cp',
                signer_email: store.recipientEmail,
                counterparty_values: store.counterpartyValues,
              },
            ],
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  }),
}));

// Whose turn it is is a separate rule with its own tests. Both signers are
// ready here, because a page that never renders the ceremony would pass every
// assertion below for the wrong reason.
vi.mock('@/lib/signature-write', () => ({
  loadSignerOrder: async () => ({
    kind: 'ordered',
    rows: [
      { id: 'sig-self', signerEmail: store.signerEmail, signedAt: null, order: 1 },
    ],
  }),
}));
vi.mock('@/lib/esign-audit', () => ({ appendSignatureEvent: async () => {} }));
vi.mock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
vi.mock('@/lib/supabase/server', () => ({
  getRealCurrentUser: async () =>
    store.currentUserEmail ? { id: 'u-1', email: store.currentUserEmail } : null,
}));
vi.mock('next/headers', () => ({ headers: () => new Map() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('next/link', () => ({ default: (p: unknown) => ({ type: 'a', props: p }) }));
vi.mock('@/app/sign/[token]/signer-surface', () => ({
  SignerSurface: (p: Record<string, unknown>) => {
    surfaceProps.current = p;
    return null;
  },
}));
vi.mock('@/app/sign/[token]/signer-response', () => ({ SignerResponse: () => null }));
vi.mock('@/app/sign/[token]/access-code-gate', () => ({ AccessCodeGate: () => null }));
vi.mock('@/components/TraceWatermark', () => ({ TraceWatermark: () => null }));
vi.mock('@/components/i18n/AutoTranslate', () => ({
  AutoTranslate: (p: { children?: unknown }) => p.children,
}));
vi.mock('@/components/i18n/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

/** Every string in a returned element tree, in order. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
  } else if (node && typeof node === 'object') {
    const el = node as { props?: { children?: unknown } };
    if (el.props && typeof el.props === 'object') textOf(el.props.children, out);
  }
  return out;
}

/** Walk the returned tree so every element function actually runs. */
function realize(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) realize(child);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === 'function' && el.props) {
    realize((el.type as (p: unknown) => unknown)(el.props));
    return;
  }
  if (el.props) realize(el.props.children);
}

let SignPage: (args: { params: { token: string } }) => Promise<unknown>;

async function ceremony(): Promise<Record<string, unknown>> {
  surfaceProps.current = null;
  realize(await SignPage({ params: { token: 'tok-1' } }));
  expect(surfaceProps.current).not.toBeNull();
  return surfaceProps.current as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  store.signerEmail = 'buyer@wren.test';
  store.recipientEmail = 'buyer@wren.test';
  store.counterpartyValues = null;
  store.employeeValues = null;
  store.accessCodeRequired = true;
  store.currentUserEmail = null;
  vi.resetModules();
  SignPage = (await import('@/app/sign/[token]/page')).default as typeof SignPage;
}, 20_000);

describe('the blanks a signer is shown', () => {
  it('asks the counterparty for the fields this document carries', async () => {
    const props = await ceremony();
    expect((props.counterpartyFields as unknown[]).map((f) => (f as { key: string }).key)).toEqual([
      'entity_name',
    ]);
  });

  const asEmployee = () => {
    store.signerEmail = 'priya@firm.test';
    store.accessCodeRequired = false;
    store.currentUserEmail = 'priya@firm.test';
  };

  it('asks the employee who counter-signs to fill in nothing', async () => {
    // Their own entity is already named in the document they approved. What
    // they are affirming is what the OTHER side agreed to, and a form they
    // cannot answer standing between them and the pad is a signature that
    // never lands.
    asEmployee();
    expect((await ceremony()).canFillFields).toBe(false);
  });

  /**
   * WHY THIS ASSERTION CHANGED. It used to require initialFieldValues to be
   * {} for the employee, on the grounds that the signing surface is public.
   * That reasoning does not reach this signer: the employee at order 2 is a
   * PARTY to the instrument, not a stranger holding a link, and what the
   * other party wrote on the agreement is the substance of what they are
   * being asked to counter-sign.
   *
   * Scoping the FORM to the counterparty was right and stands. Scoping the
   * read-only overlay with it was not: it left the employee looking at an
   * empty ruled blank, signing, and the executed instrument then carrying the
   * counterparty's value stamped into that blank. This repo already has a
   * commit named "Put the review affirmation in the chain, and stop signing
   * what nobody saw"; this is that defect on the counter-signature.
   */
  it('shows the employee what the other side actually wrote', async () => {
    store.counterpartyValues = { entity_name: 'Wren Supply Co.' };
    asEmployee();
    const props = await ceremony();
    expect(props.initialFieldValues).toEqual({ entity_name: 'Wren Supply Co.' });
    // With the questions and the geometry, or the overlay has nothing to draw
    // them into and the blank on the page stays empty.
    expect((props.counterpartyFields as unknown[]).map((f) => (f as { key: string }).key)).toEqual([
      'entity_name',
    ]);
    expect(props.fieldBoxes).toHaveLength(1);
  });

  it('does not hand the employee the counterparty’s own row', async () => {
    // The values come from the row belonging to the recipient the submission
    // names, found the same way the stamp finds it, not from whichever row
    // happens to be read first.
    store.counterpartyValues = { entity_name: 'Wren Supply Co.' };
    store.employeeValues = { entity_name: 'Whatever The Employee Guessed' };
    asEmployee();
    const props = await ceremony();
    expect(props.initialFieldValues).toEqual({ entity_name: 'Wren Supply Co.' });
  });

  it('gives the counterparty back what they already typed', async () => {
    store.counterpartyValues = { entity_name: 'Wren Supply Co.' };
    const props = await ceremony();
    expect(props.initialFieldValues).toEqual({ entity_name: 'Wren Supply Co.' });
    expect(props.canFillFields).toBe(true);
  });

  it('matches the recipient however either address was typed', async () => {
    store.recipientEmail = 'Buyer@Wren.test';
    store.signerEmail = ' buyer@wren.test ';
    const props = await ceremony();
    expect(props.counterpartyFields).toHaveLength(1);
  });
});

/**
 * The pad is gated on the blanks being settled, and the rule is a function
 * with tests rather than an expression inside a client component. It was the
 * latter, and "force it false" was a mutation the whole suite survived.
 */
describe('the pad the signer reaches', () => {
  it('opens the ceremony from the shared rule', () => {
    const src = readFileSync(
      join(__dirname, '..', 'app/sign/[token]/signer-surface.tsx'),
      'utf8',
    );
    expect(src).toMatch(/from '@\/lib\/counterparty-fields'/);
    expect(src).toContain('counterpartyFieldsSettled(');
    expect(src).toContain('canFill: canFillFields');
    // No second copy of the rule beside the one it imports.
    expect(src).not.toMatch(/counterpartyFields\.every\(/);
  });

  /**
   * The three places canFillFields decides something, pinned by their
   * ARGUMENTS rather than by the mere presence of a call. SignerSurface holds
   * hooks, so it cannot be called the way the summary below it can, and a
   * wiring assertion that only looked for a name would survive the wiring
   * being replaced by a constant. That has already happened once on this
   * branch and only a mutation found it.
   */
  it('wires the read-only case through every control it touches', () => {
    const src = readFileSync(
      join(__dirname, '..', 'app/sign/[token]/signer-surface.tsx'),
      'utf8',
    );
    // The form is the counterparty's alone.
    expect(src).toContain('{canFillFields && counterpartyFields.length > 0 && !fieldsDone &&');
    // The edit button is the one route back into it, so it is shut for
    // everybody else whatever step they are at.
    expect(src).toContain("locked={!canFillFields || step !== 'disclosure'}");
    // And the summary says whose answers these are.
    expect(src).toContain('ownedByReader={canFillFields}');
  });
});

/**
 * The one route back into the form, closed for a signer who is not the
 * counterparty.
 *
 * fieldsDone is already true for them (counterpartyFieldsSettled with
 * canFill false), so the form does not render on arrival whatever else is
 * true. The summary's "Change these details" button is the only thing that
 * can set it false again, so that button is the reachable gate and this is
 * where it is held. The surface's own `canFillFields &&` on the form is a
 * second statement of the same rule and cannot be reached past this.
 *
 * A plain function component with no hooks, so it is CALLED rather than
 * grepped.
 */
describe('the summary a later signer reads', () => {
  const FIELD = {
    key: 'entity_name',
    label: 'Entity',
    type: 'text' as const,
    required: true,
    party: 'counterparty' as const,
  };
  const VALUES = { entity_name: 'Wren Supply Co.' };

  const summary = (over: Record<string, unknown>) =>
    CounterpartyFieldsSummary({
      fields: [FIELD],
      values: VALUES,
      onEdit: () => {},
      locked: false,
      ownedByReader: true,
      ...over,
    } as Parameters<typeof CounterpartyFieldsSummary>[0]);

  it('offers the counterparty a way back to their own answers', () => {
    const text = textOf(summary({})).join(' ');
    expect(text).toContain('Change these details');
    expect(text).toContain('Your details');
  });

  it('offers a later signer no way to change what the other party wrote', () => {
    const text = textOf(summary({ ownedByReader: false, locked: true })).join(' ');
    expect(text).not.toContain('Change these details');
  });

  it('tells them whose answers they are reading', () => {
    const text = textOf(summary({ ownedByReader: false, locked: true })).join(' ');
    expect(text).toContain('What the other party supplied');
    expect(text).toContain('counter-sign');
    expect(text).not.toContain('Your details');
    // And the words themselves, so they can read the document with them.
    expect(text).toContain('Wren Supply Co.');
  });
});
