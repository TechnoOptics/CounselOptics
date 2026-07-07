'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live case map. Given the geocoded pins across a case's timeline, it drops
 * gold Advottic-themed markers and frames the view to exactly the pinged area
 * (no wider). As new evidence is analysed and more pins resolve, the parent
 * re-renders with fresh `points` and the map re-fits its bounds live, so the
 * breadcrumbs fill in as the case grows.
 *
 * Gated on NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: with no key the component renders
 * nothing, so the timeline is unaffected until the key is present.
 */

export type MapPoint = { lat: number; lng: number; label: string; source: 'gps' | 'place' };

// Advottic palette, mirroring lib/maps.ts THEME_STYLES as JS style objects.
const MAP_STYLE = [
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f4f1ea' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dcd3' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6f6f6f' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e7e2d6' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#0f2d24' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#0f2d24' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

/* Minimal shape of the pieces of the Maps JS runtime we touch, so we avoid a
 * heavy @types/google.maps dependency (same approach as PlaceAutocomplete). */
type GMap = { fitBounds(b: unknown, padding?: number): void; setCenter(c: { lat: number; lng: number }): void; setZoom(z: number): void };
type GMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
  Marker: new (opts: Record<string, unknown>) => { setMap(m: GMap | null): void };
  LatLngBounds: new () => { extend(p: { lat: number; lng: number }): void };
  InfoWindow: new (opts: Record<string, unknown>) => { open(map: GMap, anchor: unknown): void };
  SymbolPath: { CIRCLE: number };
  event: { addListener(target: unknown, ev: string, cb: () => void): void };
};
function gmaps(): GMaps | null {
  const g = (window as unknown as { google?: { maps?: GMaps } }).google;
  return g?.maps ?? null;
}

let loaderPromise: Promise<void> | null = null;
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (gmaps()) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<void>((resolve, reject) => {
    // Reuse a script another component (PlaceAutocomplete) may have added.
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('maps load failed')));
      if (gmaps()) resolve();
      return;
    }
    const s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.dataset.googleMaps = '1';
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('maps load failed'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export function CaseMap({ points, title = 'Case map' }: { points: MapPoint[]; title?: string }) {
  const key = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<Array<{ setMap(m: GMap | null): void }>>([]);
  const [failed, setFailed] = useState(false);

  // De-dup points that resolve to (nearly) the same coordinate.
  const uniq: MapPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (uniq.some((u) => Math.abs(u.lat - p.lat) < 1e-4 && Math.abs(u.lng - p.lng) < 1e-4)) continue;
    uniq.push(p);
  }
  const sig = uniq.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');

  useEffect(() => {
    if (!key || !boxRef.current || uniq.length === 0) return;
    let cancelled = false;
    loadMaps(key)
      .then(() => {
        const maps = gmaps();
        if (cancelled || !maps || !boxRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(boxRef.current, {
            styles: MAP_STYLE,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: 'cooperative',
            backgroundColor: '#f4f1ea',
          });
        }
        const map = mapRef.current;
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        const info = new maps.InfoWindow({});
        for (const p of uniq) {
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.label,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: p.source === 'gps' ? '#0f2d24' : '#c9a227',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          });
          maps.event.addListener(marker, 'click', () => {
            (info as unknown as { setContent(c: string): void }).setContent(
              `<div style="font:500 12px/1.4 system-ui;color:#0f2d24;max-width:220px">${escapeHtml(p.label)}</div>`,
            );
            info.open(map, marker);
          });
          markersRef.current.push(marker);
        }
        if (uniq.length === 1) {
          map.setCenter({ lat: uniq[0].lat, lng: uniq[0].lng });
          map.setZoom(14);
        } else {
          const bounds = new maps.LatLngBounds();
          uniq.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
          map.fitBounds(bounds, 48);
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sig]);

  if (!key || uniq.length === 0 || failed) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-forest-900/10 bg-white shadow-card dark:border-cream-50/10 dark:bg-forest-900/50">
      <div className="flex items-center justify-between border-b border-forest-900/10 bg-forest-900/[0.02] px-5 py-3 dark:border-cream-50/10 dark:bg-cream-50/[0.03]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-500">{title}</p>
        <p className="text-xs text-ink-500 dark:text-cream-300/70">
          {uniq.length} {uniq.length === 1 ? 'location' : 'locations'}
        </p>
      </div>
      <div ref={boxRef} className="h-72 w-full" data-no-translate />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[11px] text-ink-500 dark:text-cream-300/70">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#c9a227] ring-1 ring-white" />Named place</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0f2d24] ring-1 ring-white" />File GPS</span>
      </div>
    </section>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
