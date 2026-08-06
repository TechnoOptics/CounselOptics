/**
 * Pure decisions behind the public signer page (/sign/[token]).
 *
 * The page itself is a server component and the capture surface is a
 * client component, neither of which the node test environment can
 * render. So every rule that could be wrong on its own lives here,
 * as a function over plain values, and the components are the thin
 * wiring around it.
 *
 * Five rules live here:
 *
 *   1. When the signer may leave the disclosure step
 *      (canLeaveDisclosureStep).
 *   2. Where the signature is drawn, if anywhere
 *      (resolveSignatureLinePlacement), and what the drawing has to
 *      admit about its own accuracy (signaturePreviewGeometryNote,
 *      signatureOverflowNote).
 *   3. Whether the signer may download a copy, and of what
 *      (parseSignerDownloadPermission / resolveSignerCopyAccess).
 *   4. What of the signer's affirmations reaches the audit chain
 *      (projectSignerConsentMetadata).
 *   5. Everything about rasterising the document in the browser that is
 *      a decision rather than a canvas call: who may fetch the bytes
 *      (resolveSignerDocumentAccess), whether the file is one this
 *      device should attempt (resolveDocumentSizeAcceptance), how big
 *      the backing canvas may be (resolveCanvasRenderScale), which page
 *      is on screen (clampSignerPageNumber), and what a failure says to
 *      the signer (SIGNER_DOCUMENT_RENDER_COPY).
 *
 * A sixth used to live here: which URL a mounted document frame shows.
 * It is gone with the frame. The page no longer mints a signed storage
 * URL for the browser at all, so there is no freshly minted URL for a
 * re-render to write into an iframe src, and nothing to retain.
 */

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
 * Default signature box, in PDF points. These are the numbers
 * lib/signature-anchors.ts stamps onto the document and
 * lib/signature-render.ts stamps the captured PNG into, mirrored here
 * so the preview and the final render are driven by one set of values.
 */
export const SIGNATURE_BOX_WIDTH_PT = 220;
export const SIGNATURE_BOX_HEIGHT_PT = 64;

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
       *  them: left/top can be negative and left+width can exceed 100
       *  when the recorded anchor puts part of the box past the page
       *  edge, because that is what the executed copy will show. */
      leftPct: number;
      topPct: number;
      widthPct: number;
      heightPct: number;
      /** Page aspect (width / height), for a page outline. */
      pageAspect: number;
      /** Whether the page size was measured or assumed to be Letter. */
      pageGeometry: 'measured' | 'assumed';
      /** True when any part of the box falls outside the page. */
      overflowsPage: boolean;
    }
  | {
      mode: 'deferred';
      reason: 'no-recorded-position';
    };

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Floating-point slack, so a box that lands exactly on the page edge
 *  is not reported as hanging off it. */
const EDGE_EPSILON = 1e-9;

/**
 * Decide where, if anywhere, the signer's mark is drawn.
 *
 * The contract is that this cannot disagree with the final render. So
 * it reproduces lib/signature-render.ts line for line: the recorded
 * page with the renderer's past-the-end fallback to page one, the same
 * Math.max(0, Math.min(1, ...)) on each coordinate, the same 220 x 64
 * point box anchored at its BOTTOM-LEFT corner, converted from the PDF
 * origin at bottom-left to the CSS origin at top-left.
 *
 * What it deliberately does NOT do is keep the box inside the page.
 * An earlier version clamped left into [0, 1 - width] so the drawing
 * could not overflow its own frame. That was the wrong instinct twice
 * over. The renderer applies no such clamp, so above x = 1 - 220/pageW
 * the drawing and the executed copy parted company by as much as a
 * third of the page width; and the clamp was computed from an ASSUMED
 * page width, so it engaged at a fixed x = 1 - 220/612 no matter what
 * the real page was. Anchors that reach it are ordinary: signature
 * fields on the right half of a page map straight through
 * lib/signature-anchors.ts. A box that hangs off the page is now drawn
 * hanging off the page, clipped by the page it belongs to, exactly as
 * the signed PDF will show it, and `overflowsPage` lets the caller say
 * so out loud.
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

  // `pages[pageIdx] ?? pages[0]` in the renderer: a recorded page past
  // the end of the document stamps onto page one. Only knowable once
  // the document has been parsed, which is why the count is optional.
  const pageFellBackToFirst =
    finite(input.pageCount) && input.pageCount >= 1 && recordedPage > input.pageCount;
  const page = pageFellBackToFirst ? 1 : recordedPage;

  const measured =
    finite(input.pageWidthPt) &&
    finite(input.pageHeightPt) &&
    input.pageWidthPt > 0 &&
    input.pageHeightPt > 0;
  const pw = measured ? (input.pageWidthPt as number) : ASSUMED_PAGE_WIDTH_PT;
  const ph = measured ? (input.pageHeightPt as number) : ASSUMED_PAGE_HEIGHT_PT;

  // The renderer clamps each coordinate into [0, 1] before scaling it
  // by the page dimension. Same clamp, same order.
  const x = clamp01(positionX);
  const y = clamp01(positionY);

  const widthFrac = SIGNATURE_BOX_WIDTH_PT / pw;
  const heightFrac = SIGNATURE_BOX_HEIGHT_PT / ph;
  // PDF y is the BOTTOM edge of the box, measured up from the bottom
  // of the page. CSS top is the TOP edge, measured down from the top.
  const topFrac = 1 - (y + heightFrac);

  const overflowsPage =
    x + widthFrac > 1 + EDGE_EPSILON || topFrac < -EDGE_EPSILON;

  return {
    mode: 'placed',
    page,
    pageFellBackToFirst,
    leftPct: x * 100,
    topPct: topFrac * 100,
    widthPct: widthFrac * 100,
    heightPct: heightFrac * 100,
    pageAspect: pw / ph,
    pageGeometry: measured ? 'measured' : 'assumed',
    overflowsPage,
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
 *
 * The horizontal position is no longer among them. It used to be, via
 * a containment clamp computed from the assumed width; that clamp is
 * gone (see resolveSignatureLinePlacement), so left is the recorded x
 * on any page size.
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
 * What the drawing has to say when the recorded anchor puts part of
 * the signature past the edge of the page.
 *
 * This is not a preview artefact. The renderer stamps a 220 x 64 point
 * box at the recorded corner and does not pull it back, so a box that
 * hangs off the page here hangs off the page in the executed PDF, and
 * the part outside the page is not visible when the document is read
 * or printed. The signer is the one person who can catch it before it
 * is signed, so they are told, plainly, and pointed at the firm rather
 * than left to work out what to do.
 *
 * Returns null when the box is entirely on the page.
 */
export function signatureOverflowNote(
  placement: SignatureLinePlacement,
): string | null {
  if (placement.mode !== 'placed') return null;
  if (!placement.overflowsPage) return null;
  return (
    'Part of this signature box sits past the edge of the page, so part of ' +
    'your signature will not be visible on the signed copy. That is how the ' +
    'position was recorded on this document. You can still sign, but it is ' +
    'worth asking the firm to move the signature line first.'
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
 * What `document_presented` means is narrow and should be read
 * narrowly: a URL was minted and given to the frame. It is not proof
 * the PDF rendered on the signer's device.
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

/**
 * How large a file this page will attempt to open.
 *
 * The signer's device does the parsing now, and the device most likely
 * to be handed a long contract is a phone. pdf.js holds the whole file
 * in memory to parse it and rasterises one page at a time on top of
 * that, so page count is not the limit, total bytes is. 40 MB is well
 * past any ordinary agreement and still inside what a mid-range phone
 * can hold without the tab being killed.
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
  'too-large':
    'This document is too large to open on this device. Please ask the firm to send you a copy you can read, or open this link on a computer.',
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
