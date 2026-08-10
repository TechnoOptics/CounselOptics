import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  SignatureMethodPicker,
  toggleSignatureMethod,
} from '../components/counsel/SignatureMethodPicker';
import {
  NO_METHOD_ENABLED_ERROR,
  SIGNATURE_METHODS,
  SIGNATURE_METHOD_LABELS,
} from '../lib/signature-methods';

/**
 * The picker's own rule, and the markup it produces.
 *
 * toggleSignatureMethod is exported separately from the component precisely so
 * the rule can be exercised without a DOM. The rule is the part that matters:
 * a firm must not be able to turn the last method off, and "the checkbox looked
 * disabled" is not that guarantee, it is a description of one browser.
 *
 * The render assertions below are deliberately thin. They establish that every
 * method reaches the page and that a forbidden one is not silently dropped from
 * it, which is what a firm reviewing its own settings needs. They are not a
 * substitute for the server gate, and this file does not pretend otherwise:
 * tests/signature-write-gates.test.ts is where the refusal that actually
 * protects an instrument is exercised.
 */

describe('toggleSignatureMethod', () => {
  it('reads null as all four enabled, so turning one off leaves the rest', () => {
    expect(toggleSignatureMethod(null, 'upload')).toEqual({
      ok: true,
      methods: ['draw', 'type', 'phone'],
    });
  });

  it('turns a method back on', () => {
    expect(toggleSignatureMethod(['draw'], 'type')).toEqual({
      ok: true,
      methods: ['draw', 'type'],
    });
  });

  it('collapses back to null once all four are on again', () => {
    expect(toggleSignatureMethod(['draw', 'type', 'phone'], 'upload')).toEqual({
      ok: true,
      methods: null,
    });
  });

  /**
   * The invariant. A template with every method forbidden cannot be signed by
   * anybody, so the last one cannot be turned off here, cannot be saved by
   * lib/firm-templates.ts, and cannot be stored by the CHECK constraint in
   * 20260814_signature_methods.sql. This is the first of those three and the
   * only one the firm ever sees.
   */
  it('refuses to turn off the last enabled method', () => {
    expect(toggleSignatureMethod(['draw'], 'draw')).toEqual({
      ok: false,
      error: NO_METHOD_ENABLED_ERROR,
    });
  });

  it('keeps canonical order however the firm clicked', () => {
    const once = toggleSignatureMethod(['upload'], 'draw');
    expect(once).toEqual({ ok: true, methods: ['draw', 'upload'] });
  });
});

describe('SignatureMethodPicker', () => {
  const render = (value: Parameters<typeof SignatureMethodPicker>[0]['value']) =>
    renderToStaticMarkup(
      createElement(SignatureMethodPicker, { value, onChange: () => {} }),
    );

  it('offers every method by name', () => {
    const html = render(null);
    for (const m of SIGNATURE_METHODS) {
      expect(html).toContain(SIGNATURE_METHOD_LABELS[m]);
    }
  });

  it('checks all four when nothing is restricted', () => {
    const html = render(null);
    expect(html.match(/checked=""/g) ?? []).toHaveLength(SIGNATURE_METHODS.length);
  });

  it('checks only the methods a restriction names', () => {
    const html = render(['draw']);
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1);
  });

  /**
   * A firm that has turned three methods off is one click from an unsignable
   * template, and it should be told so before it gets there rather than by a
   * save that fails.
   */
  it('says the last method cannot be turned off when one is left', () => {
    expect(render(['draw'])).toContain(NO_METHOD_ENABLED_ERROR);
    expect(render(['draw', 'type'])).not.toContain(NO_METHOD_ENABLED_ERROR);
  });

  it('warns beside Upload that it is the weakest for attribution', () => {
    expect(render(null).toLowerCase()).toContain('attribution');
  });
});
