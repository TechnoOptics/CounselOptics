# QR Mobile Signature Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signer on a laptop hand off to their own phone by scanning a one-time QR, draw their signature with a finger, and have the laptop update live while the signature is placed on the document exactly as it is today.

**Architecture:** The QR encodes a separate one-time handoff token, never the durable `/sign/[token]` credential. It is minted only after the signer has already cleared the access-code gate and consented to the E-SIGN disclosure on the laptop, so it hands off an already-verified session rather than granting fresh access. The first GET consumes the token and binds it to that phone with an httpOnly cookie, so a refresh survives but a second device is refused. Both devices write through one shared function so they cannot drift.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres, storage, realtime), Tailwind v3, vitest in `environment: 'node'`.

**Source spec:** `docs/superpowers/specs/2026-08-01-qr-mobile-signing-design.md` (commit `4cb1379`).

## Global Constraints

- **No em dashes** anywhere: code, comments, UI copy, docs. Use commas, periods, parentheses, colons or hyphens.
- **No emoji** anywhere, ever.
- **Tone:** calm, plain, professional. A signer who hits an error is already anxious.
- **One new dependency is permitted, and only `qrcode-generator`**, used server-side. A hosted QR image API is FORBIDDEN: it would send a live signing credential to a third party, and this application stores PHI under a live compliance program.
- **Every `'use server'` export is a public HTTP endpoint.** Privileged helpers belong in `import 'server-only'` modules.
- **Authorization only via `lib/firm-authz.ts`.** Do not write another membership check.
- **vitest runs `environment: 'node'`** with no jsdom and no testing-library, and none may be added. Pure logic must be extracted into modules with no I/O so it can be tested.
- **The phone must NEVER receive the durable `/sign/[token]` value.** That is the entire point of the feature.
- Run `npx tsc --noEmit` and `npm run build` before every commit.
- The final task must run `npm run test:audit-guards`. A previous plan in this repo skipped it and shipped four guard regressions.

## What already exists, and must not be rebuilt

- `app/sign/[token]/` is a public token-gated route: `page.tsx`, `access-code-gate.tsx`, `signature-capture.tsx`, `signer-response.tsx`.
- `signature-capture.tsx` runs a two-step ceremony. Step one is the UETA and E-SIGN consumer disclosure, consented BEFORE the pad is shown, because 15 USC 7001(c) requires consent after the disclosure is given rather than bundled into the signature. Step two is capture, with a separate intent-to-sign checkbox at lines 439 to 452.
- `app/api/firm/sign/route.ts` at lines 135 to 141 decodes the PNG and uploads it to the `firm-signatures` storage bucket at `{firm_id}/{request_id}/{signature_id}.png`, then at lines 169 to 178 stamps `signed_at`, `ip_address`, `user_agent`, `signature_image_path` and an `audit_hash` that is a SHA-256 over signature id, request id, signer email, IP, user agent, timestamp and buffer length.
- `lib/signature-render.ts` exports `renderFinalSignedPdf`.
- Supabase realtime is already used in five components, including `app/counsel/cases/[id]/timeline/collab-context.tsx`. Follow that pattern rather than inventing one.

Live `firm_signatures` columns: `id`, `signing_request_id`, `signer_user_id`, `signer_email`, `signer_name`, `token`, `position_page`, `position_x`, `position_y`, `signed_at`, `ip_address`, `user_agent`, `signature_image_path`, `audit_hash`, `created_at`, `response`, `response_note`, `responded_at`, `access_code_hash`, `access_code_verified_at`, `access_attempts`.

**The security fact:** `accessCodeRequired` is `Boolean(access_code_hash)`, true only for external signers. For internal signers the durable `/sign/[token]` URL alone is sufficient to sign. A QR encoding it would let anyone who photographs the screen sign as that person.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/signing-handoff.ts` | Pure token rules. Hashing, expiry, consume-once, bind-check. No I/O. |
| `tests/signing-handoff.test.ts` | Real assertions over every rule above. |
| `lib/qr-svg.ts` | Turns a string into an inline SVG string. Wraps `qrcode-generator`. |
| `tests/qr-svg.test.ts` | Structural assertions on the emitted SVG. |
| `supabase/migrations/20260801_signature_handoffs.sql` | The table, its index and its RLS posture. Written, NOT applied. |
| `lib/signing-handoff-queries.ts` | `import 'server-only'`. The only module that reads or writes the table. |
| `lib/signing-intent.ts` | The canonical UETA intent sentence, shared by both surfaces. |
| `lib/signature-write.ts` | The ONE function that records a signature. Both devices call it. |
| `app/sign/[token]/mobile-handoff.tsx` | Laptop side: the button, the QR, the realtime swap. |
| `app/sign/m/[handoff]/page.tsx` | Phone side: consume, bind, render the pad. |
| `app/sign/m/[handoff]/mobile-pad.tsx` | Phone side: the canvas and submit. |
| `app/api/firm/sign/mobile/route.ts` | Phone submit. Resolves the handoff, calls `lib/signature-write.ts`. |

---

### Task 1: The pure token module

**Files:**
- Create: `lib/signing-handoff.ts`
- Test: `tests/signing-handoff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mintHandoffToken()`, `hashHandoffToken(raw: string): string`, `handoffState(row: HandoffRow, now: Date, presentedSessionHash: string | null): HandoffState`, and the types `HandoffRow` and `HandoffState`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  mintHandoffToken,
  hashHandoffToken,
  handoffState,
  type HandoffRow,
} from '../lib/signing-handoff';

const T0 = new Date('2026-08-01T12:00:00Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

function row(over: Partial<HandoffRow> = {}): HandoffRow {
  return {
    tokenHash: hashHandoffToken('raw-token'),
    sessionHash: null,
    createdAt: T0,
    expiresAt: at(15),
    consumedAt: null,
    signatureSignedAt: null,
    ...over,
  };
}

describe('mintHandoffToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = mintHandoffToken();
    const b = mintHandoffToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashHandoffToken', () => {
  it('is stable and does not return the raw value', () => {
    expect(hashHandoffToken('abc')).toBe(hashHandoffToken('abc'));
    expect(hashHandoffToken('abc')).not.toBe('abc');
    expect(hashHandoffToken('abc')).not.toBe(hashHandoffToken('abd'));
  });
});

describe('handoffState', () => {
  it('is claimable before it is scanned or expired', () => {
    expect(handoffState(row(), at(1), null)).toBe('claimable');
  });

  it('is expired once past expiresAt, even unscanned', () => {
    expect(handoffState(row(), at(16), null)).toBe('expired');
  });

  it('is bound for the same device after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(2), 'sess-hash')).toBe('bound');
  });

  it('refuses a different device presenting a consumed token', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(2), 'other-hash')).toBe('consumed');
    expect(handoffState(r, at(2), null)).toBe('consumed');
  });

  it('expires the phone session ten minutes after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(11.5), 'sess-hash')).toBe('expired');
  });

  it('honours the absolute window even for a bound device', () => {
    const r = row({ consumedAt: at(14), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(16), 'sess-hash')).toBe('expired');
  });

  it('refuses once the signature is already signed', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffState(r, at(3), null)).toBe('already-signed');
  });

  it('reports already-signed ahead of expiry, so the message is accurate', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffState(r, at(99), null)).toBe('already-signed');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/signing-handoff.test.ts`
Expected: FAIL, cannot find module `../lib/signing-handoff`.

- [ ] **Step 3: Implement the module**

```ts
import { createHash, randomBytes } from 'node:crypto';

/**
 * Pure rules for a QR signing handoff. No I/O, so every rule below is
 * unit tested. lib/signing-handoff-queries.ts owns the database.
 *
 * The token in the QR is NOT the durable /sign/[token] credential.
 * firm_signatures.access_code_hash is only set for external signers, so
 * for an internal signer the durable URL alone is enough to sign. A QR
 * encoding it would let anyone who photographs the screen sign as that
 * person.
 */

/** How long an unscanned QR stays claimable. */
export const HANDOFF_TTL_MINUTES = 15;

/** How long the phone has to finish, measured from the scan. */
export const HANDOFF_SESSION_MINUTES = 10;

export type HandoffRow = {
  tokenHash: string;
  sessionHash: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  /** firm_signatures.signed_at for the row this handoff points at. */
  signatureSignedAt: Date | null;
};

export type HandoffState =
  | 'claimable'
  | 'bound'
  | 'consumed'
  | 'expired'
  | 'already-signed';

/** A url-safe random token. Never stored; only its hash is. */
export function mintHandoffToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashHandoffToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * The single decision function. `presentedSessionHash` is the hash of
 * the httpOnly cookie the phone sent, or null if it sent none.
 *
 * Order matters. already-signed is reported before expiry so the signer
 * is told the true reason rather than a misleading one, and consumed is
 * reported before the session window so a stranger scanning a screen
 * cannot tell a live code from a dead one by the wording.
 */
export function handoffState(
  row: HandoffRow,
  now: Date,
  presentedSessionHash: string | null,
): HandoffState {
  if (row.signatureSignedAt) return 'already-signed';

  if (!row.consumedAt) {
    return now >= row.expiresAt ? 'expired' : 'claimable';
  }

  const isBoundDevice =
    row.sessionHash != null &&
    presentedSessionHash != null &&
    presentedSessionHash === row.sessionHash;

  if (!isBoundDevice) return 'consumed';

  const sessionDeadline = new Date(
    row.consumedAt.getTime() + HANDOFF_SESSION_MINUTES * 60_000,
  );
  // Both windows bind. The absolute one is not reset by scanning.
  if (now >= sessionDeadline || now >= row.expiresAt) return 'expired';

  return 'bound';
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/signing-handoff.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/signing-handoff.ts tests/signing-handoff.test.ts
git commit -m "Add the pure rules for a QR signing handoff

The QR carries a one-time token, never the durable /sign/[token]
credential: access_code_hash is only set for external signers, so for an
internal signer that URL alone is enough to sign.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The migration, written but NOT applied

**Files:**
- Create: `supabase/migrations/20260801_signature_handoffs.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the table `public.firm_signature_handoffs`, read by Task 4.

**APPLYING THIS TO PRODUCTION IS THE CONTROLLER'S STEP, NOT YOURS.** Write the file. Do not run it. Do not use any Supabase tool to apply it. Say plainly in your report that it is unapplied.

- [ ] **Step 1: Write the migration**

```sql
-- One-time handoffs that let a signer move from their laptop to their
-- own phone to draw a signature.
--
-- ============================ NOT APPLIED ================================
-- Written 2026-08-01. The owner applies this. Regenerate
-- supabase/schema-fingerprint.sha256 in the same change, or the CI drift
-- gate fails on the next push.
-- =========================================================================
--
-- Why a separate token rather than reusing firm_signatures.token:
-- access_code_hash is set only for external signers, so an internal
-- signer's durable /sign/[token] URL alone is sufficient to sign.
-- Encoding it in a QR would mean anyone who photographs the screen can
-- sign as that person. This token instead authorises exactly one action
-- on exactly one signature row, is consumed on first sight, and dies in
-- fifteen minutes.
--
-- One row per QR generated. A signer who fumbles a scan and asks again
-- gets a second row and the first is already dead, so the history of
-- every handoff attempt survives. That matters because "how was this
-- signature made" is a question that gets asked in a dispute.

begin;

create table if not exists public.firm_signature_handoffs (
  id uuid primary key default gen_random_uuid(),
  signature_id uuid not null
    references public.firm_signatures(id) on delete cascade,
  -- The raw token is never stored, only its hash, following the
  -- access_code_hash precedent already set on firm_signatures.
  token_hash text not null unique,
  -- Hash of the httpOnly cookie issued to the consuming device. Null
  -- until the QR is scanned.
  session_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_ip text,
  consumed_user_agent text
);

create index if not exists firm_signature_handoffs_signature_idx
  on public.firm_signature_handoffs (signature_id, created_at desc);

-- RLS on with NO policy at all. Both routes that touch this table are
-- server-side and use the service-role client, so a table that is
-- closed by default is the correct posture for a credential store.
-- Adding a policy here would be widening access, not enabling a feature.
alter table public.firm_signature_handoffs enable row level security;

commit;
```

- [ ] **Step 2: Confirm you did not apply it**

Run: `git status --porcelain supabase/migrations/`
Expected: exactly one untracked or added file, and no other change.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260801_signature_handoffs.sql
git commit -m "Migration: one-time signing handoffs, not yet applied

RLS is enabled with no policy, because both routes that touch this
table are server-side and a credential store should be closed by
default.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The QR renderer

**Files:**
- Create: `lib/qr-svg.ts`
- Test: `tests/qr-svg.test.ts`
- Modify: `package.json` (add `qrcode-generator`)

**Interfaces:**
- Consumes: nothing.
- Produces: `qrSvg(text: string, opts?: { size?: number; margin?: number }): string`.

**Why this dependency and not a hand-rolled encoder:** a QR encoder needs Reed-Solomon error correction, mode selection and mask evaluation, several hundred lines of bit manipulation where a small mistake yields a code that scans on one phone and not another. `qrcode-generator` has zero runtime dependencies of its own and gives us the module matrix, so we emit our own SVG and keep full control of the styling. A hosted QR image API is forbidden.

- [ ] **Step 1: Add the dependency**

```bash
npm install qrcode-generator
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { qrSvg } from '../lib/qr-svg';

describe('qrSvg', () => {
  it('emits a self-contained square svg', () => {
    const svg = qrSvg('https://example.com/sign/m/abc');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('encodes different text differently', () => {
    expect(qrSvg('one')).not.toBe(qrSvg('two'));
  });

  it('is deterministic for the same text', () => {
    expect(qrSvg('same')).toBe(qrSvg('same'));
  });

  it('reaches no network and embeds no external reference', () => {
    const svg = qrSvg('https://example.com/sign/m/abc');
    expect(svg).not.toContain('http://');
    expect(svg).not.toMatch(/<image\b/);
    expect(svg).not.toMatch(/xlink:href/);
  });

  it('carries a quiet zone, which scanners need', () => {
    const svg = qrSvg('quiet', { margin: 4 });
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(viewBox).not.toBeNull();
    const modules = /data-modules="(\d+)"/.exec(svg);
    expect(modules).not.toBeNull();
    const total = Number(viewBox![1]);
    const count = Number(modules![1]);
    expect(total).toBe(count + 8);
  });

  it('refuses empty text rather than emitting an unscannable code', () => {
    expect(() => qrSvg('')).toThrow();
    expect(() => qrSvg('   ')).toThrow();
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run tests/qr-svg.test.ts`
Expected: FAIL, cannot find module `../lib/qr-svg`.

- [ ] **Step 4: Implement the renderer**

```ts
import qrcode from 'qrcode-generator';

/**
 * A QR code as an inline SVG string, generated on this server.
 *
 * Deliberately not a hosted QR image API: the text encoded here is a
 * live signing credential and must not be sent to a third party.
 *
 * Error correction level M is the usual choice for a screen-displayed
 * code. It tolerates a smudged camera without inflating the module
 * count the way H would.
 */
export function qrSvg(
  text: string,
  opts: { size?: number; margin?: number } = {},
): string {
  if (!text.trim()) {
    throw new Error('qrSvg needs text to encode.');
  }

  const margin = opts.margin ?? 4;
  // Type 0 lets the library pick the smallest version that fits.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + margin * 2;

  // One path for every dark module, which keeps the markup small and
  // lets the colour come from currentColor at the call site.
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        d += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }
  }

  const sizeAttr = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"` +
    `${sizeAttr} data-modules="${count}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${d}" fill="#000000"/>` +
    `</svg>`
  );
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/qr-svg.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Type-check, build, commit**

If `qrcode-generator` ships no types, add a minimal declaration in `types/qrcode-generator.d.ts` rather than using `any`, and include it in the commit.

```bash
npx tsc --noEmit && npm run build
git add lib/qr-svg.ts tests/qr-svg.test.ts package.json package-lock.json
git commit -m "Render QR codes to inline SVG on our own server

A hosted QR image API would send a live signing credential to a third
party, so the encoding happens here. qrcode-generator has no runtime
dependencies and gives us the module matrix, so the SVG is ours.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The server-only query layer

**Files:**
- Create: `lib/signing-handoff-queries.ts`
- Create: `lib/signing-intent.ts`

**Interfaces:**
- Consumes: `lib/signing-handoff.ts` from Task 1, the table from Task 2.
- Produces: `createHandoff(signatureId: string)`, `claimHandoff(rawToken, ip, userAgent)`, `loadBoundHandoff(rawToken, presentedSessionSecret)`, and `SIGNING_INTENT_SENTENCE`.

- [ ] **Step 1: Write the shared intent sentence**

This is lifted verbatim from the checkbox at `app/sign/[token]/signature-capture.tsx:447-451`. Two devices in one ceremony asserting intent in two different forms of words is the kind of discrepancy that gets a signature challenged, so both surfaces must read from here.

```ts
/**
 * The canonical UETA intent-to-sign sentence.
 *
 * Lifted from the intent checkbox in app/sign/[token]/signature-capture.tsx
 * so the laptop pad and the phone pad cannot drift. Do NOT reword this in
 * one place only.
 */
export function signingIntentSentence(
  signerLabel: string,
  documentName: string,
): string {
  return (
    `I, ${signerLabel}, intend that the mark above be my signature on ` +
    `"${documentName}", with the same legal effect as a handwritten ` +
    `signature. I am acting on my own behalf or as authorized for the ` +
    `entity I represent.`
  );
}
```

- [ ] **Step 2: Write the query layer**

```ts
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  handoffState,
  hashHandoffToken,
  mintHandoffToken,
  HANDOFF_TTL_MINUTES,
  type HandoffRow,
  type HandoffState,
} from '@/lib/signing-handoff';

/**
 * The only module that reads or writes firm_signature_handoffs.
 *
 * server-only, because every export here bypasses RLS through the
 * admin client by design: the table has RLS on and no policy, so it is
 * closed to every client and reachable only from here.
 */

export const HANDOFF_COOKIE = 'adv_sign_handoff';

export type ClaimResult =
  | { ok: true; signatureId: string; sessionSecret: string }
  | { ok: false; state: Exclude<HandoffState, 'claimable' | 'bound'> };

export async function createHandoff(
  signatureId: string,
): Promise<{ ok: true; rawToken: string } | { ok: false }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false };

  const rawToken = mintHandoffToken();
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000);

  const { error } = await admin.from('firm_signature_handoffs').insert({
    signature_id: signatureId,
    token_hash: hashHandoffToken(rawToken),
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { ok: false };

  return { ok: true, rawToken };
}

/** Read the handoff joined to the one fact about the signature we need. */
async function readRow(rawToken: string) {
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data } = await admin
    .from('firm_signature_handoffs')
    .select(
      'id, signature_id, token_hash, session_hash, created_at, expires_at, consumed_at, firm_signatures!inner(signed_at)',
    )
    .eq('token_hash', hashHandoffToken(rawToken))
    .maybeSingle();

  if (!data) return null;

  const raw = data as unknown as {
    id: string;
    signature_id: string;
    token_hash: string;
    session_hash: string | null;
    created_at: string;
    expires_at: string;
    consumed_at: string | null;
    firm_signatures: { signed_at: string | null };
  };

  const row: HandoffRow = {
    tokenHash: raw.token_hash,
    sessionHash: raw.session_hash,
    createdAt: new Date(raw.created_at),
    expiresAt: new Date(raw.expires_at),
    consumedAt: raw.consumed_at ? new Date(raw.consumed_at) : null,
    signatureSignedAt: raw.firm_signatures.signed_at
      ? new Date(raw.firm_signatures.signed_at)
      : null,
  };

  return { id: raw.id, signatureId: raw.signature_id, row };
}

/**
 * First GET consumes the token and binds it to this device.
 *
 * The update is conditional on consumed_at still being null, so two
 * phones scanning the same screen in the same instant cannot both
 * claim it. The loser sees the same wording as any other dead code.
 */
export async function claimHandoff(
  rawToken: string,
  ip: string | null,
  userAgent: string | null,
): Promise<ClaimResult> {
  const admin = createAdminSupabase();
  const found = admin ? await readRow(rawToken) : null;
  if (!admin || !found) return { ok: false, state: 'consumed' };

  const state = handoffState(found.row, new Date(), null);
  if (state === 'bound') {
    // Cannot happen with a null presented hash, but fail closed.
    return { ok: false, state: 'consumed' };
  }
  if (state !== 'claimable') return { ok: false, state };

  const sessionSecret = randomBytes(32).toString('base64url');

  const { data: updated } = await admin
    .from('firm_signature_handoffs')
    .update({
      consumed_at: new Date().toISOString(),
      session_hash: createHash('sha256').update(sessionSecret).digest('hex'),
      consumed_ip: ip,
      consumed_user_agent: userAgent,
    })
    .eq('id', found.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  if (!updated) return { ok: false, state: 'consumed' };

  return { ok: true, signatureId: found.signatureId, sessionSecret };
}

/** Every request after the claim. */
export async function loadBoundHandoff(
  rawToken: string,
  presentedSessionSecret: string | null,
): Promise<
  { ok: true; signatureId: string } | { ok: false; state: HandoffState }
> {
  const found = await readRow(rawToken);
  if (!found) return { ok: false, state: 'consumed' };

  const presentedHash = presentedSessionSecret
    ? createHash('sha256').update(presentedSessionSecret).digest('hex')
    : null;

  const state = handoffState(found.row, new Date(), presentedHash);
  if (state !== 'bound') return { ok: false, state };

  return { ok: true, signatureId: found.signatureId };
}
```

- [ ] **Step 3: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add lib/signing-handoff-queries.ts lib/signing-intent.ts
git commit -m "Add the server-only handoff query layer

The claim is a conditional update on consumed_at still being null, so
two phones scanning the same screen in the same instant cannot both
claim it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The laptop side

**Files:**
- Create: `app/sign/[token]/mobile-handoff.tsx`
- Create: `app/sign/[token]/handoff-actions.ts`
- Modify: `app/sign/[token]/signature-capture.tsx`

**Interfaces:**
- Consumes: `createHandoff` from Task 4, `qrSvg` from Task 3.
- Produces: a `<MobileHandoff signatureId={...} />` mounted inside the capture step.

- [ ] **Step 1: Write the mint action**

`'use server'`, so this export is a public HTTP endpoint. It takes the DURABLE token, not a signature id, because that is what the client legitimately holds and it is what proves the caller is the signer. It resolves the signature itself and refuses if the row is already signed or the access-code gate is unmet.

```ts
'use server';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { createHandoff } from '@/lib/signing-handoff-queries';
import { qrSvg } from '@/lib/qr-svg';

export async function mintSigningHandoffAction(
  signerToken: string,
): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Unavailable. Please try again.' };

  const { data } = await admin
    .from('firm_signatures')
    .select('id, signed_at, access_code_hash, access_code_verified_at')
    .eq('token', signerToken)
    .maybeSingle();

  const sig = data as {
    id: string;
    signed_at: string | null;
    access_code_hash: string | null;
    access_code_verified_at: string | null;
  } | null;

  if (!sig) return { ok: false, error: 'This link is no longer valid.' };
  if (sig.signed_at) {
    return { ok: false, error: 'This document has already been signed.' };
  }
  // The handoff must never be a way around the access-code gate.
  if (sig.access_code_hash && !sig.access_code_verified_at) {
    return { ok: false, error: 'Enter your access code first.' };
  }

  const made = await createHandoff(sig.id);
  if (!made.ok) return { ok: false, error: 'Unavailable. Please try again.' };

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return { ok: true, svg: qrSvg(`${base}/sign/m/${made.rawToken}`) };
}
```

- [ ] **Step 2: Write the laptop component**

It renders a button, then the QR, then subscribes to realtime on this signature row and swaps to a signed state. Follow the channel pattern in `app/counsel/cases/[id]/timeline/collab-context.tsx`. The QR SVG is inserted with `dangerouslySetInnerHTML` because it is a string we generated on our own server from our own template, never user input. Say so in a comment.

Copy for the trigger: **Sign with mobile**. Helper line: **Scan with your phone to sign with your finger. The code works once and expires in fifteen minutes.**

- [ ] **Step 3: Mount it in the capture step**

Inside `signature-capture.tsx`, at the capture step only, never at the disclosure step. Consent must already have been given, which is the entire reason this is safe.

- [ ] **Step 4: Type-check, build, commit**

```bash
npx tsc --noEmit && npm run build
git add app/sign/\[token\]/
git commit -m "Offer a mobile handoff at the capture step

Minted only after the access-code gate and the E-SIGN disclosure are
already satisfied on the laptop, so the QR hands off an already
verified session rather than granting fresh access.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The shared write, then the phone

**Files:**
- Create: `lib/signature-write.ts`
- Modify: `app/api/firm/sign/route.ts`
- Create: `app/api/firm/sign/mobile/route.ts`
- Create: `app/sign/m/[handoff]/page.tsx`
- Create: `app/sign/m/[handoff]/mobile-pad.tsx`

**Interfaces:**
- Consumes: `loadBoundHandoff`, `claimHandoff`, `HANDOFF_COOKIE`, `signingIntentSentence`.
- Produces: `recordSignature(input): Promise<RecordResult>`, called by BOTH routes.

**The rule that makes this task worth doing:** there must be exactly ONE function that records a signature. Extract the existing body of `app/api/firm/sign/route.ts` (the PNG decode, the bucket upload to `{firm_id}/{request_id}/{signature_id}.png`, the `signed_at` / `ip_address` / `user_agent` / `signature_image_path` / `audit_hash` update, and the audit event) into `lib/signature-write.ts` and have the existing route call it. Do not copy it. If the two paths can drift on what a signature record contains, the feature has created a compliance problem rather than a convenience.

- [ ] **Step 1: Extract, and prove the desktop path is unchanged**

Move the body, have the existing route call it, run the full suite, and confirm nothing regressed before writing a single line of phone code.

Run: `npx vitest run`
Expected: the same pass and fail counts as before your change. Record both numbers in your report.

- [ ] **Step 2: The phone page**

`app/sign/m/[handoff]/page.tsx` is a server component. On GET: read the cookie, and if absent call `claimHandoff`, setting the httpOnly, `sameSite: 'lax'`, `secure` cookie on the response. If present call `loadBoundHandoff`. Anything other than success renders the calm refusal, and per the spec **`consumed` and `expired` and a cookie mismatch all render the same wording**, so a stranger who scans a screen learns nothing.

Copy, exactly:
- consumed, expired, or wrong device: **This code is no longer valid. On your computer, choose Sign with mobile again.**
- already signed: **This document has already been signed.**

- [ ] **Step 3: The phone pad**

Client component. The document name as the heading, the intent sentence from `lib/signing-intent.ts`, a full-width canvas sized for a thumb, Clear, and Submit. It does NOT repeat the disclosure, which was consented on the laptop. It does NOT show the document.

The heading is the document, not the signer. This step originally said the signer's name; the built page is right and this line was wrong. A signer who picks their phone up mid-ceremony needs to see which document they are about to mark, since the phone never shows it; their own name is already in front of them, in the intent sentence a few lines below. `SIGNING_INTENT_PREFIX` and `signingIntentSuffix()` are what the pad renders, not the joined `signingIntentSentence()`, so the signer's name can sit in its own `data-no-translate` element and escape the runtime translation layer, exactly as it does on the laptop.

Touch handling must call `preventDefault` on `touchmove` so the page does not scroll under the drawing finger, and the canvas must be sized from `devicePixelRatio` or the stroke renders soft on a phone.

- [ ] **Step 4: The phone submit route**

`app/api/firm/sign/mobile/route.ts` reads the cookie, calls `loadBoundHandoff`, and on success calls `recordSignature` with the resolved `signatureId`. **It must never accept a signature id from the request body.** The audit event records arrival by mobile handoff.

- [ ] **Step 5: Type-check, build, full suite, commit**

```bash
npx tsc --noEmit && npm run build && npx vitest run
git add lib/signature-write.ts app/api/firm/sign app/sign/m
git commit -m "One shared signature write, and the phone pad that uses it

Both devices now write through lib/signature-write.ts, so the desktop
and phone paths cannot drift on what a signature record contains. The
phone resolves its signature id from the bound handoff and never
accepts one from the request body.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

**Files:** none created. This task is verification and honesty.

- [ ] **Step 1: Run every gate**

```bash
npx tsc --noEmit
npm run build
npx vitest run
npm run test:audit-guards
```

`test:audit-guards` fails on `main` today with 11 pre-existing unreviewed `<T>` wraps. Your branch must not add a twelfth. Report the count before and after your work. If you added any, either allowlist them in `scripts/test/counsel-i18n-invariants.mjs` with a comment naming where the value is defined, or unwrap them if they carry firm or user data, because `<T>` resolves through machine translation.

- [ ] **Step 2: Sweep the constraints**

Grep your own diff for em dashes and emoji. Confirm `package.json` gained exactly one dependency, `qrcode-generator`. Confirm the phone never receives the durable signer token: grep your diff for any path that sends `firm_signatures.token` to `/sign/m`.

- [ ] **Step 3: State what you could not verify**

The live end-to-end check is the CONTROLLER'S step, not yours. It needs the migration applied to production and a signed-in session on a branch server, and no agent in this session has been able to sign in. **Do not fake it, do not simulate it, and do not quietly drop it from your report.** Write out the checklist for the controller to run:

1. Apply `supabase/migrations/20260801_signature_handoffs.sql` and regenerate `supabase/schema-fingerprint.sha256` in the same change.
2. Open a real signing request on a laptop, clear the access-code gate, consent to the disclosure.
3. Confirm Sign with mobile appears only at the capture step, never before consent.
4. Scan with a phone, confirm the pad loads and the intent sentence matches the laptop's word for word.
5. Draw and submit. Confirm the laptop swaps to signed without a refresh.
6. Confirm the signature is placed on the document by `renderFinalSignedPdf`.
7. Re-scan the same QR on a second device and confirm the refusal wording.
8. Confirm a row exists in `firm_signature_handoffs` with `consumed_at`, `consumed_ip` and `consumed_user_agent` populated.

- [ ] **Step 4: Commit any fixes from steps 1 and 2**

```bash
git add -A
git commit -m "Close the final gates for QR mobile signing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Flow to Tasks 5, 6. Data model to Task 2. Token semantics to Task 1. Error states to Task 6 step 2. Audit to Task 6 step 4. Testing to Tasks 1, 3, and Task 6 step 1. Dependency to Task 3. The out-of-scope list needs no task by definition.

**Placeholders.** None. Every code step carries real code, every copy string is written out, and the two refusal messages are quoted verbatim rather than described.

**Type consistency.** `HandoffRow` and `HandoffState` are defined in Task 1 and consumed unchanged in Task 4. `HANDOFF_COOKIE` is defined in Task 4 and used in Task 6. `recordSignature` is named identically in Task 6 steps 1 and 4. `signingIntentSentence` is defined in Task 4 step 1 and used in Task 6 step 3.

**Known gap, stated rather than hidden.** The phone pad is a canvas and this repo's vitest is `environment: 'node'` with no jsdom, so the drawing surface itself is verified in a browser rather than by unit test. That matches how `signature-capture.tsx` is already treated. The logic that decides whether a phone may draw at all is pure and fully tested in Task 1.
