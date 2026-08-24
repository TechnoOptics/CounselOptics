import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './support/strip-comments';
import { fetchRemoteEvidence, isBlockedIp } from '../lib/remote-fetch';
import { screenAuthenticatedUpload } from '../lib/upload-safety';
import { classifyExhibitForReading } from '../lib/exhibit-reading';
import { LINK_IMPORT_MAX_BYTES, sanitizeImportedFileName } from '../lib/exhibit-link-import';

/**
 * Guards for "add an exhibit by link".
 *
 * THE RISK THIS FEATURE CARRIES, stated once so the guards below are read in
 * its light: the server is being asked to make an outbound request to an
 * address a caller chose, and then to keep whatever comes back as evidence.
 * Two things stop that being dangerous, and both of them already existed:
 *
 *   - lib/remote-fetch.ts refuses hosts that resolve into private, loopback,
 *     link-local, carrier-NAT and cloud-metadata ranges, on every redirect hop.
 *   - lib/upload-safety.ts screenAuthenticatedUpload refuses HTML, SVG and
 *     executables and catches content confusion, BEFORE anything is written.
 *
 * So these tests exist to prove the new path CALLS both of them and cannot
 * reach storage around either. Every source-reading assertion strips comments
 * first, and matches a CALL rather than a name, because a guard satisfied by
 * the comment that explains it is not a guard: that has happened twice in
 * this repo already.
 */

const ROOT = path.resolve(__dirname, '..');

function source(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/**
 * Slice one top-level declaration out of a module.
 *
 * Runs from the declaration to the next top-level `export`, which is enough
 * to isolate a function here and does not need a parser. Throws rather than
 * returning empty, so a renamed function fails loudly instead of making every
 * "does not contain" assertion below pass vacuously.
 */
function declarationBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`declaration not found: ${decl}`);
  const after = src.indexOf('\nexport ', start + decl.length);
  const body = src.slice(start, after === -1 ? src.length : after);
  if (body.length < 200) throw new Error(`slice for ${decl} is implausibly short`);
  return body;
}

const ACTIONS = source('lib/actions.ts');
const STORAGE = source('lib/storage.ts');
const LINK_ACTION = declarationBody(
  ACTIONS,
  'export async function addExhibitFromLinkAction(',
);
const ADD_EXHIBIT = declarationBody(STORAGE, 'export async function addExhibit(');

describe('the slices these guards run against are real', () => {
  it('found both functions, so a rename cannot make the guards vacuous', () => {
    expect(LINK_ACTION).toContain('addExhibitFromLinkAction');
    expect(ADD_EXHIBIT).toContain('addExhibit');
    expect(LINK_ACTION.length).toBeGreaterThan(1000);
    expect(ADD_EXHIBIT.length).toBeGreaterThan(1000);
  });

  it('stripped the comments, so no assertion below can be met by prose', () => {
    // The module's own doc comment says "fetchRemoteEvidence" several times.
    // If stripComments were not applied, that alone would satisfy the SSRF
    // guard without a single line of code calling it.
    expect(LINK_ACTION).not.toContain('WHY THIS DOOR EXISTS');
    expect(ADD_EXHIBIT).not.toContain('Magic-byte screen');
  });
});

describe('the link path goes through the hardened downloader, and nowhere else', () => {
  it('CALLS fetchRemoteEvidence', () => {
    expect(LINK_ACTION).toMatch(/\bfetchRemoteEvidence\s*\(/);
  });

  it('makes no other outbound request of its own', () => {
    // A "just this once" second fetch is exactly how an SSRF guard gets
    // bypassed without anybody deleting it.
    expect(LINK_ACTION).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
    expect(LINK_ACTION).not.toMatch(/\baxios\b/);
    expect(LINK_ACTION).not.toMatch(/\bhttps?\.(get|request)\s*\(/);
    expect(LINK_ACTION).not.toMatch(/\bundici\b/);
    expect(LINK_ACTION).not.toMatch(/\brequest\s*\(\s*['"]http/);
  });

  it('passes the ceiling INTO the downloader, so the download is bounded', () => {
    expect(LINK_ACTION).toMatch(
      /fetchRemoteEvidence\s*\(\s*[\w.]+\s*,\s*LINK_IMPORT_MAX_BYTES\s*\)/,
    );
  });
});

describe('the fetched file goes through the same content screen as an uploaded one', () => {
  it('the action writes through addExhibit rather than a second writer', () => {
    expect(LINK_ACTION).toMatch(/\bawait addExhibit\s*\(/);
  });

  it('the action never touches storage itself', () => {
    // Two reasons, and both matter. Storage writes here would skip the screen
    // that addExhibit runs; and labels are allocated by position, so a second
    // writer hands out a duplicate "Exhibit C".
    expect(LINK_ACTION).not.toMatch(/\.storage\b/);
    expect(LINK_ACTION).not.toMatch(/\.upload\s*\(/);
    expect(LINK_ACTION).not.toMatch(/createSignedUploadUrl/);
    expect(LINK_ACTION).not.toMatch(/\.from\s*\(\s*['"]exhibits['"]/);
  });

  it('the action never inserts an exhibit row itself', () => {
    expect(LINK_ACTION).not.toMatch(/\.insert\s*\(/);
    expect(LINK_ACTION).not.toMatch(/\bstorage_path\b/);
  });

  it('addExhibit, which is that single writer, CALLS screenAuthenticatedUpload', () => {
    expect(ADD_EXHIBIT).toMatch(/\bscreenAuthenticatedUpload\s*\(/);
  });

  it('addExhibit REFUSES on that screen rather than merely calling it', () => {
    // Calling a screen and ignoring its answer would satisfy the line above.
    expect(ADD_EXHIBIT).toMatch(/if\s*\(\s*!screen\.ok\s*\)\s*return\s*\{\s*ok:\s*false/);
  });

  it('addExhibit screens BEFORE it uploads, not after', () => {
    const screenAt = ADD_EXHIBIT.search(/\bscreenAuthenticatedUpload\s*\(/);
    const uploadAt = ADD_EXHIBIT.search(/\.upload\s*\(/);
    expect(screenAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(uploadAt);
  });

  it('addExhibit screens against the 50MB ceiling', () => {
    expect(ADD_EXHIBIT).toMatch(/50 \* 1024 \* 1024/);
  });
});

describe('owner only, checked in the action', () => {
  it('CALLS loadOwnedCase with the case id', () => {
    expect(LINK_ACTION).toMatch(/\bawait loadOwnedCase\s*\(\s*caseId\b/);
  });

  it('refuses on that result rather than merely calling it', () => {
    expect(LINK_ACTION).toMatch(/if\s*\(\s*!owned\.ok\s*\)\s*return\s*\{\s*ok:\s*false/);
  });

  it('checks ownership BEFORE making any outbound request', () => {
    // A non-owner must not be able to make this server fetch a URL for them,
    // even if the exhibit would never be created.
    const ownerAt = LINK_ACTION.search(/\bawait loadOwnedCase\s*\(/);
    const fetchAt = LINK_ACTION.search(/\bfetchRemoteEvidence\s*\(/);
    expect(ownerAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeLessThan(fetchAt);
  });
});

describe('the exhibit is the bytes, not a pointer at another server', () => {
  it('records the source url and the fetch time through linkProvenanceSource', () => {
    expect(LINK_ACTION).toMatch(/\blinkProvenanceSource\s*\(/);
    expect(LINK_ACTION).toMatch(/source:\s*linkProvenanceSource\s*\(/);
    expect(LINK_ACTION).toMatch(/fetchedAt/);
  });

  it('takes the fetch time at the moment of the fetch, not at insert time', () => {
    const stampAt = LINK_ACTION.search(/const fetchedAt = new Date\(\)\.toISOString\(\)/);
    const fetchAt = LINK_ACTION.search(/\bfetchRemoteEvidence\s*\(/);
    expect(stampAt).toBeGreaterThan(-1);
    expect(stampAt).toBeLessThan(fetchAt);
  });

  it('builds a File from the downloaded bytes, so what is stored is what arrived', () => {
    expect(LINK_ACTION).toMatch(/new File\s*\(/);
    expect(LINK_ACTION).toMatch(/fetched\.file\.buffer/);
  });

  it('cleans the name it records, and takes it from the URL or the response', () => {
    expect(LINK_ACTION).toMatch(/\bsanitizeImportedFileName\s*\(\s*fetched\.file\.name/);
  });
});

describe('a sharing page is named as one', () => {
  it('CALLS the page detector and the message that explains it', () => {
    expect(LINK_ACTION).toMatch(/\blooksLikeWebPage\s*\(/);
    expect(LINK_ACTION).toMatch(/\bsharingPageMessage\s*\(/);
  });

  it('reworded the content screen refusal rather than swallowing it', () => {
    expect(LINK_ACTION).toMatch(/\bexplainScreenRefusal\s*\(\s*added\.error/);
  });

  it('classifies every downloader refusal instead of flattening it', () => {
    expect(LINK_ACTION).toMatch(/\bclassifyLinkFailure\s*\(\s*fetched\.error\s*\)/);
  });
});

describe('the SSRF guard actually refuses, behaviourally', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.254', 'private 172.16/12 upper'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'carrier NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'ipv6 loopback'],
    ['fd00::1', 'ipv6 unique local'],
    ['fe80::1', 'ipv6 link local'],
    ['::ffff:127.0.0.1', 'ipv4 mapped loopback'],
  ])('isBlockedIp refuses %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['2606:2800:220:1:248:1893:25c8:1946']])(
    'isBlockedIp allows the public address %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it('refuses garbage that is not an address at all', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });

  // These call the real downloader. None of them reaches the network: the
  // host check runs before any request is made, so the refusal proves the
  // guard rather than the absence of a route.
  it.each([
    ['http://127.0.0.1:9/x.mp3'],
    ['http://localhost/x.mp3'],
    ['http://something.localhost/x.mp3'],
    ['http://printer.local/x.mp3'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://10.0.0.5/x.mp3'],
    ['http://192.168.0.10/x.mp3'],
    ['http://[::1]/x.mp3'],
  ])('fetchRemoteEvidence refuses %s before making a request', async (url) => {
    const res = await fetchRemoteEvidence(url, 1024);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not allowed|private address/i);
    }
  });

  it('refuses a non-web scheme outright', async () => {
    const res = await fetchRemoteEvidence('file:///etc/passwd', 1024);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/http and https/i);
  });
});

describe('the link path does not weaken what already existed', () => {
  it('remote-fetch still re-checks the host on every redirect hop', () => {
    const rf = source('lib/remote-fetch.ts');
    // The host check must sit INSIDE the redirect loop, not before it.
    const loopAt = rf.search(/for \(let hop = 0;/);
    const checkAt = rf.indexOf('await assertHostIsPublic(', loopAt);
    const redirectAt = rf.indexOf('resp.status >= 300', loopAt);
    expect(loopAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(loopAt);
    expect(redirectAt).toBeGreaterThan(checkAt);
  });

  it('remote-fetch still bounds the body while streaming', () => {
    const rf = source('lib/remote-fetch.ts');
    expect(rf).toMatch(/total > maxBytes/);
    expect(rf).toMatch(/reader\.cancel\s*\(/);
  });

  it('the direct-upload path still screens the object that landed', () => {
    const stored = declarationBody(
      STORAGE,
      'export async function addExhibitFromStoredObject(',
    );
    expect(stored).toMatch(/\bscreenStoredObject\s*\(/);
  });
});

describe('the screen really refuses what this path can bring back', () => {
  it('refuses a sharing page even when the host declares it as audio', () => {
    // Content-type is the host's claim. The bytes are the fact.
    const page = Buffer.from(
      '<!DOCTYPE html>\n<html><head><title>Dropbox - call.m4a</title></head>' +
        '<body><a href="/download">Download</a></body></html>',
    );
    const screen = screenAuthenticatedUpload(page, 'audio/mpeg', LINK_IMPORT_MAX_BYTES);
    expect(screen.ok).toBe(false);
    if (!screen.ok) expect(screen.reason).toMatch(/HTML\/SVG/);
  });

  it('refuses an executable dressed as a recording', () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)]);
    const screen = screenAuthenticatedUpload(exe, 'audio/mpeg', LINK_IMPORT_MAX_BYTES);
    expect(screen.ok).toBe(false);
    if (!screen.ok) expect(screen.reason).toMatch(/Executable/i);
  });

  it('refuses something declared audio that is not a media container', () => {
    const notAudio = Buffer.from('this is just some text pretending to be a recording');
    const screen = screenAuthenticatedUpload(notAudio, 'audio/mpeg', LINK_IMPORT_MAX_BYTES);
    expect(screen.ok).toBe(false);
    if (!screen.ok) expect(screen.reason).toMatch(/not a valid audio/i);
  });

  it('refuses one byte over the ceiling, measured on the bytes that arrived', () => {
    const tooBig = Buffer.alloc(LINK_IMPORT_MAX_BYTES + 1);
    const screen = screenAuthenticatedUpload(tooBig, 'audio/mpeg', LINK_IMPORT_MAX_BYTES);
    expect(screen.ok).toBe(false);
    if (!screen.ok) expect(screen.reason).toMatch(/50MB limit/);
  });

  it('ACCEPTS a genuine large recording, so the ceiling is not refusing the real case', () => {
    // 40MB of ID3-tagged MP3: bigger than the serverless request body by an
    // order of magnitude, and bigger than Whisper will transcribe, and still
    // a perfectly good exhibit.
    const big = Buffer.alloc(40 * 1024 * 1024);
    big.write('ID3', 0, 'ascii');
    const screen = screenAuthenticatedUpload(big, 'audio/mpeg', LINK_IMPORT_MAX_BYTES);
    expect(screen.ok).toBe(true);
  });
});

describe('a link-imported exhibit is read exactly like an uploaded one', () => {
  it('keeps the extension, which is what routes a file with a vague content type', () => {
    // Hosts routinely serve .m4a as application/octet-stream. The reader
    // consults the file name when the type says nothing, so a name that lost
    // its extension would make the recording unreadable afterwards.
    const name = sanitizeImportedFileName('../../call-2026-03-14.m4a', 'audio/mp4');
    expect(name.endsWith('.m4a')).toBe(true);
    const route = classifyExhibitForReading({
      fileName: name,
      fileType: 'application/octet-stream',
    });
    expect(route.kind).toBe('transcribe');
  });

  it('routes a fetched PDF to the same reader an uploaded PDF gets', () => {
    const name = sanitizeImportedFileName('lease agreement.pdf', 'application/pdf');
    expect(classifyExhibitForReading({ fileName: name, fileType: 'application/pdf' })).toEqual(
      classifyExhibitForReading({ fileName: 'lease agreement.pdf', fileType: 'application/pdf' }),
    );
  });
});
