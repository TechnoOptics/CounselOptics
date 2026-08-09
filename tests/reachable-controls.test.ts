import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { stripComments } from './support/strip-comments';

/*
 * A control a keyboard cannot reach is not a control, and a control a thumb
 * cannot reveal is not a control either.
 *
 * Two shapes are guarded here.
 *
 * 1. `<img onClick=...>` with no role, no tabIndex and no key handler. The
 *    browser gives an <img> no tab stop and no Enter/Space behaviour, so the
 *    only way in was a mouse. Two of these were shipping: the case-images
 *    thumbnail and the party-profile portrait, both of which open the image
 *    full size. Both are now <button> wrappers.
 *
 * 2. A control whose ONLY route to being visible is `group-hover`. There is
 *    no hover on a touch screen, so the control does not exist on a phone.
 *    Combined with a sub-24px box it fails twice over.
 *
 * WHAT THIS CANNOT TELL YOU: whether focus order is sensible, whether the
 * focus ring is visible against its backdrop, or what any of it measures in a
 * real browser. Vitest here runs `environment: 'node'` with no DOM by
 * project policy, so these are assertions on source text.
 */

const root = fileURLToPath(new URL('..', import.meta.url));


function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Every `<img ... />` element in the source, as whole tags.
 *
 * `<img\s` rather than `<img\b`, and `[^<]` rather than `[\s\S]`, both on
 * purpose. evidence-intake.tsx contains the regex literal
 * `/<img[^>]+src=.../` inside its own HTML scraper; `\b` matched that, and a
 * `[\s\S]*?` run then swallowed a hundred characters of unrelated code and
 * reported it as a clickable image. Real JSX always has whitespace after the
 * tag name and never contains a `<` inside the tag.
 */
function imgTags(src: string): string[] {
  return src.match(/<img\s[^<]*?\/>/g) ?? [];
}

const files = ['app', 'components'].flatMap((d) => walk(join(root, d)));

describe('an image is never the only way to press something', () => {
  it('scans a real, non-empty set of files', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no <img> carries an onClick without also being keyboard-operable', () => {
    const hits: string[] = [];
    for (const file of files) {
      for (const tag of imgTags(stripComments(readFileSync(file, 'utf8')))) {
        if (!/\bonClick\s*=/.test(tag)) continue;
        // An img that opted into being a control has to say so AND be
        // operable: a role, a tab stop, and a key handler.
        const operable =
          /\brole\s*=/.test(tag) && /\btabIndex\s*=/.test(tag) && /\bonKey(Down|Up|Press)\s*=/.test(tag);
        if (!operable) hits.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(
      hits,
      'A bare <img onClick> has no tab stop and no Enter/Space handling. Wrap it in a <button>, as app/counsel/cases/[id]/case-images-panel.tsx does.',
    ).toEqual([]);
  });
});

describe('the controls the audit named are reachable by touch and by key', () => {
  const CASE_IMAGES = 'app/counsel/cases/[id]/case-images-panel.tsx';
  const PARTY_CARD = 'app/counsel/cases/[id]/party-profile-card.tsx';
  const TOUR = 'components/TourModal.tsx';

  it('the case-image thumbnail and its two corner controls are buttons with a 44px hit area', () => {
    const src = stripComments(readFileSync(join(root, CASE_IMAGES), 'utf8'));
    // The thumbnail opens the image: it must be a button, and the img inside
    // it must not carry the handler itself.
    // `[^>]*` will not do here: the arrow in `() =>` contains a `>`.
    expect(src).toMatch(/<button[\s\S]{0,200}?onClick=\{\(\) => void open\(\)\}/);
    // Two corner controls, each a 44px square target.
    expect(src.match(/h-11 w-11/g) ?? []).toHaveLength(2);
    // And nothing in this file is revealed only by hover any more.
    expect(src).not.toMatch(/group-hover:opacity-100/);
  });

  it('the party portrait is a button, not a clickable image', () => {
    const src = stripComments(readFileSync(join(root, PARTY_CARD), 'utf8'));
    expect(src).toMatch(/<button[\s\S]{0,200}?onClick=\{\(\) => void open\(\)\}/);
  });

  it('the tour dots keep a 4px dot inside a target big enough to press', () => {
    const src = stripComments(readFileSync(join(root, TOUR), 'utf8'));
    // The button is the target; the 4px dot is a span inside it. If the h-1
    // ever moves back onto the button's own className, the target shrinks to
    // 4px again and this goes red.
    expect(src).toMatch(/<button[\s\S]{0,400}?className="grid h-8 w-6 place-items-center/);
    expect(src).toMatch(/<span[\s\S]{0,120}?className=\{`h-1 rounded-full/);
    // The active dot needs a dark-theme value: bg-forest-900 is the panel's
    // own colour, so without this the current step is invisible in dark mode.
    expect(src).toMatch(/bg-forest-900 dark:bg-cream-100/);
  });
});
