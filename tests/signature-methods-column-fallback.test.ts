import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_METHODS_UNSAVED_ERROR,
  resolveSignatureMethodsColumnFallback,
} from '../lib/submission-dispatch';

/**
 * What to do when a write carrying signature_methods fails because the column
 * is not there.
 *
 * 20260814_signature_methods.sql is written and NOT applied, and there is a
 * further window after it runs while PostgREST holds a stale schema cache. So
 * this failure is expected, not exotic, and the retry is right in exactly one
 * direction.
 *
 * Widening is safe: an absent column reads as "all four allowed", so a firm
 * that chose all four gets what it chose. Restricting is not. Dropping the
 * column there would store a template the firm believes forbids uploads and
 * which in fact accepts them, and they would find that out from an executed
 * instrument carrying an uploaded image they had refused. Nothing about that
 * is recoverable, so it aborts.
 *
 * This is the same shape as resolveDeliveryModeColumnFallback beside it and as
 * resolveDownloadColumnFallback in lib/signer-view.ts, and deliberately so.
 */

const missing = {
  code: 'PGRST204',
  message: "Could not find the 'signature_methods' column of 'firm_templates'",
};

describe('resolveSignatureMethodsColumnFallback', () => {
  it('retries without the column when nothing was being restricted', () => {
    expect(
      resolveSignatureMethodsColumnFallback({ methods: null, error: missing }),
    ).toBe('retry-without-column');
  });

  it('refuses to save a restriction the column cannot hold', () => {
    expect(
      resolveSignatureMethodsColumnFallback({ methods: ['draw'], error: missing }),
    ).toBe('abort-restriction-unsaved');
  });

  /**
   * Narrowly scoped, for the reason every other resolver of this shape is. A
   * permission failure or a dropped connection is not "this database has no
   * such column", and reading it as one would silently drop a restriction the
   * firm had chosen.
   */
  it('surfaces anything that is not a missing column', () => {
    for (const error of [
      { code: '42501', message: 'permission denied for table firm_templates' },
      { code: 'PGRST204', message: "Could not find the 'delivery_mode' column" },
      null,
      undefined,
    ]) {
      expect(
        resolveSignatureMethodsColumnFallback({ methods: ['draw'], error }),
      ).toBe('surface-error');
    }
  });

  it('says plainly that nothing was saved', () => {
    expect(SIGNATURE_METHODS_UNSAVED_ERROR).toContain('not saved');
  });
});
