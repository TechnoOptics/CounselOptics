import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_MATTERS, seedDemo } from './seed-demo.mjs';

test('refuses a target that is not local', async () => {
  await assert.rejects(
    () => seedDemo({ url: 'https://abc.supabase.co', serviceKey: 'x' }),
    /local/i,
  );
});

/**
 * Reads the exhibit rows out of a marketing page's Sheet.
 *
 * Comments are stripped first. The home page carries a JSX comment that
 * quotes one of the dates, and a guard that its own explanation can satisfy
 * is not a guard.
 */
function sheetRows(relativePath) {
  const source = readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern =
    /mark="([^"]*)"\s+text=(?:"([^"]*)"|\{'([^']*)'\})\s+right="([^"]*)"/g;
  return [...source.matchAll(pattern)].map((m) => ({
    mark: m[1],
    text: m[2] ?? m[3],
    right: m[4],
  }));
}

test('the person demo holds the exhibits the home page shows', () => {
  const onThePage = sheetRows('app/page.tsx').filter((row) =>
    'ABCD'.includes(row.mark),
  );
  assert.deepEqual(
    DEMO_MATTERS.person.exhibits.map((e) => ({
      mark: e.label,
      text: e.fileName,
      right: e.displayDate,
    })),
    onThePage,
  );
});

test('the firm demo is the matter the enterprise page names', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../../app/enterprise/page.tsx', import.meta.url)),
    'utf8',
  );
  assert.ok(page.includes(`title="${DEMO_MATTERS.firm.title}"`));
  assert.ok(page.includes(`kickerRight="${DEMO_MATTERS.firm.kicker}"`));
});
