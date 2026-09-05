import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every copy of @xmldom/xmldom in the lockfile is a patched one.
 *
 * mammoth parses the XML inside every uploaded .docx with xmldom, so an
 * xmldom advisory is reachable from a person's own evidence, not only from
 * build tooling. GHSA-wh4c-j3r5-mjhp and five sibling advisories (XML
 * injection through unvalidated serialization, unbounded recursion) are
 * fixed in 0.8.15 on the 0.8 line and 0.9.12 on the 0.9 line, and nothing on
 * the 0.7 line is fixed at all. Three dependents pinned three different
 * copies (mammoth ^0.8, plist ^0.9, and @trapezedev/project plus mergexml
 * ^0.7), so the Security audit workflow failed on main and a routine
 * `npm install` could quietly bring a vulnerable copy back. This reads the
 * lockfile, which is what `npm ci` installs, rather than node_modules.
 */

function lockedXmldomVersions(): Array<{ at: string; version: string }> {
  const lock = JSON.parse(
    readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'),
  ) as { packages: Record<string, { version?: string }> };
  return Object.entries(lock.packages)
    .filter(([at]) => at.endsWith('node_modules/@xmldom/xmldom'))
    .map(([at, meta]) => ({ at, version: meta.version ?? '' }));
}

function isPatched(version: string): boolean {
  const [major, minor, patch] = version.split('.').map(Number);
  if (major !== 0) return major > 0;
  if (minor === 8) return patch >= 15;
  if (minor === 9) return patch >= 12;
  return minor > 9;
}

describe('@xmldom/xmldom in the lockfile', () => {
  const copies = lockedXmldomVersions();

  it('is present, because mammoth needs it to read a .docx', () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it.each(copies)('$at is $version, a patched release', ({ version }) => {
    expect(isPatched(version)).toBe(true);
  });
});
