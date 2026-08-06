import 'server-only';
// The default export is the factory itself. package.json maps this specifier
// to dist/qrcode.mjs under the import condition and dist/qrcode.js under
// require, both of which are the whole library, and it ships its own types.
// There is no deep path worth reaching for and no runtime dependency behind
// it, so nothing else enters the bundle.
import qrcode from 'qrcode-generator';

/**
 * A QR code as an inline SVG string, generated on this server.
 *
 * Deliberately not a hosted QR image API: the text encoded here is a live
 * signing credential, and handing it to a third party would hand them the
 * ability to sign. `import 'server-only'` above makes that concrete. It is
 * a build-time guard that fails the build if this module is ever pulled
 * into a client bundle, so the encoder, and the credential it is handed,
 * stay on the server.
 *
 * The encoder is a dependency rather than something we own because a QR
 * encoder needs Reed-Solomon error correction, mode selection and mask
 * evaluation: several hundred lines of subtle bit manipulation where a
 * small mistake yields a code that scans on one phone and not another.
 * That is a poor thing to own in a signing path. The SVG below is ours,
 * built from the module matrix, so nothing is fetched and the markup is
 * fully under our control.
 *
 * Error correction level M is the usual choice for a screen-displayed
 * code. It tolerates a smudged camera without inflating the module count
 * the way H would.
 */

/**
 * The quiet zone the QR specification requires, in modules. A scanner
 * locates the code by its border of blank space, so a narrower one is not
 * a styling choice, it is a code that some phones will not see.
 */
export const QR_MIN_QUIET_ZONE = 4;

export function qrSvg(
  text: string,
  opts: { size?: number; margin?: number } = {},
): string {
  if (!text.trim()) {
    throw new Error('qrSvg needs text to encode.');
  }

  const margin = opts.margin ?? QR_MIN_QUIET_ZONE;
  // Integer, because a fractional offset would push every module off the
  // module grid and blur every edge a scanner reads.
  if (!Number.isInteger(margin) || margin < QR_MIN_QUIET_ZONE) {
    throw new Error(
      `qrSvg needs a quiet zone of at least ${QR_MIN_QUIET_ZONE} whole modules.`,
    );
  }

  if (opts.size !== undefined && !(Number.isFinite(opts.size) && opts.size > 0)) {
    throw new Error('qrSvg needs a positive size, or none at all.');
  }

  // Type 0 lets the library pick the smallest version that fits, and throw
  // rather than truncate when the text cannot fit at all.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + margin * 2;

  // One path for every dark module, which keeps the markup small.
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        d += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }
  }

  const sizeAttr = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';

  // The colours are fixed rather than inherited. A QR code is read by
  // contrast, so a dark-mode currentColor would invert it or erase it.
  //
  // The encoded text appears nowhere in this markup. It is in the matrix
  // and only in the matrix, so the credential is not readable from the
  // DOM, from copied markup or by a screen reader.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"` +
    `${sizeAttr} data-modules="${count}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${d}" fill="#000000"/>` +
    `</svg>`
  );
}
