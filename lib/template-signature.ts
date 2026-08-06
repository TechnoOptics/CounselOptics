import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The employee's signature mark on a filled template: validating it, storing
 * it, and reading it back.
 *
 * The mark arrives as a data URL a browser produced, so it arrives over HTTP
 * from a caller and is not trusted. Everything that decides whether it may
 * become a file is in decodeSignaturePng, which is pure and tested.
 *
 * The bytes live in the existing private firm-signatures bucket, reached only
 * by the service-role client, exactly as the outside signer's mark already is.
 * Storage is private: the reviewer's page reads it through a short-lived signed
 * URL and the release path reads it server-side, so a document nobody may hold
 * does not leak its signature.
 */

/** The bucket the outside signer's marks already live in. */
const BUCKET = 'firm-signatures';

/**
 * The most a decoded mark may weigh. A canvas signature is a few tens of
 * kilobytes; a phone photo of a signature on paper is the large end. Half a
 * megabyte covers both with room to spare and still refuses anything that is
 * plainly not a signature.
 */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

/** The eight bytes that begin every PNG file. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type DecodedSignature =
  | { ok: true; bytes: Buffer }
  | { ok: false; error: string };

/**
 * Turn a `data:image/png;base64,...` URL into bytes, or say why not.
 *
 * The declared media type is only the caller's claim, so it is checked and
 * then ignored in favour of the magic number. That is what stops an SVG
 * arriving under a PNG label: an SVG is a script-bearing document, and this
 * mark ends up both inside a PDF renderer and inside an `<img>` on the
 * reviewer's page.
 */
export function decodeSignaturePng(dataUrl: unknown): DecodedSignature {
  if (typeof dataUrl !== 'string' || dataUrl === '') {
    return { ok: false, error: 'No signature image was supplied.' };
  }
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    return { ok: false, error: 'The signature has to be a PNG image.' };
  }
  const body = dataUrl.slice(prefix.length);
  if (body.trim() === '') {
    return { ok: false, error: 'The signature image was empty.' };
  }
  // Base64 decoding is lenient and quietly drops anything it does not
  // recognise, so a corrupt body decodes to plausible-looking rubbish rather
  // than throwing. The magic number below is what actually catches it.
  let bytes: Buffer;
  try {
    bytes = Buffer.from(body, 'base64');
  } catch {
    return { ok: false, error: 'The signature image could not be read.' };
  }
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: 'That signature image is too large.' };
  }
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, error: 'The signature image could not be read.' };
  }
  return { ok: true, bytes };
}

/**
 * Where a submission's mark lives.
 *
 * Keyed by revision so a resubmission writes beside its predecessor rather
 * than over it: a submission that went back to the employee and returned is
 * two different documents, and the record of which mark was on which one is
 * worth keeping.
 */
export function submissionMarkPath(
  firmId: string,
  submissionId: string,
  revision: number,
): string {
  for (const part of [firmId, submissionId]) {
    if (typeof part !== 'string' || part === '' || !/^[A-Za-z0-9._-]+$/.test(part) || part.includes('..')) {
      throw new Error('Invalid storage path segment.');
    }
  }
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('Invalid revision.');
  }
  return `templates/${firmId}/${submissionId}/${revision}.png`;
}

/**
 * Put the mark in the bucket and hand back its path.
 *
 * Returns null rather than throwing on any failure. Every caller stores the
 * mark alongside work that matters more than the mark does: a submission that
 * reached the legal team without its squiggle is recoverable, a submission
 * that vanished because its picture would not upload is not.
 */
export async function storeSubmissionMark(
  admin: SupabaseClient,
  input: { firmId: string; submissionId: string; revision: number; bytes: Buffer },
): Promise<string | null> {
  try {
    const path = submissionMarkPath(input.firmId, input.submissionId, input.revision);
    const { error } = await admin.storage.from(BUCKET).upload(path, input.bytes, {
      contentType: 'image/png',
      // A resubmission at the same revision is the employee correcting
      // themselves, so it overwrites its own file and nobody else's.
      upsert: true,
    });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/** The stored bytes, for the release path, or null when there are none. */
export async function loadSubmissionMark(
  admin: SupabaseClient,
  path: string | null | undefined,
): Promise<Buffer | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * A short-lived URL the reviewer's browser may load the mark from.
 *
 * Short-lived because the bucket is private and must stay that way: the same
 * approval gate that decides whether a reviewer may read the document decides
 * whether this is fetched at all, and a link that outlived the page would be a
 * way around it.
 */
export async function signedMarkUrl(
  admin: SupabaseClient,
  path: string | null | undefined,
  expiresInSeconds = 300,
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
