import type { ReactNode } from 'react';
import { FilePage } from './FilePage';
import { Section } from './Section';
import { BODY, H1 } from './type';

/**
 * The wrapper for pages that inherit the file without a redesign: about,
 * security, guides, the legal pages. The page's own h1 moves into the
 * first Section; everything the page already rendered follows in a 72ch
 * measure with the existing content untouched.
 *
 * The body block owns the vertical rhythm as well as the type, because the
 * pages it wraps set none: their sections sit flush against each other, so
 * an h2 had less air above it (32px at 1440, 31px at 390, leading only)
 * than two paragraphs of the same page had between them (46px and 50px),
 * which reads as if each heading belongs to the block it follows. A heading
 * takes more space above than below here, and the two first-child resets
 * keep the top of the page tight to the h1 Section: the direct one for a
 * page that opens on a heading, the second for one that opens on a wrapper
 * whose own first child is the heading, whose margin would otherwise
 * collapse out through it.
 *
 * h2 only, and that was measured rather than assumed. The fourteen pages
 * carry eighteen h3s between them (fourteen on security, four on about) and
 * fourteen of the eighteen are the FIRST child of a bordered card, where a
 * top margin is dead space above a card title rather than air before a
 * heading. The rule does not hold for h3 and h3 is left alone.
 */
export function Prose({
  label,
  title,
  lede,
  children,
}: {
  label: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <FilePage>
      <Section label={label} first>
        <h1 className={H1}>{title}</h1>
        {lede && <p className={`${BODY} mt-5`}>{lede}</p>}
      </Section>
      <Section label="">
        <div className="max-w-[72ch] font-public text-[16px] leading-[1.6] text-ink-700 dark:text-cream-100/80 [&_h2]:mt-12 [&_h2]:font-caslon [&_h2]:text-[28px] [&_h2]:leading-[1.15] [&_h2]:text-forest-900 [&_h2]:dark:text-cream-100 [&>*:first-child]:mt-0 [&>*:first-child>h2:first-child]:mt-0 [&_h3]:font-public [&_h3]:text-[17px] [&_h3]:font-semibold [&_a:not(.btn):not(.btn-primary):not(.btn-secondary):not(.btn-ghost):not(.btn-accent)]:underline [&_a:not(.btn):not(.btn-primary):not(.btn-secondary):not(.btn-ghost):not(.btn-accent)]:underline-offset-4">
          {children}
        </div>
      </Section>
    </FilePage>
  );
}
