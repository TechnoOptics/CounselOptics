/**
 * Where a directly-uploaded exhibit is allowed to live, and how to tell.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT AN INLINE CHECK. The direct transport
 * splits one operation into two server calls: one mints a signed upload URL
 * for a path, and a later one is told "the object at this path is ready, make
 * it an exhibit". The second call receives the path FROM THE BROWSER. If it
 * believes whatever it is handed, it becomes a way to point an exhibit row at
 * any object anywhere in the bucket, including another person's evidence,
 * which the row would then happily mint a signed read URL for. That is a
 * cross-tenant read built out of two innocent-looking actions, and it is the
 * single sharpest edge this transport introduces.
 *
 * So the path is not trusted, it is RECOMPUTED. The caller says which exhibit
 * id and which file name; the server derives the only path that could be
 * legitimate from the session's own user id and the case it has already
 * checked access to, and compares. There is nothing for a caller to influence
 * except the two values that go into the derivation, and both are constrained:
 * the exhibit id must be a UUID this server generated, and the extension is
 * sanitised down to a short lowercase alphanumeric string.
 *
 * Kept free of Supabase and Next imports so the rules can be tested directly,
 * which matters because these are the rules and not a convenience.
 */

/** Lowercased, punctuation-stripped extension, matching the shape the
 * server-action path has always written. Bounded so a crafted file name
 * cannot lengthen the path. */
export function sanitizeExhibitExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  const raw = fileName.slice(dot);
  return raw.toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The one path an exhibit uploaded directly by this user, for this case,
 * under this exhibit id, is permitted to occupy. Matches the convention the
 * server-action path already uses so both transports produce the same layout. */
export function exhibitObjectPath(input: {
  userId: string;
  caseId: string;
  exhibitId: string;
  fileName: string;
}): string {
  return `${input.userId}/${input.caseId}/${input.exhibitId}${sanitizeExhibitExt(input.fileName)}`;
}

export type PathVerdict = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Confirm that a path handed back by the browser is the exact path this
 * server would have minted, and nothing else.
 *
 * Rejects a different user's prefix, a different case, a traversal attempt, a
 * nested key under the case (which is where the timeline stores its media), and
 * an exhibit id that is not a UUID. Equality, not prefix matching: a check that
 * only asserted the path STARTS WITH the user's own folder would still accept
 * one of their other exhibits, which would give two rows one object and make
 * deleting either of them silently break the other.
 */
export function verifyExhibitObjectPath(input: {
  path: unknown;
  userId: string;
  caseId: string;
  exhibitId: string;
  fileName: string;
}): PathVerdict {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return { ok: false, reason: 'That upload could not be matched to this case.' };
  }
  if (!UUID_RE.test(input.exhibitId)) {
    return { ok: false, reason: 'That upload could not be matched to this case.' };
  }
  const expected = exhibitObjectPath({
    userId: input.userId,
    caseId: input.caseId,
    exhibitId: input.exhibitId,
    fileName: input.fileName,
  });
  if (input.path !== expected) {
    return { ok: false, reason: 'That upload could not be matched to this case.' };
  }
  return { ok: true, path: expected };
}
