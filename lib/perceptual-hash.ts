import 'server-only';
import sharp from 'sharp';

/**
 * Perceptual image hashing (dHash) for near-duplicate detection.
 *
 * sha256 catches byte-identical re-uploads. It does NOT catch the far more
 * common firm case: the SAME image re-saved, resized, screenshotted, or lightly
 * re-compressed - visually identical, byte-different. A dHash encodes what the
 * image LOOKS like: downscale to 9x8 greyscale, then record whether each pixel
 * is brighter than its right neighbour (8x8 = 64 bits). Two versions of the same
 * picture differ in only a handful of bits, so a small Hamming distance means
 * "the same image". Returned as 16 hex chars.
 */
export async function perceptualHash(buffer: Buffer): Promise<string | null> {
  try {
    const W = 9;
    const H = 8;
    const data = await sharp(buffer)
      .greyscale()
      .resize(W, H, { fit: 'fill' })
      .raw()
      .toBuffer();
    if (data.length < W * H) return null;
    let bits = '';
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W - 1; col++) {
        bits += data[row * W + col] < data[row * W + col + 1] ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}
