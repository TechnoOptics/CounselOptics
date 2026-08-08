import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_LAYOUT_UNSAVED_ERROR,
  resolveDocumentLayoutColumnFallback,
} from '../lib/template-document-layout';

/**
 * The same shape as resolveDownloadColumnFallback and
 * resolveDeliveryModeColumnFallback, and for the same reason: the column
 * arrives with a migration the owner applies, so between merge and apply the
 * write comes back with the column unknown and something has to decide whether
 * dropping it is survivable.
 */

const missing = { code: 'PGRST204', message: "Could not find the 'document_layout' column" };
const missingFromPostgres = { code: '42703', message: 'column "document_layout" does not exist' };

describe('resolveDocumentLayoutColumnFallback', () => {
  it('lets a template with no override save without the column', () => {
    // Nothing is lost. A template with no override renders on the firm
    // default, which is exactly what an absent column reads as.
    expect(resolveDocumentLayoutColumnFallback({ hasOverride: false, error: missing })).toBe(
      'retry-without-column',
    );
  });

  it('refuses to save a template that DOES set an override', () => {
    // Saving anyway would report success and hand back a template whose
    // layout is the firm default, which is not what the author configured and
    // not what they would be shown.
    expect(resolveDocumentLayoutColumnFallback({ hasOverride: true, error: missing })).toBe(
      'abort-layout-unsaved',
    );
  });

  it('recognises the Postgres error as well as the PostgREST one', () => {
    expect(
      resolveDocumentLayoutColumnFallback({ hasOverride: true, error: missingFromPostgres }),
    ).toBe('abort-layout-unsaved');
  });

  it('surfaces anything that is not a missing column', () => {
    // A permission error or a constraint violation swallowed the same way
    // would drop a real failure on the floor and save the template anyway.
    expect(
      resolveDocumentLayoutColumnFallback({
        hasOverride: false,
        error: { code: '42501', message: 'permission denied for table firm_templates' },
      }),
    ).toBe('surface-error');
    expect(resolveDocumentLayoutColumnFallback({ hasOverride: false, error: null })).toBe(
      'surface-error',
    );
  });

  it('does not mistake another missing column for this one', () => {
    expect(
      resolveDocumentLayoutColumnFallback({
        hasOverride: true,
        error: { code: 'PGRST204', message: "Could not find the 'delivery_mode' column" },
      }),
    ).toBe('surface-error');
  });

  it('names the fix and who can make it, because the author cannot', () => {
    expect(DOCUMENT_LAYOUT_UNSAVED_ERROR).toMatch(/administrator/i);
    expect(DOCUMENT_LAYOUT_UNSAVED_ERROR).toMatch(/not saved/i);
  });
});
