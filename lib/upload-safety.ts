/**
 * Upload safety for the Community Case public submission surface.
 *
 * Every other upload path in this app (exhibits, firm documents) comes
 * from an authenticated, billed, presumably-identifiable user, and their
 * risk classification (lib/security-scan.ts `classifyFileRisk`) only
 * compares the file extension against the *declared* MIME string - both
 * attacker-controlled. Community Case evidence/testimonial uploads come
 * from anonymous members of the public, so this module verifies the
 * actual file bytes (magic numbers) against a short allowlist instead of
 * trusting anything the client claims. See the "Upload safety" section
 * of the Community Case plan for the full rationale.
 */

export type AllowedCommunityFileKind = 'image' | 'pdf';

export type UploadSafetyResult =
  | { ok: true; kind: AllowedCommunityFileKind; mimeType: string }
  | { ok: false; reason: string };

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const MAX_ID_PHOTO_BYTES = 10 * 1024 * 1024;

/** Magic-byte signatures for the small allowlist this feature accepts.
 * Checked against the actual buffer, never the declared/extension MIME. */
const SIGNATURES: Array<{
  mimeType: string;
  kind: AllowedCommunityFileKind;
  matches: (buf: Buffer) => boolean;
}> = [
  {
    mimeType: 'image/jpeg',
    kind: 'image',
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    kind: 'image',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mimeType: 'image/webp',
    kind: 'image',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mimeType: 'application/pdf',
    kind: 'pdf',
    matches: (buf) => buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-',
  },
];

/**
 * Validate an uploaded file buffer for the public Community Case surface.
 * Rejects on size, on a magic-byte mismatch against the allowlist above
 * (so a renamed .exe or a mislabeled SVG is rejected regardless of what
 * the browser declared as its Content-Type), and on suspicious PDF
 * content (embedded JavaScript / auto-open actions).
 */
export function validateCommunityUpload(buf: Buffer): UploadSafetyResult {
  if (buf.length === 0) {
    return { ok: false, reason: 'File is empty.' };
  }
  if (buf.length > MAX_EVIDENCE_BYTES) {
    return { ok: false, reason: 'File is larger than the 25MB limit.' };
  }

  const match = SIGNATURES.find((sig) => sig.matches(buf));
  if (!match) {
    return {
      ok: false,
      reason: 'Unsupported file type. Please upload a JPEG, PNG, WebP image, or a PDF.',
    };
  }

  if (match.kind === 'pdf') {
    // Cheap string scan for active-content tags. Not a full parse, but
    // catches the common "PDF that auto-runs a script on open" pattern
    // without pulling in a heavier PDF-structure dependency for this
    // check alone (pdf-lib is already a dependency for the export path
    // and could be used for a deeper structural check later if needed).
    const head = buf.toString('latin1', 0, Math.min(buf.length, 2_000_000));
    if (/\/JavaScript|\/JS\b|\/OpenAction/.test(head)) {
      return { ok: false, reason: 'This PDF could not be accepted for security reasons.' };
    }
  }

  return { ok: true, kind: match.kind, mimeType: match.mimeType };
}

/**
 * Validate an ID photo (Letter of Support front/back capture). Images
 * only - no PDF, since these are always camera/photo captures - and a
 * tighter 10MB cap than general evidence, since a phone photo of a
 * driver's license doesn't need 25MB. Same magic-byte + re-check
 * approach as `validateCommunityUpload`; kept as a separate function
 * rather than a parameter so the ID-photo path's stricter rules can't
 * accidentally drift if the evidence path's limits change later.
 */
export function validateIdPhoto(buf: Buffer): UploadSafetyResult {
  if (buf.length === 0) {
    return { ok: false, reason: 'File is empty.' };
  }
  if (buf.length > MAX_ID_PHOTO_BYTES) {
    return { ok: false, reason: 'Image is larger than the 10MB limit.' };
  }
  const match = SIGNATURES.filter((sig) => sig.kind === 'image').find((sig) => sig.matches(buf));
  if (!match) {
    return {
      ok: false,
      reason: 'Unsupported image type. Please use a JPEG, PNG, or WebP photo.',
    };
  }
  return { ok: true, kind: match.kind, mimeType: match.mimeType };
}

export { MAX_EVIDENCE_BYTES, MAX_ID_PHOTO_BYTES };
