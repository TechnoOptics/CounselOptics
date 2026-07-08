# Spike: on-device / self-hosted recurring-face detection for firm evidence

**Status:** spike (recommendation, not yet fully wired to a real model)
**Author:** Engineering
**Date:** 2026-07-08
**Feature owner flag:** `firm_settings.recurring_faces_enabled` (OFF by default)

## What the feature is (and is deliberately not)

Firms drag hundreds or thousands of photos into a matter's evidence intake. This
feature answers one narrow question across those photos:

> "The same face keeps showing up. It appears in N photos. Here they are."

It groups **recurring faces**. It does **not** say who anyone is. There is no
name, no watchlist match, no cross-case linkage, no third-party face database.
A firm can attach its own private label to a group ("the neighbour", "witness B"),
but that label is the firm's own note and never becomes an identity assertion in
any analysis output. The analysis prompt in `lib/timeline-ai.ts` stays instructed
to describe people it sees and never to claim biometric identity - that rule is
unchanged by this feature. Recurring-face grouping lives in a separate,
math-only path (embeddings + cosine distance), not in the language model prompt.

## Why this is sensitive (read before building)

A face embedding derived to tell whether two photos show the same person is
**biometric identifier / special-category data**:

- **Illinois BIPA** treats a "face geometry" scan as a biometric identifier.
  Collection requires notice and written consent, and there is a private right of
  action with statutory damages per violation.
- **GDPR Art. 9** treats biometric data processed to uniquely identify a person
  as a special category, prohibited unless an Art. 9(2) condition applies
  (typically explicit consent, or establishment/exercise/defence of legal claims
  for the litigation context).
- The people in a firm's evidence photos are **third parties** who did not
  consent to Advottic processing their faces. The firm, as controller of its own
  matter, carries the lawful-basis burden; Advottic is the processor and must
  give the firm the controls (opt-in, purge, no external transfer) to meet it.

Advottic's compliance program still has open P0 gaps (see
`docs/compliance/policies/risk-register.md`, R1/R2/R3). This feature therefore
ships **off by default, behind an explicit per-firm opt-in**, with a
risk-register entry (R14) and hard purge semantics, and processes **zero faces**
until a firm turns it on.

## Approaches evaluated

The hard constraint: biometric vectors NEVER leave Advottic infrastructure. No
AWS Rekognition, no Azure Face, no Google Vision, no hosted face API. Everything
runs on infra we control.

### Option A - client-side in the reviewer's browser (face-api.js / @vladmandic/face-api on tf.js WASM/WebGL)

The pitch is "images never get uploaded for detection." **That pitch does not
apply here.** The evidence photos are *already* server-stored objects in the
`exhibits` bucket - that is where matter evidence lives, uploaded through the
existing intake pipeline. Firm reviewers view them through short-TTL signed URLs.
So client-side detection would mean:

- each reviewer's browser re-downloads every photo, runs tf.js locally, and
  uploads the resulting embeddings anyway (they must be stored to cluster);
- results vary by the reviewer's device, browser, GPU, and tab lifetime;
- a 2,000-photo matter is not viable to grind through one reviewer's tab.

It buys us nothing on the privacy claim (the pixels are on our servers regardless)
and loses determinism and scale. **Rejected as the primary path.**

### Option B - one big server-side batch job on a Vercel serverless function

Run a detector + embedder over all of a matter's photos in one invocation.
Blocked by the platform: Vercel serverless functions are memory- and
time-bounded (single-invocation wall-clock and memory ceilings), and native
inference runtimes (`tfjs-node`, `onnxruntime-node`) add heavy native binaries,
large bundles, and cold starts. Thousands of images in one request will exceed
the time or memory ceiling. **Rejected as a single-shot job.**

### Option C (RECOMMENDED) - server-side, per image, piggybacked on the existing per-event analysis pass

The evidence pipeline **already** downloads each image's bytes once, per event,
inside `computeEventAnalysis()` in `lib/case-evidence.ts` and runs one model call
on it. That is the natural, already-paid-for place to also run face detection on
that single decoded image:

- **one image per invocation** - no giant loop, stays inside serverless limits;
- **naturally spread** across the intake, which already streams files in small
  batches and can analyse large drops asynchronously via
  `analyzeFirmCaseEventAction`;
- **resumable / re-runnable** - re-analysing an event re-detects its faces, and a
  dedicated backfill can walk events one at a time;
- clustering is cheap (cosine distance over already-stored vectors) and runs
  on demand, server-side, when the "Recurring people" panel loads.

Detection is wired through the existing `detectFacesHook()` placeholder in
`lib/timeline-ai.ts`, backed by a new `lib/face-detect.ts`. The heavy inference is
kept out of `timeline-ai.ts` (which the evidence-analysis chip owns) and isolated
in the new file to minimise merge conflict.

## Recommended model + runtime

| Concern | Recommendation | Why |
|---|---|---|
| Detector + embedder | `@vladmandic/face-api` (maintained face-api.js fork): a light detector (TinyFaceDetector / SSD-Mobilenet) for boxes + `FaceRecognitionNet` for a 128-d descriptor | Small self-hostable weights (~6 MB total), 128-d descriptors, works in Node, mature clustering-by-distance story. Good enough to say "same face recurs"; we are NOT doing identity, so we don't need ArcFace-grade accuracy. |
| tf.js backend | `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm` (WASM), NOT `tfjs-node` | Avoids the native binary that bloats the Vercel bundle and breaks cold starts. Slower per image (order of hundreds of ms to low seconds), which is fine because we run one image at a time inside an already-async analysis pass, never a synchronous fan-out. |
| Image decode | `@napi-rs/canvas` (prebuilt binaries, no system libs) to turn JPEG/PNG bytes into pixels for the model | face-api in Node needs an ImageData/canvas source. `@napi-rs/canvas` ships prebuilt and avoids `node-canvas`'s Cairo/system-dep pain. **This is the main integration friction - flagged below.** |
| Model weights hosting | Bundle under `public/models/face/` (or a private bucket) and load from our own origin | Keeps "self-hosted, nothing leaves our infra" literally true - weights come from Advottic, inference runs on Advottic. |

**Alternative if we want higher fidelity later:** raw ONNX (SCRFD/RetinaFace for
detection + ArcFace glint for 512-d embeddings) via `onnxruntime-node`. More
accurate, heavier to deploy, more wiring. Not needed for recurring-face grouping;
noted as a future swap. The `lib/face-detect.ts` interface is written to be
backend-agnostic so the model can be replaced without touching callers.

## Constraints and open risks (must-read before enabling)

1. **Native decode dependency.** `@napi-rs/canvas` (or equivalent) is a real new
   dependency with a prebuilt native binary. It must install cleanly on the Vercel
   build image. Until it (and the tf.js WASM assets + model weights) are
   provisioned, `lib/face-detect.ts` **degrades to a no-op that returns `[]`** so
   `tsc` and `next build` stay green and the feature simply finds no faces. This
   is intentional: the scaffolding, table, flag, clustering, and UI are all real
   and shippable now; flipping on real inference is a follow-up that installs the
   deps and drops in the weights (see "To fully enable" below).
2. **Per-image latency.** WASM inference adds seconds to each image's analysis.
   Acceptable on the async intake path; do NOT move it onto any synchronous
   request path.
3. **Accuracy is "recurrence", not "identity".** Cosine threshold clustering will
   sometimes split one person into two groups (lighting, angle, age) or merge two
   similar faces. That is why the UI must let a firm **merge/split** clusters. We
   never present a cluster as a confirmed person.
4. **Retention / purge.** Face vectors are derived biometric data. They MUST purge
   with the case and MUST purge when the firm turns the feature off. The schema
   uses `on delete cascade` from `cases`, and the toggle-off action deletes all of
   a firm's face rows. See R14.
5. **Consent burden sits with the firm.** Advottic provides the opt-in, the purge,
   and the no-third-party guarantee. The firm is responsible for having a lawful
   basis to process the third parties in its photos. The opt-in copy states this.

## Placement summary (what goes where)

- `supabase/fixes/2026-07-08-recurring-faces.sql` - new `firm_settings` (opt-in
  flag) + `case_evidence_faces` (boxes, embeddings, cluster ids) with RLS; then
  regenerate `supabase/schema-fingerprint.sha256`.
- `lib/face-settings.ts` - read/write the per-firm opt-in (firm membership gated).
- `lib/face-detect.ts` - NEW. Backend-agnostic detect(bytes) -> [{bbox, embedding}],
  degrades to `[]` when the model/deps are absent. Cosine-distance clustering.
- `lib/face-actions.ts` - NEW. Admin-client, firm-scoped reads/writes for faces
  and clusters (mirrors `lib/case-evidence-actions.ts`'s `assertFirmCase` gate).
- `lib/timeline-ai.ts` - `detectFacesHook()` delegates to `lib/face-detect.ts`
  (small, additive change in the existing placeholder).
- `app/counsel/cases/[id]/evidence/recurring-people.tsx` - NEW UI panel:
  representative crop per cluster + "appears in N photos", merge/split/label.

## To fully enable (follow-up after this spike lands)

1. `npm i @vladmandic/face-api @tensorflow/tfjs @tensorflow/tfjs-backend-wasm @napi-rs/canvas`
2. Place the face-api weight files under `public/models/face/` (TinyFaceDetector +
   FaceRecognitionNet manifests + shards).
3. Set the runtime env that `lib/face-detect.ts` checks (`FACE_MODELS_DIR`) to the
   weights path.
4. Turn the feature on for a pilot firm (`firm_settings.recurring_faces_enabled`)
   and validate a small matter end to end before wider rollout.
5. Re-score R14 once real inference is validated in production.
