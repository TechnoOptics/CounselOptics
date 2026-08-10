import 'server-only';

import { createHash } from 'node:crypto';
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
 * The declared media type is only the caller's claim, so it is not read at
 * all: the magic number below is the fact. That is what stops an SVG arriving
 * under a PNG label, and an SVG is a script-bearing document that would end up
 * both inside a PDF renderer and inside an `<img>` on the reviewer's page.
 *
 * There was a `startsWith('data:image/png;base64,')` check here. It is gone on
 * purpose. Nothing could break it: loosening or removing it changed no accept
 * and no reject, because every caller it would have turned away is turned away
 * by the magic number a few lines down. A check that cannot fail reads like a
 * second line of defence and is not one, so the media type is now genuinely
 * ignored rather than being ignored while appearing to be enforced.
 *
 * What replaces it does carry weight: the base64 payload is located rather
 * than assumed to sit at a fixed offset, so a data URL that declares another
 * parameter before `;base64,` still decodes to the bytes it carries instead of
 * to rubbish.
 */
export function decodeSignaturePng(dataUrl: unknown): DecodedSignature {
  if (typeof dataUrl !== 'string' || dataUrl === '') {
    return { ok: false, error: 'No signature image was supplied.' };
  }
  const marker = ';base64,';
  const at = dataUrl.indexOf(marker);
  if (at < 0) {
    return { ok: false, error: 'The signature has to be a PNG image.' };
  }
  const body = dataUrl.slice(at + marker.length);
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
 * The three ways a person can produce a mark. These are the values the column
 * stores, so nothing translates between what the pad reports and what the row
 * records. 'typed' is a first-class signature and not a degraded one.
 */
export const SIGNATURE_MODES = ['typed', 'drawn', 'uploaded'] as const;
export type SignatureMode = (typeof SIGNATURE_MODES)[number];

/** The seven columns the mark and the record around it occupy. */
export type SignatureColumns = {
  signature_image_path: string | null;
  signature_mode: SignatureMode | null;
  signature_captured_at: string | null;
  signature_intent_at: string | null;
  signature_ip: string | null;
  signature_user_agent: string | null;
  signed_document_sha256: string | null;
};

/**
 * The caller's claimed mode, or null.
 *
 * The mode arrives over HTTP from a caller nobody controls, and the column
 * carries a CHECK constraint. An unrecognised value would not be stored as an
 * odd string, it would fail the whole update, and the update it rides on is
 * the one that records the submission. So an unknown mode is dropped and the
 * rest of the record still lands.
 */
export function signatureModeOrNull(value: unknown): SignatureMode | null {
  return (SIGNATURE_MODES as readonly string[]).includes(value as string)
    ? (value as SignatureMode)
    : null;
}

/**
 * The fingerprint of the exact words a mark was affirmed against.
 *
 * This is what makes "signed by someone who saw those words" checkable rather
 * than merely asserted, and it is the hinge the re-sign gate will hang on: a
 * reviewer edit moves the document, the stored hash no longer matches, and the
 * mismatch is a fact rather than a procedure someone has to remember.
 */
export function documentSignatureHash(documentText: string): string {
  return createHash('sha256').update(documentText, 'utf8').digest('hex');
}

/** Long enough to hold a real value, short enough that neither is a payload. */
const MAX_IP = 100;
const MAX_USER_AGENT = 500;

/**
 * The record to write beside a submission, built from what the server knows.
 *
 * Two things are deliberately not taken from the caller.
 *
 * The timestamps are this server's clock. The browser sends a
 * `signatureIntentAt`, and it is read only as "the box was ticked", never as
 * "and here is when". A time on an audit record that the caller chose is the
 * caller's word for when they signed, which is the opposite of what the record
 * is for, and backdating it would cost nothing.
 *
 * The hash is over the document this server just merged from the firm's own
 * template, never over anything that arrived in the request. The whole point of
 * rebuilding the document server-side is undone if the fingerprint of it comes
 * from the caller.
 */
export function signatureColumns(input: {
  /** Where the PNG landed, or null when there is no image to store. */
  markPath: string | null;
  /** The caller's claimed capture mode. Validated here. */
  mode: unknown;
  /** Whether the caller affirmed intent. The time is this server's. */
  intentAffirmed: boolean;
  ip: string | null;
  userAgent: string | null;
  /** The document as the server built it. */
  documentText: string;
  now: Date;
}): SignatureColumns {
  const at = input.now.toISOString();
  return {
    signature_image_path: input.markPath,
    signature_mode: signatureModeOrNull(input.mode),
    // Captured means there is a mark. A submission with no image has nothing
    // that was captured, and a timestamp saying otherwise would be a claim the
    // storage bucket cannot back up.
    signature_captured_at: input.markPath ? at : null,
    signature_intent_at: input.intentAffirmed ? at : null,
    signature_ip: (input.ip ?? '').trim().slice(0, MAX_IP) || null,
    signature_user_agent:
      (input.userAgent ?? '').trim().slice(0, MAX_USER_AGENT) || null,
    signed_document_sha256: documentSignatureHash(input.documentText),
  };
}

/**
 * What a reviewer's edit leaves behind.
 *
 * The mark was affirmed against different words, so it is no longer a
 * signature on this document. Every one of the seven goes, including the hash:
 * a hash left pointing at the previous wording would say the current document
 * was signed when it was not, which is worse than saying nothing.
 */
export const CLEARED_SIGNATURE_COLUMNS: SignatureColumns = {
  signature_image_path: null,
  signature_mode: null,
  signature_captured_at: null,
  signature_intent_at: null,
  signature_ip: null,
  signature_user_agent: null,
  signed_document_sha256: null,
};

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
  assertPathSegments([firmId, submissionId]);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('Invalid revision.');
  }
  return `templates/${firmId}/${submissionId}/${revision}.png`;
}

/**
 * Every segment that goes into a path in this bucket, checked in one place.
 *
 * The allowlist is what does the work, not the `..` test beside it: a segment
 * matching `[A-Za-z0-9._-]+` cannot contain a slash, so it cannot climb out of
 * its prefix or reach into another firm's, whatever it says. The explicit `..`
 * rejection is kept because `..` alone passes that pattern and is worth
 * refusing by name.
 *
 * Callers pass database uuids today, so nothing currently reaches the throw.
 * That is a property of the callers, not of the path, and the prefix is the
 * only thing separating one firm's signature images from another's.
 */
function assertPathSegments(parts: unknown[]): void {
  for (const part of parts) {
    if (
      typeof part !== 'string' ||
      part === '' ||
      !/^[A-Za-z0-9._-]+$/.test(part) ||
      part.includes('..')
    ) {
      throw new Error('Invalid storage path segment.');
    }
  }
}

/**
 * Where an outside signer's mark lives.
 *
 * The literal this replaces was built inline in lib/signature-write.ts, and it
 * is moved here so the bucket has ONE module that knows how to address it
 * rather than two that agree by inspection. lib/signature-geometry.ts exists
 * because three hand-written copies of the box arithmetic drifted twice in
 * opposite directions; a storage prefix is smaller but the failure is worse,
 * because a path that drifts writes one firm's signature into another firm's
 * folder.
 */
export function signerMarkPath(
  firmId: string,
  signingRequestId: string,
  signatureId: string,
): string {
  assertPathSegments([firmId, signingRequestId, signatureId]);
  return `${firmId}/${signingRequestId}/${signatureId}.png`;
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
