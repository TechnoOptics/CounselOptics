import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_METHODS,
  SIGNATURE_METHOD_LABELS,
  NO_METHOD_ENABLED_ERROR,
  decideSignatureMethod,
  methodRefusalSentence,
  normalizeSignatureMethodSelection,
  parseAllowedSignatureMethods,
  parseSignatureMethod,
  signatureMethodFromPadMode,
} from '../lib/signature-methods';

/**
 * The rules a firm's choice of signature methods is decided by, exercised
 * directly.
 *
 * Everything here is pure on purpose. The decision this module makes is the
 * one thing standing between a firm forbidding a method and a caller posting
 * that method anyway, and a decision reached inside a database round trip is
 * a decision nothing exercises. lib/signature-write.ts calls
 * decideSignatureMethod and does nothing else about methods, so these are the
 * tests for that gate as well as for this file.
 *
 * The distinction these tests care about most is null versus []. Null is "no
 * restriction was recorded" and every existing row means it. [] is "this
 * template names no method", which the database CHECK forbids and which this
 * module must therefore never manufacture out of a value it merely failed to
 * understand: doing so would turn a garbled column into an unsignable
 * document, and collapsing it the other way into null would turn it into an
 * unrestricted one.
 */

describe('parseSignatureMethod', () => {
  it('accepts each of the four methods', () => {
    for (const m of SIGNATURE_METHODS) {
      expect(parseSignatureMethod(m)).toBe(m);
    }
  });

  it('rejects anything that is not one of them', () => {
    expect(parseSignatureMethod('DRAW')).toBeNull();
    expect(parseSignatureMethod('scribble')).toBeNull();
    expect(parseSignatureMethod('')).toBeNull();
    expect(parseSignatureMethod(null)).toBeNull();
    expect(parseSignatureMethod(undefined)).toBeNull();
    expect(parseSignatureMethod(7)).toBeNull();
    expect(parseSignatureMethod(['draw'])).toBeNull();
  });
});

describe('parseAllowedSignatureMethods', () => {
  it('reads a missing column as unrestricted, not as empty', () => {
    expect(parseAllowedSignatureMethods(null)).toBeNull();
    expect(parseAllowedSignatureMethods(undefined)).toBeNull();
  });

  it('keeps a stored list, in canonical order and without duplicates', () => {
    expect(parseAllowedSignatureMethods(['upload', 'draw', 'draw'])).toEqual([
      'draw',
      'upload',
    ]);
  });

  it('drops entries it does not recognise rather than storing them', () => {
    expect(parseAllowedSignatureMethods(['draw', 'holograph'])).toEqual(['draw']);
  });

  /**
   * The load-bearing one. A column naming only methods this build does not
   * know is a restriction it cannot honour, and answering "unrestricted"
   * would let through every method the firm was trying to forbid. It comes
   * back as an empty list, which every consumer reads as "refuse".
   */
  it('returns an empty list, not null, when nothing recognisable survives', () => {
    expect(parseAllowedSignatureMethods(['holograph'])).toEqual([]);
    expect(parseAllowedSignatureMethods([])).toEqual([]);
  });

  it('reads a non-array as unrestricted', () => {
    expect(parseAllowedSignatureMethods('draw')).toBeNull();
    expect(parseAllowedSignatureMethods({ draw: true })).toBeNull();
  });
});

describe('decideSignatureMethod', () => {
  it('allows any known method when nothing was restricted', () => {
    for (const m of SIGNATURE_METHODS) {
      expect(decideSignatureMethod({ allowed: null, claimed: m })).toEqual({
        ok: true,
        method: m,
      });
    }
  });

  /**
   * An unrestricted request must keep working for a client that predates the
   * method field entirely, because every signing link already in the wild
   * belongs to one. The method is recorded as null, which the audit metadata
   * writes as unspecified rather than guessing.
   */
  it('allows an unspecified method when nothing was restricted', () => {
    expect(decideSignatureMethod({ allowed: null, claimed: undefined })).toEqual({
      ok: true,
      method: null,
    });
  });

  it('allows a method the request names', () => {
    expect(
      decideSignatureMethod({ allowed: ['draw', 'type'], claimed: 'type' }),
    ).toEqual({ ok: true, method: 'type' });
  });

  it('refuses a method the request does not name', () => {
    const decision = decideSignatureMethod({
      allowed: ['draw', 'type'],
      claimed: 'upload',
    });
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.error).toBe(
      methodRefusalSentence('upload'),
    );
  });

  /**
   * Fail closed. Once a restriction exists, declining to say how the mark was
   * made must not be a way around it, or every attacker simply omits the
   * field. This is the difference between a gate and a suggestion.
   */
  it('refuses an unspecified method once a restriction exists', () => {
    const decision = decideSignatureMethod({ allowed: ['draw'], claimed: undefined });
    expect(decision.ok).toBe(false);
  });

  it('refuses an unrecognised method once a restriction exists', () => {
    expect(
      decideSignatureMethod({ allowed: ['draw'], claimed: 'holograph' }).ok,
    ).toBe(false);
  });

  it('refuses every method when the restriction names none', () => {
    for (const m of SIGNATURE_METHODS) {
      expect(decideSignatureMethod({ allowed: [], claimed: m }).ok).toBe(false);
    }
  });

  it('names the method in the refusal, in the words the signer reads', () => {
    for (const m of SIGNATURE_METHODS) {
      expect(methodRefusalSentence(m)).toContain(SIGNATURE_METHOD_LABELS[m]);
    }
  });
});

describe('normalizeSignatureMethodSelection', () => {
  it('accepts a selection and returns it in canonical order', () => {
    const result = normalizeSignatureMethodSelection(['upload', 'draw']);
    expect(result).toEqual({ ok: true, methods: ['draw', 'upload'] });
  });

  it('accepts all four and stores null, because that is no restriction', () => {
    expect(
      normalizeSignatureMethodSelection(['draw', 'type', 'phone', 'upload']),
    ).toEqual({ ok: true, methods: null });
  });

  it('refuses a selection with nothing in it', () => {
    expect(normalizeSignatureMethodSelection([])).toEqual({
      ok: false,
      error: NO_METHOD_ENABLED_ERROR,
    });
  });

  /**
   * A payload of four unknown strings is a selection of nothing, and it must
   * be refused for the same reason [] is rather than saved as a template
   * nobody can sign.
   */
  it('refuses a selection whose entries are all unrecognised', () => {
    expect(normalizeSignatureMethodSelection(['holograph', 'seal'])).toEqual({
      ok: false,
      error: NO_METHOD_ENABLED_ERROR,
    });
  });

  it('leaves an absent selection alone rather than inventing one', () => {
    expect(normalizeSignatureMethodSelection(undefined)).toEqual({
      ok: true,
      methods: undefined,
    });
  });

  it('reads an explicit null as going back to all four', () => {
    expect(normalizeSignatureMethodSelection(null)).toEqual({
      ok: true,
      methods: null,
    });
  });
});

describe('signatureMethodFromPadMode', () => {
  it('maps every mode the pad reports onto a method', () => {
    expect(signatureMethodFromPadMode('drawn')).toBe('draw');
    expect(signatureMethodFromPadMode('typed')).toBe('type');
    expect(signatureMethodFromPadMode('uploaded')).toBe('upload');
  });

  it('does not invent a method for a mode it does not know', () => {
    expect(signatureMethodFromPadMode('phone')).toBeNull();
    expect(signatureMethodFromPadMode('')).toBeNull();
    expect(signatureMethodFromPadMode(undefined)).toBeNull();
  });
});
