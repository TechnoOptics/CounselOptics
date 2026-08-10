import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SignaturePad } from '../components/SignaturePad';
import {
  claimedSignatureMethod,
  decideSignatureMethod,
  padModesFor,
} from '../lib/signature-methods';

/**
 * What a template restricted to the phone leaves an employee.
 *
 * The claim this file was written to check was that padModesFor(['phone'])
 * returning nothing left the employee with a pad they could not use. It does
 * return nothing, and that part is in tests/signature-methods.test.ts. What
 * happened next was the opposite of a dead end in two independent ways, and
 * both are pinned here so neither can quietly come back:
 *
 *   - components/SignaturePad read an EMPTY allowed list as "no preference"
 *     and offered all three tabs. A restriction that named none of them was
 *     therefore widened back to all of them by the component meant to enforce
 *     it, on the outside signer's page as well as anywhere else.
 *
 *   - app/portal/forms/[id]/form-fill-client.tsx never passed the restriction
 *     to the pad at all, and nothing on the employee's submit path checked it,
 *     so an employee signed a phone-only template by drawing on their laptop
 *     and the server recorded it.
 *
 * The pad tests below use renderToStaticMarkup, the same DOM-free harness
 * tests/signature-method-picker.test.ts uses.
 */

function padMarkup(allowedModes?: readonly ('drawn' | 'typed' | 'uploaded')[]) {
  return renderToStaticMarkup(
    createElement(SignaturePad, { onChange: () => {}, allowedModes }),
  );
}

describe('SignaturePad and an empty allowed list', () => {
  it('offers all three when no restriction is passed at all', () => {
    const html = padMarkup(undefined);
    expect(html).toContain('Draw');
    expect(html).toContain('Type');
    expect(html).toContain('Upload');
  });

  it('offers only what a restriction names', () => {
    const html = padMarkup(['typed']);
    expect(html).toContain('Type');
    expect(html).not.toContain('>Draw<');
    expect(html).not.toContain('>Upload<');
  });

  /**
   * The one that mattered. An explicitly empty list is a restriction that no
   * pad mode satisfies, which is what padModesFor(['phone']) produces. It must
   * not be read as the absence of a restriction.
   */
  it('offers no mode at all for an explicitly empty list', () => {
    const html = padMarkup([]);
    expect(html).not.toContain('>Draw<');
    expect(html).not.toContain('>Type<');
    expect(html).not.toContain('>Upload<');
  });

  /**
   * And says so, rather than rendering a canvas nobody may mark. The sentence
   * does not name the phone: this component cannot tell a phone-only template
   * from one restricted to nothing at all, and only one of those has a QR card
   * under it. Each surface says the true thing beneath.
   */
  it('says there is no pad rather than showing an unusable one', () => {
    const html = padMarkup([]);
    expect(html).not.toContain('<canvas');
    expect(html).toContain('cannot be signed on this page');
    expect(html).not.toContain('phone');
  });
});

describe('claimedSignatureMethod', () => {
  it('reports the phone only when the server established it', () => {
    expect(claimedSignatureMethod({ attestedPhone: true, padMode: 'drawn' })).toBe(
      'phone',
    );
  });

  it('translates the pad vocabulary otherwise', () => {
    expect(claimedSignatureMethod({ attestedPhone: false, padMode: 'drawn' })).toBe(
      'draw',
    );
    expect(claimedSignatureMethod({ attestedPhone: false, padMode: 'typed' })).toBe(
      'type',
    );
    expect(
      claimedSignatureMethod({ attestedPhone: false, padMode: 'uploaded' }),
    ).toBe('upload');
  });

  /**
   * A browser saying 'phone' has said nothing. This is the same rule
   * lib/signature-write.ts states for the outside signer, and it is the whole
   * reason 'phone' is worth restricting to: it is the only one of the four the
   * server can establish for itself.
   */
  it('refuses to believe a caller that simply says phone', () => {
    expect(claimedSignatureMethod({ attestedPhone: false, padMode: 'phone' })).toBe(
      null,
    );
  });

  it('and a phone-only template then refuses that caller', () => {
    const claimed = claimedSignatureMethod({
      attestedPhone: false,
      padMode: 'phone',
    });
    expect(decideSignatureMethod({ allowed: ['phone'], claimed }).ok).toBe(false);
  });

  it('while the same template accepts a mark the server attested', () => {
    const claimed = claimedSignatureMethod({
      attestedPhone: true,
      padMode: 'drawn',
    });
    expect(decideSignatureMethod({ allowed: ['phone'], claimed })).toEqual({
      ok: true,
      method: 'phone',
    });
  });
});

describe('the pad modes an employee is offered', () => {
  it('is empty for a phone-only template, which is why the QR has to be there', () => {
    expect(padModesFor(['phone'])).toEqual([]);
  });
});
