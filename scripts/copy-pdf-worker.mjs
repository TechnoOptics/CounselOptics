#!/usr/bin/env node
/**
 * Put the pdf.js worker where the signer page can load it from our own
 * origin.
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

const from = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const toDir = join(root, 'public', 'pdf-worker', version);
const to = join(toDir, 'pdf.worker.min.mjs');

mkdirSync(toDir, { recursive: true });
copyFileSync(from, to);
console.log(`copy-pdf-worker: public/pdf-worker/${version}/pdf.worker.min.mjs`);
