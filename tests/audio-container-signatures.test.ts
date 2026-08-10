import { describe, it, expect } from 'vitest';
import { isAudioBuffer } from '@/lib/upload-safety';

/**
 * The containers a person's own recorder actually produces.
 *
 * This exists because a narrower version of isAudioBuffer shipped and broke
 * audio upload for real users within the hour. Before it there was no audio
 * check at all, so every recording was accepted; adding one that recognised
 * six containers turned every other format into a refusal. The refusal was
 * then thrown rather than returned, so what the person saw was React's
 * "the specific message is omitted in production builds", with no way to
 * learn that their file had been judged not to be audio.
 *
 * So the rule this file pins is not "reject non-audio". It is that a
 * RECORDING A PHONE MAKES MUST UPLOAD. The gate's purpose is to establish
 * that bytes leaving for a third-party transcription API are a media
 * container at all, and being generous about which one costs nothing that
 * matters. Being narrow costs somebody their evidence.
 */
describe('every container a consumer recorder writes is accepted', () => {
  /** A signature followed by enough padding to clear the 12-byte floor. */
  const sig = (bytes: number[]) => Buffer.from(bytes.concat(Array(24).fill(0)));
  const ascii = (s: string) => Buffer.concat([Buffer.from(s), Buffer.alloc(24)]);
  /** An ISO base media header: 4 size bytes, then ftyp, then the brand. */
  const ftyp = (brand: string) =>
    Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from('ftyp'),
      Buffer.from(brand),
      Buffer.alloc(16),
    ]);

  const ACCEPTED: Array<[string, Buffer]> = [
    ['mp3 with an ID3v2 tag', sig([0x49, 0x44, 0x33, 0x03])],
    ['mp3 with a bare frame sync', sig([0xff, 0xfb, 0x90])],
    ['wav', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)])],
    // iPhone Voice Memos. The brand carries a trailing space, which is why
    // the brand test trims before comparing.
    ['m4a from iPhone Voice Memos', ftyp('M4A ')],
    ['mp4 audio', ftyp('mp42')],
    // Android recorders still emit these two, and neither was accepted by
    // the first version of this gate.
    ['3gp from an Android recorder', ftyp('3gp4')],
    ['3g2', ftyp('3g2a')],
    // Raw ADTS AAC shares the 12-bit sync word with MPEG audio but differs
    // in the layer bits, so the mp3 test cannot match it: 0xf1 & 0xe6 is
    // 0xe0, not 0xe2. That near-miss is exactly why it was rejected.
    ['raw ADTS aac', sig([0xff, 0xf1, 0x50, 0x80])],
    ['amr', ascii('#!AMR')],
    ['caf from macOS or iOS', ascii('caff')],
    ['wma in an asf container', sig([0x30, 0x26, 0xb2, 0x75])],
    ['webm from a browser MediaRecorder', sig([0x1a, 0x45, 0xdf, 0xa3])],
    ['ogg or opus', ascii('OggS')],
    ['flac', ascii('fLaC')],
  ];

  for (const [name, buf] of ACCEPTED) {
    it(`accepts ${name}`, () => {
      expect(isAudioBuffer(buf)).toBe(true);
    });
  }
});

describe('things that are not recordings are still refused', () => {
  const REFUSED: Array<[string, Buffer]> = [
    ['a png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0])],
    ['a windows executable', Buffer.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    ['an html document', Buffer.concat([Buffer.from('<!DOCTYPE html>'), Buffer.alloc(12)])],
    ['a pdf', Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(12)])],
    // WebP is also a RIFF container, so the form type at byte 8 is the only
    // thing separating it from wav. Getting this wrong would let an image
    // through as a recording.
    [
      'a webp, which is RIFF like wav',
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]),
    ],
    ['something shorter than any signature', Buffer.from([0xff, 0xfb])],
  ];

  for (const [name, buf] of REFUSED) {
    it(`refuses ${name}`, () => {
      expect(isAudioBuffer(buf)).toBe(false);
    });
  }
});
