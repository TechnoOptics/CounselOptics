import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { stripComments } from './support/strip-comments';

/**
 * The affirmation is asked FIRST, and nothing can be signed until it is given.
 *
 * The checkbox used to sit under the pad, so a person drew their signature and
 * was only then asked to affirm that they meant it to be one. That is the
 * ceremony backwards: the affirmation under 15 USC 7006(5) and UETA 2(8) is
 * what makes the mark a signature, and asking for it afterwards invites the
 * answer "I had already signed, I just clicked the box".
 *
 * So the box comes first and it GATES the section. The point of these tests is
 * that the gate is real rather than cosmetic. An earlier instinct was to fade
 * the pad with opacity, which leaves every control live to a mouse, to the
 * keyboard and to a screen reader, and announces nothing at all.
 *
 * Rendered with renderToStaticMarkup, the harness
 * tests/employee-form-phone-signing.test.ts established for this page. Effects
 * do not run, so nothing here touches a canvas or the network. The default
 * state of the page IS the unaffirmed state, which is exactly the one under
 * test.
 *
 * NOTE ON WHAT THIS CANNOT SEE. Static markup cannot tick a checkbox, so the
 * unlocked page is not rendered here. It is covered from two other directions:
 * the pad's own contract below (disabled false leaves every control live), and
 * the source guard that the page derives the pad's disabled state from the
 * checkbox rather than from anything else.
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
const { SignaturePad } = await import('../components/SignaturePad');

function page(signatureMethods: unknown, phoneHandoffAvailable = true): string {
  return renderToStaticMarkup(
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
}

const INTENT = 'intend that the mark above be my signature';

/**
 * The opening tag of the element whose visible text is `label`.
 *
 * Asserting `html.includes('disabled')` proves nothing on a page with a dozen
 * disabled buttons on it: the send button is disabled here too, for unrelated
 * reasons, so a whole-page match would stay green with every signature control
 * live. This walks back from the label to the tag that carries it, so each
 * assertion is about one control.
 */
function tagFor(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `no element with the exact text "${label}" in the page`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  return html.slice(open, at + 1);
}

describe('the affirmation is asked before the pad, not after it', () => {
  const html = page(null);

  it('puts the affirmation above the signature controls', () => {
    const affirmation = html.indexOf(INTENT);
    const firstTab = html.indexOf('>Draw<');
    expect(affirmation).toBeGreaterThan(-1);
    expect(firstTab).toBeGreaterThan(-1);
    expect(
      affirmation,
      'the affirmation must be read before the pad it is about',
    ).toBeLessThan(firstTab);
  });

  it('puts the affirmation above the canvas', () => {
    expect(html.indexOf(INTENT)).toBeLessThan(html.indexOf('<canvas'));
  });
});

describe('until it is given, the signature section is genuinely inoperable', () => {
  const html = page(null);

  it('disables every mode tab', () => {
    for (const label of ['Draw', 'Type', 'Upload', 'Phone']) {
      expect(tagFor(html, label), `the ${label} tab is still live`).toContain(
        'disabled=""',
      );
    }
  });

  it('disables the Clear control', () => {
    expect(tagFor(html, 'Clear')).toContain('disabled=""');
  });

  /**
   * The canvas is the one control with no `disabled` attribute of its own, so
   * it is the one a fade would have left fully operable. Its pointer handlers
   * refuse while locked, and it says so to a screen reader rather than only to
   * a mouse.
   */
  it('marks the canvas as unavailable rather than merely dimming it', () => {
    const at = html.indexOf('<canvas');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(at, html.indexOf('>', at) + 1);
    expect(tag).toContain('aria-disabled="true"');
    expect(tag, 'a locked canvas must not advertise a drawing cursor').not.toContain(
      'cursor-crosshair',
    );
  });

  /**
   * The QR is the way around a disabled pad, so it has to be shut too.
   *
   * On an unrestricted template the mint button is not in the markup at all:
   * the phone's panel is only mounted once its tab is chosen, and that tab is
   * disabled above. The card's own button is asserted on the phone-only
   * template below, where the panel opens by default and the button IS on the
   * page from the first render.
   */
  it('does not open the phone panel behind the lock', () => {
    expect(html).not.toContain('Sign with mobile');
  });

  it('says why, rather than leaving a dead section with no explanation', () => {
    expect(html).toContain('turn on once you tick the box');
  });
});

describe('the phone-only template, where the QR is the only route', () => {
  const html = page(['phone']);

  it('still asks for the affirmation first', () => {
    expect(html.indexOf(INTENT)).toBeLessThan(html.indexOf('Sign with mobile'));
  });

  it('will not mint a code before it is given', () => {
    expect(tagFor(html, 'Sign with mobile')).toContain('disabled=""');
  });
});

describe('the pad honours the lock it is handed', () => {
  const pad = (disabled: boolean) =>
    renderToStaticMarkup(
      createElement(SignaturePad as never, { onChange: () => {}, disabled }),
    );

  it('leaves every control live when it is not locked', () => {
    const html = pad(false);
    for (const label of ['Draw', 'Type', 'Upload', 'Clear']) {
      expect(tagFor(html, label), `${label} must be live when unlocked`).not.toContain(
        'disabled=""',
      );
    }
    const at = html.indexOf('<canvas');
    expect(html.slice(at, html.indexOf('>', at) + 1)).not.toContain(
      'aria-disabled="true"',
    );
  });

  it('locks every control when it is', () => {
    const html = pad(true);
    for (const label of ['Draw', 'Type', 'Upload', 'Clear']) {
      expect(tagFor(html, label), `${label} must be locked`).toContain('disabled=""');
    }
  });
});

/**
 * The wiring, read from the source.
 *
 * The render above proves the page ships locked. It cannot prove WHAT unlocks
 * it, because static markup cannot tick a box, and a page hardcoded to
 * `disabled` would pass every assertion above while never unlocking at all.
 *
 * Comments stripped first. A guard that matches its own explanation is
 * satisfied by prose, and that has happened twice in this repository.
 */
describe('what unlocks it is the checkbox and nothing else', () => {
  const SRC = stripComments(
    readFileSync(
      join(process.cwd(), 'app/portal/forms/[id]/form-fill-client.tsx'),
      'utf8',
    ),
  );

  it('derives the lock from the affirmation', () => {
    expect(SRC).toMatch(/const signatureLocked = !intentAffirmed;/);
  });

  it('hands that lock to the pad', () => {
    expect(SRC).toMatch(/disabled=\{signatureLocked\}/);
  });

  it('hands it to the phone card too, so the QR cannot be minted around it', () => {
    const card = SRC.indexOf('<PhoneMarkHandoff');
    expect(card).toBeGreaterThan(-1);
    const props = SRC.slice(card, SRC.indexOf('/>', card));
    expect(props).toContain('disabled={signatureLocked}');
  });
});
