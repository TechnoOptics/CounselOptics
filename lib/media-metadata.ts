import 'server-only';
import exifr from 'exifr';
import { PDFDocument } from 'pdf-lib';

/**
 * Forensic "core details" extraction — pull whatever a file quietly carries
 * (device, capture time, GPS, camera settings, PDF authoring metadata) so the
 * firm can surface it as evidence/clues. Best-effort: an image with its EXIF
 * stripped, or a flat PDF, simply returns fewer fields. Never throws.
 */

export type MetaField = { label: string; value: string };
export type MediaMetadata = {
  fields: MetaField[];
  /** Present when the file embeds GPS coordinates. */
  gps?: { lat: number; lng: number } | null;
};

function fmtDate(d: unknown): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function extractImageMetadata(buffer: Buffer): Promise<MediaMetadata> {
  const fields: MetaField[] = [];
  let gps: { lat: number; lng: number } | null = null;
  try {
    // `true` = parse every segment/tag (TIFF, EXIF, GPS, XMP, IPTC…).
    const x = (await exifr.parse(buffer, true)) as Record<string, unknown> | undefined;

    if (x) {
      const push = (label: string, v: unknown, suffix = '') => {
        if (v === undefined || v === null || v === '') return;
        fields.push({ label, value: `${String(v)}${suffix}` });
      };
      const device = [x.Make, x.Model].filter(Boolean).join(' ').trim();
      push('Device', device);
      push('Lens', x.LensModel);
      push('Software', x.Software);
      const captured = fmtDate(x.DateTimeOriginal || x.CreateDate || x.ModifyDate);
      if (captured) push('Captured', captured);
      if (x.ExifImageWidth && x.ExifImageHeight) {
        push('Dimensions', `${x.ExifImageWidth} × ${x.ExifImageHeight}`);
      }
      push('ISO', x.ISO);
      if (x.FNumber) push('Aperture', `ƒ/${x.FNumber}`);
      if (typeof x.ExposureTime === 'number' && x.ExposureTime > 0) {
        push('Shutter', x.ExposureTime < 1 ? `1/${Math.round(1 / x.ExposureTime)} s` : `${x.ExposureTime} s`);
      }
      if (x.FocalLength) push('Focal length', `${x.FocalLength} mm`);
      push('Artist', x.Artist);
      push('Copyright', x.Copyright);
      if (typeof x.latitude === 'number' && typeof x.longitude === 'number') {
        gps = { lat: x.latitude, lng: x.longitude };
      }
      if (typeof x.GPSAltitude === 'number') push('Altitude', `${Math.round(x.GPSAltitude)} m`);
    }

    if (!gps) {
      const g = await exifr.gps(buffer).catch(() => null);
      if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') {
        gps = { lat: g.latitude, lng: g.longitude };
      }
    }
    if (gps) fields.unshift({ label: 'GPS', value: `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}` });
  } catch {
    /* no/unsupported EXIF — return what we have */
  }
  return { fields, gps };
}

export async function extractPdfMetadata(buffer: Buffer): Promise<MediaMetadata> {
  const fields: MetaField[] = [];
  try {
    const pdf = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: false });
    const push = (label: string, v: string | undefined | null) => { if (v && v.trim()) fields.push({ label, value: v.trim() }); };
    push('Title', pdf.getTitle());
    push('Author', pdf.getAuthor());
    push('Subject', pdf.getSubject());
    push('Creator', pdf.getCreator());
    push('Producer', pdf.getProducer());
    const created = fmtDate(pdf.getCreationDate()); if (created) fields.push({ label: 'Created', value: created });
    const modified = fmtDate(pdf.getModificationDate()); if (modified) fields.push({ label: 'Modified', value: modified });
    fields.push({ label: 'Pages', value: String(pdf.getPageCount()) });
  } catch {
    /* not a parseable PDF */
  }
  return { fields, gps: null };
}

export async function extractMediaMetadata(
  buffer: Buffer,
  mime: string,
  name: string,
): Promise<MediaMetadata> {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|heic|heif|tiff?|webp|avif)$/.test(n)) {
    return extractImageMetadata(buffer);
  }
  if (m === 'application/pdf' || n.endsWith('.pdf')) {
    return extractPdfMetadata(buffer);
  }
  return { fields: [], gps: null };
}
