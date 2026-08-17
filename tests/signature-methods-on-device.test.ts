import { describe, expect, it } from 'vitest';
import {
  padModesFor,
  signatureMethodsOnDevice,
  SIGNATURE_METHODS,
} from '../lib/signature-methods';

/**
 * What 'phone' means as a permitted METHOD when the device already is one.
 *
 * lib/signature-methods.ts settled long ago that the phone is a method rather
 * than a channel, and that the method delivers A DRAWN MARK: its own header
 * says a firm that forbids 'draw' but allows 'phone' still receives a drawn
 * signature. The QR handoff was never the method. It is the errand a DESK has
 * to run to borrow a touchscreen it does not have.
 *
 * So on a phone the errand is already done. The screen the mark would be drawn
 * on is the screen in the person's hand, and a template restricted to 'phone'
 * is satisfied by drawing on it. Before this function existed, padModesFor gave
 * that template an empty list and the page's only route was a code to scan with
 * the device displaying it, which is not a route.
 *
 * WHAT THIS FUNCTION MUST NEVER DO, and both directions are asserted below.
 *
 * It must never REFUSE anything. lib/template-submissions.ts records, in the
 * header of guardSignatureMethod, a deliberate refusal to close the "employee
 * decodes their own screen" residual by rejecting a claim whose user agent
 * matches the desk, because that heuristic would wrongly refuse real phones. A
 * user agent is the signer's own string and is trivially set to anything, so it
 * is allowed to open a door and never to close one. Every case here either
 * leaves the restriction alone or adds to it.
 *
 * It must never widen an EMPTY restriction. `[]` is "refuse everything" and the
 * module keeps it apart from null on purpose. It names no method, so there is no
 * 'phone' in it to resolve, and a phone must not be the thing that quietly
 * turns a document nobody can sign into one anybody can.
 */

describe('a template with no restriction recorded', () => {
  /** Null is the absence of a restriction, not a restriction listing four
   *  methods. There is nothing to resolve and it must not become a list. */
  it('is left as null on a phone', () => {
    expect(signatureMethodsOnDevice(null, true)).toBeNull();
  });

  it('is left as null on a desktop', () => {
    expect(signatureMethodsOnDevice(null, false)).toBeNull();
  });
});

describe('a template restricted to the phone', () => {
  it('also permits drawing when the viewer is on a phone', () => {
    expect(signatureMethodsOnDevice(['phone'], true)).toEqual(['draw', 'phone']);
  });

  /** The pad consequence, which is the whole point: a phone-only template
   *  offers a canvas on a phone instead of nothing at all. */
  it('gives the pad a drawn tab on a phone', () => {
    expect(padModesFor(signatureMethodsOnDevice(['phone'], true))).toEqual(['drawn']);
  });

  /**
   * The desk is untouched. It has no touchscreen to draw the phone's mark on,
   * so its route is still the handoff, and padModesFor still says so by
   * returning nothing.
   */
  it('is unchanged on a desktop', () => {
    expect(signatureMethodsOnDevice(['phone'], false)).toEqual(['phone']);
    expect(padModesFor(signatureMethodsOnDevice(['phone'], false))).toEqual([]);
  });
});

describe('a template that does not permit the phone', () => {
  /** Being on a phone is not a permission. The firm named the methods and this
   *  function has nothing to resolve. */
  it('is unchanged on a phone', () => {
    expect(signatureMethodsOnDevice(['type'], true)).toEqual(['type']);
    expect(signatureMethodsOnDevice(['type', 'upload'], true)).toEqual([
      'type',
      'upload',
    ]);
  });

  it('does not gain a drawn pad tab on a phone', () => {
    expect(padModesFor(signatureMethodsOnDevice(['type'], true))).toEqual(['typed']);
  });
});

describe('a restriction that already permits both', () => {
  it('is returned unchanged rather than reordered or duplicated', () => {
    expect(signatureMethodsOnDevice(['draw', 'phone'], true)).toEqual([
      'draw',
      'phone',
    ]);
  });

  /** Canonical order, so a resolved list and a stored one compare equal. The
   *  order is the one SIGNATURE_METHODS declares, not the order of arrival. */
  it('keeps canonical order when it adds a method', () => {
    const resolved = signatureMethodsOnDevice(['upload', 'phone'], true);
    expect(resolved).toEqual(['draw', 'phone', 'upload']);
    expect(resolved).toEqual(SIGNATURE_METHODS.filter((m) => resolved!.includes(m)));
  });
});

/**
 * The asymmetry the module was built around, checked on the one device that
 * could plausibly be used to argue it away.
 */
describe('a restriction that names no method', () => {
  it('still refuses everything on a phone', () => {
    expect(signatureMethodsOnDevice([], true)).toEqual([]);
  });

  it('still offers the pad nothing on a phone', () => {
    expect(padModesFor(signatureMethodsOnDevice([], true))).toEqual([]);
  });

  it('is not confused with null on a phone', () => {
    expect(signatureMethodsOnDevice([], true)).not.toBeNull();
  });
});

/**
 * Said as a property rather than as cases, because this is the invariant that
 * makes a spoofable header safe to read: being on a phone can only ever ADD.
 */
describe('across every possible restriction', () => {
  const everySubset = (): Array<(typeof SIGNATURE_METHODS)[number][]> => {
    const out: Array<(typeof SIGNATURE_METHODS)[number][]> = [];
    for (let mask = 0; mask < 1 << SIGNATURE_METHODS.length; mask++) {
      out.push(SIGNATURE_METHODS.filter((_, i) => mask & (1 << i)));
    }
    return out;
  };

  it('never removes a method the firm allowed', () => {
    for (const allowed of everySubset()) {
      const resolved = signatureMethodsOnDevice(allowed, true) ?? [];
      for (const method of allowed) expect(resolved).toContain(method);
    }
  });

  it('never adds anything but drawing', () => {
    for (const allowed of everySubset()) {
      const resolved = signatureMethodsOnDevice(allowed, true) ?? [];
      for (const method of resolved) {
        if (!allowed.includes(method)) expect(method).toBe('draw');
      }
    }
  });

  it('changes nothing at all on a desktop', () => {
    for (const allowed of everySubset()) {
      expect(signatureMethodsOnDevice(allowed, false)).toEqual(allowed);
    }
  });
});
