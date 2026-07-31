import { unzip as fflateUnzip, type Unzipped } from 'fflate';

/**
 * Client-side zip expansion for the evidence intake. A firm can zip a folder of
 * exhibits and drop the single archive; we expand it in the browser into the
 * individual files and hand them to the SAME upload pipeline as a normal
 * multi-file drop, so every extracted item flows through name-dedup, batch
 * upload, AI analysis, and exhibit-number assignment with no special path.
 *
 * Kept out of the initial bundle: import this module lazily (only when a zip is
 * actually present) so fflate is fetched on demand.
 */

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff',
  tiff: 'image/tiff', bmp: 'image/bmp',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
  eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
};

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? '';
}

/** A file the browser or the drop reported as a zip archive. */
export function isZip(f: File): boolean {
  return (
    /\.zip$/i.test(f.name) ||
    f.type === 'application/zip' ||
    f.type === 'application/x-zip-compressed' ||
    f.type === 'multipart/x-zip'
  );
}

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Directory entries, macOS resource forks, and OS junk that shouldn't import. */
function isJunk(path: string): boolean {
  const base = baseName(path);
  return (
    path.endsWith('/') ||
    path.includes('__MACOSX') ||
    base.startsWith('._') ||
    base === '.DS_Store' ||
    base === 'Thumbs.db' ||
    base === ''
  );
}

async function unzipOne(file: File): Promise<File[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries: Unzipped = await new Promise((resolve, reject) => {
    fflateUnzip(buf, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const out: File[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (isJunk(path) || !bytes || bytes.length === 0) continue;
    const name = baseName(path);
    out.push(new File([bytes], name, { type: mimeFromName(name) }));
  }
  return out;
}

/**
 * Replace any zip archives in `files` with their extracted contents; pass
 * everything else through untouched. A corrupt/unreadable archive is left as
 * the original file so the server rejects it with a clear error instead of it
 * silently vanishing.
 */
export async function expandZips(
  files: File[],
): Promise<{ files: File[]; archives: number; extracted: number }> {
  let archives = 0;
  let extracted = 0;
  const result: File[] = [];
  for (const f of files) {
    if (!isZip(f)) {
      result.push(f);
      continue;
    }
    try {
      const inner = await unzipOne(f);
      if (inner.length === 0) {
        // Empty / all-junk archive: keep the original so the user sees it fail
        // rather than a silent no-op.
        result.push(f);
        continue;
      }
      archives += 1;
      extracted += inner.length;
      result.push(...inner);
    } catch {
      result.push(f);
    }
  }
  return { files: result, archives, extracted };
}
