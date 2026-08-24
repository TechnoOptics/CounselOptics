/**
 * Adding an exhibit by pasting a link to it.
 *
 * WHAT THIS FEATURE DOES, AND THE ONE THING IT DELIBERATELY DOES NOT DO.
 *
 * The link is used ONCE, at the moment the exhibit is added, to FETCH AND
 * STORE THE FILE. After that the link is never followed again. Advottic does
 * not keep pointing at somebody else's URL and stream the evidence from it on
 * demand, and that is not a performance decision, it is the whole point:
 *
 *   A remote file can be changed, moved or deleted by whoever hosts it, and
 *   the host may be the opposing party. An exhibit that can change after it
 *   is filed is not an exhibit. So we capture the bytes, and the exhibit IS
 *   those bytes, exactly as an uploaded file is. The source URL and the time
 *   of the fetch are recorded alongside it, because provenance is worth
 *   having, but the artifact is ours.
 *
 * WHY THIS SOLVES A PROBLEM THE UPLOAD FORM CANNOT. Posting a file to a
 * Server Action puts it in a serverless request body, and the platform caps
 * that near 4.5MB before any framework code runs (see lib/upload-transport.ts
 * for the full account). A fetch made BY THE SERVER never crosses that
 * boundary at all. This is not a new mechanism: it is exactly how the 40MB
 * objects already in the exhibits bucket got there.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. This module is pure: no network, no
 * database, no storage. Every one of these functions can be tested in the
 * repo's node-only vitest environment. The two things that actually enforce
 * safety live elsewhere and are CALLED, never copied:
 *
 *   - lib/remote-fetch.ts fetchRemoteEvidence is the hardened downloader. It
 *     refuses hosts that resolve into private, loopback, link-local,
 *     carrier-NAT and cloud-metadata ranges, re-checks on every redirect hop,
 *     and bounds the body with a byte cap and a timeout.
 *   - addExhibit in lib/storage.ts runs screenAuthenticatedUpload on the
 *     bytes BEFORE they are written, allocates the label by position, and
 *     writes the row.
 *
 * A fetched file is UNTRUSTED INPUT in exactly the way an uploaded one is, so
 * it goes through exactly the same screen. Nothing here relaxes either guard,
 * and nothing here is a second copy of one.
 */

import { EXHIBIT_MAX_BYTES } from './upload-transport';

/**
 * The size ceiling for a link import, and it is the same number the upload
 * form promises and enforces: 50MB.
 *
 * Re-exported from lib/upload-transport rather than written again, so a file
 * cannot be accepted by one door and refused by the other. It is passed to
 * fetchRemoteEvidence as its byte cap, which aborts the download rather than
 * buffering 50MB and then complaining, and the same number is enforced a
 * second time by screenAuthenticatedUpload against the bytes that arrived.
 *
 * NOT to be confused with Whisper's 25MB transcription cap (lib/ai.ts). That
 * is a limit on what a third party will TRANSCRIBE, not on what Advottic will
 * STORE. A 40MB recording is a perfectly good exhibit that can be played,
 * exported and put in a packet; it just cannot be auto-transcribed whole.
 * Conflating the two would refuse evidence for a reason that has nothing to
 * do with holding it, and it would refuse it differently here than on the
 * upload form, which does not conflate them either.
 */
export const LINK_IMPORT_MAX_BYTES = EXHIBIT_MAX_BYTES;

export type LinkFailureKind =
  | 'invalid_url'
  | 'blocked_host'
  | 'unreachable'
  | 'not_found'
  | 'needs_sign_in'
  | 'source_error'
  | 'too_large'
  | 'empty'
  | 'timed_out'
  | 'redirect'
  | 'sharing_page'
  | 'wrong_content'
  | 'refused';

export type LinkFailure = { kind: LinkFailureKind; message: string };

/**
 * Accept a pasted link, or say precisely why it cannot be used.
 *
 * Only http and https. Everything else (file:, data:, gs:, a bare host with
 * no scheme) is refused HERE with a sentence about what to paste, rather than
 * being handed to the downloader to refuse less helpfully.
 */
export function normalizeExhibitLink(
  raw: unknown,
): { ok: true; url: string } | { ok: false; failure: LinkFailure } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return {
      ok: false,
      failure: { kind: 'invalid_url', message: 'Please paste a link to the file.' },
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'invalid_url',
        message:
          'That does not look like a web link. Paste the full address, starting with https://',
      },
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      failure: {
        kind: 'invalid_url',
        message: 'Only http and https links can be used. Paste a web address for the file.',
      },
    };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * Is what came back a web page rather than the file?
 *
 * THE PROBLEM THIS EXISTS FOR. Dropbox, Google Drive, OneDrive and iCloud all
 * hand out a link to a VIEWER PAGE, not to the file. Pasting one fetches
 * HTML: a page with a preview and a download button on it. Storing that as
 * somebody's evidence would be worse than refusing it, because it would look
 * like it worked.
 *
 * THIS IS NOT THE SECURITY CONTROL. screenAuthenticatedUpload already refuses
 * HTML and SVG outright, on every path, and it still runs on this one. This
 * function exists so the person gets a sentence they can act on instead of
 * "HTML/SVG content is not an accepted document type." It is deliberately a
 * little broader than the screen (it also trusts a text/html content type,
 * and tolerates a byte-order mark or leading whitespace before the tag), so
 * on this path a sharing page is named as a sharing page rather than reaching
 * the generic refusal. Broader is safe: it can only ever refuse more.
 */
export function looksLikeWebPage(mime: string, head: Buffer): boolean {
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/xhtml+xml') return true;

  // Strip a UTF-8 byte-order mark, then leading whitespace, before sniffing.
  let start = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) start = 3;
  const text = head.toString('latin1', start, Math.min(head.length, start + 1024)).trimStart();
  return /^<(!doctype\s+html|html|head|meta|script|title)\b/i.test(text);
}

/**
 * What to tell somebody who pasted a sharing page instead of the file.
 *
 * Names the host, because "use the direct download link" is only actionable
 * if the person knows which of the several links they have been juggling was
 * the wrong one.
 */
export function sharingPageMessage(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    host = '';
  }
  const where = host ? `${host} returned` : 'That link returned';
  return (
    `${where} a web page, not a file. That is the sharing or preview page, ` +
    'so nothing was added to your case. Open the link in your browser, use its ' +
    'own download button, and paste the direct download address instead. If the ' +
    'file will not share directly, download it to this device and use Choose file.'
  );
}

/**
 * Turn a downloader refusal into a sentence somebody filing evidence can act on.
 *
 * THE RULE HERE IS THAT NOTHING BECOMES VAGUE. fetchRemoteEvidence already
 * returns specific reasons, and the default branch passes its reason through
 * VERBATIM rather than replacing it with a generic line. Somebody trying to
 * get a recording into a hearing this week needs to know whether the host
 * refused them, the file is gone, it was too big, or it timed out. So the
 * recognised shapes below add what to do next, and an unrecognised one keeps
 * the downloader's own words rather than losing them.
 *
 * Matched on shape, not on an exact string table, so a reworded reason in
 * lib/remote-fetch.ts degrades to "specific but without advice" rather than
 * to a wrong classification.
 */
export function classifyLinkFailure(reason: string): LinkFailure {
  const text = (reason || '').trim();
  if (!text) {
    return {
      kind: 'refused',
      message: 'That link could not be downloaded. Please check it and try again.',
    };
  }

  if (/not a valid url|only http and https/i.test(text)) {
    return {
      kind: 'invalid_url',
      message:
        'That does not look like a web link. Paste the full address, starting with https://',
    };
  }
  if (/not allowed|private address/i.test(text)) {
    return {
      kind: 'blocked_host',
      message:
        'That address cannot be reached from here. Links have to point at a public ' +
        'web address, not at a private network, a local machine, or an internal host.',
    };
  }
  if (/could not resolve/i.test(text)) {
    return {
      kind: 'unreachable',
      message:
        'That web address could not be found. Check the spelling of the host, or ' +
        'open the link in your browser to confirm it still works.',
    };
  }

  const status = text.match(/returned\s+(\d{3})/i);
  if (status) {
    const code = Number(status[1]);
    if (code === 404 || code === 410) {
      return {
        kind: 'not_found',
        message:
          'The file is not there any more. The host returned "not found", which ' +
          'usually means the link expired or the file was moved or deleted.',
      };
    }
    if (code === 401 || code === 403) {
      return {
        kind: 'needs_sign_in',
        message:
          'The host would not release the file without a sign-in. Make the link ' +
          'public or downloadable by anyone with it, or download the file yourself ' +
          'and use Choose file.',
      };
    }
    return {
      kind: 'source_error',
      message:
        `The host returned an error (${code}) instead of the file. It may be ` +
        'temporarily down. Try again shortly, or download the file and use Choose file.',
    };
  }

  if (/over the size limit|larger than/i.test(text)) {
    return {
      kind: 'too_large',
      message: `That file is over the ${Math.round(
        LINK_IMPORT_MAX_BYTES / (1024 * 1024),
      )}MB limit for a single exhibit. Please add a shorter or smaller copy.`,
    };
  }
  if (/no downloadable content|empty response/i.test(text)) {
    return {
      kind: 'empty',
      message:
        'That link produced no file at all. It may be a page that needs a sign-in, ' +
        'or a link to a folder rather than to one file.',
    };
  }
  if (/too long to respond|timed out|timeout/i.test(text)) {
    return {
      kind: 'timed_out',
      message:
        'The host took too long to send the file, so nothing was added. Large files ' +
        'on slow hosts can do this. Try again, or download the file and use Choose file.',
    };
  }
  if (/redirect/i.test(text)) {
    return {
      kind: 'redirect',
      message:
        'That link kept redirecting and never arrived at a file. That usually means ' +
        'it is a sharing page. Use the direct download address instead.',
    };
  }

  // Unrecognised. Keep the downloader's own sentence rather than flattening it.
  return { kind: 'refused', message: text };
}

/**
 * Re-word the content screen's refusal for the link path.
 *
 * screenAuthenticatedUpload refuses HTML and SVG with a sentence written for
 * somebody who picked a file off their own disk. On this path the same bytes
 * almost always mean one thing: the pasted link was a sharing page. So the
 * refusal is REPHRASED, never overridden. If the screen said no, the answer
 * is still no; only the explanation changes.
 */
export function explainScreenRefusal(reason: string, url: string): LinkFailure {
  if (/html|svg/i.test(reason)) {
    return { kind: 'sharing_page', message: sharingPageMessage(url) };
  }
  return { kind: 'wrong_content', message: reason };
}

/**
 * Characters that must never survive into a recorded file name: control
 * characters and DEL (a newline in a name makes an exhibit list lie), both
 * path separators, and the bytes that are illegal in a Windows file name so
 * an exported packet can actually be saved to disk. Dots, dashes, spaces and
 * underscores are deliberately left alone, because the extension has to
 * survive: it is what tells the reader which viewer to offer.
 *
 * Written as escapes rather than as literal bytes on purpose. A literal NUL
 * in a source file makes grep treat the whole file as binary and report no
 * matches at all, which has silently hidden a defect in this repo before.
 */
const NAME_STRIP = /[\u0000-\u001f\u007f\/\\:*?"<>|]+/g;

/**
 * Clean the file name that came off the URL or the response.
 *
 * WHAT THIS IS RESPONSIBLE FOR, AND WHAT IT IS NOT. It is NOT what keeps a
 * hostile name out of the storage path. addExhibit already guarantees that,
 * and it does so structurally rather than by cleaning: the object path it
 * writes is `${userId}/${caseId}/${uuid}${ext}`, where ext is
 * path.extname(name) put through its own sanitizeExt, which keeps only
 * [a-z0-9.] and caps at 16 characters. No part of the caller's name reaches
 * the path intact, so `..%2f..%2fetc.mp3` cannot escape it however it is
 * spelled. Re-deriving that here would be a second, drifting copy of a rule
 * that already holds.
 *
 * What this IS responsible for is the name people SEE and that travels into
 * exports: exhibits.file_name. A name from a URL is attacker-shaped in a way
 * a name from a file picker is not, and `../../secret.mp3` or a name with a
 * newline in it makes an exhibit list and an export filename lie. So control
 * characters and every path separator go, leading dots go (no hidden files,
 * no `..`), whitespace collapses, and the length is capped. If nothing usable
 * is left, a neutral name derived from the response type is used, because an
 * exhibit with a blank name is worse than one called "download.mp3".
 */
export function sanitizeImportedFileName(rawName: string, mime: string): string {
  const cleaned = (rawName || '')
    .replace(NAME_STRIP, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120)
    .trim();

  if (cleaned && /[a-z0-9]/i.test(cleaned)) return cleaned;

  const ext =
    (mime || '')
      .split(';')[0]
      .split('/')[1]
      ?.replace(/[^a-z0-9]/gi, '')
      .slice(0, 8) || 'bin';
  return `download.${ext}`;
}

/**
 * The provenance line recorded on the exhibit.
 *
 * WHERE IT GOES AND WHY THERE IS NO MIGRATION. exhibits.source already exists
 * and already means exactly this: the upload form labels it "Source" and
 * prompts "Where this evidence came from". A link import has a better answer
 * to that question than a typed one, so it fills it in.
 *
 * WHY NOT scan_data, which is jsonb and would hold a tidier object.
 * saveExhibitScan REPLACES the whole scan_data value on every scan, so the
 * first transcription of this recording would erase its provenance. Recording
 * where an exhibit came from in a column that a later AI read wipes would be
 * worse than not recording it, because it would look recorded.
 *
 * Anything the person typed into Source themselves is KEPT and put first.
 * They are describing the evidence; we are describing how it got here, and
 * their sentence is not ours to overwrite.
 */
export function linkProvenanceSource(input: {
  url: string;
  fetchedAt: string;
  userSource?: string | null;
}): string {
  const typed = (input.userSource ?? '').trim();
  const line = `Downloaded by Advottic from ${input.url.slice(0, 500)} on ${input.fetchedAt}`;
  return typed ? `${typed} (${line})` : line;
}
