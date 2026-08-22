import { describe, expect, it } from 'vitest';
import {
  pdfCarriesActiveContent,
  screenAuthenticatedUpload,
  validateCommunityUpload,
} from '../lib/upload-safety';

/**
 * A person collecting evidence for their own legal matter could not upload
 * their documents. The message was "This PDF could not be accepted for
 * security reasons", and the cause was a substring scan over the first 2MB
 * of the file for /JavaScript, /JS or /OpenAction.
 *
 * Measured against 60 real PDFs at the time of the fix, that rule refused 5,
 * and 4 of the 5 were refused for /OpenAction alone. /OpenAction sets the
 * opening page and zoom and is emitted by Word, Acrobat and ordinary
 * scanners. The fifth was a fillable IRS form.
 *
 * These fixtures are the three shapes that matter, written as PDF bytes
 * rather than as strings, so the test exercises the same path the upload does.
 */

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1');

const MB = 1024 * 1024;

describe('an ordinary PDF is not refused', () => {
  /**
   * The exact false positive that blocked the upload.
   * Mutation: put /OpenAction back into pdfCarriesActiveContent. Goes red.
   */
  it('accepts a PDF whose only flagged token is /OpenAction', () => {
    const buf = pdf('1 0 obj\n<< /Type /Catalog /OpenAction [3 0 R /Fit] >>\nendobj');
    expect(pdfCarriesActiveContent(buf)).toBe(false);
    const r = screenAuthenticatedUpload(buf, 'application/pdf', 50 * MB);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.activeContent).toBeUndefined();
  });

  /**
   * /JS matched with a word boundary against compressed binary read as
   * latin1. Three bytes and a non-word byte occur by chance.
   * Mutation: restore the /JS\b branch. Goes red.
   */
  it('accepts a PDF where the bytes JS appear inside a binary stream', () => {
    const noise = Buffer.from([0x2f, 0x4a, 0x53, 0x00, 0xff, 0x1a, 0x9c, 0x4d]);
    const buf = Buffer.concat([
      Buffer.from('%PDF-1.7\n5 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      noise,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
    expect(pdfCarriesActiveContent(buf)).toBe(false);
    expect(screenAuthenticatedUpload(buf, 'application/pdf', 50 * MB).ok).toBe(true);
  });
});

describe('a PDF that really does carry a script', () => {
  /**
   * Reported, NOT refused, because this bucket is private and the reader is
   * the person who uploaded it. A fillable government form lands here.
   * Mutation: return { ok: false } for active content. Goes red.
   */
  it('is accepted and reported', () => {
    const buf = pdf('7 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj');
    expect(pdfCarriesActiveContent(buf)).toBe(true);
    const r = screenAuthenticatedUpload(buf, 'application/pdf', 50 * MB);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.activeContent).toBe('pdf_script');
  });

  /**
   * The community surface shows files to strangers, so it still refuses.
   * This is the one place the old strictness is correct and is kept.
   */
  it('is still refused on the community path', () => {
    const buf = pdf('7 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj');
    const r = validateCommunityUpload(buf);
    expect(r.ok).toBe(false);
  });
});

describe('the protections that were never the problem still hold', () => {
  it.each([
    ['HTML', Buffer.from('<!DOCTYPE html><script>alert(1)</script>', 'latin1')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'latin1')],
    ['a Windows executable', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])],
    ['a shell script', Buffer.from('#!/bin/sh\nrm -rf /\n', 'latin1')],
  ])('refuses %s', (_label, buf) => {
    expect(screenAuthenticatedUpload(buf, 'application/pdf', 50 * MB).ok).toBe(false);
  });

  it('refuses bytes that are not a PDF but are declared as one', () => {
    const buf = Buffer.from('just some text, not a pdf at all', 'latin1');
    const r = screenAuthenticatedUpload(buf, 'application/pdf', 50 * MB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not a valid PDF');
  });

  it('refuses an image whose bytes are not that image', () => {
    const buf = Buffer.from('%PDF-1.7 pretending to be a png', 'latin1');
    expect(screenAuthenticatedUpload(buf, 'image/png', 50 * MB).ok).toBe(false);
  });

  it('still enforces the size ceiling', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-', 'latin1'), Buffer.alloc(64)]);
    const r = screenAuthenticatedUpload(buf, 'application/pdf', 32);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('larger than');
  });
});
