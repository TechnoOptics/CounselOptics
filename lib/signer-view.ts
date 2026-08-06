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
 *   1. Which URL a mounted document frame shows (stableSignerFrameSrc /
 *      createSignerFrameSrcRetainer).
 *   2. When the signer may leave the disclosure step
 *      (canLeaveDisclosureStep).
 *   3. Where the signature preview may be drawn, if anywhere
 *      (resolveSignatureLinePlacement), and what the preview has to
 *      admit about its own accuracy (signaturePreviewGeometryNote).
 *   4. Whether the signer may download a copy, and of what
 *      (parseSignerDownloadPermission / resolveSignerCopyAccess).
 *   5. What of the signer's affirmations reaches the audit chain
 *      (projectSignerConsentMetadata).
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

/**
 * How long the frame's URL is good for, in minutes.
 *
 * The seconds form that storage is actually given derives from this
 * (lib/firm-storage.ts), so the number the signer is told and the
 * number the signature carries cannot drift apart. It is told to them
 * because a long contract read on a phone can outlast it, and the
 * failure otherwise is a raw storage error with no hint that reloading
 * the page fixes it.
 */
export const SIGNER_DOCUMENT_URL_TTL_MINUTES = 30;

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
 * ASKED FOR, because requiring an acknowledgement of something the
 * signer was never shown would be a fiction the audit chain would then
 * carry. But the step does not open either. A failed load is precisely
 * the case where the signer has not seen the record, and the whole
 * point of showing the document is that nobody signs one they have not
 * read. So the ceremony stops there and the page tells them to ask the
 * firm for the document.
 *
 * What this cannot prove, stated once here because the field name
 * invites the stronger reading: `documentPresented` means a URL was
 * minted and handed to the frame. It does not mean the browser
 * rendered the PDF. A device that downloads the file instead of
 * framing it shows the signer nothing while this still reads true.
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

  const x = positionX;
  const y = positionY;

  const widthFrac = Math.min(1, SIGNATURE_BOX_WIDTH_PT / pw);
  const heightFrac = Math.min(1, SIGNATURE_BOX_HEIGHT_PT / ph);
  // PDF y is the BOTTOM edge of the box, measured up from the bottom
  // of the page. CSS top is the TOP edge, measured down from the top.
  const topFrac = 1 - (y + heightFrac);

  // Keep the box inside the schematic. The renderer draws outside the
  // page when the recorded anchor sits near an edge, but a preview that
  // overflows its own frame reads as a layout bug rather than as a
  // faithful position.
  //
  // This also subsumes the 0-to-1 clamp the renderer applies to the
  // raw coordinate before it draws: for any x or y outside that range
  // these two lines land on the same answer clamping first would have,
  // so a separate clamp above would be code no test could distinguish.
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

/**
 * What the preview has to admit when it never measured the page.
 *
 * `resolveSignatureLinePlacement` falls back to US Letter when no page
 * size was passed, and the sign page passes none, because measuring
 * means downloading and parsing the PDF on every render of an
 * unauthenticated page. Three things are then approximate rather than
 * exact, and the signer is entitled to know:
 *
 *   - The page outline. A landscape page is drawn as a portrait one.
 *   - The box size. On US Legal the box is drawn taller than it is.
 *   - The box POSITION, above a threshold. The containment clamp uses
 *     the box width as a fraction of the ASSUMED width, so it engages
 *     at x = 1 - 220/612 whatever the real page is. Below that the
 *     position is exact on any page size. Above it, a page that is not
 *     Letter can put the box a visible distance from where it is drawn
 *     here, and firm-supplied anchors on the right half of a page do
 *     reach it.
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
    'The outline and the box size here assume a standard letter-size page, ' +
    'because this preview does not measure the document. If the document ' +
    'uses another page size, the box can sit some way from where it is drawn ' +
    'here. The signed copy is the record.'
  );
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
// 5. What of the signer's affirmations reaches the audit chain
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
