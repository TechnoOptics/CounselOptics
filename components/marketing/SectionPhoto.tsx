import Image from 'next/image';

/**
 * A photograph used as punctuation between the product moments on a
 * marketing page.
 *
 * Two rules are baked in rather than left to each call site.
 *
 * NOTHING IS SET OVER THE IMAGE. No headline, no eyebrow, no button.
 * Text on a photograph cannot be held to a contrast floor, because the
 * pixels behind a given glyph depend on the crop, the viewport and the
 * subject. Every other coloured surface in this product is measured in
 * tests/accent-text.test.ts against a known ground; a photo has no known
 * ground. So copy sits beside or below, on a real surface, where it can
 * be measured like everything else.
 *
 * THE ALT TEXT DESCRIBES THE PHOTOGRAPH, not the section it decorates.
 * A reader on a screen reader gets nothing from "our customers"; they
 * get something from knowing what is actually pictured. Where an image
 * is purely decorative the caller passes `decorative`, which empties the
 * alt attribute so it is skipped rather than announced as noise.
 *
 * Sizing: the intrinsic files are 1600px wide WebP at roughly 90KB.
 * `sizes` is required so next/image serves a phone a phone-sized file
 * instead of the desktop one.
 */
export function SectionPhoto({
  src,
  alt,
  sizes,
  aspect = 'aspect-[16/9]',
  priority = false,
  decorative = false,
  className = '',
}: {
  src: string;
  alt: string;
  /** Match the column this sits in, or a phone downloads the desktop file. */
  sizes: string;
  aspect?: string;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative ${aspect} overflow-hidden rounded-2xl ring-1 ring-ink-200/80 dark:ring-forest-700/50 bg-cream-100 dark:bg-forest-900 ${className}`}
    >
      <Image
        src={src}
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
