/**
 * Generate an Apple Sign-In client_secret JWT for use as the
 * "Secret Key (for OAuth)" in the Supabase Apple provider config.
 *
 * Apple JWT requirements:
 *   alg: ES256
 *   header.kid = Key ID (10 chars)
 *   payload.iss = Team ID (10 chars)
 *   payload.iat = now (seconds)
 *   payload.exp = now + 6 months (max Apple permits)
 *   payload.aud = "https://appleid.apple.com"
 *   payload.sub = Services ID (the Bundle/Service identifier)
 *
 * Signed with ES256 (ECDSA P-256 + SHA-256) using the .p8 private key
 * downloaded from Apple Developer Console.
 *
 * Usage:
 *   node scripts/generate-apple-client-secret.mjs <path-to-.p8>
 *
 * Constants below are pinned to the Advottic Apple Sign-In config.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const TEAM_ID = 'FNU92FR9C9';
const KEY_ID = 'ULT8PCLT74';
const SERVICES_ID = 'com.advottic.signin';

const p8Path = process.argv[2];
if (!p8Path) {
  console.error('Usage: node scripts/generate-apple-client-secret.mjs <path-to-.p8>');
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(p8Path, 'utf8');

const now = Math.floor(Date.now() / 1000);
// Apple permits up to 6 months (~15777000s). Use 5 months 28 days to stay safely under.
const exp = now + 60 * 60 * 24 * 180;

const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID,
};

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const headerB64 = base64url(JSON.stringify(header));
const payloadB64 = base64url(JSON.stringify(payload));
const signingInput = `${headerB64}.${payloadB64}`;

// ES256 = ECDSA with P-256 + SHA-256. Node's sign with ec key returns
// DER-encoded ASN.1. JWT wants raw r||s (each 32 bytes, zero-padded).
const derSig = crypto.sign('sha256', Buffer.from(signingInput), {
  key: privateKeyPem,
  dsaEncoding: 'ieee-p1363', // raw r||s, exactly what JWT ES256 needs
});

const sigB64 = base64url(derSig);
const jwt = `${signingInput}.${sigB64}`;

console.log(jwt);
console.error(`\n[meta] iat=${now} exp=${exp} (expires ${new Date(exp * 1000).toISOString()})`);
console.error(`[meta] team=${TEAM_ID} kid=${KEY_ID} sub=${SERVICES_ID}`);
