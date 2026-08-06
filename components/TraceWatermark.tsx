/**
 * Diagonal repeating watermark carrying who is reading the page and
 * when. Sits above the page content at very low opacity so legibility
 * is unaffected, but any screenshot that leaves the building carries an
 * identity and the moment it was taken.
 *
 * Pointer-events: none ensures it never intercepts clicks.
 *
 * Two tones, because the two surfaces it is used on paint differently
 * and a watermark that is invisible traces nothing:
 *
 *   'shell' is the app chrome, which is the dark hq-shell and
 *   counsel-shell most of the time. Gold at 10% through an overlay
 *   blend adapts to whatever is painted beneath it there.
 *
 *   'document' is the signer page, whose subject is a PDF rasterised
 *   onto a canvas and therefore a sheet of white. Overlay against white
 *   resolves to white, so the shell tone would have vanished exactly
 *   where the mark matters most. This tone uses no blend mode and a
 *   neutral grey, which reads on a white page and on the dark theme
 *   behind it alike.
 */
export function TraceWatermark({
  email,
  stamp,
  tone = 'shell',
}: {
  /** The signed-in user, for the default stamp. Ignored when `stamp`
   *  is given. */
  email?: string | null;
  /** A ready-made line, for surfaces that know who is reading without
   *  a session (the signer page builds one with signerWatermarkStamp). */
  stamp?: string | null;
  tone?: 'shell' | 'document';
}) {
  // Stamp to the minute so a single screenshot carries when it was
  // taken. We accept that the timestamp will be slightly stale on
  // long-lived pages - the goal is "around when" not forensic precision.
  const line =
    stamp ??
    (email
      ? `${email}  ·  ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`
      : null);
  if (!line) return null;

  const onDocument = tone === 'document';
  const fill = onDocument ? 'rgba(90,96,104,0.16)' : 'rgba(213,187,126,0.10)';
  // Tile the watermark via CSS background. Using a data URI SVG keeps
  // it dependency-free and crisp at any zoom level. The text appears
  // at -28deg every ~360x180 px, which is dense enough to survive
  // a partial screenshot but not so dense it visibly fogs the page.
  // The document tone tiles wider because its line carries a name and
  // an address as well as a timestamp.
  const width = onDocument ? 460 : 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="180" viewBox="0 0 ${width} 180">` +
    `<text x="${width / 2}" y="100" text-anchor="middle" transform="rotate(-28 ${width / 2} 100)" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" ` +
    `font-size="11" fill="${fill}" font-weight="500">${escapeXml(line)}</text>` +
    `</svg>`;
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: dataUri,
        backgroundRepeat: 'repeat',
        zIndex: 999,
        // Mix-blend so the watermark adapts to whatever the page paints
        // beneath it - readable on dark hq-shell and counsel-shell,
        // gentle on the consumer light theme. Deliberately absent on
        // the document tone: see the note at the top of the file.
        ...(onDocument ? null : { mixBlendMode: 'overlay' as const }),
      }}
    />
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
