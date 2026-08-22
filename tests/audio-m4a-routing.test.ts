import { describe, expect, it } from 'vitest';
import {
  classifyExhibitForReading,
  exhibitIsScannable,
  SCAN_SUPPORTED_SENTENCE,
} from '../lib/exhibit-reading';

/**
 * A voice memo is ordinary evidence and it was being refused.
 *
 * transcribeExhibitAction tested the declared content type alone. Browsers
 * send .m4a as audio/x-m4a, audio/m4a, audio/mp4, and quite often with no
 * content type at all or as application/octet-stream. In those last two cases
 * the person was told "Only audio or video files can be transcribed" about an
 * audio file, which reads as a rejection of the recording rather than of the
 * label the browser put on it.
 */

const m4a = (fileType: string | null) => ({ fileName: 'Voice Memo.m4a', fileType });

describe('an .m4a reaches transcription however the browser labels it', () => {
  /**
   * Mutation: drop isMediaByName from the audio branch. The empty-type and
   * octet-stream rows go red, which are exactly the real-world cases.
   */
  it.each([
    ['audio/x-m4a'],
    ['audio/m4a'],
    ['audio/mp4'],
    ['application/octet-stream'],
    [''],
    [null],
  ])('routes to transcribe when the content type is %s', (fileType) => {
    expect(classifyExhibitForReading(m4a(fileType)).kind).toBe('transcribe');
  });

  it('is not offered to Scan', () => {
    expect(exhibitIsScannable(m4a('audio/x-m4a'))).toBe(false);
    expect(exhibitIsScannable(m4a(null))).toBe(false);
  });
});

/**
 * THE TRAP THIS GUARDS.
 *
 * An .m4a is an MPEG-4 container. Its ftyp box at offset 4 is the same
 * signature family lib/upload-safety.ts uses to recognise a HEIC photograph,
 * so a byte-sniffing router would sit one brand string away from sending a
 * recording to the vision model, or a photograph to transcription. Routing is
 * decided by name and declared type, and these two cases pin that the two
 * media never cross.
 *
 * Mutation: route by ftyp bytes instead. Both of these go red.
 */
describe('audio and HEIC photographs do not cross', () => {
  it('sends a HEIC photograph to the vision reader, not to transcription', () => {
    const r = classifyExhibitForReading({ fileName: 'IMG_4021.HEIC', fileType: 'image/heic' });
    expect(r.kind).toBe('vision');
  });

  /**
   * THE CASE THAT ACTUALLY SEPARATES THEM.
   *
   * A HEIC carrying a declared image type never reaches the audio branch, so
   * it cannot detect a name list that wrongly claims HEIC. A phone photograph
   * uploaded with NO content type does reach it, and that is the real upload:
   * iOS sends HEIC with an empty type often enough that this is the ordinary
   * case rather than the edge one.
   *
   * It must not be transcribed. It is a photograph.
   */
  it('never transcribes a HEIC photograph that arrived with no content type', () => {
    const r = classifyExhibitForReading({ fileName: 'IMG_4021.HEIC', fileType: '' });
    expect(r.kind).not.toBe('transcribe');
  });

  it('sends an .mp4 recording to transcription, not to the vision reader', () => {
    expect(classifyExhibitForReading({ fileName: 'clip.mp4', fileType: '' }).kind)
      .toBe('transcribe');
  });
});

describe('the other recording formats a phone produces', () => {
  it.each([
    ['Recording.mp3'], ['note.wav'], ['memo.aac'], ['clip.ogg'],
    ['call.opus'], ['track.flac'], ['voicemail.amr'], ['tape.aiff'],
    ['screen.mov'], ['clip.webm'], ['old.3gp'],
  ])('routes %s to transcription with no content type', (fileName) => {
    expect(classifyExhibitForReading({ fileName, fileType: '' }).kind).toBe('transcribe');
  });
});

describe('the supported sentence stays true', () => {
  /**
   * Scan's advertised list must not claim audio. Audio goes to Transcribe,
   * and saying otherwise would send somebody to the wrong button.
   */
  it('does not advertise audio or video as readable by Scan', () => {
    for (const claim of ['.m4a', 'audio', 'video', '.mp3', '.mov']) {
      expect(SCAN_SUPPORTED_SENTENCE.toLowerCase()).not.toContain(claim.toLowerCase());
    }
  });
});

/**
 * The media type sent to transcription is RESOLVED, not copied.
 *
 * The recordings that were being refused are exactly the ones with no content
 * type, so passing the declared type straight through would have replaced a
 * clear refusal with an empty string handed to the transcription service.
 */
describe('the media type given to transcription', () => {
  /** Mutation: return `type` unchanged. The no-content-type rows go red. */
  it.each([
    ['Voice Memo.m4a', '', 'audio/mp4'],
    ['Voice Memo.m4a', 'audio/x-m4a', 'audio/x-m4a'],
    ['note.mp3', '', 'audio/mpeg'],
    ['clip.mov', '', 'video/quicktime'],
    ['screen.webm', 'video/webm', 'video/webm'],
  ])('for %s declared as "%s" is %s', (fileName, fileType, expected) => {
    const r = classifyExhibitForReading({ fileName, fileType });
    expect(r.kind).toBe('transcribe');
    if (r.kind === 'transcribe') expect(r.mediaType).toBe(expected);
  });

  it('never hands an empty media type to transcription', () => {
    for (const fileName of ['a.m4a', 'b.mp3', 'c.wav', 'd.mov', 'e.aac']) {
      const r = classifyExhibitForReading({ fileName, fileType: '' });
      if (r.kind === 'transcribe') expect(r.mediaType.length).toBeGreaterThan(0);
    }
  });
});
