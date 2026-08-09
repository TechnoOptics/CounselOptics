import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/*
 * "There is nothing here" and "I could not find out what is here" are
 * different sentences, and three surfaces said the first when they meant the
 * second.
 *
 *   - The counsel chat swallowed a failed history load and rendered
 *     "No messages yet. Say hi." A firm looking at a thread they know has
 *     messages in it was told the room was empty.
 *   - The counsel search palette set `loaded` in its catch, so a failed
 *     matter fetch produced "Nothing here matches that." for a matter that
 *     exists.
 *   - The evidence picker put the thrown message straight on screen, which
 *     meant the reader saw "HTTP 500".
 *
 * This product is used by people under real legal pressure. A screen that
 * says their work is missing, when in fact a request timed out, is not a
 * cosmetic problem.
 *
 * WHAT THIS CHECKS: that each surface still distinguishes the failed state,
 * and that the two specific wrong behaviours cannot come back (a catch that
 * only marks the load finished, and a raw error message rendered to a
 * reader). It cannot tell you the copy is good or that the retry works.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f: string) => stripComments(readFileSync(join(root, f), 'utf8'));

describe('a failed load does not read as an empty one', () => {
  it('counsel chat separates loading, failed, and genuinely empty', () => {
    const src = read('app/counsel/chat/chat-shell.tsx');

    // The three states have to be distinguishable at all.
    expect(src).toMatch(/'loading'\s*\|\s*'ready'\s*\|\s*'failed'/);

    // A non-ok response must mark the load failed. The old code was
    // `if (!res.ok) return;`, which left the reader on the empty-room copy.
    expect(src).toMatch(/if\s*\(!res\.ok\)\s*\{[\s\S]{0,120}?setHistoryState\('failed'\)/);

    // And the catch must do the same, rather than swallowing silently.
    expect(src).toMatch(/catch\s*\{[\s\S]{0,200}?setHistoryState\('failed'\)/);

    // "No messages yet" must be gated on NOT having failed, or the fix is
    // decorative: the branch would still be reachable after a failure.
    expect(src).toMatch(/historyState === 'failed'[\s\S]*?No messages yet/);
  });

  it('counsel search says the matters are missing rather than absent', () => {
    const src = read('components/counsel/CounselSearch.tsx');

    // The catch must record the failure, not just call the load finished.
    expect(src).toMatch(/\.catch\(\(\) => \{[\s\S]{0,300}?setMattersFailed\(true\)/);

    // The notice is rendered whether or not there are results: a PARTIAL
    // list is the misleading case, because pages appear and matters do not.
    expect(src).toMatch(/\{mattersFailed && \(/);

    // "Nothing here matches that." must be unreachable once matters failed.
    expect(src).toMatch(/mattersFailed[\s\S]{0,200}?Nothing here matches that/);
  });

  it('the evidence picker never shows the reader a raw error message', () => {
    const src = read('components/EvidencePicker.tsx');

    // `e.message` here was "HTTP 500". The catch must not bind the error at
    // all, which is the only way to be sure it cannot be rendered.
    expect(src).toMatch(/\.catch\(\(\) => \{/);
    expect(src).not.toMatch(/setError\(\s*\n?\s*e instanceof Error/);
    expect(src).not.toMatch(/e\.message/);

    // And there has to be a way out of the failed state.
    expect(src).toMatch(/Try again/);
  });

  it('neither retry path can spin against a failing endpoint', () => {
    // Both effects gate on a "settled" flag rather than a "succeeded" one.
    // With `loaded` left false on failure, the effect re-fires the moment
    // `loading` goes false and the panel hammers the endpoint forever. That
    // loop was already live in the evidence picker before this work.
    const picker = read('components/EvidencePicker.tsx');
    expect(picker).toMatch(/setError\(true\);[\s\S]{0,400}?setLoaded\(true\)/);

    const search = read('components/counsel/CounselSearch.tsx');
    expect(search).toMatch(/setMattersFailed\(true\);[\s\S]{0,200}?setLoaded\(true\)/);
    // The retry is an explicit press, not a dependency that re-fires.
    expect(search).toMatch(/onClick=\{\(\) => setLoaded\(false\)\}/);
  });
});
