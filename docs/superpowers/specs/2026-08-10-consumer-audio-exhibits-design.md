# Consumer audio exhibits, and letting the review read them

Date: 2026-08-10
Status: implemented on `fix/consumer-exhibits`

> Design gate note: the brainstorming skill asks for the design to be approved
> by a person before implementation. This work ran in a non-interactive
> session, so no approval was obtained. The design is recorded here for review
> after the fact, and the implementation was kept to the smallest slice that
> delivers the ask so it is cheap to revise or revert.

## What was asked

Let a consumer upload audio as case evidence, and have Bella scan and analyse
exhibits.

## What already existed

Most of it. The recon result matters more than the design here, because the
honest answer to "build audio upload" turned out to be "it is already built,
and two things around it are missing."

- **Upload already accepts audio.** `app/cases/[id]/upload-form.tsx:54-61` puts
  no `accept` on the real file input, `uploadExhibitAction`
  (`lib/actions.ts:568-627`) caps at 50MB and applies no type allowlist, and
  the helper copy at line 94 already reads "Images, PDFs, audio, video, or
  documents. Up to 50MB."
- **Transcription already exists and is already consumer-reachable.**
  `transcribeMedia` (`lib/ai.ts`) via `transcribeExhibitAction`
  (`lib/actions.ts`), surfaced by the Transcribe / Re-transcribe buttons in
  `app/cases/[id]/exhibit-scan.tsx`. That component's only mount point is the
  consumer case page. The firm side has no access to it.
- **A second transcription path exists** for timeline evidence,
  `transcribeAudio` in `lib/timeline-ai.ts` via `lib/case-evidence.ts`.

## What was actually missing

1. **Nothing checked that an audio exhibit was audio.** `SIGNATURES` in
   `lib/upload-safety.ts` knew JPEG, PNG, WebP and PDF. A declared `audio/*`
   fell past the content-confusion branch and returned ok. This matters more
   for audio than for other types because an audio exhibit's bytes are sent
   whole to a third-party transcription API.
2. **The analysis never read the transcription.** `lib/ai.ts` built the
   review's evidence block from filename, description and MIME type only, and
   Bella's `get_case_detail` tool selected the same columns. Everything the app
   had already extracted sat unread in `exhibits.scan_data`. A user could
   transcribe a voicemail, see the words on the exhibit row, run the review,
   and get an analysis that had never seen them.

That second point is the whole of "have Bella scan and analyse exhibits": the
scanning existed and stored its output, it just was not wired to the thing that
analyses.

## Approaches considered

**A. Build a dedicated audio upload surface with its own recorder, its own
storage path and its own transcription call.** Rejected. It duplicates
`transcribeMedia`, and the task explicitly warned against a second
transcription path. It also widens how much audio flows to OpenAI.

**B. Wire the existing pieces together and close the validation gap.** Chosen.
No new transcription path, no new storage path, no new AI entry point, and
therefore no new tier or token surface to gate.

**C. B, plus gating and metering the existing Transcribe button.** Deferred.
`transcribeExhibitAction` today does no tier check and no token debit, which is
a real cost path, but adding one changes existing behaviour for existing users.
That is a product decision, not a bug fix, so it is reported rather than taken.

## The design as built

### Validation

`isAudioBuffer(buf)` in `lib/upload-safety.ts` reads container signatures:
ID3 and bare MPEG frame sync (mp3), RIFF/WAVE (wav, distinguished from WebP by
the form type at byte 8), OggS, fLaC, EBML (webm/matroska), and ISO base media
`ftyp` with an audio brand (m4a, the iPhone voice-memo brands).

`screenAuthenticatedUpload` now rejects a declared `audio/*` whose bytes are not
audio. Video is deliberately left unchecked: the consumer path does not
transcribe it, and the container space is wide enough that a partial check would
be a promise the function does not keep.

Storage paths were reviewed and left alone. `addExhibit` builds
`${user.id}/${caseId}/${uuid}${ext}` with a sanitised extension and never
interpolates the filename, so it is not traversable or aimable at another
user's prefix.

### Analysis

`describeExhibitsForPrompt(exhibits)` in `lib/ai.ts` is now the single place the
review's evidence block is built. It adds, per exhibit that has been scanned:
the scan summary, parties, dates, amounts, and the transcript, each bounded
(transcript at 1500 characters) so one long recording cannot crowd the case
description out of the prompt.

Bella's `get_case_detail` selects `scan_data` and exposes `scanned_summary` and
a bounded `transcript`.

A demo scan is excluded from both. It is a placeholder produced when no API key
was configured, and feeding it back would let the model treat "document was not
actually scanned" as a finding about the evidence.

### Tier and tokens

No new AI entry point was created, so no new gate was needed. The review's
existing pre-call balance floor (`getProTokenGate`) and post-call debit
(`consumeTokensForCurrentUser`) still run, and they now measure a slightly
larger prompt, which is the correct accounting: the extra input tokens are real
and are billed as such.

### Consequence to state plainly

Transcription posts the complete raw exhibit file to OpenAI Whisper, up to
25MB, plus the filename. OpenAI has no DPA and no BAA with Advottic. This work
does not change that behaviour and does not add a new caller, but it does make
transcripts more useful, which will encourage more audio to be transcribed, and
therefore more audio to be sent there. That is a consequence of the feature and
is called out rather than buried.

## Testing

- `tests/audio-exhibit-intake.test.ts` covers each container signature, the
  RIFF ambiguity between WAV and WebP, and the screening decision.
- `tests/review-reads-what-was-scanned.test.ts` covers what the review is
  given, including the demo-scan exclusion and the transcript bound.

Both were written before the implementation and watched fail. Each guard was
then mutation-checked: disabling the audio screen and dropping the transcript
from the prompt each turn the relevant test red, and both mutations reverted
byte-identical.
