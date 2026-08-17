/**
 * The typeface a firm's generated documents are SET IN.
 *
 * A firm already controls the stationery its documents are printed on
 * (firms.letterhead_url, and the designed letterhead in
 * lib/letterhead-design.ts). It did not control the words, which were Times on
 * every document this product has ever produced. A firm whose brand face is
 * something else therefore received a sheet and a body set in two different
 * families, which is the defect this closes.
 *
 * WHERE IT IS STORED, AND WHY THERE IS NO MIGRATION FOR THE DATA
 * --------------------------------------------------------------
 * Under `firms.metadata.document_typeface`, exactly as the designed letterhead
 * lives under `firms.metadata.letterhead_design`. firms.metadata is an existing
 * jsonb column, so the record itself adds no column.
 *
 * The consequence is the one lib/letterhead-design.ts already records and it is
 * the reason normalizeDocumentTypeface exists: metadata is a SHARED bag that
 * several unrelated code paths write their own keys into, and none of them
 * knows about this one. What comes back out is untyped by construction. A wrong
 * type, a missing key or a foreign key is an ordinary read rather than a
 * corrupted database, and every read goes through the normalizer, which is the
 * trust boundary for all of it.
 *
 * The font FILES live in the existing public `firm-branding` bucket beside the
 * logo and the letterhead. That bucket's own allowed_mime_types list does have
 * to be widened, and that is the one migration this feature needs.
 *
 * THIS MODULE IS PURE ON PURPOSE
 * ------------------------------
 * Zero imports, no `server-only`, no React, matching lib/letterhead-design.ts.
 * The settings uploader is a client component and the PDF renderer is a server
 * module, and both need the identical answer to "is this file a font we can
 * actually embed?". Answering it twice is how an uploader starts accepting a
 * file the renderer cannot use, which is exactly the defect the letterhead work
 * found when a WebP was accepted and could never be drawn.
 */

/**
 * The key inside firms.metadata. Named once so the server action that writes it
 * and the renderer that reads it cannot drift onto two spellings.
 */
export const DOCUMENT_TYPEFACE_METADATA_KEY = 'document_typeface';

/**
 * What a font file's leading bytes say it is.
 *
 * 'collection' is named rather than accepted because a .ttc holds SEVERAL faces
 * and embedding one means choosing between them, which is a decision this
 * feature does not offer the firm a way to make.
 */
export type FontFormat =
  | 'truetype'
  | 'opentype'
  | 'collection'
  | 'woff'
  | 'woff2';

/** The firm's licence assertion, stored so the answer is auditable later. */
export type TypefaceLicence = {
  acknowledgedAt: string;
  acknowledgedBy: string;
  /** Who the firm says holds the licence. Free text, never validated. */
  holder: string;
};

export type DocumentTypeface = {
  /** Public URL of the regular weight. Required: the body is most of a document. */
  regularUrl: string;
  /** Public URL of the bold weight, or null. Headings fall back to regular. */
  boldUrl: string | null;
  /** What the firm calls the family, for the settings screen only. */
  familyName: string;
  licence: TypefaceLicence;
};

/**
 * Identify a font from its leading bytes.
 *
 * PREFERRED OVER Content-Type AND OVER THE FILE EXTENSION, and that is not a
 * style preference. The letterhead work measured this: storage serves back
 * whatever contentType it was handed at upload, so a mis-tagged upload arrives
 * as application/octet-stream and a header-only decision sends the wrong bytes
 * to a decoder that throws. A magic number cannot be mis-tagged.
 *
 * Null means "these bytes are not any font format we recognise", which the
 * caller must treat as a refusal rather than as a reason to guess.
 */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 4) return null;
  const [a, b, c, d] = bytes;

  // 0x00010000 - the TrueType/OpenType version 1.0 sfnt header.
  if (a === 0x00 && b === 0x01 && c === 0x00 && d === 0x00) return 'truetype';
  // 'true' - Apple's variant of the same thing.
  if (a === 0x74 && b === 0x72 && c === 0x75 && d === 0x65) return 'truetype';
  // 'OTTO' - OpenType with CFF (PostScript) outlines.
  if (a === 0x4f && b === 0x54 && c === 0x54 && d === 0x4f) return 'opentype';
  // 'ttcf' - a TrueType collection, several faces in one file.
  if (a === 0x74 && b === 0x74 && c === 0x63 && d === 0x66) return 'collection';
  // 'wOFF' / 'wOF2' - web formats, compressed wrappers around an sfnt.
  if (a === 0x77 && b === 0x4f && c === 0x46 && d === 0x46) return 'woff';
  if (a === 0x77 && b === 0x4f && c === 0x46 && d === 0x32) return 'woff2';

  return null;
}

/** The two formats fontkit can hand to pdf-lib as a single embeddable face. */
const EMBEDDABLE: ReadonlySet<FontFormat> = new Set<FontFormat>([
  'truetype',
  'opentype',
]);

/**
 * Why these bytes cannot be embedded, or null when they can be.
 *
 * NAMED REFUSALS, NOT A GENERIC ONE. WOFF and WOFF2 are what a firm actually
 * reaches this path with, because a brand kit ships web fonts and a designer
 * hands over whatever the site uses. Telling that firm "unsupported file" leaves
 * it with nothing to do; telling it the file is a WOFF and that a TTF or OTF is
 * what a PDF needs is the difference between a fixed letterhead and a firm that
 * quietly gives up.
 *
 * There is deliberately no silent fallback anywhere near this function. A font
 * that is refused has to be refused visibly, or the firm believes its documents
 * are set in its own face when they are still Times.
 */
export function fontRejectionReason(bytes: Uint8Array): string | null {
  const format = sniffFontFormat(bytes);
  if (format !== null && EMBEDDABLE.has(format)) return null;

  if (format === 'woff' || format === 'woff2') {
    const name = format === 'woff2' ? 'WOFF2' : 'WOFF';
    return (
      `This is a ${name} file, which is a web font format and cannot be embedded ` +
      'in a PDF. Upload the same typeface as a TTF or OTF file.'
    );
  }
  if (format === 'collection') {
    return (
      'This is a font collection, which holds several faces in one file. ' +
      'Upload a single TTF or OTF file for each weight.'
    );
  }
  return 'This file is not a font. Upload a TTF or OTF file.';
}

/**
 * The largest font file the uploader accepts, in bytes.
 *
 * 4 MB. A text face with a full Latin character set is well under 1 MB, and the
 * `firm-branding` bucket caps objects at 8 MB, so this leaves the app as the
 * stricter of the two. That ordering matters: the letterhead work found the
 * opposite arrangement, where the action admitted 8 MB and the bucket refused
 * at 3 MB, and the firm was shown a raw storage string instead of an answer.
 */
export const MAX_FONT_BYTES = 4 * 1024 * 1024;

/** What the uploader was given, before any of it is stored. */
export type TypefaceUploadInput = {
  bytes: Uint8Array;
  /** Whether the firm ticked the licence confirmation. */
  licenceAcknowledged: boolean;
  /** Who the firm says holds the licence. */
  licenceHolder: string;
};

/**
 * Why this upload is refused, or null when it may proceed.
 *
 * THE ORDER OF THE CHECKS IS PART OF THE ANSWER. Format is decided before size,
 * because a firm that uploaded a 30 MB WOFF needs to hear that it is a WOFF:
 * being told the file is too large would send it off to compress something that
 * was never going to work at any size.
 *
 * THE LICENCE QUESTION IS ASKED LAST AND NEVER BUYS A PASS ON THE FORMAT. A firm
 * that attested to a licence for a file that was then silently dropped has been
 * asked to affirm something about a font that is not on its documents, which is
 * worse than not asking.
 *
 * ON THE LICENCE CHECK ITSELF. Embedding a typeface into a PDF is governed by
 * that typeface's licence, and plenty of commercial licences either forbid it or
 * require a particular tier. Advottic cannot verify any of that: it cannot know
 * what the firm bought, and there is no registry to check against. What it can
 * do is refuse to embed a font nobody has claimed, and keep the claim. So this
 * is not a validation of the licence, and it is not represented to the firm as
 * one. It records who said what, on a product whose documents go to
 * counterparties and into court files.
 */
export function typefaceUploadRejection(input: TypefaceUploadInput): string | null {
  if (input.bytes.length === 0) {
    return 'That file is empty. Choose a TTF or OTF file.';
  }

  const rejection = fontRejectionReason(input.bytes);
  if (rejection) return rejection;

  if (input.bytes.length > MAX_FONT_BYTES) {
    const mb = Math.round(MAX_FONT_BYTES / (1024 * 1024));
    return `The font file must be under ${mb} MB.`;
  }

  if (!input.licenceAcknowledged) {
    return (
      'Confirm that your firm holds a licence for this typeface that permits ' +
      'embedding it in documents.'
    );
  }
  if (!input.licenceHolder.trim()) {
    return 'Enter the name of the organisation that holds the typeface licence.';
  }

  return null;
}

/** A URL the renderer is willing to fetch a font from. */
function usableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // http(s) only. The renderer fetches this from a server, so any other scheme
  // is either unreachable or is asking the server to read something local.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The trust boundary over the shared metadata bag. See the module header.
 *
 * Null means "this firm has no usable typeface", which every caller treats as
 * "use Times". That is the same answer for a firm that never set one and for a
 * firm whose record is malformed, and deliberately so: neither is a state in
 * which a document should fail to render.
 *
 * THE LICENCE ACKNOWLEDGEMENT IS PART OF VALIDITY, not decoration. A record with
 * no acknowledgement cannot have come from the uploader, which requires one, so
 * it was written by something else or by hand. Refusing it is what keeps the
 * stored attestation meaningful: every font this returns is one a firm affirmed
 * it holds a licence for.
 */
export function normalizeDocumentTypeface(value: unknown): DocumentTypeface | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;

  const regularUrl = usableUrl(raw.regularUrl);
  if (!regularUrl) return null;

  // A bold weight is optional, so an unusable one is DROPPED rather than
  // invalidating the record. Headings fall back to the regular weight, which is
  // a mild loss; losing the firm's face entirely over its second file is not.
  const boldUrl = usableUrl(raw.boldUrl);

  const licenceRaw = raw.licence;
  if (typeof licenceRaw !== 'object' || licenceRaw === null || Array.isArray(licenceRaw)) {
    return null;
  }
  const licence = licenceRaw as Record<string, unknown>;
  const holder = trimmedString(licence.holder);
  if (!holder) return null;

  return {
    regularUrl,
    boldUrl,
    familyName: trimmedString(raw.familyName) || 'Custom typeface',
    licence: {
      acknowledgedAt: trimmedString(licence.acknowledgedAt),
      acknowledgedBy: trimmedString(licence.acknowledgedBy),
      holder,
    },
  };
}

/** The firm's typeface, read out of its metadata column. */
export function firmDocumentTypeface(metadata: unknown): DocumentTypeface | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  return normalizeDocumentTypeface(
    (metadata as Record<string, unknown>)[DOCUMENT_TYPEFACE_METADATA_KEY],
  );
}
