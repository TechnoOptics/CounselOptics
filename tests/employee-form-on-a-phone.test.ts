import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

/**
 * The page an employee holding a phone actually gets.
 *
 * THE DEFECT. The form offered to show a QR code and have the employee scan it
 * with their phone, on the phone. Scanning a code with the device displaying it
 * is not a handoff, it is a loop, and the employee's way out of it was to
 * realise that the tab labelled Phone was not for them.
 *
 * WHY THIS FILE RENDERS INSTEAD OF READING SOURCE. tests/signature-methods.test.ts
 * and tests/signature-methods-on-device.test.ts already pin the logic, and the
 * logic was green throughout the original defect because nothing passed the page
 * anything. Seven defects in one day here were green across a full suite and
 * obvious the moment a page was rendered. So the assertions are about markup.
 *
 * The device answer arrives as `viewerOnPhone`, a prop, established by the
 * server from the request's user agent. tests/portal-form-page-phone-availability.test.ts
 * drives the real server component and proves it is wired to a real header;
 * this file proves the form obeys it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('../app/portal/forms/[id]/mark-handoff-actions', () => ({
  mintPhoneMarkAction: async () => ({ ok: false, error: 'stub' }),
  collectPhoneMarkAction: async () => ({ mark: null }),
}));

const { FormFillClient } = await import('../app/portal/forms/[id]/form-fill-client');

function page(opts: {
  signatureMethods: unknown;
  viewerOnPhone: boolean;
  phoneHandoffAvailable?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(FormFillClient as never, {
      phoneHandoffAvailable: opts.phoneHandoffAvailable ?? true,
      viewerOnPhone: opts.viewerOnPhone,
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
        signatureMethods: opts.signatureMethods,
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
}

/** The tab in the strip. Its presence is the handoff being offered. */
const PHONE_TAB = '>Phone<';
/** The instruction that only makes sense on a second device. */
const SCAN_COPY = 'Scan with your phone';
const INTENT = 'intend that the mark above be my signature';

describe('an unrestricted template, on a phone', () => {
  const html = page({ signatureMethods: null, viewerOnPhone: true });

  it('does not offer a code to scan with the device showing it', () => {
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(SCAN_COPY);
  });

  /** Nothing else is taken away. The three pad modes the firm allows are all
   *  usable with a finger, which is the point. */
  it('offers the pad, which is the screen already in their hand', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('>Type<');
    expect(html).toContain('>Upload<');
    expect(html).toContain('<canvas');
    expect(html).toContain(INTENT);
  });
});

/**
 * The desk is the case the handoff was built for and it must not regress. A fix
 * that withdrew the QR from everybody would read as the same green suite.
 */
describe('an unrestricted template, on a desktop', () => {
  const html = page({ signatureMethods: null, viewerOnPhone: false });

  it('still offers the phone, because this screen cannot be drawn on', () => {
    expect(html).toContain(PHONE_TAB);
  });

  it('still offers all three pad modes', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('>Type<');
    expect(html).toContain('>Upload<');
  });
});

/**
 * The case most likely to be got wrong: the firm restricted this template to
 * the phone, so before this change the QR was its ONLY route. Removing the QR
 * without resolving what 'phone' means on a phone would have left this employee
 * holding a signable document and no way to sign it.
 *
 * lib/signature-methods.ts already holds that a phone signature IS a drawn
 * mark. The handoff is the errand a desk runs to borrow a touchscreen; this
 * device is one.
 */
describe('a phone-only template, on a phone', () => {
  const html = page({ signatureMethods: ['phone'], viewerOnPhone: true });

  it('lets them sign, by drawing on the screen they are holding', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('<canvas');
    expect(html).toContain(INTENT);
  });

  it('does not send them looking for a second device', () => {
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(SCAN_COPY);
    expect(html).not.toContain('Show a code');
  });

  /** Not a dead end and not an apology. Both sentences would be false here. */
  it('does not claim there is no way to sign it', () => {
    expect(html).not.toContain('has not left a way to sign this form');
    expect(html).not.toContain('not available yet');
    expect(html).not.toContain('This document cannot be signed on this page');
  });

  /**
   * The firm narrowed this to one method, so the employee is told why they are
   * looking at a single tab rather than left to wonder.
   *
   * The whole sentence, not the substring 'signed on a phone': that substring is
   * also in the handoff card's own copy, so asserting it would have passed
   * before this change for entirely the wrong reason.
   */
  it('says plainly why drawing is the only option', () => {
    expect(html).toContain(
      'This form is signed on a phone, and you are on one. Draw your signature on this screen.',
    );
  });

  /** The three-ways sentence describes a page that is not on screen. */
  it('does not describe modes the firm forbade', () => {
    expect(html).not.toContain('>Type<');
    expect(html).not.toContain('>Upload<');
    expect(html).not.toContain('Draw it, type it, or upload');
  });
});

/** Unchanged: a desk has no touchscreen, so the handoff is still its route. */
describe('a phone-only template, on a desktop', () => {
  const html = page({ signatureMethods: ['phone'], viewerOnPhone: false });

  it('still offers the handoff and no pad', () => {
    expect(html).toContain(PHONE_TAB);
    expect(html).toContain('This form is signed on a phone');
    expect(html).not.toContain('>Draw<');
    expect(html).not.toContain('<canvas');
  });
});

/**
 * A phone-only template on a database where 20260815_mark_handoffs.sql is
 * unapplied. On a desk this is the dead end the page apologises for. On a phone
 * it is not a dead end at all: no handoff is needed to draw on this screen, so
 * the missing table is irrelevant and the apology would be false.
 */
describe('a phone-only template with no handoff provisioned, on a phone', () => {
  const html = page({
    signatureMethods: ['phone'],
    viewerOnPhone: true,
    phoneHandoffAvailable: false,
  });

  it('can still be signed', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('<canvas');
    expect(html).toContain(INTENT);
  });

  it('does not apologise for a route it does not need', () => {
    expect(html).not.toContain('not available yet');
    expect(html).not.toContain('has not left a way to sign this form');
  });
});

/** The same case on a desk, which IS a dead end and still says so. */
describe('a phone-only template with no handoff provisioned, on a desktop', () => {
  const html = page({
    signatureMethods: ['phone'],
    viewerOnPhone: false,
    phoneHandoffAvailable: false,
  });

  it('still says plainly that there is no way to sign this one yet', () => {
    expect(html).toContain('set to be signed on a phone');
    expect(html).toContain('not available yet');
    expect(html).not.toContain(INTENT);
  });
});

/**
 * The restriction that names nothing, on the device that could have been used
 * to argue it away. `[]` is "refuse everything", it names no phone to resolve,
 * and being on a phone must not be the thing that lifts it.
 */
describe('a restriction that names no method, on a phone', () => {
  const html = page({ signatureMethods: [], viewerOnPhone: true });

  it('is still refused, and still said plainly', () => {
    expect(html).toContain('has not left a way to sign this form');
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(INTENT);
  });
});
