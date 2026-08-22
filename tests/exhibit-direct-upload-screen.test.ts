import { describe, it, expect } from 'vitest';
import { screenStoredObject, screenAuthenticatedUpload } from '../lib/upload-safety';

const MB = 1024 * 1024;
const MAX = 50 * MB;

/**
 * A stand-in for the Supabase storage client, recording what was asked of it.
 *
 * The point of these tests is not that the screen recognises an executable;
 * screenAuthenticatedUpload is already tested for that. The point is the part
 * that is NEW and that a direct-to-storage upload puts at risk: when the
 * screen says no, the object must actually leave the bucket, and the answer
 * must still be a refusal even when the deletion does not work.
 */
function fakeStorage(opts: {
  body?: Buffer;
  downloadError?: string;
  removeError?: string;
  infoSize?: number | null;
  infoError?: string;
}) {
  const calls = { downloads: [] as string[], removes: [] as string[][], infos: [] as string[] };
  const client = {
    storage: {
      from: (_bucket: string) => ({
        info: async (path: string) => {
          calls.infos.push(path);
          if (opts.infoError) return { data: null, error: { message: opts.infoError } };
          if (opts.infoSize === null || opts.infoSize === undefined) {
            return { data: {}, error: null };
          }
          return { data: { size: opts.infoSize }, error: null };
        },
        download: async (path: string) => {
          calls.downloads.push(path);
          if (opts.downloadError) return { data: null, error: { message: opts.downloadError } };
          const buf = opts.body ?? Buffer.alloc(0);
          return {
            data: {
              arrayBuffer: async () =>
                buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
            },
            error: null,
          };
        },
        remove: async (paths: string[]) => {
          calls.removes.push(paths);
          return { error: opts.removeError ? { message: opts.removeError } : null };
        },
      }),
    },
  };
  return { client, calls };
}

const PATH = 'user-1/case-1/abc.mp3';
const run = (client: ReturnType<typeof fakeStorage>['client'], declaredMime: string | null) =>
  screenStoredObject({ client, bucket: 'exhibits', path: PATH, declaredMime, maxBytes: MAX });

// A real-enough MP3: an ID3v2 tag, which is what isAudioBuffer keys on.
const AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 0x11)]);

describe('screenStoredObject: a refused object does not stay in the bucket', () => {
  it('deletes an HTML file that was uploaded as audio, and refuses it', async () => {
    const html = Buffer.from('<!doctype html><script>fetch("/steal")</script>');
    const { client, calls } = fakeStorage({ body: html });

    const res = await run(client, 'audio/mpeg');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/HTML\/SVG/i);
    expect(res.ok === false && res.removed).toBe(true);
    // The object is gone, and it is THIS object that went.
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('deletes a bare SVG, the stored-XSS shape the bucket must never hold', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { client, calls } = fakeStorage({ body: svg });

    const res = await run(client, 'image/png');

    expect(res.ok).toBe(false);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('deletes a Windows executable renamed as a recording', async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(128, 0x90)]);
    const { client, calls } = fakeStorage({ body: exe });

    const res = await run(client, 'audio/mpeg');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/Executable/i);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('deletes an ELF binary', async () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128)]);
    const { client, calls } = fakeStorage({ body: elf });
    const res = await run(client, 'application/octet-stream');
    expect(res.ok).toBe(false);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('deletes something that claims to be audio but is not a media container', async () => {
    const notAudio = Buffer.from('just some plain text pretending to be a voice memo, at length');
    const { client, calls } = fakeStorage({ body: notAudio });

    const res = await run(client, 'audio/mpeg');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not a valid audio/i);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('deletes an empty object rather than accepting a zero-byte exhibit', async () => {
    const { client, calls } = fakeStorage({ body: Buffer.alloc(0) });
    const res = await run(client, 'audio/mpeg');
    expect(res.ok).toBe(false);
    expect(calls.removes).toEqual([[PATH]]);
  });
});

describe('screenStoredObject: refusing is the control, deleting is the cleanup', () => {
  it('still refuses when the deletion fails, and says the object was left behind', async () => {
    const html = Buffer.from('<html><body>nope</body></html>');
    const { client, calls } = fakeStorage({ body: html, removeError: 'storage offline' });

    const res = await run(client, 'application/pdf');

    // The important half: a failed cleanup must never become an acceptance.
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.removed).toBe(false);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('refuses when the object cannot be read back at all', async () => {
    const { client } = fakeStorage({ downloadError: 'NoSuchKey' });
    const res = await run(client, 'audio/mpeg');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/could not be read back/i);
  });
});

describe('screenStoredObject: the 50MB ceiling is enforced on the bytes that landed', () => {
  it('refuses an oversize object even when the size probe reports it as small', async () => {
    // The client is not trusted, and neither is a stale metadata record. What
    // is measured is the length of what came back.
    const big = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(MAX + 1024, 0x11)]);
    const { client, calls } = fakeStorage({ body: big, infoSize: 1024 });

    const res = await run(client, 'audio/mpeg');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/50MB limit/);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('refuses an oversize object from the probe alone, without pulling it into memory', async () => {
    const { client, calls } = fakeStorage({ infoSize: 900 * MB });

    const res = await run(client, 'video/mp4');

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/50MB limit/);
    expect(calls.removes).toEqual([[PATH]]);
    // Never downloaded: that is the whole reason the probe is there.
    expect(calls.downloads).toEqual([]);
  });

  it('falls back to the byte check when the probe is unavailable', async () => {
    const big = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(MAX + 1, 0x11)]);
    const { client, calls } = fakeStorage({ body: big, infoError: 'not supported' });
    const res = await run(client, 'audio/mpeg');
    expect(res.ok).toBe(false);
    expect(calls.removes).toEqual([[PATH]]);
  });

  it('accepts a large recording that is within the ceiling', async () => {
    const big = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40 * MB, 0x11)]);
    const { client, calls } = fakeStorage({ body: big, infoSize: big.length });

    const res = await run(client, 'audio/mpeg');

    // The whole purpose of the change: 40MB of audio is an acceptable exhibit.
    expect(res.ok).toBe(true);
    expect(res.ok === true && res.byteLength).toBe(big.length);
    expect(calls.removes).toEqual([]);
  });
});

describe('screenStoredObject: it runs the same screen, it does not have its own', () => {
  it('agrees with screenAuthenticatedUpload on every case, accept and refuse alike', async () => {
    const cases: Array<{ body: Buffer; mime: string }> = [
      { body: AUDIO, mime: 'audio/mpeg' },
      { body: Buffer.from('<html>x</html>'), mime: 'text/html' },
      { body: Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(16)]), mime: 'audio/mpeg' },
      { body: Buffer.from('%PDF-1.7\nordinary document body here'), mime: 'application/pdf' },
      { body: Buffer.from('not a pdf at all'), mime: 'application/pdf' },
      { body: Buffer.from('plain notes, no signature'), mime: 'text/plain' },
      { body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]), mime: 'image/jpeg' },
      { body: Buffer.from('#!/bin/sh\nrm -rf /'), mime: 'text/plain' },
    ];

    for (const c of cases) {
      const direct = screenAuthenticatedUpload(c.body, c.mime, MAX);
      const { client } = fakeStorage({ body: c.body, infoSize: c.body.length });
      const stored = await screenStoredObject({
        client,
        bucket: 'exhibits',
        path: PATH,
        declaredMime: c.mime,
        maxBytes: MAX,
      });
      expect(stored.ok, `mime ${c.mime}`).toBe(direct.ok);
      if (!direct.ok && !stored.ok) expect(stored.error).toBe(direct.reason);
    }
  });

  it('reports a scripted PDF rather than refusing it, exactly as the server path does', async () => {
    const pdf = Buffer.from('%PDF-1.7\n/Type /Action /S /JavaScript (app.alert(1))');
    const { client, calls } = fakeStorage({ body: pdf, infoSize: pdf.length });

    const res = await run(client, 'application/pdf');

    expect(res.ok).toBe(true);
    expect(res.ok === true && res.activeContent).toBe('pdf_script');
    // Reported, not refused, so it is NOT deleted. Matches the deliberate
    // 2026-08-22 decision recorded above screenAuthenticatedUpload.
    expect(calls.removes).toEqual([]);
  });
});
