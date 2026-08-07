/**
 * Pure decisions behind the public signer page (/sign/[token]).
 *
 * The page itself is a server component and the capture surface is a
 * client component, neither of which the node test environment can
 * render. So every rule that could be wrong on its own lives here,
 * as a function over plain values, and the components are the thin
 * wiring around it.
 *
 * Six rules live here:
 *
 *   1. When the signer may leave the disclosure step
 *      (canLeaveDisclosureStep).
 *   2. Where the signature is drawn, if anywhere
 *      (resolveSignatureLinePlacement), and what the drawing has to
 *      admit about its own accuracy (signaturePreviewGeometryNote,
 *      signatureRelocationNote). The placement arithmetic itself is
 *      not here: it is lib/signature-geometry.ts, shared with
 *      lib/signature-render.ts so the two cannot drift.
 *   3. Whether the signer may download a copy, and of what
 *      (parseSignerDownloadPermission / resolveSignerCopyAccess).
 *   4. What of the signer's affirmations reaches the audit chain
 *      (projectSignerConsentMetadata).
 *   5. Everything about rasterising the document in the browser that is
 *      a decision rather than a canvas call: who may fetch the bytes
 *      (resolveSignerDocumentAccess), whether the file is one this
 *      device should attempt (resolveDocumentSizeAcceptance) and how a
 *      file that is not gets refused and read back
 *      (resolveDocumentSizeRefusal / resolveDocumentResponseFailure),
 *      how big the backing canvas may be (resolveCanvasRenderScale),
 *      which page is on screen (clampSignerPageNumber), how long the
 *      page may sit on "opening" before that counts as a failure
 *      (SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS), whether the render
 *      actually drew everything the page asked for
 *      (firstDroppedRenderObject), and what a failure says to the
 *      signer (SIGNER_DOCUMENT_RENDER_COPY).
 *   6. What the bytes are being asked FOR, and therefore whether the
 *      firm's download decision withholds them
 *      (classifyDocumentRequestPurpose / resolveSignerDocumentDelivery),
 *      and how this page attributes itself to the person reading it
 *      (signerWatermarkStamp).
 *   7. Whether an internal signer, who gets no access code, is actually
 *      the person the signature row names (resolveInternalSignerGate).
 *      Until this existed the durable link alone was enough to sign as
 *      an employee.
 *
 * Another used to live here: which URL a mounted document frame shows.
 * It is gone with the frame. The page no longer mints a signed storage
 * URL for the browser at all, so there is no freshly minted URL for a
 * re-render to write into an iframe src, and nothing to retain.
 */

import {
  computeSignatureBoxRect,
  resolveSignaturePageIndex,
} from './signature-geometry';

// ---------------------------------------------------------------------
// 1. Leaving the disclosure step
// ---------------------------------------------------------------------

/**
 * The disclosure step already required two affirmations: consent to
 * electronic records, and confirmation of the hardware and software
 * needed to read them. Both stay exactly as they were.
 *
 * When the document is actually on the page above the ceremony, a
 * third affirmation is added: that the signer has reviewed it. E-SIGN
 * at 15 USC 7001 and UETA both rest on the signer having access to the
 * record they are assenting to, and an acknowledgement is the only
 * signal available to us about whether they read it.
 *
 * When the document could NOT be presented the review affirmation is
 * not ASKED FOR, because requiring an acknowledgement of something the
 * signer was never shown would be a fiction the audit chain would then
 * carry. But the step does not open either. A failed render is
 * precisely the case where the signer has not seen the record, and the
 * whole point of showing the document is that nobody signs one they
 * have not read. So the ceremony stops there and the page tells them
 * to ask the firm for the document.
 *
 * What this does and does not prove, stated here because the field
 * name invites the stronger reading. `documentPresented` is now
 * isDocumentPresented(status), which is true only when the rasteriser
 * put a page of this PDF onto a canvas in this browser. That is a
 * stronger claim than the page could make when the document lived in a
 * cross-origin frame that reported nothing back: a phone that
 * downloaded the file instead of displaying it used to read as
 * presented and no longer does. It is still not proof the signer
 * LOOKED at it, and nothing on a web page can be. The affirmation is
 * the signer's own statement, which is what E-SIGN rests on anyway.
 */
export function canLeaveDisclosureStep(input: {
  electronicRecordsAgreed: boolean;
  hardwareSoftwareAgreed: boolean;
  documentPresented: boolean;
  documentReviewed: boolean;
}): boolean {
  if (!input.electronicRecordsAgreed) return false;
  if (!input.hardwareSoftwareAgreed) return false;
  if (!input.documentPresented) return false;
  if (!input.documentReviewed) return false;
  return true;
}

// ---------------------------------------------------------------------
// 2. Where the signature is drawn
// ---------------------------------------------------------------------

/**
 * Default signature box, in PDF points, re-exported from the module
 * the renderer itself uses.
 *
 * These used to be declared here as their own literals, "mirrored" from
 * lib/signature-render.ts. A mirror is only as good as the next person
 * who edits one side of it, and the whole contract of this section is
 * that the preview cannot disagree with the executed copy. So the
 * numbers, and the placement arithmetic below, now come from
 * lib/signature-geometry.ts, which is what the renderer calls.
 */
export {
  SIGNATURE_BOX_WIDTH_PT,
  SIGNATURE_BOX_HEIGHT_PT,
  SIGNATURE_CAPTION_BAND_PT,
} from './signature-geometry';

/** US Letter, used only when the real page size was not measured. */
export const ASSUMED_PAGE_WIDTH_PT = 612;
export const ASSUMED_PAGE_HEIGHT_PT = 792;

export type SignatureLinePlacement =
  | {
      mode: 'placed';
      /** 1-indexed page the signature lands on. */
      page: number;
      /** True when the recorded page is past the end of the document
       *  and the renderer will therefore fall back to page one. */
      pageFellBackToFirst: boolean;
      /** Box rectangle as percentages of the page, CSS orientation
       *  (origin top-left) so a component can position it directly.
       *  These are the renderer's numbers, not a tidied version of
       *  them. The renderer now keeps the box on the page, so these
       *  stay within [0, 100] rather than running past the frame. */
      leftPct: number;
      topPct: number;
      widthPct: number;
      heightPct: number;
      /** Page aspect (width / height), for a page outline. */
      pageAspect: number;
      /** Whether the page size was measured or assumed to be Letter. */
      pageGeometry: 'measured' | 'assumed';
      /** True when the recorded anchor did not fit and the renderer
       *  will move the box to get the whole mark onto the page. */
      relocatedToFit: boolean;
      /** True when the page is too small for a full-size box and the
       *  renderer will shrink it. */
      shrunkToFit: boolean;
      /** How far the box moves, in points, on each axis. Signed, and
       *  zero on both when nothing moved. */
      relocationDxPt: number;
      relocationDyPt: number;
    }
  | {
      mode: 'deferred';
      reason: 'no-recorded-position';
    };

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Decide where, if anywhere, the signer's mark is drawn.
 *
 * The contract is that this cannot disagree with the final render, so
 * it does not reimplement the render's arithmetic, it CALLS it:
 * computeSignatureBoxRect and resolveSignaturePageIndex out of
 * lib/signature-geometry.ts are the same two functions
 * lib/signature-render.ts calls to place the stamp. All that happens
 * here is the conversion from PDF points with the origin at the
 * bottom-left to CSS percentages with the origin at the top-left.
 *
 * The history of this function is worth keeping, because it has been
 * wrong in both directions. It first clamped the box into the page
 * itself, which was wrong twice over: the renderer did no such clamp,
 * so above x = 1 - 220/pageW the drawing and the executed copy parted
 * company by as much as a third of the page width, and the clamp was
 * computed from an ASSUMED page width so it engaged at a fixed
 * x = 1 - 220/612 whatever the real page was. It was then changed to
 * draw the box hanging off the page, which was right at the time: that
 * is what the executed copy showed, with the overflow silently dropped
 * by pdf-lib.
 *
 * The renderer has since been fixed to keep the whole mark on the page
 * (see lib/signature-geometry.ts), which makes the hanging-off drawing
 * wrong in turn, and makes the warning that went with it actively
 * false: it told the signer part of their signature would be invisible
 * on the signed copy, and now none of it is. Rather than track a third
 * bespoke version of the same arithmetic, the shared module is the
 * single answer for both surfaces, and the note below reports a move
 * rather than a loss.
 *
 * When a coordinate was never recorded, this returns 'deferred'
 * instead of a position. The renderer does have a hard-coded default
 * for that case (0.07, 0.07 on page 1), but that default is an
 * arbitrary corner rather than a detected signature line, and showing
 * it to the signer would present a guess as a fact. The honest answer
 * is to say the placement happens on completion.
 */
export function resolveSignatureLinePlacement(input: {
  positionPage: number | null | undefined;
  positionX: number | null | undefined;
  positionY: number | null | undefined;
  pageWidthPt?: number | null;
  pageHeightPt?: number | null;
  /** Total pages, once the document has been parsed. */
  pageCount?: number | null;
}): SignatureLinePlacement {
  const { positionPage, positionX, positionY } = input;
  if (!finite(positionPage) || !finite(positionX) || !finite(positionY)) {
    return { mode: 'deferred', reason: 'no-recorded-position' };
  }
  const recordedPage = Math.floor(positionPage);
  if (recordedPage < 1) return { mode: 'deferred', reason: 'no-recorded-position' };

  // The renderer's own page fallback: a recorded page past the end of
  // the document stamps onto page one. Only knowable once the document
  // has been parsed, which is why the count is optional here and the
  // fallback is reported as not-happening until it is known.
  const knownPageCount = finite(input.pageCount) && input.pageCount >= 1;
  const pageResolution = knownPageCount
    ? resolveSignaturePageIndex(recordedPage, input.pageCount as number)
    : { index: recordedPage - 1, requestedPage: recordedPage, relocated: false };
  const pageFellBackToFirst = pageResolution.relocated;
  const page = pageResolution.index + 1;

  const measured =
    finite(input.pageWidthPt) &&
    finite(input.pageHeightPt) &&
    input.pageWidthPt > 0 &&
    input.pageHeightPt > 0;
  const pw = measured ? (input.pageWidthPt as number) : ASSUMED_PAGE_WIDTH_PT;
  const ph = measured ? (input.pageHeightPt as number) : ASSUMED_PAGE_HEIGHT_PT;

  // The renderer's placement, not a reimplementation of it. Both
  // coordinates are finite by the guard above, so the default-fraction
  // fallback inside computeSignatureBoxRect is unreachable from here:
  // a missing position is answered with 'deferred' rather than with
  // the renderer's arbitrary (0.07, 0.07) corner, because showing a
  // signer a guessed position as a fact is worse than saying the
  // placement happens on completion.
  const rect = computeSignatureBoxRect({
    positionX,
    positionY,
    pageWidthPt: pw,
    pageHeightPt: ph,
  });

  // PDF y is the BOTTOM edge of the box, measured up from the bottom
  // of the page. CSS top is the TOP edge, measured down from the top.
  const topFrac = 1 - (rect.y + rect.height) / ph;

  return {
    mode: 'placed',
    page,
    pageFellBackToFirst,
    leftPct: (rect.x / pw) * 100,
    topPct: topFrac * 100,
    widthPct: (rect.width / pw) * 100,
    heightPct: (rect.height / ph) * 100,
    pageAspect: pw / ph,
    pageGeometry: measured ? 'measured' : 'assumed',
    relocatedToFit: rect.relocated,
    shrunkToFit: rect.shrunk,
    relocationDxPt: rect.dxPt,
    relocationDyPt: rect.dyPt,
  };
}

/**
 * What the drawing has to admit when it never measured the page.
 *
 * The document is rasterised in the browser now, so the page it is
 * drawn on is measured from the parsed PDF and this returns null on
 * the ordinary path. It is not dead code: the signature can be on a
 * page the signer has not reached yet, and until that page is parsed
 * there is no measurement, so the step-2 card falls back to a Letter
 * outline and says so. Two things are approximate in that state:
 *
 *   - The page outline. A landscape page is drawn as a portrait one.
 *   - The box size, and with it the box's VERTICAL position, because
 *     the top edge is derived from the box height as a fraction of the
 *     page height (64/792 on Letter, 64/595 on A4 landscape, a
 *     difference of about 2.7% of the page).
 *   - The horizontal position, but only for an anchor near the right
 *     edge. This was true, then briefly false, and is true again. The
 *     renderer keeps the box on the page, so the placement engages a
 *     clamp at x = 1 - 220/pageWidth, and on an unmeasured page that
 *     threshold is computed from Letter rather than from the real
 *     width. An anchor clear of the right edge is unaffected; one at
 *     or past it is drawn against the wrong page.
 *
 * Returns null when the page WAS measured, because then there is
 * nothing to admit.
 */
export function signaturePreviewGeometryNote(
  placement: SignatureLinePlacement,
): string | null {
  if (placement.mode !== 'placed') return null;
  if (placement.pageGeometry === 'measured') return null;
  return (
    'This outline assumes a standard letter-size page, because that page of ' +
    'the document has not been opened here yet. Open the page above to see ' +
    'the box on the real page. The signed copy is the record.'
  );
}

/**
 * What the drawing has to say when the recorded anchor does not fit on
 * the page and the renderer moves the box to make it fit.
 *
 * This is not a preview artefact, and the signer is told about it for
 * the same reason as before: the box in front of them is not at the
 * coordinate the document recorded, and they are the person who can
 * raise it before the instrument is executed.
 *
 * What changed is the consequence, and so the sentence. This note used
 * to say part of the signature would not be visible on the signed
 * copy, which was true of a renderer that let pdf-lib drop the
 * overflow. That renderer is fixed. The whole mark now lands on the
 * page, the move is recorded on the audit trail as a signature_relocated
 * event, and the honest thing to tell the signer is that their
 * signature moved slightly, not that part of it is about to disappear.
 * Saying the latter now would frighten someone about a problem that no
 * longer exists.
 *
 * Returns null when the box sits exactly where the document asked.
 */
export function signatureRelocationNote(
  placement: SignatureLinePlacement,
): string | null {
  if (placement.mode !== 'placed') return null;
  if (!placement.relocatedToFit && !placement.shrunkToFit) return null;
  if (placement.shrunkToFit) {
    return (
      'This page is smaller than the standard signature box, so the box is ' +
      'reduced to fit and your signature is scaled down with it. The whole ' +
      'signature stays on the page, and the adjustment is noted on the audit ' +
      'trail for this document.'
    );
  }
  return (
    'The position recorded for this signature sits close enough to the edge ' +
    'that the box would not fit there, so it has been moved just inside the ' +
    'page. The box above is where your signature will actually appear, and ' +
    'all of it will be visible. The adjustment is noted on the audit trail. ' +
    'You can sign as normal, and mention it to the firm if the placement ' +
    'matters to you.'
  );
}

// ---------------------------------------------------------------------
// 3. Whether the signer may keep a copy
// ---------------------------------------------------------------------

/**
 * Read the per-request "the signer may download a copy" flag.
 *
 * The default is enabled. A signer keeping a copy of what they signed
 * is the ordinary expectation, and E-SIGN at 15 USC 7001(a)(1) is
 * built around the record being retainable by the person bound to it.
 * The firm can turn it off per request, but silence means yes.
 *
 * `undefined` therefore reads as permitted, which is also what a row
 * written before the column exists returns.
 */
export function parseSignerDownloadPermission(value: unknown): boolean {
  if (value === false) return false;
  if (value === true) return true;
  if (value === 'false' || value === 'f' || value === 0) return false;
  if (value === 'true' || value === 't' || value === 1) return true;
  return true;
}

/**
 * Whether a write failed because the target column is not there yet.
 *
 * The signer-download permission lands on a column that ships as a
 * migration the owner applies, so between merge and apply the insert
 * has to fall back to a write without it. That fallback must fire ONLY
 * for a missing column: swallowing a permission error or a constraint
 * violation the same way would drop a real failure on the floor and
 * send the request anyway.
 *
 * PostgREST answers a column it cannot find in its schema cache with
 * PGRST204, and Postgres itself with 42703 (undefined_column).
 */
export function isUnknownColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code !== 'PGRST204' && code !== '42703') return false;
  return (error.message ?? '').includes(column);
}

export type DownloadColumnFallback =
  /** Send anyway, without the column. Only when downloads were allowed. */
  | 'retry-without-column'
  /** Do not send. The firm restricted downloads and we cannot record it. */
  | 'abort-restriction-unsaved'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/**
 * The wording for the abort. Kept here so the decision and what the
 * firm reads about it stay together.
 */
export const SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR =
  'This request was not sent. You asked that the signer not be able to ' +
  'download a copy, and that restriction cannot be saved yet, so sending ' +
  'now would let them download it. Ask your administrator to apply the ' +
  'pending database update, or send with downloads allowed.';

/**
 * What to do when the insert carrying `signer_can_download` fails.
 *
 * The column arrives with a migration the owner applies, so between
 * merge and apply, and in the window right after the migration runs
 * while PostgREST still holds a stale schema cache, the write can come
 * back with the column unknown. Retrying without it is the obvious
 * recovery and it is right in exactly one direction.
 *
 * When downloads were ALLOWED, dropping the column changes nothing:
 * the reader defaults to permitted, so the retry lands on the same
 * behaviour the firm chose.
 *
 * When downloads were REFUSED, dropping the column inverts the firm's
 * decision. The request goes out with the document downloadable by
 * someone the firm deliberately chose to withhold it from, and telling
 * them afterwards does not put it back. Confidentiality does not fail
 * open, so this aborts and nothing is sent.
 */
export function resolveDownloadColumnFallback(input: {
  signerCanDownload: boolean;
  error: { code?: string | null; message?: string | null } | null | undefined;
}): DownloadColumnFallback {
  if (!isUnknownColumnError(input.error, 'signer_can_download')) {
    return 'surface-error';
  }
  return input.signerCanDownload
    ? 'retry-without-column'
    : 'abort-restriction-unsaved';
}

export type SignerCopyAccess =
  | {
      allowed: true;
      path: string;
      /** 'executed' is the fully stamped PDF; 'as-signed' is the
       *  document the signer reviewed, before every signer finished. */
      kind: 'executed' | 'as-signed';
    }
  | {
      allowed: false;
      reason:
        | 'code-required'
        | 'canceled'
        | 'not-signed'
        | 'not-permitted'
        | 'unavailable';
    };

/**
 * Decide whether this token may pull a copy of the document, and which
 * file it gets.
 *
 * This is the whole gate. The route that serves the bytes calls it and
 * serves nothing when it says no, because hiding a button is not a
 * gate: the token is the only credential on this surface and anyone
 * holding the link can request the route directly.
 *
 * Order matters. The access-code check runs first so a link that was
 * forwarded without its code learns nothing about the request behind
 * it. Recall runs next, because a recalled request should stop
 * handing out its document even to someone who already signed.
 */
export function resolveSignerCopyAccess(input: {
  downloadPermitted: boolean;
  signedAt: string | null;
  requestStatus: string;
  accessCodeRequired: boolean;
  accessVerifiedAt: string | null;
  /** firm_signing_requests.signed_file_path */
  signedFilePath: string | null;
  /** firm_documents.signable_file_path or file_path */
  sourceFilePath: string | null;
}): SignerCopyAccess {
  if (input.accessCodeRequired && !input.accessVerifiedAt) {
    return { allowed: false, reason: 'code-required' };
  }
  if (input.requestStatus === 'canceled') {
    return { allowed: false, reason: 'canceled' };
  }
  if (!input.signedAt) {
    return { allowed: false, reason: 'not-signed' };
  }
  if (!input.downloadPermitted) {
    return { allowed: false, reason: 'not-permitted' };
  }
  if (input.signedFilePath) {
    return { allowed: true, path: input.signedFilePath, kind: 'executed' };
  }
  if (input.sourceFilePath) {
    return { allowed: true, path: input.sourceFilePath, kind: 'as-signed' };
  }
  return { allowed: false, reason: 'unavailable' };
}

/**
 * Calm, plain wording for each refusal. Kept beside the decision so
 * the page and the route cannot describe the same refusal differently.
 * The firm name is interpolated by the caller.
 */
export const SIGNER_COPY_REFUSAL_COPY: Record<
  Exclude<SignerCopyAccess, { allowed: true }>['reason'],
  string
> = {
  'code-required':
    'Enter the access code from your email to reach this document.',
  canceled:
    'This signing request was recalled, so the document is no longer available here.',
  'not-signed': 'A copy becomes available once you have signed.',
  'not-permitted':
    'The firm has not enabled downloads for this document. You can ask them for a copy at any time.',
  unavailable:
    'The copy is not available to download right now. The firm can send it to you.',
};

// ---------------------------------------------------------------------
// 4. What of the signer's affirmations reaches the audit chain
// ---------------------------------------------------------------------

/** What the browser sends up with a signature. */
export type SignerConsentPayload = {
  electronicRecordsConsentedAt?: string | null;
  hardwareSoftwareConfirmedAt?: string | null;
  /** Whether the document was actually put in front of the signer. */
  documentPresented?: boolean | null;
  /** When they affirmed they had reviewed it. */
  documentReviewedAt?: string | null;
  intentAffirmedAt?: string | null;
  uaSnapshot?: string | null;
  tzOffsetMinutes?: number | null;
};

/** What lands in the 'signed' event's metadata. */
export type SignerConsentRecord = {
  electronic_records_consented_at: string | null;
  hardware_software_confirmed_at: string | null;
  document_presented: boolean;
  document_reviewed_at: string | null;
  intent_affirmed_at: string | null;
  ua_snapshot: string | null;
  tz_offset_minutes: number | null;
};

/**
 * Project the signer's affirmations into the audit chain.
 *
 * This is the only thing standing between what the browser captured
 * and what a later verifier can read, so it is a named function with
 * tests rather than an object literal inside a route handler. A key
 * dropped here is a piece of evidence that quietly does not exist:
 * the chain still verifies, the event still says 'signed', and the
 * absence looks exactly like a signer who was never asked.
 *
 * `document_presented` and `document_reviewed_at` are the record that
 * the signer was shown the document and said they had read it. They
 * are the reason the review gate exists at all, so they belong here
 * beside the electronic-records consent and the intent to sign.
 *
 * What `document_presented` means, stated here because this is the
 * comment a later verifier would quote when construing the record: a
 * page of this PDF was rasterised onto a canvas in the signer's own
 * browser, and the renderer confirmed afterwards that nothing the page
 * asked to paint had been dropped. It is the render, not a minted URL:
 * the old, weaker meaning ("a signed URL was handed to a frame") was
 * true of a phone that downloaded the file instead of showing it, and
 * it is not what this field carries any more. It is still not proof
 * the signer LOOKED at the page, which is what
 * `document_reviewed_at` is: their own statement that they did.
 *
 * Values are normalised rather than passed through, so a missing field
 * reads as null instead of undefined, which jsonb would drop.
 */
export function projectSignerConsentMetadata(
  consent: SignerConsentPayload | null | undefined,
): SignerConsentRecord | null {
  if (!consent) return null;
  return {
    electronic_records_consented_at: text(consent.electronicRecordsConsentedAt),
    hardware_software_confirmed_at: text(consent.hardwareSoftwareConfirmedAt),
    document_presented: consent.documentPresented === true,
    document_reviewed_at: text(consent.documentReviewedAt),
    intent_affirmed_at: text(consent.intentAffirmedAt),
    ua_snapshot: text(consent.uaSnapshot),
    tz_offset_minutes:
      typeof consent.tzOffsetMinutes === 'number' &&
      Number.isFinite(consent.tzOffsetMinutes)
        ? consent.tzOffsetMinutes
        : null,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// ---------------------------------------------------------------------
// 5. Rasterising the document in the browser
// ---------------------------------------------------------------------

/**
 * Who may pull the bytes of the document being signed.
 *
 * The renderer needs the file itself, not a viewer pointed at it, and
 * everything it needs has to come from this origin: the page is
 * unauthenticated and the URL carries a live signing credential, so a
 * cross-origin fetch would put that credential's document behind
 * somebody else's CORS policy and a redirect away from our own logs.
 * So the bytes are served by a route on this origin
 * (/api/firm/sign/document/[token]) and the storage signature stays on
 * the server, where it was already being minted.
 *
 * That route is the gate, not the page. Anyone holding the link can
 * call it directly, so the same decision runs in both places and this
 * function is it.
 *
 * Order matters, and mirrors resolveSignerCopyAccess. The access-code
 * check runs first so a link forwarded without its code learns nothing
 * about the request behind it. Recall runs next.
 *
 * 'already-signed' is a refusal on purpose. After signing, retention
 * is governed by the firm's per-request download permission and served
 * by the copy route; leaving this route open would hand out the same
 * document with that permission never consulted.
 */
export type SignerDocumentAccess =
  | { allowed: true; path: string }
  | {
      allowed: false;
      reason:
        | 'code-required'
        | 'canceled'
        | 'already-signed'
        | 'on-hold'
        | 'unavailable';
    };

export function resolveSignerDocumentAccess(input: {
  accessCodeRequired: boolean;
  accessVerifiedAt: string | null;
  requestStatus: string;
  signedAt: string | null;
  /** firm_signatures.response: set when this signer declined or asked
   *  for changes. */
  signerResponse: string | null;
  /** firm_documents.signable_file_path or file_path. */
  sourceFilePath: string | null;
}): SignerDocumentAccess {
  if (input.accessCodeRequired && !input.accessVerifiedAt) {
    return { allowed: false, reason: 'code-required' };
  }
  if (input.requestStatus === 'canceled') {
    return { allowed: false, reason: 'canceled' };
  }
  if (input.signedAt) {
    return { allowed: false, reason: 'already-signed' };
  }
  if (
    input.signerResponse ||
    input.requestStatus === 'rejected' ||
    input.requestStatus === 'changes_requested'
  ) {
    return { allowed: false, reason: 'on-hold' };
  }
  if (!input.sourceFilePath) {
    return { allowed: false, reason: 'unavailable' };
  }
  return { allowed: true, path: input.sourceFilePath };
}

/** Calm wording for each document refusal, shared by page and route. */
export const SIGNER_DOCUMENT_REFUSAL_COPY: Record<
  Exclude<SignerDocumentAccess, { allowed: true }>['reason'],
  string
> = {
  'code-required':
    'Enter the access code from your email to reach this document.',
  canceled:
    'This signing request was recalled, so the document is no longer available here.',
  'already-signed':
    'This document has been signed. Use the link on the signing page to get your copy.',
  'on-hold':
    'This document is on hold. The firm will send a new link if a revised version is ready.',
  unavailable:
    'The document is not available right now. The firm can send it to you.',
};

// ---------------------------------------------------------------------
// 6. What the bytes are being asked for, and who is reading the page
// ---------------------------------------------------------------------

/**
 * What a request for the document bytes is going to do with them.
 *
 * 'render' is the signing page's own fetch, feeding the rasteriser.
 * 'navigate' is a browser being pointed AT the file: a new tab, a
 * bookmark, a frame, an embed. That lands in the browser's built-in PDF
 * viewer, which is a save-and-print surface with the file already open
 * in it.
 * 'unstated' is a client that said nothing, which is Safari before
 * 16.4, some in-app webviews, and every scripted client.
 *
 * Fetch Metadata is the only thing on the wire that separates the
 * first two, and it separates them well for real browsers: a same
 * origin fetch() sends Sec-Fetch-Dest: empty, and a top level
 * navigation sends Sec-Fetch-Dest: document with Sec-Fetch-Mode:
 * navigate. Neither header can be set by page script.
 */
export type DocumentRequestPurpose = 'render' | 'navigate' | 'unstated';

/** Destinations that mean "a browser is going to display this file
 *  itself", as opposed to handing the bytes to our script. */
const VIEWER_FETCH_DESTS = new Set([
  'document',
  'embed',
  'frame',
  'iframe',
  'object',
]);

export function classifyDocumentRequestPurpose(input: {
  secFetchDest: string | null | undefined;
  secFetchMode: string | null | undefined;
}): DocumentRequestPurpose {
  const dest = (input.secFetchDest ?? '').trim().toLowerCase();
  const mode = (input.secFetchMode ?? '').trim().toLowerCase();
  if (mode === 'navigate') return 'navigate';
  if (VIEWER_FETCH_DESTS.has(dest)) return 'navigate';
  if (dest === 'empty') return 'render';
  return 'unstated';
}

export type SignerDocumentDelivery =
  | { serve: true }
  | { serve: false; reason: 'download-not-permitted' };

/**
 * Whether the firm's "the signer may keep a copy" decision withholds
 * these bytes from this particular request.
 *
 * This is the gap the download permission had. resolveSignerCopyAccess
 * gates the copy route, and the composer refuses to send a restricted
 * request it cannot record, but the route that streams the render
 * source never asked the question at all: the permission reached a
 * button and stopped there, and anyone holding the signing link could
 * open the raw PDF by requesting the URL.
 *
 * The question this function answers is deliberately narrower than
 * "may these bytes be served", because the wide version breaks signing.
 * The rasteriser runs in the signer's browser and needs the whole file
 * to draw a page of it, so refusing the render fetch means the signer
 * cannot read the document, and a signer who cannot read the document
 * cannot be asked to sign it. Displaying is not downloading, and the
 * firm turning off downloads is not the firm withdrawing the document
 * from the person it asked to sign.
 *
 * So the permission gates DELIVERY AS A FILE, not the render. When the
 * firm has withheld a copy, this route serves the signing page's fetch
 * and refuses a browser pointed at the URL, which is the request that
 * ends in the browser's own PDF viewer with Save and Print on it.
 *
 * State the limit plainly, because the header is not a credential. A
 * client that sends no Fetch Metadata is served, because Safari before
 * 16.4 and a number of in-app webviews send none and the signer on one
 * of those still has to be able to read the document; and a scripted
 * client can send whatever it likes. Nothing here, and nothing
 * available to any web server, stops someone who already holds a live
 * signing token from saving bytes their own browser must receive to
 * show them the page. What it does is make the firm's decision a
 * property of the endpoint rather than of a button, and close the
 * one-click path from a signing link to a downloadable file.
 */
export function resolveSignerDocumentDelivery(input: {
  downloadPermitted: boolean;
  purpose: DocumentRequestPurpose;
}): SignerDocumentDelivery {
  if (input.downloadPermitted) return { serve: true };
  if (input.purpose === 'navigate') {
    return { serve: false, reason: 'download-not-permitted' };
  }
  return { serve: true };
}

/**
 * The refusal, in the same calm register as the rest of this surface.
 * It says where the document is rather than what the reader may not do.
 */
export const SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY: Record<
  Exclude<SignerDocumentDelivery, { serve: true }>['reason'],
  string
> = {
  'download-not-permitted':
    'This document opens on your signing page rather than as a separate file. ' +
    'Go back to your signing link to read it and sign. ' +
    'The firm can send you a copy at any time.',
};

/**
 * The attribution line the signer page carries.
 *
 * The trace watermark on the rest of the app is gated on a signed-in
 * user, which left the one page most likely to be screenshotted, and
 * least likely to be read by an account holder, carrying no identity at
 * all. The counterparty is never signed in. They are, however, known:
 * the signature row names them, and on an external request the access
 * code from a separate email is what let them reach this page.
 *
 * Wording matters here. Someone reading this page is usually reading it
 * under some pressure, and a watermark that reads as an accusation is
 * both unpleasant and wrong: marking a confidential document with who
 * holds it and when is ordinary practice, not a warning that they are
 * suspected of something. So it opens with what the document is.
 *
 * Returns null rather than a half-stamp when there is nobody to name.
 * A watermark reading "Confidential" and nothing else is decoration; it
 * traces nothing, and rendering it would overstate what the page knows.
 */
export function signerWatermarkStamp(input: {
  signerName: string | null | undefined;
  signerEmail: string | null | undefined;
  at: Date | string;
}): string | null {
  const name = oneLine(input.signerName);
  const email = oneLine(input.signerEmail);
  const who = name && email ? `${name} (${email})` : email || name;
  if (!who) return null;

  const when = input.at instanceof Date ? input.at : new Date(input.at);
  const ms = when.getTime();
  // An unparseable timestamp drops the time and keeps the identity.
  // Attribution is the point; "when" is the supporting detail.
  if (!Number.isFinite(ms)) return `Confidential  ·  ${who}`;
  // To the minute, like the signed-in watermark: enough to place a
  // screenshot in a session, not a claim of forensic precision.
  const stamp = `${when.toISOString().slice(0, 16).replace('T', ' ')}Z`;
  return `Confidential  ·  ${who}  ·  ${stamp}`;
}

/**
 * A stored name is user input and the stamp is one line of SVG text, so
 * newlines, tabs and control bytes are folded to spaces rather than
 * carried into the markup. Length is capped so a pathological name
 * cannot push the identity off the tile it is drawn in.
 */
function oneLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .split('')
    .map((ch) => ((ch.codePointAt(0) ?? 0) < 32 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 96 ? `${cleaned.slice(0, 95)}…` : cleaned;
}

/**
 * How large a file this page will attempt to open.
 *
 * The signer's device does the parsing now, and the device most likely
 * to be handed a long contract is a phone. pdf.js holds the whole file
 * to parse it, so this is a ceiling on the PARSE and nothing else.
 * State that precisely, because the honest version is narrower than it
 * looks: at open time the bytes exist twice, once in the page's own
 * buffer and once in the worker's structured clone of it, and the
 * compositor generally keeps a second copy of the canvas alongside the
 * backing store. 40 MB is well past any ordinary agreement and still
 * inside what a mid-range phone can hold through that.
 *
 * What it does NOT bound is the read-through. A signer reading a long
 * document opens page after page, and pdf.js retains per-page state
 * for each one until it is told not to, so an 800-page text contract
 * that passes this gate comfortably can still exhaust a phone while
 * being read. That is why renderPageToCanvas releases each page after
 * it draws it (page.cleanup()); this constant would not have saved it.
 *
 * The point of the limit is that the failure is a sentence rather than
 * a blank canvas or a crashed tab. Refusing to start is the honest
 * version of a render that would not have finished.
 */
export const SIGNER_DOCUMENT_MAX_BYTES = 40 * 1024 * 1024;

export type DocumentSizeAcceptance = 'ok' | 'empty' | 'too-large';

export function resolveDocumentSizeAcceptance(
  byteLength: number | null | undefined,
): DocumentSizeAcceptance {
  if (!finite(byteLength) || byteLength <= 0) return 'empty';
  if (byteLength > SIGNER_DOCUMENT_MAX_BYTES) return 'too-large';
  return 'ok';
}

/**
 * The one status code that means "too large", named once.
 *
 * The route that serves the bytes and the page that fetches them both
 * read it. They used to agree by coincidence and disagree in effect:
 * the route answered 413 for an EMPTY stored file as well, and the
 * page turned every 413 into "this document is larger than this page
 * can open". A signer whose firm had uploaded a zero-byte file was
 * told the opposite of what had happened, and the firm was sent to fix
 * a size problem it did not have.
 */
export const SIGNER_DOCUMENT_TOO_LARGE_STATUS = 413;

/**
 * How the route refuses a file it will not serve, given what is wrong
 * with it.
 *
 * Empty is not a size complaint. A stored file with no bytes in it is,
 * to the reader, a file that is not there, so it refuses as one and
 * the page says the document could not be loaded.
 */
export function resolveDocumentSizeRefusal(
  size: Exclude<DocumentSizeAcceptance, 'ok'>,
): { status: number; message: string } {
  if (size === 'too-large') {
    return {
      status: SIGNER_DOCUMENT_TOO_LARGE_STATUS,
      message:
        'This document is too large to open on this page. The firm can send you a copy.',
    };
  }
  return { status: 404, message: SIGNER_DOCUMENT_REFUSAL_COPY.unavailable };
}

/**
 * What a refused response says to the signer.
 *
 * The pair to resolveDocumentSizeRefusal, and the reason both are
 * functions rather than literals at two call sites: the sentence the
 * signer reads has to follow from the reason the bytes were withheld,
 * and there is a test that walks every refusal the route can emit
 * through both.
 */
export function resolveDocumentResponseFailure(
  httpStatus: number,
): Extract<SignerDocumentRenderStatus, 'too-large' | 'unavailable'> {
  return httpStatus === SIGNER_DOCUMENT_TOO_LARGE_STATUS
    ? 'too-large'
    : 'unavailable';
}

/**
 * How long the page will sit on "Opening the document." before it
 * calls the attempt failed.
 *
 * Every other way this can fail ends in a sentence. Without a deadline
 * one of them does not: a body that stalls on a flaky connection never
 * resolves and never rejects, and a container that is measured at zero
 * width never renders a page at all, so the signer waits on a spinner
 * with Continue disabled, no error, and no reason to go ask the firm.
 * Silence is the one failure state that cannot be acted on.
 *
 * Two minutes is long enough for a large agreement over a slow mobile
 * connection and short enough that nobody sits in front of a page that
 * is not coming. It runs from mount to the first rendered page, so it
 * covers the fetch, the parse, and the render alike.
 */
export const SIGNER_DOCUMENT_PRESENT_TIMEOUT_MS = 120_000;

/**
 * Whether the renderer quietly dropped something the page asked it to
 * paint, and what.
 *
 * This is the guard behind the branch's central claim, and it exists
 * because pdf.js does not fail the way the rest of this file assumed.
 * When an image on a page cannot be decoded - a JPEG 2000 scan, a
 * truncated stream, a codec this build has no decoder for - the worker
 * catches it, warns, and resolves the image object to null
 * (pdf.worker.mjs, buildPaintImageXObject). The canvas side then skips
 * that paint with a console warning and the render task RESOLVES. On a
 * scanned agreement, whose every page is one image, that produces the
 * exact artefact this whole page was built to prevent: a white
 * rectangle that reports itself as the document, under a checkbox
 * saying the signer has reviewed it in full.
 *
 * `stopAtErrors` does not close it. That option only reaches the
 * `ignoreErrors` branches, and the catch on this path is not one of
 * them: it swallows the failure before any of them is consulted.
 *
 * So the renderer checks afterwards instead. Everything pdf.js
 * resolves into a page's object bag is an image or a pattern, and a
 * null there means precisely one thing: the worker could not produce
 * it. One null means the signer was shown less than the page, which is
 * not a document that was presented to them.
 *
 * A page that draws nothing at all is NOT a failure here, deliberately.
 * Blank pages are ordinary in real agreements - the back of a scanned
 * duplex sheet, a divider - and refusing to open a document because
 * page 7 has nothing on it would block a signing for a page that is
 * exactly as it should be.
 */
export function firstDroppedRenderObject(
  entries: Iterable<readonly unknown[]> | null | undefined,
): string | null {
  if (!entries) return null;
  for (const [objId, data] of entries) {
    if (data === null || data === undefined) return String(objId);
  }
  return null;
}

/**
 * Where a document render can end up, and whether the signer has seen
 * the record.
 *
 * 'ready' is the only state that counts as having been shown the
 * document, and it is set from the rasteriser having actually put a
 * page on a canvas, not from a URL having been minted. That is a
 * stronger claim than this page could make before: the old
 * documentPresented meant a signed URL was handed to a cross-origin
 * frame, which reports nothing back, so a phone that downloaded the
 * file instead of displaying it still read as presented. It is still
 * not proof the signer looked at it, which is what the affirmation is
 * for, but it is now proof the document rendered on their device.
 */
export type SignerDocumentRenderStatus =
  | 'pending'
  | 'ready'
  | 'empty'
  | 'too-large'
  | 'unreadable'
  | 'unsupported'
  | 'unavailable';

export function isDocumentPresented(
  status: SignerDocumentRenderStatus,
): boolean {
  return status === 'ready';
}

/**
 * What each failure says. Calm, specific about what the signer should
 * do, and never blaming them for their device. Every one of these ends
 * with the signing blocked, because the whole point of showing the
 * document is that nobody signs a record they have not seen.
 */
export const SIGNER_DOCUMENT_RENDER_COPY: Record<
  Exclude<SignerDocumentRenderStatus, 'ready'>,
  string
> = {
  pending: 'Opening the document.',
  empty:
    'The document came back empty, so there is nothing to show you. Please ask the firm to send it again.',
  // Not "too large for this device": the ceiling is the same
  // everywhere, because the route that serves the bytes holds them in
  // memory too, so telling someone to try a computer would send them
  // round the same refusal.
  'too-large':
    'This document is larger than this page can open. Please ask the firm to send you a copy you can read.',
  unreadable:
    'This document could not be opened. It may be damaged or password protected. Please ask the firm for a copy you can read.',
  unsupported:
    'This browser cannot display the document on this page. Please open the link in an up-to-date browser, or ask the firm to send you a copy.',
  unavailable:
    'The document could not be loaded. Check your connection and reload this page, or ask the firm to send you a copy.',
};

/**
 * Ceiling on the canvas backing store, in pixels and in pixels per
 * side.
 *
 * Mobile Safari refuses to allocate a canvas past a total area and a
 * maximum side, and the failure is silent: the canvas allocates, draws
 * nothing, and reads back as transparent. A blank page the signer is
 * asked to sign is the worst outcome available here, so the scale is
 * chosen to stay inside the limit rather than discovered by hitting
 * it. 8 megapixels is roughly 300 dpi on a letter page, comfortably
 * inside every documented limit including the 4096 side cap on older
 * iOS devices.
 */
export const SIGNER_CANVAS_MAX_PIXELS = 8_000_000;
export const SIGNER_CANVAS_MAX_SIDE_PX = 4096;

/**
 * The scale to hand pdf.js for one page.
 *
 * Starts from the width the page is being shown at and the device
 * pixel ratio, so text is sharp, then gives that up rather than
 * exceeding the canvas limits above. Returns a positive, finite number
 * for any input, because a NaN scale produces a zero-sized canvas and
 * a blank document rather than an error anyone can read.
 */
export function resolveCanvasRenderScale(input: {
  pageWidthPt: number;
  pageHeightPt: number;
  cssWidthPx: number;
  devicePixelRatio?: number | null;
  maxPixels?: number;
  maxSidePx?: number;
}): number {
  const { pageWidthPt, pageHeightPt, cssWidthPx } = input;
  if (
    !finite(pageWidthPt) ||
    !finite(pageHeightPt) ||
    !finite(cssWidthPx) ||
    pageWidthPt <= 0 ||
    pageHeightPt <= 0 ||
    cssWidthPx <= 0
  ) {
    return 1;
  }
  const maxPixels = finite(input.maxPixels) && input.maxPixels > 0
    ? input.maxPixels
    : SIGNER_CANVAS_MAX_PIXELS;
  const maxSide = finite(input.maxSidePx) && input.maxSidePx > 0
    ? input.maxSidePx
    : SIGNER_CANVAS_MAX_SIDE_PX;

  // A device ratio of 4 buys nothing a reader can see and costs 16x
  // the memory, so it is capped rather than trusted.
  const dpr =
    finite(input.devicePixelRatio) && input.devicePixelRatio > 0
      ? Math.min(3, input.devicePixelRatio)
      : 1;

  let scale = (cssWidthPx / pageWidthPt) * dpr;
  scale = Math.min(scale, maxSide / pageWidthPt, maxSide / pageHeightPt);
  const area = pageWidthPt * pageHeightPt * scale * scale;
  if (area > maxPixels) {
    scale = Math.sqrt(maxPixels / (pageWidthPt * pageHeightPt));
  }
  // Never zero. A page rendered at a hair's width is still a rendered
  // page and still fails loudly if it is unreadable; a zero-scale
  // canvas is the blank one.
  return Math.max(0.05, scale);
}

/**
 * Which page the viewer is on.
 *
 * Multi-page navigation exists on this page for one reason: the signer
 * has to be able to reach the page their signature line is on. So the
 * only rule is that the number stays inside the document, and a
 * document whose page count is not known yet stays on page one rather
 * than jumping somewhere that does not exist.
 */
export function clampSignerPageNumber(
  page: number | null | undefined,
  pageCount: number | null | undefined,
): number {
  if (!finite(pageCount) || pageCount < 1) return 1;
  if (!finite(page)) return 1;
  return Math.max(1, Math.min(Math.floor(pageCount), Math.floor(page)));
}

/** A box on a page, in fractions of the page's own width and height,
 *  CSS orientation. */
export type SignatureRectFractions = {
  leftFrac: number;
  topFrac: number;
  widthFrac: number;
  heightFrac: number;
};

/**
 * Move the signature box into the coordinates the page is displayed
 * in, when the page carries a /Rotate entry.
 *
 * The recorded coordinates live in unrotated PDF user space, which is
 * the space pdf-lib draws into: lib/signature-render.ts calls
 * page.getSize() and page.drawImage, and neither consults /Rotate. A
 * viewer, on the other hand, shows the page rotated, and so does the
 * rasteriser on this page, because a signer cannot read a contract
 * sideways. Without this the box would be drawn in the right place in
 * a space nobody is looking at.
 *
 * Rotation is clockwise, which is what /Rotate means. Rotating an
 * image 90 degrees clockwise sends the point at (u, v) to (1 - v, u),
 * and the box's width and height trade places because they are
 * fractions of dimensions that have traded places.
 *
 * Anything that is not a right angle is treated as no rotation.
 * /Rotate is defined to be a multiple of 90, and inventing a shear for
 * a malformed value would be worse than showing the box where the
 * unrotated render puts it.
 */
export function rotateSignatureRectForDisplay(
  rect: SignatureRectFractions,
  rotationDeg: number | null | undefined,
): SignatureRectFractions {
  // finite() here is the type narrowing, not the guard: a NaN or a
  // null falls through to the unrotated case below either way.
  const raw = finite(rotationDeg) ? rotationDeg : 0;
  // Wrapped into [0, 360) so a viewer reporting -90 and a PDF storing
  // 270 are the same turn. Deliberately NOT rounded to the nearest
  // right angle: an earlier version did, which quietly turned a
  // malformed 80 into a quarter turn while the comment below promised
  // the opposite, and no test could tell the two apart because
  // /Rotate is defined to be a multiple of 90 and pdf.js normalises
  // page.rotate before this ever sees it.
  const turn = ((raw % 360) + 360) % 360;
  const { leftFrac: l, topFrac: t, widthFrac: w, heightFrac: h } = rect;
  if (turn === 90) {
    return { leftFrac: 1 - t - h, topFrac: l, widthFrac: h, heightFrac: w };
  }
  if (turn === 180) {
    return { leftFrac: 1 - l - w, topFrac: 1 - t - h, widthFrac: w, heightFrac: h };
  }
  if (turn === 270) {
    return { leftFrac: t, topFrac: 1 - l - w, widthFrac: h, heightFrac: w };
  }
  return { leftFrac: l, topFrac: t, widthFrac: w, heightFrac: h };
}

// ---------------------------------------------------------------------
// 7. Whether an internal signer is actually the internal signer
// ---------------------------------------------------------------------

export type InternalSignerGate =
  /** Sign away. Either they proved themselves with a code, or their
   *  session is the one this row names. */
  | 'allow'
  /** An internal signer with no session at all. */
  | 'sign-in-required'
  /** An internal signer signed in as somebody else. */
  | 'wrong-account';

/**
 * The credential an internal signer has, which until now was none.
 *
 * Two kinds of person reach /sign/[token]. An EXTERNAL signer is a
 * stranger to this app: they get a one-time access code in a second
 * email, and entering it is what proves they are the person the firm
 * addressed. An INTERNAL signer is a member or an employee of the firm,
 * and createSigningRequestAction deliberately issues them no code
 * (lib/firm-actions.ts, the classification block), because they already
 * have an account and a second email would be ceremony for its own sake.
 *
 * The consequence was not deliberate. With no code, the durable
 * /sign/[token] URL is the ONLY thing standing between a caller and a
 * signature made in that employee's name. That URL is emailed, it sits
 * in an inbox, it is forwarded, it is copied out of a notification, and
 * it stays live for the whole retention window on purpose. Anyone who
 * came into possession of it could sign as them, and the executed
 * instrument would carry their name, their timestamp and an audit chain
 * that says nothing was wrong.
 *
 * That gap was survivable while internal signers were incidental. This
 * slice makes the employee's counter-signature the ordinary end of the
 * whole flow, so it is not survivable any more, and this is the
 * compensating control: an internal signer must be signed in, as
 * themselves, for the signature to be taken.
 *
 * WHAT IT REFUSES AND WHAT IT CANNOT
 * ----------------------------------
 * It refuses a caller with no session and a caller whose session is a
 * different account, on the page and in the write alike. It does not
 * refuse the employee themselves, on any device where they are signed
 * in, which is where they already read their notifications.
 *
 * It is NOT a claim that the account cannot be misused. Somebody holding
 * the employee's own signed-in browser is out of reach of anything on
 * this surface. The claim is narrower and is the one that matters here:
 * possession of the link is no longer sufficient.
 *
 * External signers are always 'allow'. The code is their proof, it is
 * checked in three places already, and requiring a counterparty to hold
 * an Advottic account before they can sign an agreement would break the
 * flow this whole branch exists to build.
 *
 * A signature row with no signer_email is treated as internal and
 * refused, because there is then nothing for a session to match and
 * 'allow' would be a gate that opens when its input is missing.
 */
export function resolveInternalSignerGate(input: {
  /** True when this row carries an access_code_hash. */
  accessCodeRequired: boolean;
  /** firm_signatures.signer_email. */
  signerEmail: string | null | undefined;
  /** The signed-in session's email, or null when there is no session. */
  sessionEmail: string | null | undefined;
}): InternalSignerGate {
  if (input.accessCodeRequired) return 'allow';
  const signer = normalizeEmail(input.signerEmail);
  const session = normalizeEmail(input.sessionEmail);
  if (!session) return 'sign-in-required';
  if (!signer) return 'wrong-account';
  return signer === session ? 'allow' : 'wrong-account';
}

/**
 * Both sides of the comparison are normalised, and both for the same
 * reason: an address that differs only in case or in surrounding
 * whitespace is the same address, and refusing the right employee
 * because their identity provider capitalised their name would send them
 * to support over a signature they are entitled to make.
 *
 * The local part of an address is case sensitive by RFC 5321 and is
 * treated as insensitive by every mail system anybody uses, which is
 * also the assumption the rest of this repo makes: signer_email is
 * stored lowercased by createSigningRequestAction, and the profile
 * lookups there match on a lowercased address too.
 */
function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Show enough of an address for the right person to recognise it, and
 * not enough for a stranger to learn it.
 *
 * The 'wrong-account' screen has to name the account that is expected,
 * or the reader has three work addresses and no way to tell which one to
 * use. It is also reachable by anyone holding the link, so the address
 * is masked: the first character of the local part, then the domain,
 * which an employee recognises at a glance and a stranger cannot
 * complete.
 *
 * Anything that is not an address at all masks to an empty string rather
 * than being echoed back, so a malformed stored value cannot be
 * reflected onto the page.
 */
export function maskSignerEmail(value: string | null | undefined): string {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, local.length - 1))}${domain}`;
}

/**
 * What each refusal says. Calm, and it tells the reader the one thing
 * they can do about it. The masked address is interpolated by the
 * caller, because a record is not a sentence.
 */
export const INTERNAL_SIGNER_GATE_COPY = {
  'sign-in-required':
    'Sign in to Advottic to sign this document. It is waiting for you in your Hub.',
  'wrong-account': (masked: string) =>
    `This document is waiting for a different account. Sign in as ${masked} to continue.`,
} as const;

/**
 * Whether this browser is missing Promise.withResolvers.
 *
 * pdf.js 5 uses it unguarded. It landed in Safari 17.4 and Chrome 119,
 * so a signer on an iPhone that stopped at iOS 16 would get a thrown
 * reference rather than a document. The library ships a legacy build
 * that polyfills it, but that build also drags in core-js and a stream
 * shim for browsers this app dropped years ago, which is a lot of
 * bundle for one missing static method. So the modern build is used
 * and the one method is added when it is absent.
 *
 * Predicate and installation are separate so the decision is testable
 * in the node environment without mutating the test runner's globals.
 */
export function needsPromiseWithResolvers(
  target: { withResolvers?: unknown } | null | undefined,
): boolean {
  if (!target) return false;
  return typeof target.withResolvers !== 'function';
}
