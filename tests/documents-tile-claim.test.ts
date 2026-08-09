import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The Documents tile said "Versioned". Nothing is versioned.
 *
 * `firm_documents.version` is written as the literal 1 at every insert site
 * and no code path increments it, so a firm reading that tile was told the
 * product keeps document history it does not keep. This file holds the label
 * and the fact behind it together, which is the only arrangement that stops
 * them drifting apart again.
 *
 * If real versioning is ever built, the second block below goes red first,
 * and THAT is the signal that the tile may make the claim again. Building it
 * was out of scope here: it needs a version chain, a supersede path on
 * upload, and a history view, none of which exist.
 */

const root = fileURLToPath(new URL('../', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const rel = join(dir, entry);
    const full = join(root, rel);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

/** Every window of source that follows a `firm_documents` table reference. */
function firmDocumentWindows(): Array<{ file: string; window: string }> {
  const out: Array<{ file: string; window: string }> = [];
  for (const file of [...sourceFiles('lib'), ...sourceFiles('app')]) {
    const src = stripComments(readFileSync(join(root, file), 'utf8'));
    const parts = src.split("from('firm_documents')");
    for (const part of parts.slice(1)) {
      out.push({ file, window: part.slice(0, 1200) });
    }
  }
  return out;
}

describe('the tile says only what the data supports', () => {
  const src = stripComments(
    readFileSync(
      join(root, 'components/counsel/CounselDashboardTiles.tsx'),
      'utf8',
    ),
  );

  it('does not claim documents are versioned', () => {
    expect(src).not.toMatch(/Versioned/i);
  });

  it('labels the count with what it is', () => {
    expect(src).toContain('held for this firm');
  });
});

describe('nothing behind the claim has changed', () => {
  const windows = firmDocumentWindows();

  it('finds the document writes at all, so an empty pass is impossible', () => {
    const inserts = windows.filter((w) => w.window.includes('.insert('));
    expect(inserts.length).toBeGreaterThanOrEqual(5);
  });

  it('writes version as the literal 1 at every insert site', () => {
    const written = windows
      .filter((w) => w.window.includes('.insert('))
      .map((w) => ({
        file: w.file,
        value: /\bversion:\s*([^,\n]+)/.exec(w.window)?.[1]?.trim() ?? null,
      }))
      .filter((w) => w.value !== null);
    expect(written.length).toBeGreaterThanOrEqual(5);
    expect(written.filter((w) => w.value !== '1')).toEqual([]);
  });

  it('never increments it on update', () => {
    const bumping = windows
      .filter((w) => {
        const update = w.window.indexOf('.update(');
        if (update === -1) return false;
        return /\bversion:/.test(w.window.slice(update, update + 400));
      })
      .map((w) => w.file);
    expect(bumping).toEqual([]);
  });
});
