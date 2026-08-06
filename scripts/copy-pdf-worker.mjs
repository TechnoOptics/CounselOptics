#!/usr/bin/env node
/**
 * Put the pdf.js worker and its wasm decoders where the signer page
 * can load them from our own origin.
 *
 * The signer page rasterises the document it is asking someone to
 * sign, and that page is unauthenticated with a live signing
 * credential in its URL, so nothing the renderer needs may come from a
 * CDN: not the library, not the worker, not a wasm blob, not a font,
 * not a character map. The library is bundled from node_modules. The
 * worker cannot be, because it is an ES module and Next runs Terser
 * over emitted .mjs assets in non-module mode, which fails on the
 * `import.meta` inside it. So it is copied into public/ instead, which
 * is a plainer path to the same guarantee: same origin, no bundler in
 * the way.
 *
 * Copied at build time rather than committed, because a vendored
 * megabyte drifts from the package it came from and nobody notices
 * until a signer's document will not open. The version is read from
 * the installed package and used in the path, so a stale cached worker
 * cannot be served against a newer library: the URL simply changes.
 * app/sign/[token]/pdf-runtime.ts builds the same path from
 * pdfjs.version, so the two are the same string or the fetch 404s and
 * the page blocks signing, which is the safe direction.
 *
 * Runs from `prebuild` and `predev`. Nothing else needs it.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'node_modules', 'pdfjs-dist', 'package.json');

let version;
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
} catch {
  console.error(
    'copy-pdf-worker: pdfjs-dist is not installed, so the signer page would ' +
      'have no worker to load. Run npm install.',
  );
  process.exit(1);
}

const pkgDir = join(root, 'node_modules', 'pdfjs-dist');
const toDir = join(root, 'public', 'pdf-worker', version);

mkdirSync(toDir, { recursive: true });
copyFileSync(
  join(pkgDir, 'build', 'pdf.worker.min.mjs'),
  join(toDir, 'pdf.worker.min.mjs'),
);
console.log(`copy-pdf-worker: public/pdf-worker/${version}/pdf.worker.min.mjs`);

/**
 * The image decoders, on the same terms.
 *
 * openjpeg.wasm is the JPEG 2000 decoder. Without it the library
 * cannot decode a JPEG 2000 image AT ALL - it throws before any fetch
 * is attempted, because pdf.js refuses a wasm factory with no base URL
 * - and a scanned agreement whose pages are JPEG 2000 (Acrobat's
 * optimiser and a great many office scanners produce exactly that)
 * loses every page image. pdf.js catches that internally, warns, and
 * finishes the render, so the signer is shown a white rectangle over
 * which they are asked to confirm they have read the document. That is
 * the one outcome the signer page exists to make impossible.
 *
 * openjpeg_nowasm_fallback.js is the library's own fallback when wasm
 * will not instantiate, and it is imported from the same directory, so
 * it comes along or the fallback reaches for a URL that 404s.
 * qcms_bg.wasm is the colour-management decoder and travels with them
 * for the same reason: an ICC-profiled scan is ordinary.
 */
for (const filename of [
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
]) {
  mkdirSync(join(toDir, 'wasm'), { recursive: true });
  copyFileSync(join(pkgDir, 'wasm', filename), join(toDir, 'wasm', filename));
  console.log(`copy-pdf-worker: public/pdf-worker/${version}/wasm/${filename}`);
}
