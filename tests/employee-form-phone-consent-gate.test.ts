import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { stripComments } from './support/strip-comments';

/**
 * The consent gate AND the withdrawn handoff, on the same page at the same time.
 *
 * Two changes landed on this section independently and neither one's tests can
 * see the other. tests/employee-form-consent-gate.test.ts renders every case on
 * a desktop, because it predates the device prop and never passes it.
 * tests/employee-form-on-a-phone.test.ts renders every case unaffirmed, because
 * that is the default state, but asserts only which controls are PRESENT and
 * never whether they are live. So both files stayed green over the combination,
 * and the combination is where the risk is.
 *
 * THE RISK, stated plainly. Withdrawing the QR from a phone had to leave a
 * phone-only template signable, so signatureMethodsOnDevice hands that template
 * a drawn tab it never had before. That tab is a NEW way to make a mark on a
 * legal document, introduced by a branch cut before the affirmation gated
 * anything. If it reached the page around the gate rather than through it, an
 * employee could sign a phone-only template on a phone without ever affirming
 * intent, and 15 USC 7006(5) would have nothing to point at. Every existing
 * test in this repository passes in that world.
 *
 * So these assertions are about the two facts holding AT ONCE: the section is
 * inoperable until the box is ticked, and there is no code to scan on a device
 * that would be scanning it with itself.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('../app/portal/forms/[id]/mark-handoff-actions', () => ({
  mintPhoneMarkAction: async () => ({ ok: false, error: 'stub' }),
  collectPhoneMarkAction: async () => ({
    mark: null,
    markAt: null,
    scanned: false,
    collected: false,
  }),
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

const INTENT = 'intend that the mark above be my signature';
/** The tab in the strip. Its presence is the handoff being offered. */
const PHONE_TAB = '>Phone<';
/** The card's own mint button, on the page whenever its panel is open. */
const MINT = 'Sign with mobile';
/** The instruction that only makes sense on a second device. */
const SCAN_COPY = 'Scan with your phone';

/**
 * The opening tag of the element whose visible text is `label`. Borrowed from
 * tests/employee-form-consent-gate.test.ts for the same reason it exists there:
 * this page has unrelated disabled buttons on it, so a whole-page search for
 * the word would stay green with every signature control live.
 */
function tagFor(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `no element with the exact text "${label}" in the page`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  return html.slice(open, at + 1);
}

/** The canvas's own opening tag, which is where its lock is announced. */
function canvasTag(html: string): string {
  const at = html.indexOf('<canvas');
  expect(at, 'no canvas in the page').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('>', at) + 1);
}

/**
 * The headline case: somebody on their phone who has not yet affirmed.
 *
 * The pad must be THERE, because the phone is the screen the mark gets drawn
 * on and taking it away would leave nothing. It must also be SHUT, because
 * nothing on this page may be signed before the box is ticked. And there must
 * be no QR at all, which is a different statement from the QR being disabled.
 */
describe('an unrestricted template, on a phone, unaffirmed', () => {
  const html = page({ signatureMethods: null, viewerOnPhone: true });

  it('offers the pad, because that screen is the one in their hand', () => {
    expect(html).toContain('<canvas');
    expect(html).toContain('>Draw<');
  });

  it('locks every mode tab it offers', () => {
    for (const label of ['Draw', 'Type', 'Upload']) {
      expect(tagFor(html, label), `the ${label} tab is still live`).toContain(
        'disabled=""',
      );
    }
  });

  it('locks the Clear control', () => {
    expect(tagFor(html, 'Clear')).toContain('disabled=""');
  });

  it('marks the canvas unavailable rather than merely dimming it', () => {
    const tag = canvasTag(html);
    expect(tag).toContain('aria-disabled="true"');
    expect(tag, 'a locked canvas must not advertise a drawing cursor').not.toContain(
      'cursor-crosshair',
    );
  });

  /**
   * Absent, not disabled. A disabled QR on a phone would still be a page
   * telling somebody to scan a code with the device displaying it, which is the
   * loop the branch removed.
   */
  it('offers no code to scan with the device showing it', () => {
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(MINT);
    expect(html).not.toContain(SCAN_COPY);
  });

  it('still says why the section is shut', () => {
    expect(html).toContain('turn on once you tick the box');
  });

  it('still asks for the affirmation, and asks it above the pad', () => {
    expect(html.indexOf(INTENT)).toBeGreaterThan(-1);
    expect(html.indexOf(INTENT)).toBeLessThan(html.indexOf('<canvas'));
  });
});

/**
 * The case that only exists because of this merge.
 *
 * A phone-only template on a phone had no pad at all before the branch and no
 * gate at all before main. Here it has both, and the drawn tab that the device
 * resolution granted has to be behind the same lock as any other.
 */
describe('a phone-only template, on a phone, unaffirmed', () => {
  const html = page({ signatureMethods: ['phone'], viewerOnPhone: true });

  it('is signable at all, by drawing on the screen they are holding', () => {
    expect(html).toContain('>Draw<');
    expect(html).toContain('<canvas');
  });

  /** The whole point. A new route to a mark is still a route to a signature. */
  it('does not let that pad be drawn on before intent is affirmed', () => {
    expect(tagFor(html, 'Draw'), 'the granted Draw tab is live').toContain(
      'disabled=""',
    );
    expect(canvasTag(html)).toContain('aria-disabled="true"');
    expect(tagFor(html, 'Clear')).toContain('disabled=""');
  });

  it('asks for the affirmation, above the pad it is about', () => {
    expect(html.indexOf(INTENT)).toBeGreaterThan(-1);
    expect(html.indexOf(INTENT)).toBeLessThan(html.indexOf('<canvas'));
  });

  it('sends nobody looking for a second device', () => {
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(MINT);
    expect(html).not.toContain(SCAN_COPY);
  });

  it('says why the section is shut, not that the form cannot be signed', () => {
    expect(html).toContain('turn on once you tick the box');
    expect(html).not.toContain('has not left a way to sign this form');
    expect(html).not.toContain('not available yet');
  });
});

/**
 * The desk, which is what proves the withdrawal above is about the DEVICE and
 * not a blanket removal. A merge that dropped the handoff everywhere, or that
 * dropped the gate everywhere, would read as the same green suite without
 * these two.
 */
describe('the desk still gets the handoff, and still behind the gate', () => {
  it('offers an unrestricted template a Phone tab, locked', () => {
    const html = page({ signatureMethods: null, viewerOnPhone: false });
    expect(html).toContain(PHONE_TAB);
    expect(tagFor(html, 'Phone'), 'the Phone tab is still live').toContain(
      'disabled=""',
    );
  });

  it('offers a phone-only template the card, and will not mint before intent', () => {
    const html = page({ signatureMethods: ['phone'], viewerOnPhone: false });
    expect(html).toContain(MINT);
    expect(tagFor(html, MINT)).toContain('disabled=""');
    expect(html.indexOf(INTENT)).toBeLessThan(html.indexOf(MINT));
  });
});

/**
 * A restriction naming no method, on the device that could have been used to
 * argue it away. Being on a phone widens what may be drawn; it must not turn a
 * document nobody can sign into one anybody can, and with no pad on the page
 * there is no affirmation to ask for either.
 */
describe('a restriction that names no method, on a phone', () => {
  const html = page({ signatureMethods: [], viewerOnPhone: true });

  it('is still refused, with nothing to affirm and nothing to lock', () => {
    expect(html).toContain('has not left a way to sign this form');
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain(PHONE_TAB);
    expect(html).not.toContain(INTENT);
    expect(html).not.toContain('turn on once you tick the box');
  });
});

/**
 * The wiring, read from the source, because static markup cannot tick a box.
 *
 * The renders above prove the page ships locked on both devices. They cannot
 * prove that the pad the DEVICE RESOLUTION feeds is the same pad the gate
 * shuts. A second, ungated SignaturePad rendered for the phone case would
 * satisfy every assertion above: the locked one would still be in the markup
 * and `tagFor` would find its tabs first.
 *
 * Comments are stripped before matching. A guard satisfied by the prose
 * explaining it is not a guard, and that has happened twice in this repository.
 */
describe('the device resolution feeds the gated pad, not a second one', () => {
  const SRC = stripComments(
    readFileSync(
      join(process.cwd(), 'app/portal/forms/[id]/form-fill-client.tsx'),
      'utf8',
    ),
  );

  it('resolves the device before deciding what the pad may offer', () => {
    expect(SRC).toMatch(
      /const methodsHere = signatureMethodsOnDevice\(\s*template\.signatureMethods,\s*viewerOnPhone,?\s*\)/,
    );
    expect(
      SRC,
      'padModes must come from the device-resolved list, not the raw restriction',
    ).toMatch(/const padModes = padModesFor\(methodsHere\)/);
  });

  /**
   * The element, not the type. A bare '<SignaturePad' also matches the
   * `useState<SignaturePadValue>` above, which made the first version of this
   * guard fail against a correct file and then read the type's generic as the
   * pad's props. The trailing boundary is what tells the two apart.
   */
  const PAD_ELEMENT = /<SignaturePad(?![A-Za-z])/g;

  it('mounts exactly one pad, so there is only one thing to lock', () => {
    expect(SRC.match(PAD_ELEMENT) ?? []).toHaveLength(1);
  });

  it('hands that one pad the lock', () => {
    const pad = SRC.search(/<SignaturePad(?![A-Za-z])/);
    expect(pad).toBeGreaterThan(-1);
    const props = SRC.slice(pad, SRC.indexOf('/>', pad));
    expect(props).toContain('allowedModes={padModes}');
    expect(props).toContain('disabled={signatureLocked}');
  });

  /**
   * The handoff is withheld on the device, and the two reasons it was already
   * withheld for are still there. All three have to be conjoined: dropping
   * either of the originals to make room for the device would put the card back
   * in front of an employee whose firm forbade it, or whose database has no
   * table for it.
   */
  it('withholds the handoff for the device as well as the firm and the database', () => {
    expect(SRC).toMatch(
      /const phoneOffered =\s*phonePermitted && phoneHandoffAvailable && !viewerOnPhone;/,
    );
  });
});
