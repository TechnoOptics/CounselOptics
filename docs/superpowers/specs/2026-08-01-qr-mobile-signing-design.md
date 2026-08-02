# QR mobile signature capture

Design, 2026-08-01. Approved by the owner before writing.

## The problem

A signer opens a document on a laptop and has to draw their signature with a
trackpad. The result looks nothing like their signature, and people know it,
which is why they hesitate over it. A phone is the right instrument: a finger on
glass produces a mark a person recognises as their own.

The owner's words:

> a user gets a document to sign, they scan a unique one-time QR code that takes
> them to a temp portal that allows them to scribble their signature after which
> it is captured and rendered onto the signature line on the document.

## What already exists, and must be built on rather than rebuilt

- `app/sign/[token]/` is a public token-gated route: `page.tsx`,
  `access-code-gate.tsx`, `signature-capture.tsx`, `signer-response.tsx`.
- `signature-capture.tsx` runs a two-step ceremony. Step one is the UETA and
  E-SIGN consumer disclosure, which must be consented to BEFORE the pad is
  shown, because 15 USC 7001(c) requires consent be obtained after the
  disclosure is given rather than bundled into the signature. Step two is
  capture, by free-hand canvas, typed font, or upload, with a separate
  intent-to-sign checkbox carrying canonical UETA language. It posts the token,
  a base64 PNG, the typed name and the consent timestamps to `/api/firm/sign`.
- `/api/firm/sign` persists the image, fills `firm_signatures.signed_at`, and
  appends a `signed` event to an audit chain.
- `lib/signature-render.ts` exports `renderFinalSignedPdf`, which places the
  signature on the document. OCR-based field detection already auto-places the
  signature, date and name fields.
- The signer URL is built in exactly one place, `lib/firm-actions.ts:2413`.
- Supabase realtime is already used in five components, so the laptop does not
  need a new mechanism to learn that the phone finished.

Nothing QR-related exists in signing. The only QR in the product is Supabase's
TOTP enrollment SVG on the MFA page, which encodes a TOTP secret and cannot
encode an arbitrary URL, and the watch pairing flow.

## The security fact that shapes the whole design

`firm_signatures.accessCodeRequired` is `Boolean(r.access_code_hash)`. It is
true only for external signers who were emailed a code. Internal signers have no
code and fall straight through the gate, which means for them the durable
`/sign/[token]` URL alone is sufficient to sign.

So a QR must never encode the durable token. Anyone who photographed the screen
would then be able to sign as that person. The QR encodes a separate, one-time
handoff token that authorises exactly one action on exactly one signature row.

The QR is generated only AFTER the signer has already cleared the passcode gate
and consented to the disclosure on the laptop. It therefore hands off an
already-verified session to a second device rather than granting fresh access,
which is what makes the whole feature safe.

## The flow

1. Signer opens the emailed link on a laptop. External signers clear the
   access-code gate. This is unchanged.
2. They read the document and consent to the E-SIGN disclosure. Unchanged, and
   this is the step that satisfies 15 USC 7001(c).
3. At the capture step, alongside the existing draw, type and upload options, a
   new option reads **Sign with mobile**.
4. Clicking it calls a server action that mints a handoff and returns the
   one-time URL. The laptop renders the QR inline and subscribes to realtime on
   that signature row.
5. The signer scans with their phone and lands on `/sign/m/[handoffToken]`. The
   screen is deliberately bare: their name, one sentence of intent, a full-width
   canvas, and Submit. It does not repeat the disclosure, which was consented on
   the device that displayed the document.

   The intent sentence is NOT new copy. It reuses the canonical UETA
   intent-to-sign language already carried by the intent checkbox in
   `signature-capture.tsx`, lifted into a shared constant so both surfaces read
   from one source. Two devices in one ceremony asserting intent in two
   different forms of words is the kind of discrepancy that gets a signature
   challenged, and rewording it here would create exactly that.
6. Submit posts the drawn PNG and the handoff cookie. The phone NEVER holds the
   durable `/sign/[token]` credential and must never be sent it, which is the
   entire point of the handoff. The server resolves the handoff to its
   `signature_id` itself, then performs the same write `/api/firm/sign` performs
   today: persist the image, stamp `signed_at`, append to the audit chain, with
   the event additionally recording arrival by mobile handoff.

   The implementation may either add a handoff-authenticated branch inside
   `/api/firm/sign` or give the phone its own route that calls the same shared
   write helper. Whichever is chosen, there must be exactly ONE function that
   performs the signature write, so the desktop and phone paths cannot drift on
   what a signature record contains.
7. Realtime fires. The laptop replaces the QR with the signed state without a
   refresh.
8. `renderFinalSignedPdf` places the signature on the signature line. Unchanged.

The laptop pad stays exactly as it is. Sign with mobile is an additional route,
never a replacement. If a phone camera fails, or the signer has no phone, or the
QR expires, the existing path is right there and nothing is lost.

## Data model

```sql
create table public.firm_signature_handoffs (
  id                  uuid primary key default gen_random_uuid(),
  signature_id        uuid not null
                        references public.firm_signatures(id) on delete cascade,
  token_hash          text not null unique,
  session_hash        text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  consumed_ip         text,
  consumed_user_agent text
);
```

The raw token is never stored, only its hash, following the `access_code_hash`
precedent already set in `firm_signatures`.

RLS is enabled and denies everything. There is no client policy at all, because
both routes that touch this table are server-side and use the service-role
client. A table with RLS on and no policy is closed by default, which is the
correct posture for a credential store.

`on delete cascade` means deleting a signature takes its handoff history with
it, so the table cannot outlive the thing it refers to.

One row per QR generated. A signer who fumbles a scan and clicks Sign with
mobile again gets a second row, and the first is already dead. The history of
every handoff attempt is therefore preserved, which matters because "how was
this signature made" is a question that gets asked in a dispute.

## Token semantics

**Minting.** A high-entropy random token, hashed before storage. `expires_at` is
15 minutes out.

**First GET consumes it.** `consumed_at` is stamped, the phone's IP and user
agent are recorded, and an httpOnly cookie is issued whose hash is written to
`session_hash`.

**Binding, not burning.** After consumption the same phone can refresh, rotate
the device, or recover from a dropped connection, because the cookie proves it
is the bound holder. A different device presenting the same token finds it
consumed and is refused. This preserves one-scan-grants-access exactly, while
not punishing a signer for their browser reloading.

**Two independent expiries, one column.** The unscanned QR dies at
`expires_at`, 15 minutes after minting. Once scanned, the phone has 10 minutes
to finish, evaluated as `consumed_at + 10 minutes` rather than stored, because a
second column would be a derived value that can disagree with the first. A
request is valid only if it is inside BOTH windows. Both are backstops. The
primary control is that the code is consumed on sight.

**No escalation.** A handoff authorises exactly one action on exactly one
signature row, and refuses outright if that row is already signed.

**Nothing leaves the system.** The QR is encoded server-side and inlined as SVG.
A hosted QR image API is explicitly rejected: it would send a live signing
credential to a third party, which is not acceptable for an application storing
PHI under a live compliance program.

## Error states

Every failure resolves to the same calm shape: say what happened, then name the
way back.

| Condition | What the phone says |
| --- | --- |
| Token already consumed by another device | This code is no longer valid. On your computer, choose Sign with mobile again. |
| Token expired before scanning | Same wording. |
| Phone session expired after scanning | Same wording. |
| Signature already signed | This document has already been signed. |
| Cookie does not match `session_hash` | Same wording as already consumed. |

Wrong device is deliberately indistinguishable from already used. A stranger who
scans a screen learns nothing about whether the code was ever real.

## Audit

The `signed` event records arrival by mobile handoff, and the phone's IP and
user agent are stored on the handoff row, separate from anything recorded for
the laptop.

This is stronger evidence than desktop-only signing, not weaker. The record
shows two devices, two addresses and one continuous ceremony, with the
disclosure consented on the device that displayed the document and the signature
drawn on the device in the signer's hand.

## Testing

The token logic lives in a pure module with no I/O: hashing, expiry evaluation,
consume-once, bind-check, and refusal when the signature is already signed. That
is fully node-testable and gets real assertions, including the case where a
second device presents a consumed token and the case where a bound device
returns after a refresh.

The pad itself is a canvas in a browser. This repo's vitest runs
`environment: 'node'` with no jsdom and no testing-library, and no dependency
may be added for it, so the pad is verified in a browser rather than by unit
test. That matches how `signature-capture.tsx` is already treated.

## Dependency

One small QR encoder, used server-side only, rendering inline SVG so nothing
extra reaches the client bundle.

Hand-rolling was considered and rejected. A QR encoder requires Reed-Solomon
error correction, mode selection and mask evaluation, which is several hundred
lines of subtle bit manipulation where a small mistake produces a code that
scans on one phone and not another. That is a poor thing to own in a signing
path.

## Out of scope

- In-person signing, where counsel shows a QR on their own screen to a client
  across the desk. That is a different feature with a different threat model,
  because the signer never held a credential to begin with.
- Letting the phone view the document. The phone is a pad. The document was read
  on the laptop, which is where the disclosure was consented.
- Replacing the laptop pad.
- Filling intake forms by phone, or any other QR handoff. This design covers
  signatures only.
