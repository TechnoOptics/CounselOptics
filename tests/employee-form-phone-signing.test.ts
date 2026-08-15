import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

/**
 * What an employee actually sees on the form, which is the thing that was
 * reported: the QR option was not there.
 *
 * The unit tests beside this one check padModesFor and the pad in isolation,
 * and both were green while the employee's page passed neither of them
 * anything. So this renders the real component and reads the page, which is
 * the discipline this repo arrived at after 1450 green tests missed two
 * defects that were obvious on sight.
 *
 * renderToStaticMarkup, the same DOM-free harness
 * tests/signature-method-picker.test.ts uses. Effects do not run, so nothing
 * here depends on the network or on a canvas.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
// The two server actions the QR card is bound to. Not under test here: they
// are exercised in tests/mark-handoff.test.ts and
// tests/mark-handoff-queries.test.ts. Stubbed so this file can render the page
// without a database.
vi.mock('../app/portal/forms/[id]/mark-handoff-actions', () => ({
  mintPhoneMarkAction: async () => ({ ok: false, error: 'stub' }),
  collectPhoneMarkAction: async () => ({ mark: null }),
}));

const { FormFillClient } = await import('../app/portal/forms/[id]/form-fill-client');

function page(signatureMethods: unknown, phoneHandoffAvailable = true): string {
  const html = renderToStaticMarkup(
    createElement(FormFillClient as never, {
      phoneHandoffAvailable,
      template: {
        id: 't1',
        firmId: 'f1',
        name: 'Mutual NDA',
        description: '',
        category: 'nda',
        body: 'Agreement body.',
        fields: [],
        status: 'published',
        requiresApproval: true,
        deliveryMode: 'signature',
        signatureMethods,
        documentLayout: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      firmId: 'f1',
      firmName: 'Anderson Foundation',
      employeeName: 'Jane Okafor',
      employeeEmail: 'jane@example.com',
    }),
  );
  return html;
}

/** The card's own button label. Its presence is the QR option being offered. */
const QR_BUTTON = 'Sign with mobile';

describe('the employee form, on a template restricted to the phone', () => {
  const html = page(['phone']);

  /** The report that started this: the option was not on the page at all. */
  it('offers the phone, which is the only way this template can be signed', () => {
    expect(html).toContain(QR_BUTTON);
    expect(html).toContain('This form is signed on a phone');
  });

  it('offers no pad mode the firm forbade', () => {
    expect(html).not.toContain('>Draw<');
    expect(html).not.toContain('>Type<');
    expect(html).not.toContain('>Upload<');
    expect(html).not.toContain('<canvas');
  });

  /** Copy that described a page the firm has restricted away. */
  it('does not describe three ways of signing that are not there', () => {
    expect(html).not.toContain('Draw it, type it, or upload');
  });
});

describe('the employee form, unrestricted', () => {
  const html = page(null);

  it('is unchanged: all three modes, and the phone as a fourth', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('>Type<');
    expect(html).toContain('>Upload<');
    expect(html).toContain('Draw it, type it, or upload');
    expect(html).toContain(QR_BUTTON);
  });
});

describe('the employee form, on a template that forbids the phone', () => {
  const html = page(['type']);

  /** An offer that would be refused on scanning is worse than no offer. */
  it('does not offer a code the mint would refuse', () => {
    expect(html).not.toContain(QR_BUTTON);
  });

  it('offers exactly the one mode the firm named', () => {
    expect(html).toContain('>Type<');
    expect(html).not.toContain('>Draw<');
    expect(html).not.toContain('>Upload<');
    expect(html).not.toContain('Draw it, type it, or upload');
  });
});

/**
 * The live defect. 20260815_mark_handoffs.sql is unapplied, so
 * firm_mark_handoffs does not exist; 20260814_signature_methods.sql is
 * unapplied too, so signature_methods reads as null, which means "no
 * restriction" and therefore "the phone is allowed". The form offered a route
 * whose table was not there, and the employee found that out by tapping it.
 *
 * Whether the firm ALLOWS the phone and whether the phone is POSSIBLE are two
 * questions now, and an offer needs both.
 */
describe('the employee form, where the phone handoff is not provisioned', () => {
  const html = page(null, false);

  it('does not offer a route the server cannot honour', () => {
    expect(html).not.toContain(QR_BUTTON);
  });

  /** Nothing else moves. This employee has a pad and does not need telling
   *  about a feature they were never shown. */
  it('is otherwise the ordinary form', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('>Type<');
    expect(html).toContain('>Upload<');
    expect(html).toContain('intend that the mark above be my signature');
    expect(html).not.toContain('has not left a way to sign this form');
    expect(html).not.toContain('not available yet');
  });
});

/**
 * The one case where it has to be said out loud: the firm restricted this
 * template to the phone, so there is no pad to fall back to.
 */
describe('a phone-only form where the phone handoff is not provisioned', () => {
  const html = page(['phone'], false);

  it('offers nothing, rather than a button that fails on tapping', () => {
    expect(html).not.toContain(QR_BUTTON);
    expect(html).not.toContain('<canvas');
  });

  it('says plainly that there is no way to sign this one yet', () => {
    expect(html).toContain('set to be signed on a phone');
    expect(html).toContain('not available yet');
    expect(html).toContain('Ask your legal team');
  });

  /** No cause. The database is not the employee's problem and naming it here
   *  would be alarming and useless in equal measure. */
  it('tells the employee nothing about the database', () => {
    expect(html).not.toContain('firm_mark_handoffs');
    expect(html).not.toContain('migration');
    expect(html).not.toContain('table');
  });

  it('does not ask anyone to affirm intent about a mark that cannot exist', () => {
    expect(html).not.toContain('intend that the mark above be my signature');
  });
});

describe('the employee form, on a restriction that names nothing', () => {
  /**
   * Unreachable through the picker, the save path and the CHECK constraint,
   * all three of which refuse an empty selection. It is reachable from a
   * column an older build wrote, and lib/signature-methods.ts reads it as
   * "refuse everything" rather than quietly widening it back. This is the
   * surface honouring that, and it is the answer to what a restriction
   * leaving a signer no method does: it is shown, not worked around.
   */
  const html = page([]);

  it('says so plainly rather than inventing a route the firm did not grant', () => {
    expect(html).toContain('has not left a way to sign this form');
    expect(html).not.toContain(QR_BUTTON);
    expect(html).not.toContain('<canvas');
  });

  it('does not ask anyone to affirm intent about a mark that cannot exist', () => {
    expect(html).not.toContain('intend that the mark above be my signature');
  });
});
