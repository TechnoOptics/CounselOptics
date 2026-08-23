/**
 * A transcript a PERSON typed, kept apart from one the software produced.
 *
 * WHY THIS EXISTS. Automatic transcription is switched off and is staying off:
 * it would send the whole recording to OpenAI, and there is no DPA and no BAA
 * with them (lib/subprocessor-gate.ts). So the person transcribes the
 * recording on their own machine and puts the text here. Nothing in this
 * module talks to any transcription service, and nothing here reads the
 * sub-processor gate.
 *
 * THE ONE REQUIREMENT THIS MODULE EXISTS TO ENFORCE. A transcript typed by a
 * person and a transcript produced by transcription software are different
 * kinds of claim, and somebody relying on one in a hearing is entitled to know
 * which they have. A person's transcript is their own reading of the
 * recording, checked by nobody; a machine transcript is a tool's output, wrong
 * in different ways (mis-heard names, dropped crosstalk) and never reviewed by
 * anyone at all. Presenting the first as the second would let a court, or the
 * case owner's own lawyer, treat one person's account of what was said as an
 * independent reading of the recording.
 *
 * So the provenance travels WITH the text, in three places that every consumer
 * of scan_data already reads:
 *
 *   modelUsed  MANUAL_TRANSCRIPT_MODEL, never a model name.
 *   readMethod 'typed-by-person', the sibling of 'vision' and 'extracted-text'.
 *   summary    starts with MANUAL_TRANSCRIPT_SUMMARY_LEAD, so the sentence the
 *              review prompt and the collapsed exhibit row show FIRST says who
 *              supplied it.
 *
 * `readNote` carries the long form, which lib/ai.ts describeExhibitsForPrompt
 * already renders to the model as "How it was read" and the exhibit row
 * already shows to the person. This is the same pattern the spreadsheet path
 * uses (extractedTextReadNote in lib/exhibit-reading.ts) and for the same
 * reason.
 *
 * Pure. No I/O, no imports beyond the ScanData type, testable on its own.
 */

import type { ScanData } from './types';

/**
 * What goes in `modelUsed` for a hand-typed transcript.
 *
 * NOT a model name, and deliberately not one of the two values `isRealScan` in
 * lib/types.ts rejects ('demo' and 'unsupported'). A typed transcript is real
 * content, not a placeholder, so it has to pass that existing rule or the
 * review, Bella and the packet readiness count would all ignore the text the
 * person went to the trouble of typing. Reusing `isRealScan` rather than
 * writing a second "is this real" rule is the whole point.
 */
export const MANUAL_TRANSCRIPT_MODEL = 'human-transcript';

/**
 * The first sentence of the stored summary.
 *
 * The summary is the field the collapsed exhibit row shows and the field
 * lib/ai.ts prints to the model as "Scanned: ...". If it held only the
 * transcript's opening words, that label would put a person's typing under a
 * heading that reads as a machine's reading of the file. The lead sentence
 * makes the first thing anybody sees the truth about where the text came from.
 */
export const MANUAL_TRANSCRIPT_SUMMARY_LEAD =
  'Transcript typed in by the case owner. Transcription software did not produce this text.';

/**
 * The long form, for `readNote`.
 *
 * Says the two things a reader has to know: a person wrote it, and nobody has
 * checked it against the recording. The second sentence is not hedging. A
 * machine transcript at least reflects the audio the tool received; this one
 * reflects one person's hearing of it, and if that person mis-heard a name the
 * only record of the error is the recording itself.
 */
export const MANUAL_TRANSCRIPT_READ_NOTE =
  'This transcript was typed or pasted in by the case owner rather than produced by transcription software. It is their own reading of the recording and has not been checked against it by anyone else. The wording is stored exactly as it was entered.';

/**
 * How much text one exhibit may carry.
 *
 * 500,000 characters. Speech runs near 900 characters a minute once speaker
 * labels and timestamps are counted, so this is roughly nine hours of talking,
 * or about 250 transcript pages. A full day of deposition or a long bodycam
 * recording fits with room to spare, and the hour-long recording that prompted
 * this feature uses about a tenth of it.
 *
 * It is not set higher because scan_data is loaded in full by the case page
 * for EVERY exhibit at once. A cap in the megabytes would let a handful of
 * recordings turn one page load into a payload nobody on a courthouse
 * connection can fetch. The jsonb column itself would take far more; the
 * budget being protected here is the page, not the database.
 *
 * NOTHING IS EVER TRUNCATED. Past this the save is refused and the person is
 * told the limit and their actual length, because quietly storing the first
 * 500,000 characters of somebody's evidence and reporting success is how a
 * transcript arrives at a hearing missing its last hour with no sign that
 * anything is missing.
 */
export const MAX_MANUAL_TRANSCRIPT_CHARS = 500_000;

/** The refusal shown when a save would have run past the cap. */
export function tooLongMessage(length: number): string {
  return `That transcript is ${length.toLocaleString('en-US')} characters and the limit is ${MAX_MANUAL_TRANSCRIPT_CHARS.toLocaleString('en-US')}. Nothing was saved and nothing was cut. Split the recording into shorter exhibits, or upload the transcript as its own document exhibit.`;
}

/**
 * The refusal shown for an empty box.
 *
 * EMPTY IS REFUSED, IT DOES NOT CLEAR. The same control is used to correct an
 * existing transcript, which is the normal case: a person fixing a mis-heard
 * name the night before a hearing. scan_data is overwritten in place and this
 * product keeps no earlier version of it, so a save that treated an empty box
 * as "delete it" would destroy the only text record of a recording on one
 * stray select-all, or on a paste that silently failed, with nothing to
 * recover from. Refusing costs a person who genuinely wants the text gone
 * nothing they cannot get another way; accepting costs the other person their
 * evidence.
 */
export const MANUAL_TRANSCRIPT_EMPTY_MESSAGE =
  'There is no transcript text to save. Nothing was changed. To correct a transcript, edit the text and save it again.';

export type ManualTranscriptCheck =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Decide whether this text may be stored, WITHOUT changing it.
 *
 * The returned `text` is the input string, byte for byte. Nothing is trimmed,
 * reflowed, re-wrapped or collapsed, and no blank line is removed. A
 * transcript's shape carries meaning: speaker labels sit at the head of a
 * line, timestamps sit in their own column, and a blank line is where one
 * speaker stopped. Tidying any of that would be editing evidence.
 *
 * The emptiness test is the only place the text is trimmed, and only to make
 * the decision. A box holding nothing but spaces and newlines is an empty box.
 */
export function checkManualTranscript(input: unknown): ManualTranscriptCheck {
  if (typeof input !== 'string') return { ok: false, error: MANUAL_TRANSCRIPT_EMPTY_MESSAGE };
  if (input.trim().length === 0) {
    return { ok: false, error: MANUAL_TRANSCRIPT_EMPTY_MESSAGE };
  }
  if (input.length > MAX_MANUAL_TRANSCRIPT_CHARS) {
    return { ok: false, error: tooLongMessage(input.length) };
  }
  return { ok: true, text: input };
}

/** How much of the transcript the stored summary quotes after the lead. */
const SUMMARY_EXCERPT_CHARS = 220;

/**
 * Build the scan record for a typed transcript.
 *
 * `isVideo` decides only the doc type and the suggested category, matching
 * what transcribeMedia in lib/ai.ts stores for the same file, so the two paths
 * are told apart by their provenance fields and by nothing else.
 */
export function buildManualTranscriptScan(input: {
  text: string;
  isVideo: boolean;
  now: string;
}): ScanData {
  const excerpt = input.text.replace(/\s+/g, ' ').trim();
  const clipped =
    excerpt.length <= SUMMARY_EXCERPT_CHARS
      ? excerpt
      : `${excerpt.slice(0, SUMMARY_EXCERPT_CHARS).trimEnd()}...`;
  return {
    docType: input.isVideo ? 'video' : 'voice_note',
    identifiers: {},
    parties: [],
    dates: [],
    summary: `${MANUAL_TRANSCRIPT_SUMMARY_LEAD} ${clipped}`,
    transcript: input.text,
    suggestedCategory: input.isVideo ? 'Video' : 'Audio',
    scannedAt: input.now,
    modelUsed: MANUAL_TRANSCRIPT_MODEL,
    readMethod: 'typed-by-person',
    readNote: MANUAL_TRANSCRIPT_READ_NOTE,
  };
}

/**
 * True when this stored scan is a person's typing.
 *
 * Either marker alone is enough. They are written together and a record
 * carrying only one of them is a record this code did not write, so the safe
 * reading of a half-marked record is the one that shows the caveat rather than
 * the one that hides it.
 */
export function isManualTranscript(
  scan: { modelUsed?: string; readMethod?: string } | null | undefined,
): boolean {
  if (!scan) return false;
  return scan.modelUsed === MANUAL_TRANSCRIPT_MODEL || scan.readMethod === 'typed-by-person';
}

/**
 * What the exhibit row prints where it otherwise prints the model name.
 *
 * "Scanned 08/22/2026 . human-transcript" would be two untruths in one line:
 * nothing scanned anything, and `human-transcript` reads like a model id. The
 * row asks this instead.
 */
export function scanProvenanceLabel(
  scan: { modelUsed?: string; readMethod?: string } | null | undefined,
): 'typed-by-person' | 'machine' {
  return isManualTranscript(scan) ? 'typed-by-person' : 'machine';
}

/**
 * The heading a transcript is printed under in the court packet.
 *
 * The packet is read by a judge, by opposing counsel and by the case owner's
 * own lawyer, none of whom can ask the software where the words came from. The
 * heading is the only place they will be told, so it says it plainly rather
 * than in a footnote.
 */
export function packetTranscriptHeading(
  scan: { modelUsed?: string; readMethod?: string } | null | undefined,
): string {
  return isManualTranscript(scan)
    ? 'Transcript, typed in by the case owner'
    : 'Transcript, produced by transcription software';
}

/** The sentence printed under that heading in the packet. */
export function packetTranscriptNote(
  scan: { modelUsed?: string; readMethod?: string } | null | undefined,
): string {
  return isManualTranscript(scan)
    ? 'This transcript was typed in by the case owner from the recording. It was not produced by transcription software and has not been certified by a transcriptionist.'
    : 'This transcript was produced automatically from the recording by transcription software. It has not been certified by a transcriptionist.';
}
