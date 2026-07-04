import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reverse-geocode a lat/lng into a human place (city, state, ZIP) so we
 * can show "Edina, MN 55435" instead of raw "44.762, -93.473" wherever
 * the browser hands us coordinates.
 *
 * Server-side so there's no client CSP/CORS hurdle and no API key in the
 * bundle. Uses OpenStreetMap Nominatim (keyless); the response is small
 * and cached briefly. Best-effort: any failure returns 200 with a null
 * place so the caller can fall back to coordinates.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  // Light cap; this is a user-initiated lookup, not a hot path.
  const allowed = await checkRateLimit(`geocode-reverse:${ip}`, {
    limit: 30,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json({ place: null, error: 'rate_limited' }, { status: 429 });
  }

  let body: { lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ place: null }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ place: null }, { status: 400 });
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
      `&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy asks for an identifying User-Agent.
        'User-Agent': 'Advottic/1.0 (https://advottic.com)',
        Accept: 'application/json',
      },
      // Coarse place data changes slowly; let the platform cache it.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ place: null });
    const j = (await res.json()) as {
      address?: Record<string, string>;
      display_name?: string;
    };
    const a = j.address ?? {};
    const city =
      a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
    const state = a.state || a.region || '';
    const stateCode = US_STATE_CODE[state] || '';
    const zip = a.postcode || '';
    // Build a short label: "Edina, MN 55435" (or the best subset we have).
    const parts: string[] = [];
    if (city) parts.push(city);
    const tail = [stateCode || state, zip].filter(Boolean).join(' ');
    if (tail) parts.push(tail);
    const label = parts.join(', ');
    return NextResponse.json({
      place: label
        ? { label, city, state, stateCode, zip, country: a.country_code || '' }
        : null,
    });
  } catch {
    return NextResponse.json({ place: null });
  }
}

// Nominatim returns full state names; map to the two-letter code so the
// label reads the way US users expect ("MN" not "Minnesota").
const US_STATE_CODE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
};
