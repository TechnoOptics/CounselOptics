import { readFileSync } from 'node:fs';
import path from 'node:path';
import Image from 'next/image';
import { Sheet } from './Sheet';
import { LABEL } from './type';

/**
 * A frame of the real, signed-in app on a marketing page: `Screen` is the
 * only way tasks 5 and 6 place one. See
 * docs/superpowers/specs/2026-09-24-marketing-screen-grabs-design.md 2.
 *
 * The manifest is `public/screens/manifest.json`, written by the capture
 * script (a later task) and read here at build time, never at request time:
 * a page that renders `<Screen>` is a page whose build fails the moment its
 * id goes missing, rather than one that ships a hole in production. Per the
 * task's own interface, `Screen` consumes only an entry's `id` and `alt` -
 * it does not read `route`, `width`, `theme` or `commit`, which exist for
 * the capture script and the guard in tests/screens-are-real-and-current.test.ts.
 *
 * Width and height come from the PNG itself, not from a number in the
 * manifest (the manifest carries none): the file on disk is the one place
 * that cannot lie about its own intrinsic size, and reading it directly
 * means a re-crop can never leave a stale dimension behind.
 */

type ManifestEntry = {
  id: string;
  route: string;
  width: number;
  theme: string;
  alt: string;
  commit: string;
};

const SCREENS_DIR = path.join(process.cwd(), 'public', 'screens');
const MANIFEST_PATH = path.join(SCREENS_DIR, 'manifest.json');

function loadManifest(): ManifestEntry[] {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as ManifestEntry[];
}

function findEntry(id: string): ManifestEntry {
  const entry = loadManifest().find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(
      `Screen: "${id}" has no entry in the screens manifest (public/screens/manifest.json). ` +
        'Check the id for a typo, or run the capture script to add it.',
    );
  }
  return entry;
}

/**
 * A PNG's own width and height, read out of its IHDR chunk rather than
 * trusted from anywhere else: the 8-byte signature, a 4-byte chunk length,
 * the 4-byte type "IHDR", then big-endian width and height, 4 bytes each.
 */
function pngDimensions(file: Buffer): { width: number; height: number } {
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

export function Screen({ id, caption }: { id: string; caption: string }) {
  const entry = findEntry(id);
  const imagePath = path.join(SCREENS_DIR, `${entry.id}.png`);
  const { width, height } = pngDimensions(readFileSync(imagePath));
  return (
    <Sheet>
      <Image
        src={`/screens/${entry.id}.png`}
        alt={entry.alt}
        width={width}
        height={height}
        className="block h-auto w-full"
      />
      <p className={`mt-3 ${LABEL}`}>{caption}</p>
    </Sheet>
  );
}
