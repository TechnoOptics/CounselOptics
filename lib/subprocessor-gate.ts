/**
 * Whether a sub-processor may receive customer content yet.
 *
 * THE ONE THIS EXISTS FOR. Two code paths send a COMPLETE raw exhibit file,
 * up to 25MB plus its original filename, to OpenAI's Whisper endpoint:
 * transcribeMedia in lib/ai.ts and transcribeAudio in lib/timeline-ai.ts.
 * Every other sub-processor receives something Advottic extracted. That one
 * receives the recording itself, and a client voice note or an incident video
 * can contain anything the client said, health information included, so it
 * must be treated as PHI until proven otherwise.
 *
 * Advottic has no DPA and no BAA with OpenAI. Its own policy in
 * docs/compliance/policies/vendor-and-subprocessor-management.md forbids a
 * sub-processor receiving production data without both, plus a HIPAA-eligible
 * plan where PHI is involved.
 *
 * WHY A SECOND FLAG AND NOT JUST THE API KEY. Both call sites already refuse
 * when OPENAI_API_KEY is absent, and on 2026-08-15 that key was confirmed
 * unset in production: 33 exhibits, 0 audio or video, 0 transcripts, so
 * nothing had ever been sent. But that safety was an ABSENCE nobody had
 * written down. Setting one environment variable to try a feature would have
 * silently begun shipping raw evidence to a processor under no agreement, and
 * whoever set it would have had no reason to think they were making a
 * compliance decision. An API key answers "can we reach this service". It must
 * not also answer "are we permitted to".
 *
 * So the key is necessary and no longer sufficient. Turning this on is a
 * deliberate act with a name that says what is being asserted.
 *
 * WHAT TO DO WHEN THE AGREEMENTS EXIST. Execute the DPA and the BAA, record
 * them in the vendor register with their dates, then set
 * OPENAI_SUBPROCESSOR_AGREEMENTS=signed. The guard in
 * tests/subprocessor-agreements.test.ts reads that register and will fail if
 * this flag is honoured while the register still shows the agreements
 * outstanding, so the two cannot drift apart.
 */

/** Env value that asserts the paperwork is done. Nothing else is accepted. */
const AGREEMENTS_SIGNED = 'signed';

/**
 * True only when BOTH a credential exists AND the agreements have been
 * asserted. Fails closed on an unset, empty, or unrecognised value, because
 * the failure here sends a client's recording to a third party and the
 * recovery is nothing at all: the data has left.
 */
export function openaiTranscriptionAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return false;
  return env.OPENAI_SUBPROCESSOR_AGREEMENTS?.trim().toLowerCase() === AGREEMENTS_SIGNED;
}

/**
 * What a person is told when transcription is off because of this gate rather
 * than because of a missing key.
 *
 * It names no vendor and no compliance state. Someone uploading a recording
 * to a legal matter does not need to read about our contracts, and a sentence
 * about an unsigned agreement would worry them about their own case. The
 * operator detail belongs in the server log, which is where the callers put
 * it.
 */
export const TRANSCRIPTION_UNAVAILABLE =
  'Transcription is not switched on for this workspace. You can still upload the recording, describe it in your own words, and add it to the case.';

/** What the server log gets, for whoever is wondering why it is off. */
export const TRANSCRIPTION_GATE_LOG =
  '[subprocessor-gate] Transcription is off: OPENAI_SUBPROCESSOR_AGREEMENTS is not "signed". Raw exhibit files would go to OpenAI, and Advottic has no DPA or BAA with them. See docs/compliance/policies/vendor-and-subprocessor-management.md before setting it.';
