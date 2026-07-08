import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Server-side fetch for evidence dragged in from a *browser* (an image or
 * link), where the item arrives as a URL rather than a file. The browser
 * itself usually can't fetch those cross-origin (CORS), so the drop handler
 * hands the URL to the server and we download it here.
 *
 * Downloading an arbitrary user-supplied URL server-side is an SSRF vector,
 * so this is deliberately strict:
 *   - http/https only,
 *   - the host must resolve to a PUBLIC IP (private / loopback / link-local /
 *     carrier-NAT / cloud-metadata ranges are refused, on every redirect hop),
 *   - redirects are followed manually (max 4) so each new host is re-checked,
 *   - a hard byte cap + request timeout bound the download.
 */

const REDIRECT_LIMIT = 4;
const REQUEST_TIMEOUT_MS = 15_000;

/** True when an IP literal is in a range we must never fetch from. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true; // loopback / unspecified
    if (l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb'))
      return true; // fe80::/10 link-local
    if ( l.startsWith('fc') || ll_ula(ip)) return true; // fc00::/7 unique-local
    // IPv4-mapped (::ffff:a.b.c.d) - re-check the embedded v4.
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal -> refuse
}

function ll_ula(ip: string): boolean {
  const l = ip.toLowerCase();
  return l.startsWith('fd');
}

/** Refuse a host whose every resolved address is public? No - refuse if ANY is blocked. */
async function assertHostIsPublic(hostname: string): Promise<void> {
  // Hostname could itself be an IP literal.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('That address is not allowed.');
    return;
  }
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    throw new Error('That host is not allowed.');
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error('Could not resolve that address.');
  }
  if (addrs.length === 0) throw new Error('Could not resolve that address.');
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error('That host resolves to a private address.');
  }
}

export type RemoteFile = { buffer: Buffer; mime: string; name: string };

function nameFromUrl(u: URL, mime: string): string {
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
  if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return last.slice(0, 200);
  const ext = mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const stem = last || u.hostname.replace(/[^a-z0-9]/gi, '-') || 'download';
  return `${stem}.${ext}`.slice(0, 200);
}

/**
 * Download one remote URL as a buffer, enforcing the SSRF + size guards.
 * `maxBytes` bounds the body; the caller still applies its own storage-side
 * validation (magic-byte sniffing) on the returned buffer.
 */
export async function fetchRemoteEvidence(
  rawUrl: string,
  maxBytes: number,
): Promise<{ ok: true; file: RemoteFile } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Not a valid URL.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return { ok: false, error: 'Only http and https links can be imported.' };
      }
      await assertHostIsPublic(current.hostname);

      const resp = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: '*/*' },
      });

      // Manual redirect: re-validate the next host on the following loop.
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) return { ok: false, error: 'Broken redirect.' };
        if (hop === REDIRECT_LIMIT) return { ok: false, error: 'Too many redirects.' };
        current = new URL(loc, current);
        continue;
      }

      if (!resp.ok) return { ok: false, error: `Source returned ${resp.status}.` };

      const declaredLen = Number(resp.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
        return { ok: false, error: 'That file is over the size limit.' };
      }
      if (!resp.body) return { ok: false, error: 'Empty response.' };

      // Stream with a hard cap so a missing/lying content-length can't blow past it.
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, error: 'That file is over the size limit.' };
          }
          chunks.push(value);
        }
      }
      if (total === 0) return { ok: false, error: 'That link had no downloadable content.' };

      const mime = (resp.headers.get('content-type') ?? 'application/octet-stream')
        .split(';')[0]
        .trim() || 'application/octet-stream';
      return {
        ok: true,
        file: { buffer: Buffer.concat(chunks), mime, name: nameFromUrl(current, mime) },
      };
    }
    return { ok: false, error: 'Too many redirects.' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'The source took too long to respond.' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch that link.' };
  } finally {
    clearTimeout(timer);
  }
}
