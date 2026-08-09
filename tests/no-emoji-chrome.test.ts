import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/*
 * Emoji are not this product's icons.
 *
 * An emoji is somebody else's artwork, drawn differently on every platform,
 * unable to take the colour of the text around it, and beside the hand-drawn
 * stroke icons the rest of the product uses it reads as unfinished. These are
 * screens a person shows a lawyer, and screens a firm shows a client.
 *
 * SCOPE, deliberately narrow. This does not sweep the whole repo for every
 * pictographic character, because a repo-wide ban produces a guard people
 * route around: there are legitimate non-emoji glyphs in this codebase
 * (arrows, the pencil and cross on the timeline row controls, a check mark)
 * that are typographic, take currentColor, and are not somebody's artwork.
 * What is pinned here is the set the audit named plus the files they render
 * in, which is where the regression would actually recur.
 *
 * WHAT IT CANNOT TELL YOU: that the replacement icons are the right icons, or
 * that they are legible at the sizes they are drawn.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f: string) => stripComments(readFileSync(join(root, f), 'utf8'));

/**
 * Emoji proper, and NOT every pictographic-looking character.
 *
 * The distinction is presentation, not appearance. U+1F5D1 WASTEBASKET is
 * always drawn as colour artwork by the platform. U+270E LOWER RIGHT PENCIL
 * and U+2713 CHECK MARK are dingbats: they render as text, in the current
 * text colour, in the page's own font. Banning the second group would be a
 * rule people route around rather than follow.
 *
 * So: the pictographic plane unconditionally, and a dual-use character only
 * when it carries U+FE0F, the variation selector that explicitly asks for
 * emoji presentation. That is what made the old scales and shield emoji, and
 * what the pencil and the check mark do not have.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}]|[\u{2000}-\u{3300}]\u{FE0F}|\u{FE0F}/u;

const SURFACES = [
  // The consumer timeline, both views, plus the screens around them.
  'lib/timeline-types.ts',
  'app/cases/[id]/timeline/timeline-builder.tsx',
  'app/cases/[id]/timeline/minimal-timeline.tsx',
  'app/cases/[id]/timeline/media-lightbox.tsx',
  'app/cases/[id]/timeline/page.tsx',
  // Intake, shared by the employee Hub and the counsel matter view.
  'components/intake/IntakeConversation.tsx',
  'components/intake/IntakeWorkPanel.tsx',
  // The tokenized drop box a client is sent.
  'app/send/[token]/send-form.tsx',
];

describe('no emoji is used as an icon on these surfaces', () => {
  for (const file of SURFACES) {
    it(file, () => {
      const src = read(file);
      const hit = src.match(new RegExp(EMOJI, 'gu'));
      expect(
        hit ?? [],
        `${file} draws emoji as chrome. Use components/counsel/KindIcon.tsx or components/counsel/EntityIcons.tsx.`,
      ).toEqual([]);
    });
  }

  it('the timeline kind badge is the drawn icon, not a lookup table of emoji', () => {
    // KIND_ICON was a Record<TimelineKind, string> of emoji. Both render sites
    // now call the SVG component; if the table ever comes back, these fail.
    const types = read('lib/timeline-types.ts');
    expect(types).not.toMatch(/KIND_ICON|DOCUMENT_TYPE_ICON|FOLDER_ICON|contentIconFor/);

    for (const f of [
      'app/cases/[id]/timeline/timeline-builder.tsx',
      'app/cases/[id]/timeline/minimal-timeline.tsx',
    ]) {
      expect(read(f), `${f} should draw the kind badge`).toMatch(
        /<KindIcon kind=\{event\.kind\}/,
      );
    }
  });
});

describe('the Safe Witness alert subject', () => {
  /*
   * Judged rather than swept. The rule bans emoji in UI chrome, and an email
   * subject is not chrome: it lands in somebody else's inbox, and there is a
   * genuine argument that a glyph there helps a contact spot the one message
   * in the product where being missed is the failure that matters.
   *
   * It still comes out, for two reasons that beat recognition. A leading
   * emoji in a transactional subject is a well-known spam heuristic, and this
   * mail already looks like what filters distrust; recognition is worth
   * nothing from the spam folder. And U+1F6E1 draws as a missing-glyph box in
   * Outlook desktop on common fonts, so the subject would open with a broken
   * character on a message that must not read as a spoof.
   *
   * The words carry it instead, which is what the contact was told to look
   * for when they were set up.
   */
  it('leads with the words a contact was told to look for, and no emoji', () => {
    const src = read('app/api/safe-alert/route.ts');
    const m = src.match(/const subject = `([^`]*)`/);
    expect(m, 'the subject line moved; re-read the reasoning above').not.toBeNull();
    const subject = m![1];
    expect(subject).not.toMatch(new RegExp(EMOJI, 'u'));
    expect(subject.startsWith('Safe Witness alert')).toBe(true);
    expect(subject).toContain('${who}');
  });
});
