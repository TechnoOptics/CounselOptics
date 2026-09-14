import type { ReactNode } from 'react';
import { FilePage } from './FilePage';
import { Section } from './Section';
import { BODY, H1 } from './type';

/**
 * The wrapper for pages that inherit the file without a redesign: about,
 * security, guides, the legal pages. The page's own h1 moves into the
 * first Section; everything the page already rendered follows in a 72ch
 * measure with the existing content untouched.
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
        <div className="max-w-[72ch] font-public text-[16px] leading-[1.6] text-ink-700 dark:text-cream-100/80 [&_h2]:font-caslon [&_h2]:text-[28px] [&_h2]:leading-[1.15] [&_h2]:text-forest-900 [&_h2]:dark:text-cream-100 [&_h3]:font-public [&_h3]:text-[17px] [&_h3]:font-semibold [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </Section>
    </FilePage>
  );
}
