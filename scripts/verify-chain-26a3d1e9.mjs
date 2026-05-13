// One-off: recompute hashes for the audit chain the Security Pulse
// keeps flagging. Tests two timestamp serializations to confirm the
// bug is in the verifier, not the data.
//
// Run with: node scripts/verify-chain-26a3d1e9.mjs

import crypto from 'node:crypto';

// Pulled from the DB query just now.
const events = [
  {
    rn: 1,
    event_type: 'request_created',
    signature: null,
    user: null,
    signer_email: null,
    signer_name: null,
    ip: null,
    ua: null,
    doc: null,
    created_at_pg: '2026-05-05 15:22:53.135+00',
    created_at_iso: '2026-05-05T15:22:53.135Z',
    stored_hash: 'd6f291243d2bc867',
    request: '26a3d1e9-df21-466a-aadd-1a416cbec7fd',
  },
  // The other 4 events follow but the first event is enough to confirm
  // which timestamp format hashes to d6f291243d2bc867.
];

function payload(e, tsForm) {
  return JSON.stringify({
    request: e.request,
    signature: e.signature,
    type: e.event_type,
    user: e.user,
    email: e.signer_email?.toLowerCase() ?? null,
    name: e.signer_name,
    ip: e.ip,
    ua: e.ua,
    doc: e.doc,
    ts: tsForm,
  });
}

function hash(prevHash, body) {
  return crypto
    .createHash('sha256')
    .update((prevHash ?? '') + '|' + body)
    .digest('hex');
}

for (const e of events) {
  const hIso = hash(null, payload(e, e.created_at_iso));
  const hPg = hash(null, payload(e, e.created_at_pg));
  console.log(`Event ${e.rn} (${e.event_type})`);
  console.log(`  stored:     ${e.stored_hash}...`);
  console.log(`  iso form:   ${hIso.slice(0, 16)}  ts=${e.created_at_iso}`);
  console.log(`  pg form:    ${hPg.slice(0, 16)}  ts=${e.created_at_pg}`);
  const matchIso = hIso.startsWith(e.stored_hash);
  const matchPg = hPg.startsWith(e.stored_hash);
  console.log(
    `  match: iso=${matchIso} pg=${matchPg}  ${matchIso ? '<- inserter used ISO' : matchPg ? '<- inserter used PG' : '<- neither matches'}`,
  );
}
