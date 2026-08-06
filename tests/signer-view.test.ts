import { describe, it, expect } from 'vitest';
import {
  ASSUMED_PAGE_HEIGHT_PT,
  ASSUMED_PAGE_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_BOX_WIDTH_PT,
  SIGNER_COPY_REFUSAL_COPY,
  canLeaveDisclosureStep,
  createSignerFrameSrcRetainer,
  parseSignerDownloadPermission,
  resolveSignatureLinePlacement,
  resolveSignerCopyAccess,
  stableSignerFrameSrc,
} from '../lib/signer-view';

describe('stableSignerFrameSrc', () => {
  it('takes the incoming URL when nothing is retained yet', () => {
    expect(stableSignerFrameSrc(null, 'https://store/a.pdf?sig=1')).toBe(
      'https://store/a.pdf?sig=1',
    );
  });

  it('keeps the retained URL when a different one arrives', () => {
    expect(
      stableSignerFrameSrc('https://store/a.pdf?sig=1', 'https://store/a.pdf?sig=2'),
    ).toBe('https://store/a.pdf?sig=1');
  });

  it('keeps the retained URL when the incoming one goes missing', () => {
    expect(stableSignerFrameSrc('https://store/a.pdf?sig=1', null)).toBe(
      'https://store/a.pdf?sig=1',
    );
    expect(stableSignerFrameSrc('https://store/a.pdf?sig=1', '')).toBe(
      'https://store/a.pdf?sig=1',
    );
  });

  it('reports nothing when neither side has a URL', () => {
    expect(stableSignerFrameSrc(null, undefined)).toBeNull();
    expect(stableSignerFrameSrc('', '')).toBeNull();
  });
});

describe('createSignerFrameSrcRetainer', () => {
  it('holds the first usable URL across a sequence of renders', () => {
    const retain = createSignerFrameSrcRetainer();
    expect(retain('https://store/a.pdf?sig=1')).toBe('https://store/a.pdf?sig=1');
    expect(retain('https://store/a.pdf?sig=2')).toBe('https://store/a.pdf?sig=1');
    expect(retain('https://store/a.pdf?sig=3')).toBe('https://store/a.pdf?sig=1');
  });

  it('does not latch onto an empty first render', () => {
    const retain = createSignerFrameSrcRetainer();
    expect(retain(null)).toBeNull();
    expect(retain('https://store/a.pdf?sig=9')).toBe('https://store/a.pdf?sig=9');
  });

  it('is idempotent for a repeated argument (double / discarded render)', () => {
    const retain = createSignerFrameSrcRetainer();
    retain('https://store/a.pdf?sig=1');
    expect(retain('https://store/a.pdf?sig=1')).toBe('https://store/a.pdf?sig=1');
    expect(retain('https://store/a.pdf?sig=1')).toBe('https://store/a.pdf?sig=1');
  });

  it('gives each mount its own memory', () => {
    const a = createSignerFrameSrcRetainer();
    const b = createSignerFrameSrcRetainer();
    a('https://store/a.pdf?sig=1');
    expect(b('https://store/b.pdf?sig=1')).toBe('https://store/b.pdf?sig=1');
  });
});

describe('canLeaveDisclosureStep', () => {
  const base = {
    electronicRecordsAgreed: true,
    hardwareSoftwareAgreed: true,
    documentPresented: true,
    documentReviewed: true,
  };

  it('passes when all three affirmations are given', () => {
    expect(canLeaveDisclosureStep(base)).toBe(true);
  });

  it('still requires the electronic-records consent', () => {
    expect(
      canLeaveDisclosureStep({ ...base, electronicRecordsAgreed: false }),
    ).toBe(false);
  });

  it('still requires the hardware and software confirmation', () => {
    expect(
      canLeaveDisclosureStep({ ...base, hardwareSoftwareAgreed: false }),
    ).toBe(false);
  });

  it('blocks the pad until a presented document is acknowledged', () => {
    expect(canLeaveDisclosureStep({ ...base, documentReviewed: false })).toBe(
      false,
    );
  });

  it('does not ask for review of a document that was never shown', () => {
    expect(
      canLeaveDisclosureStep({
        ...base,
        documentPresented: false,
        documentReviewed: false,
      }),
    ).toBe(true);
  });
});

describe('resolveSignatureLinePlacement', () => {
  it('defers when no position was recorded', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: null,
        positionX: null,
        positionY: null,
      }),
    ).toEqual({ mode: 'deferred', reason: 'no-recorded-position' });
  });

  it('defers when only part of the position was recorded', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 2,
        positionX: 0.1,
        positionY: null,
      }).mode,
    ).toBe('deferred');
    expect(
      resolveSignatureLinePlacement({
        positionPage: null,
        positionX: 0.1,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('defers on a non-finite coordinate rather than drawing NaN', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 1,
        positionX: Number.NaN,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('defers on a page number below one', () => {
    expect(
      resolveSignatureLinePlacement({
        positionPage: 0,
        positionX: 0.1,
        positionY: 0.1,
      }).mode,
    ).toBe('deferred');
  });

  it('converts a recorded anchor from PDF space to CSS space', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 3,
      positionX: 0.25,
      positionY: 0.5,
      pageWidthPt: 600,
      pageHeightPt: 800,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed preview');
    expect(p.page).toBe(3);
    expect(p.leftPct).toBeCloseTo(25, 6);
    // PDF y is the bottom edge measured up; CSS top is the top edge
    // measured down, so top = 1 - (y + boxHeight/pageHeight).
    const heightFrac = SIGNATURE_BOX_HEIGHT_PT / 800;
    expect(p.topPct).toBeCloseTo((1 - (0.5 + heightFrac)) * 100, 6);
    expect(p.widthPct).toBeCloseTo((SIGNATURE_BOX_WIDTH_PT / 600) * 100, 6);
    expect(p.heightPct).toBeCloseTo(heightFrac * 100, 6);
    expect(p.pageGeometry).toBe('measured');
    expect(p.pageAspect).toBeCloseTo(600 / 800, 6);
  });

  it('falls back to Letter geometry when the page was not measured', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.1,
      positionY: 0.1,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed preview');
    expect(p.pageGeometry).toBe('assumed');
    expect(p.widthPct).toBeCloseTo(
      (SIGNATURE_BOX_WIDTH_PT / ASSUMED_PAGE_WIDTH_PT) * 100,
      6,
    );
    expect(p.heightPct).toBeCloseTo(
      (SIGNATURE_BOX_HEIGHT_PT / ASSUMED_PAGE_HEIGHT_PT) * 100,
      6,
    );
  });

  it('clamps an out-of-range anchor the same way the renderer does', () => {
    const p = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 1.4,
      positionY: -0.3,
      pageWidthPt: 600,
      pageHeightPt: 800,
    });
    if (p.mode !== 'placed') throw new Error('expected a placed preview');
    // x clamps to 1, then the box is pulled back inside the page.
    expect(p.leftPct).toBeCloseTo((1 - SIGNATURE_BOX_WIDTH_PT / 600) * 100, 6);
    // y clamps to 0, which is the bottom edge of the page.
    expect(p.topPct).toBeCloseTo((1 - SIGNATURE_BOX_HEIGHT_PT / 800) * 100, 6);
  });

  it('never lets the preview box escape its page schematic', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [0.999, 0.999],
      [0.5, 0.97],
    ]) {
      const p = resolveSignatureLinePlacement({
        positionPage: 1,
        positionX: x,
        positionY: y,
        pageWidthPt: 612,
        pageHeightPt: 792,
      });
      if (p.mode !== 'placed') throw new Error('expected a placed preview');
      expect(p.leftPct).toBeGreaterThanOrEqual(0);
      expect(p.topPct).toBeGreaterThanOrEqual(0);
      expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100.0001);
      expect(p.topPct + p.heightPct).toBeLessThanOrEqual(100.0001);
    }
  });
});

describe('parseSignerDownloadPermission', () => {
  it('defaults to permitted when the firm has not said otherwise', () => {
    expect(parseSignerDownloadPermission(undefined)).toBe(true);
    expect(parseSignerDownloadPermission(null)).toBe(true);
  });

  it('honours an explicit refusal', () => {
    expect(parseSignerDownloadPermission(false)).toBe(false);
    expect(parseSignerDownloadPermission('false')).toBe(false);
    expect(parseSignerDownloadPermission('f')).toBe(false);
    expect(parseSignerDownloadPermission(0)).toBe(false);
  });

  it('honours an explicit permission', () => {
    expect(parseSignerDownloadPermission(true)).toBe(true);
    expect(parseSignerDownloadPermission('true')).toBe(true);
    expect(parseSignerDownloadPermission('t')).toBe(true);
    expect(parseSignerDownloadPermission(1)).toBe(true);
  });
});

describe('resolveSignerCopyAccess', () => {
  const base = {
    downloadPermitted: true,
    signedAt: '2026-08-06T10:00:00.000Z',
    requestStatus: 'completed',
    accessCodeRequired: false,
    accessVerifiedAt: null,
    signedFilePath: 'signed/req-1/final.pdf',
    sourceFilePath: 'firm-1/contract.pdf',
  };

  it('serves the executed PDF once it exists', () => {
    expect(resolveSignerCopyAccess(base)).toEqual({
      allowed: true,
      path: 'signed/req-1/final.pdf',
      kind: 'executed',
    });
  });

  it('falls back to the document the signer reviewed', () => {
    expect(
      resolveSignerCopyAccess({ ...base, signedFilePath: null }),
    ).toEqual({
      allowed: true,
      path: 'firm-1/contract.pdf',
      kind: 'as-signed',
    });
  });

  it('refuses when the firm turned downloads off', () => {
    expect(
      resolveSignerCopyAccess({ ...base, downloadPermitted: false }),
    ).toEqual({ allowed: false, reason: 'not-permitted' });
  });

  it('refuses before the signer has signed', () => {
    expect(resolveSignerCopyAccess({ ...base, signedAt: null })).toEqual({
      allowed: false,
      reason: 'not-signed',
    });
  });

  it('refuses a recalled request even to someone who already signed', () => {
    expect(
      resolveSignerCopyAccess({ ...base, requestStatus: 'canceled' }),
    ).toEqual({ allowed: false, reason: 'canceled' });
  });

  it('refuses an unverified access code before anything else', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        accessCodeRequired: true,
        accessVerifiedAt: null,
      }),
    ).toEqual({ allowed: false, reason: 'code-required' });
  });

  it('serves a verified access-code link normally', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        accessCodeRequired: true,
        accessVerifiedAt: '2026-08-06T09:00:00.000Z',
      }).allowed,
    ).toBe(true);
  });

  it('refuses when no file path is recorded at all', () => {
    expect(
      resolveSignerCopyAccess({
        ...base,
        signedFilePath: null,
        sourceFilePath: null,
      }),
    ).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('has calm wording for every refusal it can return', () => {
    const reasons = [
      'code-required',
      'canceled',
      'not-signed',
      'not-permitted',
      'unavailable',
    ] as const;
    for (const reason of reasons) {
      expect(SIGNER_COPY_REFUSAL_COPY[reason]).toBeTruthy();
      expect(SIGNER_COPY_REFUSAL_COPY[reason]).not.toMatch(/[—–]/);
    }
  });
});
