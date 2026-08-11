import { describe, expect, it } from 'vitest';

import {
  CASE_MODES,
  caseModeDecision,
  caseModeIsLitigation,
  type CaseModeInput,
} from '../lib/case-mode';

/*
 * The owner, looking at a routine employee request rendered as a litigation
 * workbench: "Please only use this screen if there is a court case, or the firm
 * has selected build a case."
 *
 * These are the claims that (a) simple is the DEFAULT, (b) a court date opens
 * the case file on its own, and (c) a person's answer beats the court date in
 * BOTH directions - because a matter switched back must stay switched back even
 * though the hearing that opened it is still on the record.
 */

const base: CaseModeInput = {
  litigationMode: null,
  hearingAt: null,
  hearingLocation: null,
};

describe('the default is the simple matter page', () => {
  it('gives a routine request the simple view', () => {
    expect(caseModeDecision(base)).toEqual({ mode: 'simple', source: 'default' });
  });

  it('is simple for a matter nobody has decided about and no court has a date for', () => {
    expect(caseModeIsLitigation(base)).toBe(false);
  });

  it('treats an empty-string hearing location as no hearing', () => {
    // The matter form posts '' for a field left blank, so a stored empty string
    // is what "no courtroom" actually looks like in this column.
    expect(
      caseModeDecision({ ...base, hearingLocation: '   ' }),
    ).toEqual({ mode: 'simple', source: 'default' });
  });
});

describe('trigger one: there is a court case', () => {
  it('opens the case file when a hearing date is on the matter', () => {
    expect(
      caseModeDecision({ ...base, hearingAt: '2026-09-01T09:00:00Z' }),
    ).toEqual({ mode: 'litigation', source: 'hearing' });
  });

  it('opens it for a courtroom recorded without a date', () => {
    expect(
      caseModeDecision({ ...base, hearingLocation: 'Dept 14, Superior Court' }),
    ).toEqual({ mode: 'litigation', source: 'hearing' });
  });
});

describe('trigger two: the firm selected build a case', () => {
  it('opens the case file on an explicit true, with no hearing anywhere', () => {
    expect(caseModeDecision({ ...base, litigationMode: true })).toEqual({
      mode: 'litigation',
      source: 'explicit',
    });
  });

  it('closes it on an explicit false', () => {
    expect(caseModeDecision({ ...base, litigationMode: false })).toEqual({
      mode: 'simple',
      source: 'explicit',
    });
  });
});

describe('a person beats the signal, in both directions', () => {
  it('keeps a matter simple after it is switched back, hearing date and all', () => {
    // The whole point of "switched back". Inferring from the hearing here would
    // make the control unable to do the only thing it is for.
    expect(
      caseModeDecision({
        litigationMode: false,
        hearingAt: '2026-09-01T09:00:00Z',
        hearingLocation: 'Dept 14',
      }),
    ).toEqual({ mode: 'simple', source: 'explicit' });
  });

  it('keeps a matter open when a person opened it and the court date was removed', () => {
    expect(
      caseModeDecision({ ...base, litigationMode: true }),
    ).toEqual({ mode: 'litigation', source: 'explicit' });
  });
});

describe('reading a column that may not exist yet', () => {
  /*
   * The migration adding cases.litigation_mode is written but NOT applied, and
   * applying it is the owner's step. Until then the reader cannot select the
   * column at all and hands the resolver `undefined`. That must resolve exactly
   * as `null` does, or every matter in the product changes shape on deploy
   * rather than on migration.
   */
  it('treats undefined the same as never-decided', () => {
    expect(caseModeDecision({ ...base, litigationMode: undefined })).toEqual({
      mode: 'simple',
      source: 'default',
    });
    expect(
      caseModeDecision({
        ...base,
        litigationMode: undefined,
        hearingAt: '2026-09-01T09:00:00Z',
      }),
    ).toEqual({ mode: 'litigation', source: 'hearing' });
  });
});

describe('the resolver is pure and total', () => {
  it('names exactly two modes', () => {
    expect([...CASE_MODES].sort()).toEqual(['litigation', 'simple']);
  });

  it('always returns one of them, whatever it is handed', () => {
    for (const litigationMode of [true, false, null, undefined]) {
      for (const hearingAt of [null, '', '2026-09-01T09:00:00Z']) {
        for (const hearingLocation of [null, '', 'Dept 14']) {
          const d = caseModeDecision({ litigationMode, hearingAt, hearingLocation });
          expect(CASE_MODES).toContain(d.mode);
          expect(caseModeIsLitigation({ litigationMode, hearingAt, hearingLocation })).toBe(
            d.mode === 'litigation',
          );
        }
      }
    }
  });
});
