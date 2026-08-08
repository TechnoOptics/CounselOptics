/**
 * Whether a firm already has this template under a slightly different name.
 *
 * WHY THIS EXISTS. installSeedTemplateAction refused a duplicate by comparing
 * trimmed lowercase names exactly. "Mutual Nondisclosure Agreement" and
 * "Mutual Non-Disclosure Agreement" are one hyphen apart and that comparison
 * passed, so a firm now has both in its list. Two NDAs in an employee's Forms
 * list is a person picking the wrong one, and only one of the two carries the
 * legal team's later edits.
 *
 * Pure and import-free, so both the server action that refuses the install and
 * the panel that greys out the button can read the same answer. Two different
 * ideas of "already installed" is how the button says one thing and the save
 * says another.
 */

/** A name reduced to what it is regardless of how it was punctuated. */
export function templateNameKey(name: string): string {
  if (typeof name !== 'string') return '';
  return (
    name
      .normalize('NFKD')
      // Everything that is not a letter or a digit goes, including the spaces.
      // Removed rather than turned into a separator, which is the whole point:
      // the hyphen in "Non-Disclosure" is INSIDE a word, so replacing it with a
      // space would leave "non disclosure" against "nondisclosure" and the two
      // would still be different templates.
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .toLowerCase()
  );
}

export type TemplateNameClash = {
  /**
   * 'same' is the same document under different punctuation and is refused.
   * 'near' is a different document with a confusingly similar name, which is a
   * legitimate thing to have and is warned about rather than blocked.
   */
  kind: 'same' | 'near';
  /** The existing template's name, as the firm typed it. */
  name: string;
};

/**
 * The strongest clash between a proposed name and the names a firm already
 * has, or null.
 *
 * Scanned for an exact clash before a near one, whatever order the list is in.
 * Reporting a near clash first would hand a firm a warning it can click past
 * for a name that should have been refused outright.
 *
 * Archived templates are not in the list the caller passes, and that is
 * deliberate: an archived template is out of everybody's way and refusing an
 * install because of one would leave a firm with no route back.
 */
export function findTemplateNameClash(
  name: string,
  existingNames: readonly string[],
): TemplateNameClash | null {
  const key = templateNameKey(name);
  if (!key) return null;
  const names = (Array.isArray(existingNames) ? existingNames : []).filter(
    (n): n is string => typeof n === 'string' && templateNameKey(n) !== '',
  );

  for (const other of names) {
    if (templateNameKey(other) === key) return { kind: 'same', name: other };
  }
  for (const other of names) {
    if (isNearIdentical(key, templateNameKey(other))) return { kind: 'near', name: other };
  }
  return null;
}

/**
 * Close enough that a person would have to read twice.
 *
 * Two rules, and both are cases the firm should hear about at the moment it
 * happens rather than from an employee who picked the wrong form:
 *
 *   One name contains the other. "Mutual NDA" beside "Mutual NDA Short Form"
 *   is two real templates, but a list showing both wants a deliberate decision.
 *
 *   A small number of edits apart. The tolerance scales with the length,
 *   because two characters is a typo in a long name and a different document
 *   in a short one: NDA and ND are two edits apart and are not the same thing.
 */
function isNearIdentical(a: string, b: string): boolean {
  if (a === b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 6) return false;
  if (longer.includes(shorter)) return true;
  const tolerance = Math.min(2, Math.floor(shorter.length / 8));
  return tolerance > 0 && editDistanceWithin(a, b, tolerance);
}

/**
 * Levenshtein distance, abandoned as soon as it exceeds the tolerance.
 *
 * Bounded rather than complete because the answer past the tolerance is never
 * read, and because this runs over a firm's whole template list on a path a
 * person is waiting on.
 */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    // Every remaining path runs through this row, so once the whole row is
    // past the tolerance the answer cannot come back under it.
    if (best > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}
