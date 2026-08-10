import { describe, expect, it } from 'vitest';
import { isAudioBuffer, screenAuthenticatedUpload } from '../lib/upload-safety';

/**
 * Audio exhibits are validated by their bytes, like every other type.
 *
 * The consumer upload form already accepted audio and already offered a
 * Transcribe button, but nothing ever checked that an audio exhibit was audio:
 * SIGNATURES in lib/upload-safety.ts knew four formats, all of them pictures or
 * PDFs, so a declared `audio/mpeg` fell straight through the content-confusion
 * branch and returned ok. That matters more here than elsewhere, because the
 * bytes of an audio exhibit are sent whole to a third-party transcription API.
 *
 * The magic numbers below are the real container signatures, not extensions:
 * a file is audio because it starts like audio.
 */

function withHeader(header: number[] | string, size = 4096): Buffer {
  const head = typeof header === 'string' ? Buffer.from(header, 'latin1') : Buffer.from(header);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
}

/** ISO base media (m4a / mp4): 4-byte size, then `ftyp`, then a brand. */
function isoBmff(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand.padEnd(4, ' '), 'latin1'),
    Buffer.alloc(4000),
  ]);
}

describe('recognising audio by its bytes', () => {
  it('accepts an MP3 with an ID3 tag', () => {
    // "ID3" then the v2.4 version/flag bytes, written numerically: a raw
    // NUL in a source file makes the whole file invisible to grep.
    expect(isAudioBuffer(withHeader([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]))).toBe(true);
  });

  it('accepts a bare MP3 frame header', () => {
    expect(isAudioBuffer(withHeader([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
  });

  it('accepts a RIFF/WAVE recording', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x08, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.alloc(4000),
    ]);
    expect(isAudioBuffer(wav)).toBe(true);
  });

  it('accepts an m4a voice memo', () => {
    expect(isAudioBuffer(isoBmff('M4A'))).toBe(true);
  });

  it('accepts an Ogg recording', () => {
    expect(isAudioBuffer(withHeader('OggS'))).toBe(true);
  });

  it('accepts a FLAC recording', () => {
    expect(isAudioBuffer(withHeader('fLaC'))).toBe(true);
  });

  it('accepts a WebM/Matroska recording', () => {
    expect(isAudioBuffer(withHeader([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
  });

  it('does not mistake a WebP image for a WAV', () => {
    // Both start "RIFF". Only the form type at byte 8 tells them apart, and
    // getting this wrong would let a picture through as a recording.
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0x08, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1'),
      Buffer.alloc(4000),
    ]);
    expect(isAudioBuffer(webp)).toBe(false);
  });

  it('does not accept a PDF, a PNG or plain text as audio', () => {
    expect(isAudioBuffer(withHeader('%PDF-1.7'))).toBe(false);
    expect(isAudioBuffer(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
    expect(isAudioBuffer(withHeader('just some words'))).toBe(false);
  });
});

describe('screening an upload that claims to be audio', () => {
  const CAP = 50 * 1024 * 1024;

  it('lets a real recording through', () => {
    expect(screenAuthenticatedUpload(isoBmff('M4A'), 'audio/mp4', CAP)).toEqual({ ok: true });
  });

  it('refuses a file that claims to be audio and is not', () => {
    const res = screenAuthenticatedUpload(withHeader('%PDF-1.7'), 'audio/mpeg', CAP);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toMatch(/not a valid audio/i);
  });

  it('still refuses an executable renamed to a recording', () => {
    const res = screenAuthenticatedUpload(withHeader([0x4d, 0x5a, 0x90, 0x00]), 'audio/mpeg', CAP);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toMatch(/executable/i);
  });

  it('leaves video alone rather than guessing at it', () => {
    // Video is not transcribed by the consumer path today and has many more
    // containers; claiming to validate it would be a promise we do not keep.
    expect(screenAuthenticatedUpload(isoBmff('isom'), 'video/mp4', CAP)).toEqual({ ok: true });
  });

  it('does not change how a declared image is screened', () => {
    const res = screenAuthenticatedUpload(withHeader('OggS'), 'image/png', CAP);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toMatch(/not a valid image/i);
  });
});
