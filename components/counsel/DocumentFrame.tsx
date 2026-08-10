'use client';

import { useState } from 'react';
import { createFrameSrcRetainer, type FrameSrcRetainer } from '@/lib/refresh-guards';
import { PdfViewer } from '@/components/PdfViewer';

/**
 * An embedded document preview whose source does not change underneath
 * the reader.
 *
 * The pages that show one are force-dynamic and mint a fresh signed
 * storage URL on every render, so every router.refresh() hands this
 * component a different URL. On /counsel/documents/[id] the form's own
 * router.refresh() after a successful send does it too.
 *
 * THE RETENTION IS STILL LOAD-BEARING, AND THE MECHANISM IT PROTECTS
 * AGAINST HAS CHANGED. It used to be an iframe: React wrote the new URL
 * into `src`, the browser treated it as a navigation, and the built-in
 * PDF viewer reloaded to page 1 with the scroll lost and focus stolen.
 * There is no iframe now, and that exact sequence is gone with it. What
 * replaced it is not weaker. The URL is the identity of the document
 * inside PdfViewer, and the only thing allowed to restart the fetch and
 * the parse; hand it a new one and the viewer re-downloads the same
 * bytes, throws away the parsed document, and comes back at page 1 at
 * fit width, having dropped whatever page and zoom the reader had set.
 * That is the same loss through a different door, so the first URL that
 * works is still held for the life of the mount.
 *
 * The retention itself is createFrameSrcRetainer: a closure that
 * remembers what is on screen, so calling it during render does mutate
 * it. What is asserted, and what this component needs, is that
 * repeating a render never changes the answer. It is unit-tested over a
 * sequence of renders for exactly that (tests/refresh-guards.test.ts);
 * this component is the two lines of React around it.
 *
 * The trade is unchanged and worth restating: a signed URL is minted
 * for ten minutes (lib/firm-storage.ts), so a tab left open past that
 * and then restored can find the URL expired. The viewer now SAYS so
 * rather than showing an empty rectangle, which is most of why that
 * trade was uncomfortable before.
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
  return (
    <PdfViewer
      source={{ kind: 'url', url: frameSrc }}
      title={title}
      className={className}
      fallbackHref={frameSrc}
    />
  );
}
