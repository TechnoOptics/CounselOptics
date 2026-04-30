/**
 * Diagonal repeating watermark with the signed-in user's email and a
 * minute-precision timestamp. Sits above the page content at very low
 * opacity so legibility is unaffected, but any screenshot that leaves
 * the building carries the captor's email and the moment it was taken.
 *
 * Pointer-events: none ensures it never intercepts clicks.
 */
export function TraceWatermark({ email }: { email: string | null }) {
  if (!email) return null;
  // Stamp to the minute so a single screenshot carries when it was
  // taken. We accept that the timestamp will be slightly stale on
  // long-lived pages - the goal is "around when" not forensic precision.
  const stamp = `${email}  ·  ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
  // Tile the watermark via CSS background. Using a data URI SVG keeps
  // it dependency-free and crisp at any zoom level. The text appears
  // at -28deg every ~360x180 px, which is dense enough to survive
  // a partial screenshot but not so dense it visibly fogs the page.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180">` +
    `<text x="180" y="100" text-anchor="middle" transform="rotate(-28 180 100)" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" ` +
    `font-size="11" fill="rgba(213,187,126,0.10)" font-weight="500">${escapeXml(stamp)}</text>` +
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
        // gentle on the consumer light theme.
        mixBlendMode: 'overlay',
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
