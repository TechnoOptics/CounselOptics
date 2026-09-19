import type { ReactNode } from 'react';

/**
 * A full-bleed band inside FilePage: a section that belongs to the whole
 * page rather than to the file, on its own ground. The home firm signpost
 * and the enterprise cover are the two.
 *
 * The bleed and the column live here because the two bands disagreed about
 * what a band is. The home one used `-mx-4 sm:-mx-6 lg:-mx-10`, which only
 * reaches FilePage's 1200px container, so above 1200px it was a rectangle
 * with paper on both sides; the enterprise cover used the same classes and
 * was overridden at lg by an `!important` rule in globals.css that pulled it
 * to the viewport edge AND gave it a different inner column, so the cover's
 * h1 and the h2 of the section directly beneath it did not share a left
 * edge. Full bleed is the geometry; the inner column is spelled exactly as
 * FilePage's, so a band's content lines up with the file above and below it
 * at every width.
 *
 * `html, body { overflow-x: clip }` in globals.css is what keeps the 100vw
 * width from introducing a sideways scroll next to a classic scrollbar.
 *
 * `dark:bg-band` is the dark-theme ground, and it belongs here rather than at
 * the two call sites because they spell the same light-theme colour two ways
 * (`bg-forest-950` on home, `bg-paper` inside the enterprise shell). In dark
 * theme `--paper` IS that forest, so both bands painted the page's own ground
 * and neither read as a band; `--band` (globals.css) lifts them one step.
 */
export function Band({ className = '', children }: { className?: string; children?: ReactNode }) {
  return (
    <section className={`mx-[calc(50%_-_50vw)] dark:bg-band ${className}`.trim()}>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">{children}</div>
    </section>
  );
}
