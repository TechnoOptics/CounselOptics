import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { stripComments } from './support/strip-comments';
import { formatSignedOn } from '../lib/firm-template-placeholders';

/**
 * Once the phone has signed, the desk shows the signature and stops offering
 * to change it.
 *
 * What shipped before this left the pad live underneath. The mark from the
 * phone was drawn onto the canvas, and the canvas was still a canvas: one
 * stray drag across it and the person had a different picture on screen from
 * the one the server holds a fingerprint for. The submission would then either
 * carry the phone's bytes while the desk showed something else, or fail the
 * attestation check outright. Neither is a thing to find out about afterwards.
 *
 * So the pad is REPLACED rather than covered. There is no canvas in this
 * state, which is the only form of uneditable that does not depend on a
 * handler firing.
 *
 * The way out is explicit. Somebody who signed with the wrong finger, or on
 * the wrong phone, needs a route that is not "start the form again", and
 * leaving the pad live was the old, silent version of that route.
 */

const { PhoneMarkComplete } = await import(
  '../app/portal/forms/[id]/phone-mark-complete'
);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const AT = '2026-03-03T12:00:00.000Z';

function panel(markAt: string | null = AT): string {
  return renderToStaticMarkup(
    createElement(PhoneMarkComplete as never, {
      dataUrl: PNG,
      markAt,
      onSignAgain: () => {},
    }),
  );
}

describe('what the desk shows once the phone has signed', () => {
  const html = panel();

  it('shows the mark itself, not a description of one', () => {
    expect(html).toContain(`src="${PNG}"`);
  });

  it('says it was signed on a phone', () => {
    expect(html).toContain('Signed on a mobile device');
  });

  it('shows the date and the time', () => {
    // The shared formatter's exact output. Asserting a loose /2026/ would pass
    // for a date-only string, which is the defect
    // tests/signature-datetime.test.ts exists about: a browser and a server
    // rendering the same instant in local time produced different times and
    // different calendar DAYS on an executed instrument.
    expect(html).toContain(formatSignedOn(new Date(AT)));
    expect(html).toContain('12:00 PM UTC');
  });

  it('prints no timestamp at all rather than inventing one', () => {
    // A row with no recorded instant is not an excuse to reach for the
    // browser's clock. The panel simply does not claim a time.
    const html = panel(null);
    expect(html).toContain('Signed on a mobile device');
    expect(html).not.toContain('Invalid Date');
    expect(html).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });
});

describe('the section is uneditable, not merely discouraged', () => {
  const html = panel();

  it('renders no canvas', () => {
    expect(html).not.toContain('<canvas');
  });

  it('offers no way to draw, type or upload over it', () => {
    for (const label of ['Draw', 'Type', 'Upload', 'Clear']) {
      expect(html, `${label} must be gone, not disabled`).not.toContain(`>${label}<`);
    }
  });

  it('offers no file input', () => {
    expect(html).not.toContain('type="file"');
  });
});

describe('the way out', () => {
  const html = panel();

  it('offers an explicit way to sign again', () => {
    expect(html).toContain('>Sign again<');
  });

  it('says what signing again will do', () => {
    expect(html).toContain('clears this signature');
  });
});

/**
 * There is still exactly one signature date formatter.
 *
 * A new surface printing a signing time is precisely where a fourth private
 * copy gets written, and the last one printed a different calendar day from
 * the server on the same instant.
 *
 * Comments stripped, because the note above this panel explains the rule using
 * the words the rule bans.
 */
describe('it uses the shared formatter', () => {
  const SRC = stripComments(
    readFileSync(
      join(process.cwd(), 'app/portal/forms/[id]/phone-mark-complete.tsx'),
      'utf8',
    ),
  );

  it('imports it rather than declaring its own', () => {
    expect(SRC).toMatch(/formatSignedOn/);
    expect(SRC).not.toMatch(/function formatSignedOn\s*\(/);
  });

  it('does not reach for a local-time formatter', () => {
    expect(SRC).not.toMatch(/toLocaleDateString|toLocaleTimeString/);
    expect(SRC).not.toMatch(/toLocaleString/);
  });

  it('does not slice an ISO string into a date', () => {
    expect(SRC).not.toMatch(/toISOString\(\)\.slice/);
  });
});

/**
 * The wiring: the completed panel STANDS IN FOR the pad rather than sitting
 * beside it.
 *
 * Rendered markup cannot show this, because the phone's mark arrives through
 * an effect and static rendering runs none. So this reads the page and checks
 * that the pad is on the other side of the same branch, which is what makes
 * the canvas absent rather than merely covered.
 */
describe('the page puts the panel where the pad was', () => {
  const SRC = stripComments(
    readFileSync(
      join(process.cwd(), 'app/portal/forms/[id]/form-fill-client.tsx'),
      'utf8',
    ),
  );

  it('branches on the phone mark', () => {
    expect(SRC).toMatch(/\{phoneMark \? \(/);
  });

  it('renders the completed panel and the pad on opposite arms', () => {
    const branch = SRC.indexOf('{phoneMark ? (');
    const complete = SRC.indexOf('<PhoneMarkComplete', branch);
    const otherArm = SRC.indexOf(') : (', branch);
    const pad = SRC.indexOf('<SignaturePad', branch);
    expect(complete).toBeGreaterThan(-1);
    expect(otherArm).toBeGreaterThan(-1);
    expect(pad).toBeGreaterThan(-1);
    expect(complete, 'the panel belongs on the phone-mark arm').toBeLessThan(otherArm);
    expect(pad, 'the pad belongs on the other arm').toBeGreaterThan(otherArm);
  });

  /**
   * Signing again has to drop the pad's own state as well as the phone's.
   *
   * `markSrc` prefers the phone's bytes and falls back to the pad's, so
   * clearing only the phone mark would uncover whatever the pad last reported
   * and hand a stale picture to the submission as though it were the new one.
   */
  it('clears the pad state too when the person signs again', () => {
    const fn = SRC.indexOf('const signAgain');
    expect(fn).toBeGreaterThan(-1);
    const body = SRC.slice(fn, fn + 400);
    expect(body).toContain('setPhoneMark(null)');
    expect(body).toContain('setMark(');
  });
});
