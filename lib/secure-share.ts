import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Secure document sharing. A court packet (or any exported PDF) is encrypted
 * with a one-time AES-256-GCM key, stored as ciphertext in the private
 * `exhibits` bucket, and reachable only via a random token URL. The recipient
 * must supply the key to decrypt it — the server never persists the key, so a
 * leaked storage path or token alone yields only ciphertext.
 *
 * Storage is used instead of a DB table so the feature needs no migration:
 *   exhibits/secure-shares/{token}/doc.enc   → iv(12) | authTag(16) | ciphertext
 *   exhibits/secure-shares/{token}/meta.json → non-secret metadata (below)
 * The bucket has no public policy; only the service-role server reads it.
 */

const BUCKET = 'exhibits';
const PREFIX = 'secure-shares';

export type ShareMeta = {
  caseId: string;
  firmId: string;
  createdBy: string; // user id
  createdByName: string | null;
  recipientEmail: string;
  filename: string;
  caseTitle: string;
  scopeLabel: string; // e.g. "Full court packet"
  sizeBytes: number;
  createdAt: string; // ISO
  expiresAt: string; // ISO
};

/** A URL-safe token used as both the share id and the storage prefix. */
export function newShareToken(): string {
  return crypto.randomBytes(18).toString('base64url'); // 24 chars, 144 bits
}

/** True for a well-formed token (guards path traversal on the open route). */
export function isValidToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(t);
}

/** Encrypt a PDF; returns the stored blob and the HEX key to hand out. Hex is
 *  used (not base64url) so the key's own alphabet contains no dashes/spaces —
 *  which means dash-grouping for readability is pure formatting we can strip. */
export function encryptDocument(pdf: Buffer): { blob: Buffer; key: string } {
  const key = crypto.randomBytes(32); // AES-256
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(pdf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { blob: Buffer.concat([iv, tag, ct]), key: key.toString('hex') };
}

/** Decrypt a stored blob with the recipient's key (hex, any grouping/spacing).
 *  Throws on a wrong/tampered key (GCM auth failure) — callers treat a throw as
 *  "incorrect key". */
export function decryptDocument(blob: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(unformatKey(keyHex), 'hex');
  if (key.length !== 32) throw new Error('bad key');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

/** Format the hex key in dash-separated groups of 8 so it is readable/typable. */
export function formatKey(key: string): string {
  return (key.match(/.{1,8}/g) || [key]).join('-');
}
/** Normalize pasted input back to bare hex (drops dashes, spaces, case noise). */
export function unformatKey(input: string): string {
  return input.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export async function storeShare(
  admin: SupabaseClient,
  token: string,
  blob: Buffer,
  meta: ShareMeta,
): Promise<boolean> {
  const base = `${PREFIX}/${token}`;
  const a = await admin.storage.from(BUCKET).upload(`${base}/doc.enc`, blob, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (a.error) return false;
  const b = await admin.storage.from(BUCKET).upload(`${base}/meta.json`, Buffer.from(JSON.stringify(meta)), {
    contentType: 'application/json',
    upsert: false,
  });
  if (b.error) {
    // Roll back the ciphertext so we never leave a keyless orphan.
    await admin.storage.from(BUCKET).remove([`${base}/doc.enc`]).catch(() => {});
    return false;
  }
  return true;
}

export async function loadShare(
  admin: SupabaseClient,
  token: string,
): Promise<{ blob: Buffer; meta: ShareMeta } | null> {
  const base = `${PREFIX}/${token}`;
  const m = await admin.storage.from(BUCKET).download(`${base}/meta.json`);
  if (m.error || !m.data) return null;
  let meta: ShareMeta;
  try {
    meta = JSON.parse(await m.data.text()) as ShareMeta;
  } catch {
    return null;
  }
  const d = await admin.storage.from(BUCKET).download(`${base}/doc.enc`);
  if (d.error || !d.data) return null;
  return { blob: Buffer.from(await d.data.arrayBuffer()), meta };
}
