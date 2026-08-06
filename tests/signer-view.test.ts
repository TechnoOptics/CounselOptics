import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ASSUMED_PAGE_HEIGHT_PT,
  ASSUMED_PAGE_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_BOX_WIDTH_PT,
  SIGNER_COPY_REFUSAL_COPY,
  SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR,
  canLeaveDisclosureStep,
  createSignerFrameSrcRetainer,
  isUnknownColumnError,
  parseSignerDownloadPermission,
  projectSignerConsentMetadata,
  resolveDownloadColumnFallback,
  resolveSignatureLinePlacement,
  resolveSignerCopyAccess,
  signaturePreviewGeometryNote,
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

  // A document that failed to load is the exact case where the signer
  // has not read what they are being asked to sign, so the step does
  // not open. It is not softened by the review checkbox being absent.
  it('does not open at all when the document never loaded', () => {
    expect(
      canLeaveDisclosureStep({
        ...base,
        documentPresented: false,
        documentReviewed: false,
      }),
    ).toBe(false);
  });

  it('stays shut on a failed load even if review is somehow claimed', () => {
    expect(
      canLeaveDisclosureStep({
        ...base,
        documentPresented: false,
        documentReviewed: true,
      }),
    ).toBe(false);
  });
});

describe('signaturePreviewGeometryNote', () => {
  const assumed = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.7,
    positionY: 0.1,
  });
  const measured = resolveSignatureLinePlacement({
    positionPage: 1,
    positionX: 0.7,
    positionY: 0.1,
    pageWidthPt: 595,
    pageHeightPt: 842,
  });

  it('admits the guess when the page was never measured', () => {
    const note = signaturePreviewGeometryNote(assumed);
    expect(note).toBeTruthy();
    expect(note).toMatch(/letter-size/i);
  });

  it('says nothing when the page WAS measured', () => {
    expect(signaturePreviewGeometryNote(measured)).toBeNull();
  });

  it('says nothing when there is no placement to qualify', () => {
    expect(
      signaturePreviewGeometryNote({
        mode: 'deferred',
        reason: 'no-recorded-position',
      }),
    ).toBeNull();
  });

  it('is calm and carries no em dash', () => {
    expect(signaturePreviewGeometryNote(assumed)).not.toMatch(/[—–]/);
  });

  // The reason the note exists. Below the threshold the assumed page
  // width changes nothing about the position; above it, the clamp
  // engages on the assumed width and the drawn position parts company
  // with where the renderer will actually put the box.
  it('covers a position the assumed page size actually moves', () => {
    const threshold = 1 - SIGNATURE_BOX_WIDTH_PT / ASSUMED_PAGE_WIDTH_PT;
    const below = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: threshold - 0.05,
      positionY: 0.1,
    });
    const belowMeasured = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: threshold - 0.05,
      positionY: 0.1,
      pageWidthPt: 842,
      pageHeightPt: 595,
    });
    if (below.mode !== 'placed' || belowMeasured.mode !== 'placed') {
      throw new Error('expected placed previews');
    }
    expect(below.leftPct).toBeCloseTo(belowMeasured.leftPct, 6);

    const above = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.75,
      positionY: 0.1,
    });
    const aboveMeasured = resolveSignatureLinePlacement({
      positionPage: 1,
      positionX: 0.75,
      positionY: 0.1,
      pageWidthPt: 842,
      pageHeightPt: 595,
    });
    if (above.mode !== 'placed' || aboveMeasured.mode !== 'placed') {
      throw new Error('expected placed previews');
    }
    expect(Math.abs(above.leftPct - aboveMeasured.leftPct)).toBeGreaterThan(1);
    // Which is precisely the case the note has to be present for.
    expect(signaturePreviewGeometryNote(above)).toBeTruthy();
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

describe('isUnknownColumnError', () => {
  it('recognises the PostgREST schema-cache miss', () => {
    expect(
      isUnknownColumnError(
        {
          code: 'PGRST204',
          message:
            "Could not find the 'signer_can_download' column of 'firm_signing_requests' in the schema cache",
        },
        'signer_can_download',
      ),
    ).toBe(true);
  });

  it('recognises the Postgres undefined_column code', () => {
    expect(
      isUnknownColumnError(
        { code: '42703', message: 'column "signer_can_download" does not exist' },
        'signer_can_download',
      ),
    ).toBe(true);
  });

  it('does not swallow a permission failure', () => {
    expect(
      isUnknownColumnError(
        { code: '42501', message: 'permission denied for table firm_signing_requests' },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not swallow a constraint violation', () => {
    expect(
      isUnknownColumnError(
        { code: '23514', message: 'new row violates check constraint' },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  // The column name appearing in the message is not enough on its own.
  // These are the errors that name the column while meaning something
  // entirely different, and retrying without the column would send the
  // request while hiding a real failure.
  it('does not swallow a permission failure that names the column', () => {
    expect(
      isUnknownColumnError(
        {
          code: '42501',
          message: 'permission denied for column signer_can_download',
        },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not swallow a not-null violation that names the column', () => {
    expect(
      isUnknownColumnError(
        {
          code: '23502',
          message:
            'null value in column "signer_can_download" violates not-null constraint',
        },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('does not fire for a different missing column', () => {
    expect(
      isUnknownColumnError(
        { code: 'PGRST204', message: "Could not find the 'due_at' column" },
        'signer_can_download',
      ),
    ).toBe(false);
  });

  it('reports false for no error at all', () => {
    expect(isUnknownColumnError(null, 'signer_can_download')).toBe(false);
    expect(isUnknownColumnError(undefined, 'signer_can_download')).toBe(false);
  });
});

describe('resolveDownloadColumnFallback', () => {
  const missing = {
    code: 'PGRST204',
    message:
      "Could not find the 'signer_can_download' column of 'firm_signing_requests' in the schema cache",
  };

  it('sends without the column when downloads were allowed anyway', () => {
    expect(
      resolveDownloadColumnFallback({ signerCanDownload: true, error: missing }),
    ).toBe('retry-without-column');
  });

  // The one that matters. Retrying without the column would send the
  // request with the document downloadable by exactly the person the
  // firm chose to withhold it from, and a warning afterwards does not
  // put it back.
  it('refuses to send when the firm restricted downloads and it cannot be saved', () => {
    expect(
      resolveDownloadColumnFallback({
        signerCanDownload: false,
        error: missing,
      }),
    ).toBe('abort-restriction-unsaved');
  });

  it('does the same for the Postgres undefined_column code', () => {
    expect(
      resolveDownloadColumnFallback({
        signerCanDownload: false,
        error: {
          code: '42703',
          message: 'column "signer_can_download" does not exist',
        },
      }),
    ).toBe('abort-restriction-unsaved');
  });

  it('surfaces anything that is not a missing column', () => {
    for (const canDownload of [true, false]) {
      expect(
        resolveDownloadColumnFallback({
          signerCanDownload: canDownload,
          error: {
            code: '42501',
            message: 'permission denied for column signer_can_download',
          },
        }),
      ).toBe('surface-error');
      expect(
        resolveDownloadColumnFallback({
          signerCanDownload: canDownload,
          error: null,
        }),
      ).toBe('surface-error');
    }
  });

  it('tells the firm plainly, and calmly, why nothing was sent', () => {
    expect(SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR).toMatch(/was not sent/i);
    expect(SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR).not.toMatch(/[—–]/);
  });
});

describe('projectSignerConsentMetadata', () => {
  const full = {
    electronicRecordsConsentedAt: '2026-08-06T10:00:00.000Z',
    hardwareSoftwareConfirmedAt: '2026-08-06T10:00:00.000Z',
    documentPresented: true,
    documentReviewedAt: '2026-08-06T10:00:05.000Z',
    intentAffirmedAt: '2026-08-06T10:01:00.000Z',
    uaSnapshot: 'Mozilla/5.0',
    tzOffsetMinutes: -60,
  };

  it('records nothing when the signer sent no consent block', () => {
    expect(projectSignerConsentMetadata(undefined)).toBeNull();
    expect(projectSignerConsentMetadata(null)).toBeNull();
  });

  // The whole reason the document-review gate exists is to produce
  // this evidence. Dropped here, the checkbox is theatre: the chain
  // still verifies and the absence looks like a signer never asked.
  it('carries the document-review affirmation into the chain', () => {
    const record = projectSignerConsentMetadata(full);
    expect(record?.document_presented).toBe(true);
    expect(record?.document_reviewed_at).toBe('2026-08-06T10:00:05.000Z');
  });

  it('still carries the electronic-records and intent affirmations', () => {
    expect(projectSignerConsentMetadata(full)).toEqual({
      electronic_records_consented_at: '2026-08-06T10:00:00.000Z',
      hardware_software_confirmed_at: '2026-08-06T10:00:00.000Z',
      document_presented: true,
      document_reviewed_at: '2026-08-06T10:00:05.000Z',
      intent_affirmed_at: '2026-08-06T10:01:00.000Z',
      ua_snapshot: 'Mozilla/5.0',
      tz_offset_minutes: -60,
    });
  });

  it('does not claim a review that was not affirmed', () => {
    const record = projectSignerConsentMetadata({
      ...full,
      documentPresented: false,
      documentReviewedAt: null,
    });
    expect(record?.document_presented).toBe(false);
    expect(record?.document_reviewed_at).toBeNull();
  });

  it('reads a merely truthy presented flag as not presented', () => {
    const record = projectSignerConsentMetadata({
      // A client posting anything other than true is not evidence of
      // presentation, so it does not become evidence in the chain.
      documentPresented: 'yes' as unknown as boolean,
    });
    expect(record?.document_presented).toBe(false);
  });

  it('normalises missing fields to null rather than dropping the key', () => {
    const record = projectSignerConsentMetadata({});
    expect(record).not.toBeNull();
    expect(Object.keys(record ?? {}).sort()).toEqual([
      'document_presented',
      'document_reviewed_at',
      'electronic_records_consented_at',
      'hardware_software_confirmed_at',
      'intent_affirmed_at',
      'tz_offset_minutes',
      'ua_snapshot',
    ]);
    expect(record?.intent_affirmed_at).toBeNull();
    expect(record?.tz_offset_minutes).toBeNull();
  });

  it('keeps a zero timezone offset rather than nulling it', () => {
    expect(
      projectSignerConsentMetadata({ tzOffsetMinutes: 0 })?.tz_offset_minutes,
    ).toBe(0);
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

/**
 * The rules above are pure and fully covered. Their CALL SITES are not:
 * a route handler, a server action, and two React components that the
 * node test environment cannot run. The failure that started this round
 * was exactly there, in wiring rather than in a rule: the page captured
 * the document-review affirmation, the rule was right, and the route
 * quietly projected five keys and dropped it.
 *
 * So these read the source. That is a weak test and it is said plainly:
 * it proves the call is written, not that it runs. It is here because a
 * decision no caller uses is worth less than no decision at all, and
 * because the specific regressions it catches (re-inlining the consent
 * literal, dropping the abort branch, letting the geometry admission go
 * dead again, going back to a raw target="_blank") are all silent.
 */
describe('call sites', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', rel), 'utf8');

  it('has the sign route project the consent through one function', () => {
    const src = read('app/api/firm/sign/route.ts');
    expect(src).toMatch(/projectSignerConsentMetadata\(payload\.consent\)/);
    // The old hand-rolled literal is what dropped the review keys.
    expect(src).not.toMatch(/electronic_records_consented_at:/);
  });

  it('has the composer abort rather than send a restriction it lost', () => {
    const src = read('lib/firm-actions.ts');
    expect(src).toMatch(/resolveDownloadColumnFallback\(/);
    expect(src).toMatch(
      /abort-restriction-unsaved'\)?[\s\S]{0,120}SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR/,
    );
  });

  it('has the preview actually show the geometry admission', () => {
    const src = read('app/sign/[token]/signature-line-preview.tsx');
    expect(src).toMatch(/signaturePreviewGeometryNote\(placement\)/);
    expect(src).toMatch(/\{geometryNote/);
  });

  it('has the document view open new tabs through ExternalLink', () => {
    const src = read('app/sign/[token]/document-view.tsx');
    expect(src).toMatch(/<ExternalLink\b/);
    // A raw _blank anchor is the thing that no-ops in the native shell.
    // The prose above the component names it, so this looks for the tag.
    expect(src).not.toMatch(/<a\b[^>]*target="_blank"/s);
    // The signer is told what the frame's URL is good for.
    expect(src).toMatch(/SIGNER_DOCUMENT_URL_TTL_MINUTES/);
  });

  it('has the capture step refuse to open on a failed document load', () => {
    const src = read('app/sign/[token]/signature-capture.tsx');
    expect(src).toMatch(/canLeaveDisclosureStep\(/);
    expect(src).toMatch(/disabled=\{!mayLeaveDisclosure\}/);
    expect(src).toMatch(/documentPresented,\s*\n\s*documentReviewedAt/);
  });
});
