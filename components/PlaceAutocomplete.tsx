'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Minimal local types for the bits of the Google Maps JS API we
// use. Hand-rolled to avoid a 700 KB @types/google.maps dependency
// for what is really a handful of methods on a single widget.
type GmAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};
type GmLatLng = { lat: () => number; lng: () => number };
type GmPlaceResult = {
  address_components?: GmAddressComponent[];
  formatted_address?: string;
  name?: string;
  place_id?: string;
  geometry?: { location?: GmLatLng };
};
type GmLatLngBounds = unknown;
type GmAutocompleteOptions = {
  types?: string[];
  componentRestrictions?: { country: string[] };
  bounds?: GmLatLngBounds;
  strictBounds?: boolean;
  fields?: string[];
};
type GmAutocomplete = {
  getPlace: () => GmPlaceResult | undefined;
  addListener: (
    event: 'place_changed',
    handler: () => void,
  ) => { remove: () => void };
};
type GmGlobal = {
  google?: {
    maps?: {
      places?: { Autocomplete: new (input: HTMLInputElement, opts?: GmAutocompleteOptions) => GmAutocomplete };
      LatLngBounds?: new (sw: { lat: number; lng: number }, ne: { lat: number; lng: number }) => GmLatLngBounds;
    };
  };
};

/**
 * Single-instance Google Maps JS loader. Lazy-loaded the first time
 * any <PlaceAutocomplete /> mounts so a /pricing page doesn't pay
 * for the Places library it never uses. All instances share the
 * same window.google.maps.* runtime once loaded.
 */
let loaderPromise: Promise<void> | null = null;
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  // Already loaded by a previous mount or some other component
  // (e.g. an embed)? Short-circuit.
  if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) {
    loaderPromise = Promise.resolve();
    return loaderPromise;
  }
  loaderPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&loading=async&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

/**
 * Parsed Google Places address components in flat form. Filled when
 * a place is selected; null for fields the chosen place didn't
 * supply (e.g. a country result has no `locality`).
 */
export type AutocompletePlace = {
  formatted_address: string;
  /** Lat/lng of the picked place. Useful for the hearing-court
   *  bias-by-jurisdiction case. */
  lat: number | null;
  lng: number | null;
  country: string | null;
  country_code: string | null;
  administrative_area_level_1: string | null;
  administrative_area_level_1_code: string | null;
  administrative_area_level_2: string | null;
  locality: string | null;
  postal_code: string | null;
  street_address: string | null;
  /** Raw Place to allow callers to inspect anything we didn't parse. */
  place_id: string | null;
};

function parsePlace(
  p: GmPlaceResult,
): AutocompletePlace {
  const flat: AutocompletePlace = {
    formatted_address: p.formatted_address ?? p.name ?? '',
    lat: p.geometry?.location?.lat() ?? null,
    lng: p.geometry?.location?.lng() ?? null,
    country: null,
    country_code: null,
    administrative_area_level_1: null,
    administrative_area_level_1_code: null,
    administrative_area_level_2: null,
    locality: null,
    postal_code: null,
    street_address: null,
    place_id: p.place_id ?? null,
  };
  for (const c of p.address_components ?? []) {
    if (c.types.includes('country')) {
      flat.country = c.long_name;
      flat.country_code = c.short_name;
    } else if (c.types.includes('administrative_area_level_1')) {
      flat.administrative_area_level_1 = c.long_name;
      flat.administrative_area_level_1_code = c.short_name;
    } else if (c.types.includes('administrative_area_level_2')) {
      flat.administrative_area_level_2 = c.long_name;
    } else if (c.types.includes('locality')) {
      flat.locality = c.long_name;
    } else if (c.types.includes('postal_code')) {
      flat.postal_code = c.long_name;
    } else if (
      c.types.includes('street_address') ||
      c.types.includes('route') ||
      c.types.includes('premise')
    ) {
      // Concatenate street_number + route if both present (handled
      // by formatted_address normally, but useful as a separate
      // field for some callers).
      flat.street_address = flat.street_address
        ? `${flat.street_address} ${c.long_name}`
        : c.long_name;
    }
  }
  return flat;
}

/**
 * Single-line input that hooks up to a Google Places Autocomplete.
 *
 * Props:
 *   - types: optional Places type restriction. Examples:
 *       ['(regions)']     - countries, states, cities, neighborhoods
 *       ['(cities)']      - cities + locality
 *       ['country']       - just countries
 *       ['address']       - full street addresses
 *       ['establishment'] - businesses + landmarks + courts
 *   - countryRestrictions: 2-letter country codes to scope to. Use
 *     when narrowing a state/city autocomplete to a chosen country.
 *   - locationBiasLatLng: approximate center to prefer in results.
 *     Used to keep "Hennepin County District Court" results focused
 *     on the user's jurisdiction.
 *   - onPlace: fires when the user picks a suggestion. Carries the
 *     parsed AutocompletePlace.
 *   - onChange: fires on every keystroke. Just the input value.
 *
 * Gracefully degrades to a plain <input> when:
 *   - NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is unset (build/dev env)
 *   - The Maps script fails to load (offline / CSP / referrer block)
 * In both cases the input stays usable with manual typing.
 */
export function PlaceAutocomplete({
  name,
  required,
  defaultValue,
  placeholder,
  className,
  types,
  countryRestrictions,
  locationBiasLatLng,
  locationBiasRadiusM,
  onPlace,
  onChange,
  inputMode,
  autoComplete,
  fallbackHint,
}: {
  name?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  types?: string[];
  countryRestrictions?: string[];
  locationBiasLatLng?: { lat: number; lng: number };
  locationBiasRadiusM?: number;
  onPlace?: (place: AutocompletePlace) => void;
  onChange?: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  /** Optional hint shown under the input when we've fallen back
   *  to a plain text input (e.g. "Type the full address."). */
  fallbackHint?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const acRef = useRef<GmAutocomplete | null>(null);
  const w = (typeof window !== 'undefined' ? (window as unknown as GmGlobal) : ({} as GmGlobal));
  const [value, setValue] = useState(defaultValue ?? '');
  const [fallback, setFallback] = useState(false);
  const apiKey =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? ''
      : '';

  // Re-broadcast value upward when the user types. We deliberately
  // do NOT call onPlace here - that fires only when a suggestion is
  // chosen, so callers can distinguish "free-typed" from "verified
  // place."
  const setVal = useCallback(
    (v: string) => {
      setValue(v);
      onChange?.(v);
    },
    [onChange],
  );

  useEffect(() => {
    if (!apiKey) {
      setFallback(true);
      return;
    }
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current) return;
        const win = window as unknown as GmGlobal;
        const ACtor = win.google?.maps?.places?.Autocomplete;
        if (!ACtor) {
          setFallback(true);
          return;
        }
        const options: GmAutocompleteOptions = {};
        if (types && types.length > 0) options.types = types;
        if (countryRestrictions && countryRestrictions.length > 0) {
          options.componentRestrictions = {
            country: countryRestrictions.map((c) => c.toLowerCase()),
          };
        }
        if (locationBiasLatLng) {
          const radius = locationBiasRadiusM ?? 50_000;
          const LLBCtor = win.google?.maps?.LatLngBounds;
          if (LLBCtor) {
            options.bounds = new LLBCtor(
              {
                lat: locationBiasLatLng.lat - radius / 111_000,
                lng:
                  locationBiasLatLng.lng -
                  radius / (111_000 * Math.cos((locationBiasLatLng.lat * Math.PI) / 180)),
              },
              {
                lat: locationBiasLatLng.lat + radius / 111_000,
                lng:
                  locationBiasLatLng.lng +
                  radius / (111_000 * Math.cos((locationBiasLatLng.lat * Math.PI) / 180)),
              },
            );
            options.strictBounds = false;
          }
        }
        // We only need a small set of fields to keep billing low -
        // each requested field shapes the SKU.
        options.fields = [
          'address_components',
          'formatted_address',
          'geometry.location',
          'name',
          'place_id',
        ];
        const ac = new ACtor(inputRef.current, options);
        acRef.current = ac;
        const listener = ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place) return;
          const flat = parsePlace(place);
          // Keep the visible value aligned with the selected
          // place's formatted address so the user sees the
          // confirmed text, not the half-typed query.
          if (flat.formatted_address) {
            setVal(flat.formatted_address);
            if (inputRef.current)
              inputRef.current.value = flat.formatted_address;
          }
          onPlace?.(flat);
        });
        return () => listener.remove();
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      // Best-effort detach; google.maps doesn't expose a clean
      // dispose for Autocomplete, but releasing our ref is enough
      // for it to be GC'd along with the input.
      acRef.current = null;
    };
  }, [
    apiKey,
    types,
    countryRestrictions,
    locationBiasLatLng,
    locationBiasRadiusM,
    onPlace,
    setVal,
  ]);

  return (
    <>
      <input
        ref={inputRef}
        id={`pa-${id}`}
        name={name}
        type="text"
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={className}
        inputMode={inputMode}
        autoComplete={autoComplete ?? 'off'}
        value={value}
        onChange={(e) => setVal(e.target.value)}
      />
      {fallback && fallbackHint && (
        <p className="mt-1 text-[11px] text-ink-500 leading-snug">
          {fallbackHint}
        </p>
      )}
    </>
  );
}
