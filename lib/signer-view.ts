/**
 * Pure decisions behind the public signer page (/sign/[token]).
 *
 * The page itself is a server component and the capture surface is a
 * client component, neither of which the node test environment can
 * render. So every rule that could be wrong on its own lives here,
 * as a function over plain values, and the components are the thin
 * wiring around it.
 *
 * Four rules live here:
 *
 *   1. Which URL a mounted document frame shows (stableSignerFrameSrc /
 *      createSignerFrameSrcRetainer).
 *   2. When the signer may leave the disclosure step
 *      (canLeaveDisclosureStep).
 *   3. Where the signature preview may be drawn, if anywhere
 *      (resolveSignatureLinePlacement).
 *   4. Whether the signer may download a copy, and of what
 *      (parseSignerDownloadPermission / resolveSignerCopyAccess).
 */

// ---------------------------------------------------------------------
// 1. Frame source retention
// ---------------------------------------------------------------------

/**
 * What one frame shows for a single render.
 *
 * The sign page is force-dynamic and mints a fresh signed storage URL
 * every time it renders, so any re-render would otherwise hand the
 * iframe a different URL. React writes it through, the browser treats
 * the write as a navigation, and the PDF viewer reloads: back to page
 * one, scroll lost, focus taken from whatever the signer was doing.
 * On this page that is worse than an annoyance, because the thing the
 * signer is being asked to read is inside that frame.
 *
 * So the first usable URL wins and later ones are ignored.
 *
 * The cost, stated plainly: the retained URL is a time-limited
 * signature, and pinning one for the life of the mount is genuinely
 * shorter-lived than re-minting. A request for the resource made after
 * the signature expires (a range request deep into a very large PDF, a
 * bfcache restore) can be refused, and the recovery is a page reload.
 * We take that over reloading the document under the reader. Renewing
 * on a timer is not a middle ground: renewing means assigning `src`,
 * which is the navigation this exists to prevent.
 */
export function stableSignerFrameSrc(
  retained: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return retained || incoming || null;
}

/** What one mounted frame shows across a sequence of renders. */
export type SignerFrameSrcRetainer = (
  incoming: string | null | undefined,
) => string | null;

/**
 * The mount-scoped half of the rule above.
 *
 * `stableSignerFrameSrc` decides one render and on its own is not the
 * fix, because a decision with no memory lets the next freshly minted
 * URL through and navigates the frame anyway. The memory is the point,
 * so it lives here as a closure that the node test environment can
 * call, and the component is one call per render.
 *
 * Idempotent for a repeated argument, so a render that runs twice
 * (StrictMode) or is discarded (an abandoned concurrent render) cannot
 * change the answer.
 */
export function createSignerFrameSrcRetainer(): SignerFrameSrcRetainer {
  let retained: string | null = null;
  return (incoming) => {
    retained = stableSignerFrameSrc(retained, incoming);
    return retained;
  };
}

// ---------------------------------------------------------------------
// 2. Leaving the disclosure step
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
 * signal available to us, because a cross-origin PDF frame reports
 * nothing about scrolling.
 *
 * When the document could NOT be presented (no stored file, or the
 * storage signature could not be minted) the review affirmation is not
 * required, because requiring an acknowledgement of something the
 * signer was never shown would be a lie, and would also strand them on
 * a step they cannot pass.
 */
export function canLeaveDisclosureStep(input: {
  electronicRecordsAgreed: boolean;
  hardwareSoftwareAgreed: boolean;
  documentPresented: boolean;
  documentReviewed: boolean;
}): boolean {
  if (!input.electronicRecordsAgreed) return false;
  if (!input.hardwareSoftwareAgreed) return false;
  if (input.documentPresented && !input.documentReviewed) return false;
  return true;
}

// ---------------------------------------------------------------------
// 3. Where the signature preview is drawn
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
      /** Box rectangle as percentages of the page, CSS orientation
       *  (origin top-left) so a component can position it directly. */
      leftPct: number;
      topPct: number;
      widthPct: number;
      heightPct: number;
      /** Page aspect (width / height), for the page schematic. */
      pageAspect: number;
      /** Whether the page size was measured or assumed to be Letter. */
      pageGeometry: 'measured' | 'assumed';
    }
  | {
      mode: 'deferred';
      reason: 'no-recorded-position';
    };

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Decide where, if anywhere, the signer's mark may be previewed.
 *
 * The contract is that the preview cannot disagree with the final
 * render. So this reads the SAME recorded coordinates
 * lib/signature-render.ts reads, and clamps them the same way it does
 * (it applies Math.max(0, Math.min(1, ...)) before drawing), and it
 * converts from the PDF origin at bottom-left to the CSS origin at
 * top-left rather than inventing anything.
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
}): SignatureLinePlacement {
  const { positionPage, positionX, positionY } = input;
  if (!finite(positionPage) || !finite(positionX) || !finite(positionY)) {
    return { mode: 'deferred', reason: 'no-recorded-position' };
  }
  const page = Math.floor(positionPage);
  if (page < 1) return { mode: 'deferred', reason: 'no-recorded-position' };

  const measured =
    finite(input.pageWidthPt) &&
    finite(input.pageHeightPt) &&
    input.pageWidthPt > 0 &&
    input.pageHeightPt > 0;
  const pw = measured ? (input.pageWidthPt as number) : ASSUMED_PAGE_WIDTH_PT;
  const ph = measured ? (input.pageHeightPt as number) : ASSUMED_PAGE_HEIGHT_PT;

  // Same clamp the renderer applies before it draws.
  const x = Math.max(0, Math.min(1, positionX));
  const y = Math.max(0, Math.min(1, positionY));

  const widthFrac = Math.min(1, SIGNATURE_BOX_WIDTH_PT / pw);
  const heightFrac = Math.min(1, SIGNATURE_BOX_HEIGHT_PT / ph);
  // PDF y is the BOTTOM edge of the box, measured up from the bottom
  // of the page. CSS top is the TOP edge, measured down from the top.
  const topFrac = 1 - (y + heightFrac);

  // Keep the box inside the schematic. The renderer draws outside the
  // page when the recorded anchor sits near an edge, but a preview that
  // overflows its own frame reads as a layout bug rather than as a
  // faithful position.
  const left = Math.max(0, Math.min(1 - widthFrac, x));
  const top = Math.max(0, Math.min(1 - heightFrac, topFrac));

  return {
    mode: 'placed',
    page,
    leftPct: left * 100,
    topPct: top * 100,
    widthPct: widthFrac * 100,
    heightPct: heightFrac * 100,
    pageAspect: pw / ph,
    pageGeometry: measured ? 'measured' : 'assumed',
  };
}

// ---------------------------------------------------------------------
// 4. Whether the signer may keep a copy
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
