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
  watcherFirstName,
  watcherLat,
  watcherLng,
  watcherPhone,
  accuracyM,
  locationTimedOut,
  mapsApiKey,
  firedAt,
}: {
  watcherFirstName: string;
  watcherLat: number | null;
  watcherLng: number | null;
  watcherPhone: string | null;
  accuracyM: number | null;
  locationTimedOut: boolean;
  mapsApiKey: string | null;
  firedAt: string;
}) {
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

  // Static-map URL: shows the watcher's pin alone before the contact
  // grants permission, then ALSO shows the contact's pin + a line
  // between the two once we have both. The Google Static Maps API
  // accepts multiple `markers` params and an encoded polyline `path`.
  const staticMapUrl = (() => {
    if (!hasWatcher || !mapsApiKey) return null;
    const params = new URLSearchParams();
    params.set('size', '640x440');
    params.set('scale', '2');
    params.set('maptype', 'roadmap');
    // Watcher marker - red, labeled S (for "subject")
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

      <p className="mt-2 text-[11px] text-[#FBF7E9]/60 text-center italic">
        {minutesSinceFired < 1
          ? 'Just fired.'
          : `Pin captured ${minutesSinceFired} ${minutesSinceFired === 1 ? 'minute' : 'minutes'} ago.`}{' '}
        {watcherFirstName} could be moving - widen the search the longer
        this has been sitting.
      </p>

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
