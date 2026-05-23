'use client';

import { useEffect, useState } from 'react';

/**
 * LiveTracker - client component for /safe/alert/[id].
 *
 * Renders:
 *   - the static map preview (works without JS / before the geo
 *     permission prompt)
 *   - a one-tap "share my live location" button that asks for
 *     navigator.geolocation permission, computes distance + bearing
 *     to the watcher's last-known fix, and updates live
 *   - the quick-action button row that mirrors the email:
 *     Call 911, Get directions, Call watcher, Hospitals, Police
 *
 * The watcher's position is a single point in time. The contact's
 * position updates as they move toward the watcher, so the page
 * shows a live "you are 0.8 km away" that gets smaller as they
 * approach. Future work: long-poll for updated watcher positions
 * once we ship continuous location reporting from the watch.
 */
export function LiveTracker({
  alertId,
  watcherFirstName,
  watcherLat: initialWatcherLat,
  watcherLng: initialWatcherLng,
  watcherPhone,
  accuracyM: initialAccuracyM,
  locationTimedOut,
  mapsApiKey,
  firedAt,
  initialLiveTracking,
}: {
  alertId: string;
  watcherFirstName: string;
  watcherLat: number | null;
  watcherLng: number | null;
  watcherPhone: string | null;
  accuracyM: number | null;
  locationTimedOut: boolean;
  mapsApiKey: string | null;
  firedAt: string;
  initialLiveTracking: boolean;
}) {
  // Live-pin polling. The static map / static accuracy below are
  // initial values from the alert row; as new pings stream in we
  // override the active watcher position to the latest one and feed
  // a breadcrumb trail (up to the last ~20 points) into the
  // static-map polyline so the contact sees a path, not just a dot.
  type Ping = {
    lat: number;
    lng: number;
    accuracyM: number | null;
    t: string; // ISO timestamp
  };
  const [pings, setPings] = useState<Ping[]>([]);
  const [tracking, setTracking] = useState<{
    live: boolean;
    stoppedAt: string | null;
  }>({ live: initialLiveTracking, stoppedAt: null });
  // Latest server timestamp we've already pulled. Used as the since=
  // param on subsequent polls so we transfer 0-2 rows in the steady
  // state instead of the full trail every 5 seconds.
  const [lastSeenT, setLastSeenT] = useState<string | null>(null);

  useEffect(() => {
    // Don't bother polling once tracking is known-stopped; a manual
    // refresh of the page is the right way to revisit a frozen
    // trail.
    if (!tracking.live) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const sinceParam = lastSeenT
          ? `?since=${encodeURIComponent(lastSeenT)}`
          : '';
        const r = await fetch(
          `/api/safe/alert/${alertId}/positions${sinceParam}`,
          { cache: 'no-store' },
        );
        if (!r.ok) return;
        const j = (await r.json()) as {
          pings: Array<{
            lat: number;
            lng: number;
            accuracy_m: number | null;
            t: string;
          }>;
          tracking: {
            live: boolean;
            stopped_at: string | null;
          };
        };
        if (cancelled) return;
        if (Array.isArray(j.pings) && j.pings.length > 0) {
          setPings((prev) => {
            const merged = [
              ...prev,
              ...j.pings.map((p) => ({
                lat: p.lat,
                lng: p.lng,
                accuracyM: p.accuracy_m,
                t: p.t,
              })),
            ];
            // Cap at last 60 pings (~30 min @ 30s) so the static-map
            // URL stays under the URL length cap and the polyline
            // doesn't drown out the map at small zoom levels.
            return merged.slice(-60);
          });
          setLastSeenT(j.pings[j.pings.length - 1]!.t);
        }
        if (j.tracking && j.tracking.live === false) {
          setTracking({ live: false, stoppedAt: j.tracking.stopped_at });
        }
      } catch {
        // Network blip is fine - we'll retry on the next interval.
      }
    };
    // First fetch on mount + every 5s thereafter.
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [alertId, lastSeenT, tracking.live]);

  // Active watcher position: latest ping if any, otherwise the
  // alert-fire location passed in as initial props.
  const latestPing = pings[pings.length - 1] ?? null;
  const watcherLat = latestPing?.lat ?? initialWatcherLat;
  const watcherLng = latestPing?.lng ?? initialWatcherLng;
  const accuracyM = latestPing?.accuracyM ?? initialAccuracyM;
  type ContactPos = {
    lat: number;
    lng: number;
    accuracyM: number;
    capturedAt: number;
  };
  const [contactPos, setContactPos] = useState<ContactPos | null>(null);
  const [geoState, setGeoState] = useState<
    'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  >('idle');
  const [geoError, setGeoError] = useState<string | null>(null);

  // When the contact taps "share my location", start a continuous
  // watcher that updates the contact's position. We keep watching
  // for the lifetime of the page so the distance read-out tracks as
  // they walk / drive toward the watcher.
  useEffect(() => {
    if (geoState !== 'requesting') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoState('unavailable');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setContactPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          capturedAt: pos.timestamp,
        });
        setGeoState('granted');
        setGeoError(null);
      },
      (err) => {
        setGeoError(err.message || 'Could not access your location.');
        if (err.code === err.PERMISSION_DENIED) {
          setGeoState('denied');
        } else {
          setGeoState('unavailable');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoState]);

  const hasWatcher = watcherLat !== null && watcherLng !== null;

  // Seconds elapsed between an ISO timestamp and a wall-clock value
  // (used for the "Last update Xs ago" caption on the live indicator).
  function secondsSince(iso: string, nowMs: number): number {
    const t = new Date(iso).getTime();
    return Math.max(0, Math.floor((nowMs - t) / 1000));
  }

  // Haversine distance in meters between two lat/lng pairs.
  function haversineMeters(
    aLat: number,
    aLng: number,
    bLat: number,
    bLng: number,
  ): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const distanceM =
    hasWatcher && contactPos
      ? haversineMeters(contactPos.lat, contactPos.lng, watcherLat!, watcherLng!)
      : null;
  const distanceLabel =
    distanceM === null
      ? null
      : distanceM < 1000
        ? `${Math.round(distanceM)} m`
        : `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 2 : 1)} km`;

  // Static-map URL: shows the watcher's current pin (latest ping or
  // alert-fire fallback), the breadcrumb trail of recent pings as a
  // polyline, the contact's pin when they opt in, and a line between
  // the contact and the watcher. Google Static Maps accepts multiple
  // `markers` and `path` params.
  const staticMapUrl = (() => {
    if (!hasWatcher || !mapsApiKey) return null;
    const params = new URLSearchParams();
    params.set('size', '640x440');
    params.set('scale', '2');
    params.set('maptype', 'roadmap');
    // Breadcrumb trail: gold polyline through the last N pings.
    // We only draw it when there are at least 2 points; below
    // that there's nothing to "trail."
    if (pings.length >= 2) {
      const trail = pings
        .slice(-30)
        .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
        .join('|');
      // Soft gold trail behind the live pin so the current pin still
      // stands out. weight:3 reads as a line at all zooms.
      params.append('path', `color:0xE6CE93BB|weight:3|${trail}`);
    }
    // Watcher marker - red, labeled S (for "subject"). This is the
    // *current* position (latest ping or alert-fire fallback).
    params.append('markers', `color:red|label:S|${watcherLat},${watcherLng}`);
    if (contactPos) {
      // Contact marker - gold, labeled Y (for "you")
      params.append(
        'markers',
        `color:0xE6CE93|label:Y|${contactPos.lat},${contactPos.lng}`,
      );
      // Line from contact to watcher
      params.append(
        'path',
        `color:0xE5816B|weight:3|${contactPos.lat},${contactPos.lng}|${watcherLat},${watcherLng}`,
      );
      // Auto-fit the bounds: we let Google figure the center + zoom
      // by NOT passing center/zoom so both pins fit.
    } else {
      params.set('center', `${watcherLat},${watcherLng}`);
      params.set('zoom', accuracyM && accuracyM > 150 ? '13' : '15');
    }
    params.set('key', mapsApiKey);
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  })();

  const mapLink = hasWatcher
    ? `https://www.google.com/maps?q=${watcherLat},${watcherLng}`
    : null;
  const directionsLink = hasWatcher
    ? `https://www.google.com/maps/dir/?api=1&destination=${watcherLat},${watcherLng}&travelmode=driving`
    : null;
  const hospitalsLink = hasWatcher
    ? `https://www.google.com/maps/search/hospital/@${watcherLat},${watcherLng},15z`
    : `https://www.google.com/maps/search/hospital`;
  const policeLink = hasWatcher
    ? `https://www.google.com/maps/search/police+station/@${watcherLat},${watcherLng},15z`
    : `https://www.google.com/maps/search/police+station`;
  const callWatcherLink =
    watcherPhone && /^\+[1-9]\d{1,14}$/.test(watcherPhone)
      ? `tel:${watcherPhone}`
      : null;

  // Time since the alert fired - the older it gets, the wider the
  // realistic search radius. We show this as a small italic line
  // under the map so the contact has a concrete sense of staleness.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);
  const minutesSinceFired = Math.floor(
    (now - new Date(firedAt).getTime()) / 60_000,
  );

  const APPROX_THRESHOLD_M = 150;
  const locationIsConfident =
    hasWatcher &&
    !locationTimedOut &&
    accuracyM !== null &&
    accuracyM <= APPROX_THRESHOLD_M;

  return (
    <div>
      {hasWatcher && !locationIsConfident && (
        <div className="mb-3 p-3 rounded-lg bg-[#E5816B]/15 border-l-[3px] border-[#E5816B]">
          <p className="text-[13px] font-semibold leading-snug">
            {locationTimedOut
              ? 'Approximate location - GPS could not lock.'
              : 'Approximate location - low-confidence fix.'}
          </p>
          <p className="text-[12px] text-[#FBF7E9]/80 leading-snug mt-1">
            The pin could be off by up to{' '}
            <strong>
              {accuracyM
                ? accuracyM < 1000
                  ? `${Math.round(accuracyM)} m`
                  : `${(accuracyM / 1000).toFixed(1)} km`
                : 'a wide radius'}
            </strong>
            . Treat the surrounding blocks as the search area.
          </p>
        </div>
      )}

      {staticMapUrl && mapLink ? (
        <a href={mapLink} target="_blank" rel="noreferrer" className="block">
          <img
            src={staticMapUrl}
            alt={`${watcherFirstName}'s last known location`}
            className="w-full rounded-xl border-[3px] border-[#E5816B] block"
          />
        </a>
      ) : hasWatcher ? (
        <div className="p-4 rounded-xl bg-[#FBF7E9]/5 border border-[#E6CE93]/25">
          <p className="text-[13px]">
            Map preview unavailable. Tap{' '}
            <a
              href={mapLink ?? '#'}
              className="underline text-[#E6CE93]"
              target="_blank"
              rel="noreferrer"
            >
              View location
            </a>{' '}
            to open in Maps.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-[#FBF7E9]/5">
          <p className="text-[13px] text-[#FBF7E9]/80">
            No location was captured with this alert. Call{' '}
            {watcherFirstName} directly if you can.
          </p>
        </div>
      )}

      {/* Status line: when live tracking is on, anchor the freshness
          to the latest ping. When it's stopped, fall back to the
          original alert-fire time. */}
      <div className="mt-2 text-center">
        {tracking.live ? (
          <p className="text-[11px] text-emerald-300 inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
            />
            Live tracking on.
            {latestPing
              ? ` Last update ${
                  secondsSince(latestPing.t, now) < 60
                    ? 'just now'
                    : `${Math.floor(secondsSince(latestPing.t, now) / 60)} min ago`
                }.`
              : ' Waiting for the next ping…'}
          </p>
        ) : (
          <p className="text-[11px] text-[#FBF7E9]/60 italic">
            Live tracking stopped
            {tracking.stoppedAt
              ? ` ${Math.max(0, Math.floor((now - new Date(tracking.stoppedAt).getTime()) / 60_000))} min ago`
              : ''}
            . Pin is the last known location -{' '}
            {watcherFirstName} could be moving from there.
          </p>
        )}
        {!tracking.live && minutesSinceFired >= 1 && (
          <p className="mt-1 text-[11px] text-[#FBF7E9]/45">
            Alert fired {minutesSinceFired} {minutesSinceFired === 1 ? 'minute' : 'minutes'} ago.
          </p>
        )}
      </div>

      {/* Live-distance widget. Hidden until the contact opts in. */}
      <div className="mt-4 rounded-xl bg-[#FBF7E9]/5 p-4">
        {geoState === 'idle' && (
          <>
            <p className="text-[13px] text-[#FBF7E9]/90 mb-2 leading-snug">
              Want a live distance read-out as you head toward{' '}
              {watcherFirstName}?
            </p>
            <button
              type="button"
              onClick={() => setGeoState('requesting')}
              className="block w-full px-4 py-3 rounded-lg bg-[#E6CE93] text-[#0B1F19] font-semibold text-[14px]"
            >
              Share my location
            </button>
            <p className="text-[10.5px] text-[#FBF7E9]/55 mt-2 leading-snug">
              Your browser will ask permission. Your location stays in this
              page and is never sent to Advottic servers.
            </p>
          </>
        )}
        {geoState === 'requesting' && (
          <p className="text-[13px] text-[#FBF7E9]/80">
            Waiting for your browser&hellip;
          </p>
        )}
        {geoState === 'granted' && contactPos && distanceLabel && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#FBF7E9]/55 mb-1">
              You are about
            </p>
            <p className="text-[32px] font-semibold text-[#E6CE93]">
              {distanceLabel}
            </p>
            <p className="text-[12px] text-[#FBF7E9]/75 leading-snug">
              from {watcherFirstName}&rsquo;s last known location. Updating
              live as you move.
            </p>
          </div>
        )}
        {(geoState === 'denied' || geoState === 'unavailable') && (
          <p className="text-[13px] text-[#FBF7E9]/80 leading-snug">
            {geoError ??
              'Could not access your location. You can still use Get directions below.'}
          </p>
        )}
      </div>

      {/* Quick action buttons */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <a
          href="tel:911"
          className="block text-center px-3 py-3 rounded-lg bg-[#E5816B] text-[#FBF7E9] font-bold text-[14px]"
        >
          Call 911
        </a>
        {directionsLink ? (
          <a
            href={directionsLink}
            target="_blank"
            rel="noreferrer"
            className="block text-center px-3 py-3 rounded-lg bg-[#E6CE93] text-[#0B1F19] font-bold text-[14px]"
          >
            Get directions
          </a>
        ) : (
          <span className="block text-center px-3 py-3 rounded-lg bg-[#E6CE93]/15 text-[#FBF7E9]/40 text-[12px]">
            No location
          </span>
        )}
        {callWatcherLink ? (
          <a
            href={callWatcherLink}
            className="block text-center px-3 py-3 rounded-lg bg-[#E6CE93]/18 text-[#E6CE93] font-bold text-[14px]"
          >
            Call {watcherFirstName}
          </a>
        ) : (
          <span className="block text-center px-3 py-3 rounded-lg bg-[#E6CE93]/05 text-[#FBF7E9]/30 text-[12px]">
            No phone on file
          </span>
        )}
        <a
          href={hospitalsLink}
          target="_blank"
          rel="noreferrer"
          className="block text-center px-3 py-3 rounded-lg bg-[#E5816B]/15 text-[#FBF7E9] font-semibold text-[13px]"
        >
          Hospitals nearby
        </a>
        <a
          href={policeLink}
          target="_blank"
          rel="noreferrer"
          className="block text-center px-3 py-3 rounded-lg bg-[#E5816B]/15 text-[#FBF7E9] font-semibold text-[13px]"
        >
          Police nearby
        </a>
        {mapLink && (
          <a
            href={mapLink}
            target="_blank"
            rel="noreferrer"
            className="block text-center px-3 py-3 rounded-lg bg-[#E6CE93]/10 text-[#E6CE93] font-semibold text-[13px]"
          >
            View location
          </a>
        )}
      </div>
    </div>
  );
}
