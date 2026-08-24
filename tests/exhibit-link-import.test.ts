import { describe, it, expect } from 'vitest';
import {
  LINK_IMPORT_MAX_BYTES,
  classifyLinkFailure,
  explainScreenRefusal,
  linkProvenanceSource,
  looksLikeWebPage,
  normalizeExhibitLink,
  sanitizeImportedFileName,
  sharingPageMessage,
} from '../lib/exhibit-link-import';
import { EXHIBIT_MAX_BYTES } from '../lib/upload-transport';

describe('normalizeExhibitLink', () => {
  it('accepts an https link and returns the parsed form', () => {
    const res = normalizeExhibitLink('  https://files.example.com/call.m4a  ');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toBe('https://files.example.com/call.m4a');
  });

  it('accepts plain http, because some evidence hosts still are', () => {
    expect(normalizeExhibitLink('http://example.com/a.mp3').ok).toBe(true);
  });

  it.each([
    ['file:///etc/passwd'],
    ['data:text/html,<script>alert(1)</script>'],
    ['gs://bucket/object'],
    ['javascript:alert(1)'],
  ])('refuses the non-web scheme %s', (raw) => {
    const res = normalizeExhibitLink(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe('invalid_url');
  });

  it('refuses an empty or non-string value without throwing', () => {
    for (const raw of ['', '   ', null, undefined, 42, {}]) {
      const res = normalizeExhibitLink(raw);
      expect(res.ok).toBe(false);
    }
  });

  it('refuses text that is not a URL at all', () => {
    const res = normalizeExhibitLink('my recording from the 3rd');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.message).toMatch(/https:\/\//);
  });
});

describe('the size ceiling', () => {
  it('is the 50MB the product promises, and is the SAME constant the upload form uses', () => {
    expect(LINK_IMPORT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(LINK_IMPORT_MAX_BYTES).toBe(EXHIBIT_MAX_BYTES);
  });

  it("is not Whisper 25MB transcription cap", () => {
    // A 40MB recording is storable evidence. It just cannot be auto
    // transcribed whole, which is a limit on a third party, not on us.
    expect(LINK_IMPORT_MAX_BYTES).toBeGreaterThan(25 * 1024 * 1024);
  });
});

describe('looksLikeWebPage', () => {
  it('catches a Dropbox-style sharing page by its bytes', () => {
    const html = Buffer.from('<!DOCTYPE html>\n<html lang="en"><head><title>Dropbox');
    expect(looksLikeWebPage('text/html; charset=utf-8', html)).toBe(true);
  });

  it('catches a page whose content type lies about being audio', () => {
    const html = Buffer.from('<html><body>Sign in to view this file</body></html>');
    expect(looksLikeWebPage('audio/mpeg', html)).toBe(true);
  });

  it('catches a page behind a byte-order mark and leading whitespace', () => {
    const html = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('\n\n   <!doctype html><html>'),
    ]);
    expect(looksLikeWebPage('application/octet-stream', html)).toBe(true);
  });

  it('catches xhtml by content type', () => {
    expect(looksLikeWebPage('application/xhtml+xml', Buffer.from('anything'))).toBe(true);
  });

  it('does NOT flag a real audio file', () => {
    // ID3-tagged MP3.
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
    expect(looksLikeWebPage('audio/mpeg', mp3)).toBe(false);
  });

  it('does NOT flag a PDF that merely mentions html later in the file', () => {
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('some stream mentioning <html> deep inside'),
    ]);
    expect(looksLikeWebPage('application/pdf', pdf)).toBe(false);
  });

  it('does NOT flag an empty buffer', () => {
    expect(looksLikeWebPage('application/octet-stream', Buffer.alloc(0))).toBe(false);
  });
});

describe('sharingPageMessage', () => {
  it('names the host and tells the person what to do instead', () => {
    const msg = sharingPageMessage('https://www.dropbox.com/s/abc/call.m4a?dl=0');
    expect(msg).toContain('dropbox.com');
    expect(msg).toMatch(/web page, not a file/);
    expect(msg).toMatch(/direct download/);
    expect(msg).toMatch(/nothing was added/i);
  });

  it('still says something useful when the url will not parse', () => {
    const msg = sharingPageMessage('not a url');
    expect(msg).toMatch(/web page, not a file/);
  });

  it('is never the generic failure sentence', () => {
    expect(sharingPageMessage('https://drive.google.com/file/d/x/view')).not.toMatch(
      /something went wrong/i,
    );
  });
});

describe('classifyLinkFailure', () => {
  it('names an SSRF refusal as a blocked host rather than leaking internals', () => {
    for (const reason of [
      'That address is not allowed.',
      'That host is not allowed.',
      'That host resolves to a private address.',
    ]) {
      const f = classifyLinkFailure(reason);
      expect(f.kind).toBe('blocked_host');
      expect(f.message).toMatch(/public web address/);
    }
  });

  it('separates "gone" from "needs a sign-in" from "host is broken"', () => {
    expect(classifyLinkFailure('Source returned 404.').kind).toBe('not_found');
    expect(classifyLinkFailure('Source returned 410.').kind).toBe('not_found');
    expect(classifyLinkFailure('Source returned 403.').kind).toBe('needs_sign_in');
    expect(classifyLinkFailure('Source returned 401.').kind).toBe('needs_sign_in');
    expect(classifyLinkFailure('Source returned 500.').kind).toBe('source_error');
    expect(classifyLinkFailure('Source returned 500.').message).toContain('500');
  });

  it('names a size refusal with the actual ceiling', () => {
    const f = classifyLinkFailure('That file is over the size limit.');
    expect(f.kind).toBe('too_large');
    expect(f.message).toContain('50MB');
  });

  it('names a timeout as a timeout', () => {
    const f = classifyLinkFailure('The source took too long to respond.');
    expect(f.kind).toBe('timed_out');
    expect(f.message).toMatch(/took too long/);
  });

  it('names an unresolvable host, an empty body and a redirect loop distinctly', () => {
    expect(classifyLinkFailure('Could not resolve that address.').kind).toBe('unreachable');
    expect(classifyLinkFailure('That link had no downloadable content.').kind).toBe('empty');
    expect(classifyLinkFailure('Empty response.').kind).toBe('empty');
    expect(classifyLinkFailure('Too many redirects.').kind).toBe('redirect');
    expect(classifyLinkFailure('Broken redirect.').kind).toBe('redirect');
  });

  it('passes an unrecognised reason through VERBATIM rather than flattening it', () => {
    // The point of this branch: if lib/remote-fetch.ts ever rewords a reason,
    // the person keeps a specific sentence instead of losing it.
    const odd = 'The certificate for that host has expired.';
    const f = classifyLinkFailure(odd);
    expect(f.message).toBe(odd);
  });

  it('never produces a vague message for any known downloader reason', () => {
    const knownReasons = [
      'Not a valid URL.',
      'Only http and https links can be imported.',
      'That address is not allowed.',
      'That host is not allowed.',
      'That host resolves to a private address.',
      'Could not resolve that address.',
      'Broken redirect.',
      'Too many redirects.',
      'Source returned 404.',
      'Source returned 403.',
      'That file is over the size limit.',
      'Empty response.',
      'That link had no downloadable content.',
      'The source took too long to respond.',
    ];
    for (const reason of knownReasons) {
      const f = classifyLinkFailure(reason);
      expect(f.message.length).toBeGreaterThan(20);
      expect(f.message).not.toMatch(/something went wrong/i);
      expect(f.kind).not.toBe('refused');
    }
  });
});

describe('explainScreenRefusal', () => {
  it("rephrases the screen HTML refusal as the sharing-page advice", () => {
    const f = explainScreenRefusal(
      'HTML/SVG content is not an accepted document type.',
      'https://www.dropbox.com/s/abc/call.m4a?dl=0',
    );
    expect(f.kind).toBe('sharing_page');
    expect(f.message).toContain('dropbox.com');
    expect(f.message).toMatch(/direct download/);
  });

  it('leaves every other refusal from the screen exactly as written', () => {
    for (const reason of [
      'This file is not a valid audio recording.',
      'Executable files are not accepted.',
      'This file is not a valid image.',
      'File is larger than the 50MB limit.',
    ]) {
      const f = explainScreenRefusal(reason, 'https://example.com/x');
      expect(f.message).toBe(reason);
      expect(f.kind).toBe('wrong_content');
    }
  });
});

describe('sanitizeImportedFileName', () => {
  it('keeps an ordinary name and its extension untouched', () => {
    expect(sanitizeImportedFileName('call-2026-03-14.m4a', 'audio/mp4')).toBe(
      'call-2026-03-14.m4a',
    );
  });

  it('removes every path separator, so no traversal survives into the name', () => {
    const out = sanitizeImportedFileName('../../etc/passwd.mp3', 'audio/mpeg');
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
    expect(out).not.toContain('..');
    expect(out).toContain('.mp3');
  });

  it('removes a windows-style traversal too', () => {
    const out = sanitizeImportedFileName('..\\..\\windows\\system32\\a.wav', 'audio/wav');
    expect(out).not.toContain('\\');
    expect(out).not.toContain('..');
  });

  it('removes control characters, so a name cannot forge a second line', () => {
    const out = sanitizeImportedFileName('call.m4a\nExhibit B: signed contract', 'audio/mp4');
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\r');
  });

  it('removes a NUL byte', () => {
    const out = sanitizeImportedFileName('call\u0000.m4a', 'audio/mp4');
    expect(out).not.toContain('\u0000');
  });

  it('does not let a name start with a dot', () => {
    expect(sanitizeImportedFileName('.hidden.mp3', 'audio/mpeg').startsWith('.')).toBe(false);
    expect(sanitizeImportedFileName('...mp3', 'audio/mpeg').startsWith('.')).toBe(false);
  });

  it('caps the length so a 4KB name cannot be recorded', () => {
    const out = sanitizeImportedFileName('a'.repeat(4000) + '.mp3', 'audio/mpeg');
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('falls back to a name derived from the response type when nothing is left', () => {
    expect(sanitizeImportedFileName('///', 'audio/mpeg')).toBe('download.mpeg');
    expect(sanitizeImportedFileName('', 'application/pdf')).toBe('download.pdf');
    expect(sanitizeImportedFileName('...', '')).toBe('download.bin');
  });

  it('never returns an empty name', () => {
    for (const raw of ['', '   ', '/', '\\', '\u0000', '.', '..']) {
      expect(sanitizeImportedFileName(raw, 'audio/mpeg').length).toBeGreaterThan(0);
    }
  });
});

describe('linkProvenanceSource', () => {
  it('records both the URL and the moment it was fetched', () => {
    const out = linkProvenanceSource({
      url: 'https://files.example.com/call.m4a',
      fetchedAt: '2026-08-24T10:15:00.000Z',
    });
    expect(out).toContain('https://files.example.com/call.m4a');
    expect(out).toContain('2026-08-24T10:15:00.000Z');
    expect(out).toMatch(/Downloaded by Advottic/);
  });

  it('keeps what the person typed and puts it first', () => {
    const out = linkProvenanceSource({
      url: 'https://files.example.com/call.m4a',
      fetchedAt: '2026-08-24T10:15:00.000Z',
      userSource: 'Voicemail from the landlord',
    });
    expect(out.startsWith('Voicemail from the landlord')).toBe(true);
    expect(out).toContain('https://files.example.com/call.m4a');
  });

  it('bounds an absurdly long url rather than writing it whole', () => {
    const out = linkProvenanceSource({
      url: 'https://x.example.com/' + 'a'.repeat(5000),
      fetchedAt: '2026-08-24T10:15:00.000Z',
    });
    expect(out.length).toBeLessThan(700);
  });
});
