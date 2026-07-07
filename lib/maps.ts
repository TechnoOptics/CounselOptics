import 'server-only';

/**
 * Google Maps helpers for the case timeline: geocode text locations, and build
 * Advottic-themed Static Maps URLs that fit exactly the area where a case's
 * data pings (omit center/zoom and Google frames all markers automatically).
 *
 * Two keys, on purpose:
 *   - GOOGLE_MAPS_API_KEY (server only): Geocoding API + server-side Static
 *     Maps fetches for the PDF export. Never exposed to the browser.
 *   - NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (client): the live Maps JavaScript map
 *     and any browser <img> static map. Restrict this one by HTTP referrer.
 *
 * Everything is gated: with no key the helpers return null and callers simply
 * render nothing, so the app is unaffected until the keys are added.
 */

export type LatLng = { lat: number; lng: number };

function serverKey(): string {
  // Prefer the dedicated server key; fall back to the public key so the maps
  // light up with whatever key is attached (mirrors app/api/safe/alert).
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    ''
  );
}
export function mapsConfigured(): boolean {
  return Boolean(serverKey());
}
export function mapsClientKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || '';
}

// Advottic palette: cream landscape, muted-green water, forest labels.
const THEME_STYLES = [
  'feature:landscape|element:geometry|color:0xf4f1ea',
  'feature:water|element:geometry|color:0xc9dcd3',
  'feature:road|element:geometry|color:0xffffff',
  'feature:road|element:labels.text.fill|color:0x6f6f6f',
  'feature:poi|element:geometry|color:0xe7e2d6',
  'feature:poi|element:labels|visibility:off',
  'feature:administrative|element:geometry.stroke|color:0x0f2d24',
  'feature:administrative|element:labels.text.fill|color:0x0f2d24',
  'feature:transit|visibility:off',
];

const geocodeCache = new Map<string, LatLng | null>();

/** Address/place string -> coordinates (cached). Null without a key. */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const key = serverKey();
  const q = (address || '').trim();
  if (!key || !q) return null;
  if (geocodeCache.has(q)) return geocodeCache.get(q) ?? null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`,
      { cache: 'no-store' },
    );
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    const loc = data?.results?.[0]?.geometry?.location;
    const out = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
      ? { lat: loc.lat, lng: loc.lng }
      : null;
    geocodeCache.set(q, out);
    return out;
  } catch {
    return null;
  }
}

function buildStaticUrl(points: LatLng[], key: string, opts?: { width?: number; height?: number; scale?: 1 | 2 }): string | null {
  if (!key || points.length === 0) return null;
  const w = opts?.width ?? 640;
  const h = opts?.height ?? 360;
  const scale = opts?.scale ?? 2;
  const markers = points
    .map((p) => `markers=${encodeURIComponent(`color:0xC9A227|${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)}`)
    .join('&');
  const styles = THEME_STYLES.map((s) => `style=${encodeURIComponent(s)}`).join('&');
  // A single point has no bounds to fit, so give it a sensible zoom; multiple
  // points auto-fit (only the pinged area is shown).
  const framing =
    points.length === 1
      ? `&center=${points[0].lat.toFixed(6)},${points[0].lng.toFixed(6)}&zoom=14`
      : '';
  return `https://maps.googleapis.com/maps/api/staticmap?size=${w}x${h}&scale=${scale}&maptype=roadmap${framing}&${markers}&${styles}&key=${key}`;
}

/** Themed static map for SERVER use (PDF export). Uses the server key. */
export function staticMapUrlServer(points: LatLng[], opts?: { width?: number; height?: number; scale?: 1 | 2 }): string | null {
  return buildStaticUrl(points, serverKey(), opts);
}

/** Themed static map for a browser <img>. Uses the referrer-restricted client key. */
export function staticMapUrlClient(points: LatLng[], opts?: { width?: number; height?: number; scale?: 1 | 2 }): string | null {
  return buildStaticUrl(points, mapsClientKey(), opts);
}
