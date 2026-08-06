'use client';

import { useState } from 'react';
import { createFrameSrcRetainer, type FrameSrcRetainer } from '@/lib/refresh-guards';

/**
 * An embedded document preview whose `src` does not change underneath
 * the reader.
 *
 * The pages that show one are force-dynamic and mint a fresh signed
 * storage URL on every render, so every router.refresh() used to hand
 * the iframe a different URL. React writes it through, the browser
 * treats it as a navigation, and the PDF viewer reloads: back to page 1,
 * scroll lost, focus stolen from whatever the reader was doing beside
 * it. On /counsel/documents/[id] the form's own router.refresh() after a
 * successful send did it too.
 *
 * So the first working URL is held for the life of the mount and later
 * ones are ignored. The retention itself is createFrameSrcRetainer: a
 * closure that remembers the URL on screen, so calling it during render
 * does mutate it. What is asserted, and what this component needs, is
 * that repeating a render never changes the answer. It is unit-tested
 * over a sequence of renders for exactly that; this component is the
 * two lines of React around it.
 */
export function DocumentFrame({
  src,
  title,
  className,
}: {
  src: string;
  title: string;
  className?: string;
}) {
  // One retainer per mount, created lazily so it survives every
  // re-render and is never shared with another frame.
  const [retain] = useState<FrameSrcRetainer>(() => createFrameSrcRetainer());
  const frameSrc = retain(src);
  if (!frameSrc) return null;
  return <iframe src={frameSrc} title={title} className={className} />;
}
