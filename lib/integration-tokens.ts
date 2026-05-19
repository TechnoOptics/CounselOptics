import crypto from 'node:crypto';

/**
 * AES-256-GCM envelope for OAuth tokens stored in firm_integrations.
 *
 * Why encrypt at the application layer when Postgres / Supabase
 * already encrypts at rest:
 *   - Defense in depth: a leaked database backup, a service-role-key
 *     leak, or a misconfigured RLS policy each independently exposes
 *     plaintext tokens. The application-layer envelope means an
 *     attacker would also need INTEGRATION_ENCRYPTION_KEY out of the
 *     Vercel env to decrypt.
 *   - Forward security: rotating the encryption key invalidates old
 *     ciphertexts WITHOUT having to delete the rows; the next refresh
 *     re-encrypts under the new key.
 *
 * Key management:
 *   - INTEGRATION_ENCRYPTION_KEY env var holds a base64-encoded
 *     32-byte key. Generate with:
 *       openssl rand -base64 32
 *   - In production set as a Sensitive env var in Vercel, scoped to
 *     server runtimes only.
 *
 * Envelope format (bytea in firm_integrations.access_token_encrypted):
 *   [0..1]   = version byte (0x01)
 *   [1..13]  = 12-byte IV (random per write)
 *   [13..29] = 16-byte AES-GCM auth tag
 *   [29..]   = ciphertext
 *
 * If INTEGRATION_ENCRYPTION_KEY is missing the helpers throw - we
 * never want to fall back to plaintext for tokens. Set the env var
 * before turning the integrations on.
 */

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is not set. Generate with: openssl rand -base64 32 - then set the value as a Sensitive env var in Vercel.',
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be base64-encoded.');
  }
  if (key.length !== 32) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptToken(envelope: Buffer): string {
  if (envelope.length < 1 + IV_LEN + TAG_LEN + 1) {
    throw new Error('Token envelope is too short to be valid.');
  }
  const version = envelope[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported token envelope version: ${version}.`);
  }
  const key = getKey();
  const iv = envelope.subarray(1, 1 + IV_LEN);
  const tag = envelope.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Encrypt and return the value in Postgres `bytea` hex-input form
 * (`\x<hex>`), safe to send through PostgREST / supabase-js into a
 * bytea column.
 *
 * Why this exists: handing a raw Node Buffer to supabase-js
 * `.insert()/.upsert()` JSON-serializes it as
 * `{"type":"Buffer","data":[...]}` and that TEXT lands in the bytea
 * column instead of the bytes - which then fails to decrypt. Sending
 * the `\x<hex>` literal makes Postgres parse it back to the exact
 * bytes, so the envelope round-trips intact.
 */
export function encryptTokenForDb(plaintext: string): string {
  return '\\x' + encryptToken(plaintext).toString('hex');
}

/** True when INTEGRATION_ENCRYPTION_KEY is configured (and decodes to 32 bytes). */
export function isIntegrationEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
