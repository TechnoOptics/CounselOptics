'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from '@/components/ExternalLink';

type Coords = { lat: number; lng: number };
type Mode = 'idle' | 'asking' | 'denied' | 'unsupported' | 'manual' | 'ready' | 'error';

const PRACTICE_AREAS: { value: string; label: string }[] = [
  { value: 'lawyers', label: 'Lawyers (general)' },
  { value: 'family law attorneys', label: 'Family law' },
  { value: 'criminal defense attorneys', label: 'Criminal defense' },
  { value: 'employment lawyers', label: 'Employment' },
  { value: 'landlord tenant lawyers', label: 'Landlord / tenant' },
  { value: 'personal injury lawyers', label: 'Personal injury' },
  { value: 'estate planning lawyers', label: 'Estate / probate' },
  { value: 'small business lawyers', label: 'Small business / contracts' },
  { value: 'immigration lawyers', label: 'Immigration' },
  { value: 'civil rights lawyers', label: 'Civil rights' },
  { value: 'legal aid', label: 'Legal aid (free / low cost)' },
];

export function FindCounselClient() {
  const [mode, setMode] = useState<Mode>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [manualPlace, setManualPlace] = useState('');
  const [practice, setPractice] = useState<string>('lawyers');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && !('geolocation' in navigator)) {
      setMode('unsupported');
    }
  }, []);

  // Turn the raw lat/lng into a human place (city, state, ZIP) so we can
  // show "Edina, MN 55435" instead of coordinates. Best-effort: if the
  // lookup fails, placeLabel stays null and we fall back to coordinates.
  useEffect(() => {
    if (!coords) {
      setPlaceLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/geocode/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
        });
        const j = (await res.json()) as { place?: { label?: string } | null };
        if (!cancelled && j.place?.label) setPlaceLabel(j.place.label);
      } catch {
        /* keep coordinate fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coords]);

  function requestLocation() {
    setMode('asking');
    setErrMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMode('ready');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setMode('denied');
        } else {
          setMode('error');
          setErrMsg(err.message || 'Could not read your location.');
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  function useManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (manualPlace.trim().length === 0) return;
    setMode('manual');
  }

  // Build the map src + open-in-Google-Maps URL
  const query = encodeURIComponent(practice);
  const place = manualPlace.trim();
  const embedSrc =
    mode === 'ready' && coords
      ? `https://www.google.com/maps?q=${query}&ll=${coords.lat},${coords.lng}&z=12&output=embed`
      : mode === 'manual' && place
        ? `https://www.google.com/maps?q=${query}+near+${encodeURIComponent(place)}&output=embed`
        : null;

  const fullMapsUrl =
    mode === 'ready' && coords
      ? `https://www.google.com/maps/search/${query}/@${coords.lat},${coords.lng},12z`
      : mode === 'manual' && place
        ? `https://www.google.com/maps/search/${query}+near+${encodeURIComponent(place)}`
        : null;

  return (
    <div className="space-y-6">
      {/* Practice area selector + location controls */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="label" htmlFor="practice">
            Practice area
          </label>
          <select
            id="practice"
            value={practice}
            onChange={(e) => setPractice(e.target.value)}
            className="input"
          >
            {PRACTICE_AREAS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-500 mt-1.5">
            Pick the area that best matches your matter. Results come from Google Maps - we
            don&apos;t vet, rank, or get paid by any of the firms shown.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Use device location */}
          <div className="rounded-lg border border-ink-200 p-4">
            <p className="text-sm font-semibold text-forest-900">Use my location</p>
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">
              Your browser asks first. Coordinates stay in your browser - we don&apos;t store them.
            </p>
            {mode === 'unsupported' ? (
              <p className="text-xs text-rose-700 mt-3">
                Your browser doesn&apos;t support geolocation. Use the manual option instead.
              </p>
            ) : (
              <button
                type="button"
                onClick={requestLocation}
                disabled={mode === 'asking'}
                className="btn-primary mt-3"
              >
                {mode === 'asking'
                  ? 'Locating...'
                  : mode === 'ready' && coords
                    ? 'Refresh location'
                    : 'Use my location'}
              </button>
            )}
            {mode === 'denied' && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-amber-800 leading-relaxed">
                  Location was blocked. You can ask again - if your browser remembers the block,
                  you may need to allow it from the lock icon in the address bar first.
                </p>
                <button
                  type="button"
                  onClick={requestLocation}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Try again
                </button>
              </div>
            )}
            {mode === 'error' && errMsg && (
              <p className="text-xs text-rose-700 mt-2">{errMsg}</p>
            )}
            {mode === 'ready' && coords && (
              <p className="text-xs text-emerald-800 mt-2">
                {placeLabel
                  ? `Located near ${placeLabel}.`
                  : 'Location detected. Finding attorneys near you…'}
              </p>
            )}
          </div>

          {/* Manual zip / city */}
          <form onSubmit={useManual} className="rounded-lg border border-ink-200 p-4">
            <p className="text-sm font-semibold text-forest-900">Or enter a place</p>
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">
              Zip code, city, or neighborhood. Anything Google Maps can geocode.
            </p>
            <div className="flex gap-2 mt-3">
              <input
                value={manualPlace}
                onChange={(e) => setManualPlace(e.target.value)}
                placeholder="55379, Shakopee MN, 90210"
                className="input flex-1"
              />
              <button type="submit" className="btn-secondary">
                Go
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Map */}
      {embedSrc ? (
        <div className="space-y-3">
          <div className="card overflow-hidden p-0 ring-1 ring-forest-900/10">
            {/* Advottic-branded map frame. The results come from a
                cross-origin Google Maps embed whose own tiles can't be
                recolored, so we theme the surround instead: a forest
                header bar + brand ring keep it on-brand without hurting
                map legibility. */}
            <div className="flex items-center gap-2 bg-forest-900 text-cream-100 px-4 py-2.5">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 flex-none text-gold-400"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
              </svg>
              <p className="text-[12px] font-semibold tracking-[0.02em]">
                Counsel near{placeLabel ? ` ${placeLabel}` : ' you'}
              </p>
            </div>
            <iframe
              key={embedSrc}
              src={embedSrc}
              title="Nearby legal counsel on Google Maps"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-[60vh] min-h-[420px] border-0"
            />
          </div>
          {fullMapsUrl && (
            <p className="text-sm text-ink-600">
              Listings come from{' '}
              <ExternalLink
                href={fullMapsUrl}
                className="underline text-forest-900 hover:text-forest-700"
              >
                Google Maps - open the full results
              </ExternalLink>{' '}
              for reviews, hours, contact details, and directions.
            </p>
          )}
        </div>
      ) : (
        <div className="card p-10 text-center">
          <p className="text-ink-600 max-w-md mx-auto leading-relaxed">
            Pick how you want to find counsel. We&apos;ll embed Google Maps results so you can
            scan reviews and contact details right here.
          </p>
        </div>
      )}

      {/* Disclaimer + alt resources */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 leading-relaxed">
        <p className="font-semibold mb-1">A note on these listings</p>
        <ul className="list-disc list-outside pl-5 space-y-1">
          <li>
            Advottic is <strong>not a lawyer-referral service</strong> and does not endorse,
            rank, or vet any firm shown.
          </li>
          <li>
            Always confirm a lawyer&apos;s license through your state bar before signing
            anything. Most state bars publish a free lookup tool.
          </li>
          <li>
            If you can&apos;t afford private counsel, search for &quot;legal aid&quot; in your
            county, or for criminal matters request a public defender at your first court
            appearance.
          </li>
        </ul>
      </div>
    </div>
  );
}
