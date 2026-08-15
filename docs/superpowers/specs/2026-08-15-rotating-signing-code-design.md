# A signing code a screenshot cannot reuse

**Status:** design, not built. Written after tracing the current handoff so the
implementation does not start from the wrong idea.

**The ask:** "make the qrcode custom and a motion qr code so that it can not be
shared as an image and is only good for one scan and sign."

---

## What is already true, and must not be rebuilt

Verified in the code before designing, because two things in this brief already
exist.

**One scan and sign is done.** `lib/mark-handoff-queries.ts` updates
conditionally on `consumed_at IS NULL` and reads the row back, so a second scan
loses the race. `used_at` and `expires_at` are there too. Nothing about that
needs changing.

**The exposure is the window, not the count.** `HANDOFF_TTL_MINUTES = 15`
(`lib/signing-handoff.ts:16`). So a photograph of the screen is a working
signing link for up to fifteen minutes, and during that window a person who was
never meant to sign can open it on their own phone and draw a mark. That is the
real hole and it is what this design closes.

---

## Why an animated QR does not work here

The obvious reading of "motion QR" is to split the payload across frames so a
single screenshot captures a fragment. It cannot work on this product.

Signers scan with **the camera app on their own phone**. A stock camera decodes
one complete QR from one frame. It has no idea that four frames belong together
and no way to reassemble them. Splitting the payload would produce a code that
Advottic could read and that no signer's phone could.

Animation that keeps each frame a complete, valid QR is decoration: a
screenshot of any one frame still carries the whole payload. It would look like
a security feature and be none, which is worse than not doing it.

**So motion has to change WHAT is encoded, not how it is drawn.**

---

## The design: a rotating short-lived code

The QR is redrawn every `STEP_SECONDS` with a different one-time code. Each
code is valid only for its own step. A screenshot is dead within seconds
instead of fifteen minutes.

This is the shape TOTP already established, and it needs no new column: the
handoff row carries `session_hash` already.

```
code(step)  = HMAC-SHA256(handoff.session_secret, handoffId + ":" + step)
step        = floor(unixSeconds / STEP_SECONDS)
QR encodes  = /sign/mark/<handoffId>.<code>
```

**Server acceptance.** Recompute for the current step, and accept the previous
step as well. The previous step is not slack for a screenshot, it is for a
person who framed the camera as the code turned over: without it, a scan that
lands on a boundary fails for a reason nobody can see. Two steps is the
smallest window that does not punish ordinary use.

**`STEP_SECONDS = 30`.** A photographed code dies in at most 60 seconds
(current step plus the accepted previous one), against 900 today. Shorter than
30 starts failing real scans on slow cameras and poor light.

**The 15 minute TTL stays.** It bounds how long the code will keep rotating at
all. The two limits answer different questions: the step bounds a stolen frame,
the TTL bounds an abandoned session.

**Consumption is unchanged and still authoritative.** A valid current code that
arrives for an already-consumed handoff is refused by the existing
`consumed_at IS NULL` update. Rotation narrows the theft window; it does not
replace single use, and the two guards must both stay.

---

## What the signer sees

Nothing new to learn. The code on screen refreshes silently. The card already
carries "Scan it with your phone" and needs no extra instruction, because
nothing is being asked of the person.

Not added: a visible countdown. It invites somebody to hurry a signature, and
this product's copy is deliberately calm. If a scan lands on a dead step the
phone gets the same refusal it already gets for an expired code, and the desk
is still showing a live one to scan.

---

## Where it goes

| Concern | File |
|---|---|
| derive + verify a step code, pure | `lib/handoff-rotating-code.ts` (new) |
| mint the secret, unchanged shape | `lib/mark-handoff.ts` |
| accept current or previous step | `lib/mark-handoff-queries.ts` |
| redraw on an interval | `components/signing/PhoneHandoffCard.tsx` |

The derivation module must be pure and node-testable, and it must be **called**
before it is believed. A pure crypto helper that nothing invokes is this
repository's most repeated failure, and a guard has to hold the call site as
well as the maths.

---

## How it gets verified

- Pure tests over the derivation: same input same output, different steps give
  different codes, a code from step N is rejected at step N+2, accepted at N+1.
- A wiring guard that the mint and the verifier both call it.
- Mutation: fixing the step to a constant, and widening acceptance beyond one
  previous step, must each turn a test red.
- **Rendered check**: the code on screen must still scan with a real phone
  camera after rotation. Nothing in the suite can prove that, and it is the one
  thing that decides whether the feature works at all.

---

## What this deliberately does not do

**Custom-branded QR.** The brief also asked for the code to be "custom".
Logo-in-the-middle and coloured modules reduce the error-correction budget and
the contrast the decoder needs, on the one screen where a failed scan means a
document does not get signed. If it is wanted, it belongs in a separate change
with its own scan testing on real devices, not folded into a security fix.
