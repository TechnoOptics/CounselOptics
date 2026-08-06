import { describe, expect, it } from 'vitest';
import {
  SEEDED_REQUEST_TYPES,
  pickableRequestTypes,
  resolveRequestType,
  type FirmRequestType,
} from '../lib/request-types';

/**
 * The employee Hub renders these as clickable tiles, so each rule here
 * is load-bearing on what a firm's staff are shown:
 *
 *  - a 'client' type in an employee's grid offers them an outside-client
 *    matter they have no business filing;
 *  - a hidden type is one the firm deliberately retired;
 *  - the order is the firm's own, and it is what keeps the canonical
 *    twelve ahead of partner-app slugs.
 */

const t = (
  key: string,
  mode: 'client' | 'inhouse',
  sortOrder: number,
  hidden = false,
): FirmRequestType => ({ key, label: key.toUpperCase(), mode, sortOrder, hidden });

describe('pickableRequestTypes', () => {
  it('drops client-mode types from the employee list', () => {
    const rows = [t('matter', 'client', 0), t('nda', 'inhouse', 5)];
    expect(pickableRequestTypes(rows, 'inhouse').map((r) => r.key)).toEqual([
      'nda',
    ]);
  });

  it('drops hidden types', () => {
    const rows = [t('nda', 'inhouse', 5), t('retired', 'inhouse', 6, true)];
    expect(pickableRequestTypes(rows, 'inhouse').map((r) => r.key)).toEqual([
      'nda',
    ]);
  });

  it('orders by sort_order, so the seeded twelve precede partner slugs', () => {
    const rows = [
      t('partner-slug', 'inhouse', 101),
      t('other', 'inhouse', 11),
      t('contract', 'inhouse', 1),
    ];
    expect(pickableRequestTypes(rows, 'inhouse').map((r) => r.key)).toEqual([
      'contract',
      'other',
      'partner-slug',
    ]);
  });

  it('breaks a sort_order tie on label so the order is stable', () => {
    const rows = [t('zebra', 'inhouse', 101), t('alpha', 'inhouse', 101)];
    expect(pickableRequestTypes(rows, 'inhouse').map((r) => r.key)).toEqual([
      'alpha',
      'zebra',
    ]);
  });

  it('leaves exactly one client-mode type in the seeded defaults', () => {
    // The fallback list stands in for the live table when it cannot be
    // read, so it has to obey the same shape: New case / matter is the
    // only outside-client type, and the employee never sees it.
    const employee = pickableRequestTypes(SEEDED_REQUEST_TYPES, 'inhouse');
    expect(SEEDED_REQUEST_TYPES).toHaveLength(12);
    expect(employee).toHaveLength(11);
    expect(employee.some((r) => r.key === 'new_case_matter')).toBe(false);
  });
});

describe('resolveRequestType', () => {
  const types = pickableRequestTypes(SEEDED_REQUEST_TYPES, 'inhouse');

  it('resolves the label a tile links with', () => {
    expect(resolveRequestType(types, 'NDA review')?.key).toBe('nda_review');
  });

  it('resolves a key, so an older link still opens the right form', () => {
    expect(resolveRequestType(types, 'nda_review')?.label).toBe('NDA review');
  });

  it('returns null for a missing or unrecognised parameter', () => {
    expect(resolveRequestType(types, undefined)).toBeNull();
    expect(resolveRequestType(types, '  ')).toBeNull();
    expect(resolveRequestType(types, 'anything at all')).toBeNull();
  });

  it('never resolves a client-mode type from an employee list', () => {
    expect(resolveRequestType(types, 'New case / matter')).toBeNull();
  });
});
