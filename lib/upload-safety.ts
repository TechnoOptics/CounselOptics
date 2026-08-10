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
 * True when the buffer really is an audio recording.
 *
 * Extensions and declared MIME types are attacker- and browser-controlled, and
 * an audio exhibit's bytes are sent whole to a third-party transcription API,
 * so this reads the container signature instead. Kept separate from SIGNATURES
 * because that table drives the Community allowlist, which accepts only
 * pictures and PDFs and should not start accepting recordings.
 */
export function isAudioBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const ascii = (start: number, end: number) => buf.toString('ascii', start, end);

  // MP3: an ID3v2 tag, or a bare MPEG frame sync (11 set bits).
  if (ascii(0, 3) === 'ID3') return true;
  if (buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2) return true;

  // WAV: a RIFF container whose form type is WAVE. WebP is also RIFF, so the
  // form type at byte 8 is the only thing separating them.
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return true;

  // Ogg / Opus, and FLAC.
  if (ascii(0, 4) === 'OggS') return true;
  if (ascii(0, 4) === 'fLaC') return true;

  // Matroska / WebM (EBML header). Shared with video, which is fine: this
  // gate only has to establish that the bytes are a media container.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;

  // ISO base media (m4a, and the mp4 audio brands iPhone voice memos use).
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).trim().toLowerCase();
    if (/^(m4a|m4b|mp4|mp42|isom|iso2|dash|avc1|qt)$/.test(brand)) return true;
  }

  return false;
}

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

/**
 * Screen an AUTHENTICATED upload (firm documents, case exhibits).
 *
 * These come from a signed-in, billed user, so unlike the public
 * community path they may legitimately be many document types (PDF,
 * images, Word/Excel/PowerPoint, text). We therefore don't impose the
 * tiny community allowlist. Instead we do the two things that actually
 * matter for a private bucket served through signed URLs:
 *
 *   1. BLOCK actively-dangerous content regardless of the declared
 *      Content-Type: HTML/SVG/XML-script (stored-XSS when a signed URL
 *      is opened inline) and executables. A renamed `evil.svg` uploaded
 *      as `application/pdf` is caught here.
 *   2. CATCH content-confusion: when the client declares an image or a
 *      PDF, the bytes must actually be that (magic-byte match), and PDFs
 *      are scanned for auto-run JavaScript/OpenAction.
 *
 * Anything else (Office formats, plain text, CSV) is allowed through -
 * it has already cleared the dangerous-content screen. Returns
 * `{ ok: true }` when safe, `{ ok: false, reason }` otherwise.
 */
export function screenAuthenticatedUpload(
  buf: Buffer,
  declaredMime: string | null,
  maxBytes: number,
): { ok: true } | { ok: false; reason: string } {
  if (buf.length === 0) return { ok: false, reason: 'File is empty.' };
  if (buf.length > maxBytes) {
    return {
      ok: false,
      reason: `File is larger than the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`,
    };
  }

  // 1) Dangerous content, by actual bytes.
  const head = buf.toString('latin1', 0, 512).trimStart();
  if (/^<(!doctype html|html|script|svg|\?xml)/i.test(head)) {
    return { ok: false, reason: 'HTML/SVG content is not an accepted document type.' };
  }
  const isMZ = buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a; // PE/.exe/.dll
  const isELF =
    buf.length >= 4 &&
    buf[0] === 0x7f &&
    buf[1] === 0x45 &&
    buf[2] === 0x4c &&
    buf[3] === 0x46;
  const isShebang = buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21; // #!
  if (isMZ || isELF || isShebang) {
    return { ok: false, reason: 'Executable files are not accepted.' };
  }

  // 2) Content-confusion checks for the types clients most often spoof.
  const mime = (declaredMime ?? '').toLowerCase();
  if (mime.startsWith('image/')) {
    const isImage = SIGNATURES.filter((s) => s.kind === 'image').some((s) =>
      s.matches(buf),
    );
    const isHeic =
      buf.length >= 12 &&
      buf.toString('ascii', 4, 8) === 'ftyp' &&
      /heic|heif|mif1|hevc/i.test(buf.toString('ascii', 8, 12));
    if (!isImage && !isHeic) {
      return { ok: false, reason: 'This file is not a valid image.' };
    }
  }
  // Audio is checked because its bytes leave the system: an audio exhibit is
  // uploaded whole to a third-party transcription API. Video is deliberately
  // not checked here - the consumer path does not transcribe it, and the
  // container space is wide enough that a partial check would be a promise
  // this function does not keep.
  if (mime.startsWith('audio/')) {
    if (!isAudioBuffer(buf)) {
      return { ok: false, reason: 'This file is not a valid audio recording.' };
    }
  }
  if (mime === 'application/pdf') {
    if (!(buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-')) {
      return { ok: false, reason: 'This file is not a valid PDF.' };
    }
    const scan = buf.toString('latin1', 0, Math.min(buf.length, 2_000_000));
    if (/\/JavaScript|\/JS\b|\/OpenAction/.test(scan)) {
      return { ok: false, reason: 'This PDF could not be accepted for security reasons.' };
    }
  }

  return { ok: true };
}

export { MAX_EVIDENCE_BYTES, MAX_ID_PHOTO_BYTES };

/**
 * Central chokepoint for AUTHENTICATED storage writes. Every server-side
 * upload of a user-supplied file should go through here rather than calling
 * `client.storage.from(bucket).upload(...)` directly, so the magic-byte /
 * dangerous-content screen (screenAuthenticatedUpload) can never be forgotten
 * on a new upload path. It also uses the caller's DECLARED content-type only
 * after that type has been confirmed against the bytes.
 *
 * Structural client type so this file needn't import the Supabase SDK; both
 * createServerSupabase() and createAdminSupabase() satisfy it.
 */
type StorageUploader = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer | Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export async function safeStorageUpload(input: {
  client: StorageUploader;
  bucket: string;
  path: string;
  buffer: Buffer;
  declaredMime: string | null;
  maxBytes: number;
  upsert?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const screen = screenAuthenticatedUpload(
    input.buffer,
    input.declaredMime,
    input.maxBytes,
  );
  if (!screen.ok) return { ok: false, error: screen.reason };
  const { error } = await input.client.storage
    .from(input.bucket)
    .upload(input.path, input.buffer, {
      contentType: input.declaredMime || 'application/octet-stream',
      upsert: input.upsert ?? false,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
