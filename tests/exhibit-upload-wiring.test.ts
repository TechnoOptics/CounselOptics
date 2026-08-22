import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';
import {
  exhibitObjectPath,
  sanitizeExhibitExt,
  verifyExhibitObjectPath,
} from '../lib/exhibit-direct-upload';

const ROOT = join(__dirname, '..');
// Every guard below matches against COMMENT-STRIPPED source. A guard that can
// be satisfied by the comment explaining it is not a guard, and this repo has
// been bitten by exactly that twice.
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

const FORM = 'app/cases/[id]/upload-form.tsx';
const STORAGE = 'lib/storage.ts';
const ACTIONS = 'lib/actions.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const CASE = '22222222-2222-4222-8222-222222222222';
const EXH = '33333333-3333-4333-8333-333333333333';

describe('the direct path is actually wired, not merely described', () => {
  it('the form asks lib/upload-transport which transport to use', () => {
    const src = code(FORM);
    // A call, with its open paren and an argument, not the bare name.
    expect(src).toMatch(/chooseExhibitTransport\(\s*file\.size\s*\)/);
  });

  it('the form sends big files with uploadToSignedUrl', () => {
    const src = code(FORM);
    expect(src).toMatch(/\.uploadToSignedUrl\(/);
    expect(src).toMatch(/mintExhibitUploadAction\(/);
    expect(src).toMatch(/finalizeExhibitUploadAction\(/);
  });

  it('the small-file server action path is left in place', () => {
    // The fix must not have quietly moved every upload onto the weaker
    // ordering. The original call is still there and still reachable.
    expect(code(FORM)).toMatch(/uploadExhibitAction\(\s*caseId\s*,\s*formData\s*\)/);
  });

  it('the server mints the signed URL rather than the browser', () => {
    expect(code(STORAGE)).toMatch(/\.createSignedUploadUrl\(/);
    // The browser is never handed a service-role client.
    expect(code(FORM)).not.toMatch(/createSignedUploadUrl/);
    expect(code(FORM)).not.toMatch(/SERVICE_ROLE/);
  });

  it('exposes exactly the two direct-upload server actions the form needs', () => {
    const src = code(ACTIONS);
    expect(src).toMatch(/export async function mintExhibitUploadAction\(/);
    expect(src).toMatch(/export async function finalizeExhibitUploadAction\(/);
  });
});

/**
 * THE GUARD THAT MATTERS MOST.
 *
 * A direct upload writes bytes into the bucket without our server seeing
 * them. If the finalize step ever stops screening, HTML, SVG and executables
 * get into a bucket that is served by signed URL and nothing anywhere says so.
 * These assert the CALL, and they assert its ORDER relative to the row insert,
 * because a screen that runs after the row is created is not the control it
 * claims to be.
 */
describe('the dangerous-content screen still covers the direct path', () => {
  const src = code(STORAGE);
  const fn = (() => {
    const start = src.indexOf('export async function addExhibitFromStoredObject');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\nexport ', start + 10);
    return src.slice(start, end === -1 ? undefined : end);
  })();

  it('calls screenStoredObject on the object that landed', () => {
    expect(fn).toMatch(/screenStoredObject\(\s*\{/);
    // and acts on the answer rather than ignoring it
    expect(fn).toMatch(/if\s*\(\s*!screened\.ok\s*\)/);
    expect(fn).toMatch(/return\s*\{\s*ok:\s*false,\s*error:\s*screened\.error/);
  });

  it('screens BEFORE it writes the exhibit row', () => {
    const screenAt = fn.indexOf('screenStoredObject(');
    const insertAt = fn.indexOf(".from('exhibits')\n    .insert(");
    const anyInsert = insertAt === -1 ? fn.indexOf('.insert(') : insertAt;
    expect(screenAt).toBeGreaterThan(-1);
    expect(anyInsert).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(anyInsert);
  });

  it('verifies the path before it screens or inserts anything', () => {
    const verifyAt = fn.indexOf('verifyExhibitObjectPath(');
    const screenAt = fn.indexOf('screenStoredObject(');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(screenAt);
  });

  it('enforces the 50MB ceiling as a number handed to the screen', () => {
    // The ceiling has to be a real argument to a real call, not a sentence in
    // a message. screenStoredObject measures it against the stored bytes.
    expect(fn).toMatch(/maxBytes:\s*50\s*\*\s*1024\s*\*\s*1024/);
  });

  it('never writes to the exhibits bucket from the browser', () => {
    const form = code(FORM);
    // uploadToSignedUrl is the only storage write the client makes: it needs
    // a server-minted, single-path token. A plain .upload() would not.
    expect(form).not.toMatch(/storage\s*\n?\s*\.from\('exhibits'\)\s*\n?\s*\.upload\(/);
  });
});

describe('verifyExhibitObjectPath: the path is recomputed, never believed', () => {
  const base = { userId: USER, caseId: CASE, exhibitId: EXH, fileName: 'memo.m4a' };
  const good = exhibitObjectPath(base);

  it('accepts the exact path the server would have minted', () => {
    expect(good).toBe(`${USER}/${CASE}/${EXH}.m4a`);
    expect(verifyExhibitObjectPath({ ...base, path: good })).toEqual({ ok: true, path: good });
  });

  it("refuses another person's object", () => {
    const other = `99999999-9999-4999-8999-999999999999/${CASE}/${EXH}.m4a`;
    expect(verifyExhibitObjectPath({ ...base, path: other }).ok).toBe(false);
  });

  it('refuses another case belonging to the same person', () => {
    const otherCase = `${USER}/44444444-4444-4444-8444-444444444444/${EXH}.m4a`;
    expect(verifyExhibitObjectPath({ ...base, path: otherCase }).ok).toBe(false);
  });

  it('refuses a different object under the same case, so two rows cannot share one file', () => {
    const sibling = `${USER}/${CASE}/55555555-5555-4555-8555-555555555555.m4a`;
    expect(verifyExhibitObjectPath({ ...base, path: sibling }).ok).toBe(false);
  });

  it('refuses a timeline object, which lives under the same case prefix', () => {
    const timeline = `${USER}/${CASE}/timeline/${EXH}/recording.m4a`;
    expect(verifyExhibitObjectPath({ ...base, path: timeline }).ok).toBe(false);
  });

  it('refuses traversal and other non-paths', () => {
    for (const path of [
      `${USER}/${CASE}/../../other/secret.pdf`,
      `../${USER}/${CASE}/${EXH}.m4a`,
      '',
      '/',
      null,
      undefined,
      42,
      { path: good },
    ]) {
      expect(verifyExhibitObjectPath({ ...base, path }).ok, String(path)).toBe(false);
    }
  });

  it('refuses an exhibit id that is not a UUID this server generated', () => {
    for (const exhibitId of ['..', 'abc', '', '3333', `${EXH}/x`, '*']) {
      const path = `${USER}/${CASE}/${exhibitId}.m4a`;
      expect(verifyExhibitObjectPath({ ...base, exhibitId, path }).ok, exhibitId).toBe(false);
    }
  });

  it('refuses when the file name changed between minting and finalizing', () => {
    // The extension is part of the derived path, so a swapped name no longer
    // matches what was minted.
    expect(verifyExhibitObjectPath({ ...base, fileName: 'memo.html', path: good }).ok).toBe(false);
  });
});

describe('sanitizeExhibitExt', () => {
  it('keeps ordinary extensions and lowercases them', () => {
    expect(sanitizeExhibitExt('Recording.M4A')).toBe('.m4a');
    expect(sanitizeExhibitExt('scan.pdf')).toBe('.pdf');
  });

  it('strips anything that could shape a path', () => {
    // The extension is taken from the LAST dot, so a name carrying traversal
    // yields the tail after it, and the strip then removes the slashes and
    // dots that would have mattered. Both steps have to hold, not just one.
    expect(sanitizeExhibitExt('a.m4a/../../x')).toBe('.x');
    expect(sanitizeExhibitExt('note.tar gz')).toBe('.targz');
    expect(sanitizeExhibitExt('weird.<svg>')).toBe('.svg');
    // No slashes survive, so no crafted name can leave the case folder.
    for (const name of ['x.a/b', 'x.a\\b', 'x.%2e%2e']) {
      expect(sanitizeExhibitExt(name)).not.toMatch(/[/\\%]/);
    }
  });

  it('handles names with no usable extension', () => {
    expect(sanitizeExhibitExt('recording')).toBe('');
    expect(sanitizeExhibitExt('trailing.')).toBe('');
  });

  it('bounds the length so a crafted name cannot stretch the path', () => {
    expect(sanitizeExhibitExt(`f.${'a'.repeat(500)}`).length).toBeLessThanOrEqual(16);
  });
});
