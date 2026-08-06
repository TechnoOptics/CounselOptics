import { describe, expect, it } from 'vitest';
import {
  decodeSignaturePng,
  MAX_SIGNATURE_BYTES,
  submissionMarkPath,
} from '../lib/template-signature';

/**
 * The mark arrives as a data URL the browser produced, which means it arrives
 * over HTTP from a caller, which means it is not trusted. These are the rules
 * that decide what is allowed to become a file in the firm's storage bucket and
 * then get handed to a PDF renderer and to an <img> tag.
 */

/** One 8-bit RGBA pixel: the smallest thing that is genuinely a PNG. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

describe('decodeSignaturePng', () => {
  it('accepts a well-formed PNG data URL', () => {
    const out = decodeSignaturePng(PNG_URL);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.bytes.subarray(0, 8).equals(PNG_BYTES.subarray(0, 8))).toBe(true);
  });

  it('rejects a value that is not a string', () => {
    for (const bad of [null, undefined, 42, {}, [], Buffer.from('x')]) {
      expect(decodeSignaturePng(bad).ok).toBe(false);
    }
  });

  it('rejects an SVG data URL', () => {
    // An SVG is a script-bearing document. Accepting one here would put it in
    // front of a PDF renderer and into an <img> on the reviewer's page.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(decodeSignaturePng(`data:image/svg+xml;base64,${svg.toString('base64')}`).ok).toBe(false);
  });

  it('rejects an SVG smuggled behind a PNG media type', () => {
    // The media type is the caller's claim. The magic number is the fact.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(decodeSignaturePng(`data:image/png;base64,${svg.toString('base64')}`).ok).toBe(false);
  });

  it('rejects a JPEG data URL', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(decodeSignaturePng(`data:image/jpeg;base64,${jpeg.toString('base64')}`).ok).toBe(false);
  });

  it('rejects a PNG prefix with a body that is not a PNG', () => {
    expect(decodeSignaturePng('data:image/png;base64,not really base64 at all').ok).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(decodeSignaturePng('data:image/png;base64,').ok).toBe(false);
  });

  it('rejects a bare data URL with no base64 marker', () => {
    expect(decodeSignaturePng('data:image/png,hello').ok).toBe(false);
  });

  it('finds the payload rather than assuming where it starts', () => {
    // A data URL may carry another parameter before ;base64,. Slicing a fixed
    // number of characters off the front would take part of that parameter as
    // payload, decode it to rubbish, and refuse a mark the person really did
    // draw. This is what stands in for the media-type prefix check that used
    // to sit here and could not fail.
    const url = `data:image/png;charset=utf-8;base64,${PNG_BYTES.toString('base64')}`;
    const out = decodeSignaturePng(url);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.bytes.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects a remote URL', () => {
    expect(decodeSignaturePng('https://example.com/signature.png').ok).toBe(false);
  });

  it('accepts a payload right at the size limit', () => {
    const pad = Buffer.alloc(MAX_SIGNATURE_BYTES - PNG_BYTES.length, 0);
    const bytes = Buffer.concat([PNG_BYTES, pad]);
    expect(bytes.length).toBe(MAX_SIGNATURE_BYTES);
    expect(decodeSignaturePng(`data:image/png;base64,${bytes.toString('base64')}`).ok).toBe(true);
  });

  it('rejects a payload one byte over the size limit', () => {
    const pad = Buffer.alloc(MAX_SIGNATURE_BYTES - PNG_BYTES.length + 1, 0);
    const bytes = Buffer.concat([PNG_BYTES, pad]);
    expect(decodeSignaturePng(`data:image/png;base64,${bytes.toString('base64')}`).ok).toBe(false);
  });

  it('gives a reason a caller could show, never a raw error', () => {
    const out = decodeSignaturePng('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.length).toBeGreaterThan(0);
    expect(out.error).not.toMatch(/undefined|\[object/);
  });
});

describe('submissionMarkPath', () => {
  it('puts a submission mark under templates, keyed by firm, submission and revision', () => {
    expect(submissionMarkPath('firm-1', 'sub-2', 3)).toBe('templates/firm-1/sub-2/3.png');
  });

  it('keeps revisions apart, so a resubmission does not overwrite its history', () => {
    expect(submissionMarkPath('f', 's', 1)).not.toBe(submissionMarkPath('f', 's', 2));
  });

  it('refuses an id that could climb out of its folder', () => {
    // These ids come from the database today. The guard is here because the
    // path is built from strings and a future caller may not be so careful.
    expect(() => submissionMarkPath('../../other-firm', 'sub', 1)).toThrow();
    expect(() => submissionMarkPath('firm', 'sub/../../..', 1)).toThrow();
    expect(() => submissionMarkPath('', 'sub', 1)).toThrow();
  });

  it('refuses a revision that is not a whole non-negative number', () => {
    expect(() => submissionMarkPath('f', 's', -1)).toThrow();
    expect(() => submissionMarkPath('f', 's', 1.5)).toThrow();
    expect(() => submissionMarkPath('f', 's', Number.NaN)).toThrow();
  });
});
