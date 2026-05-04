/**
 * Approximate latitude/longitude centroid for each US state + DC +
 * federal-courts placeholder. Used by /file-exhibits and other
 * jurisdiction pickers to surface the state closest to the user
 * when they grant geolocation.
 *
 * Numbers are courthouse-of-the-capital, rounded to 2 decimals.
 * Good enough for a "closest state" sort - not for navigation.
 *
 * Source: US Census Bureau state-capital geographic centroids.
 * Federal ("FED") is not bound to a single point; we use Washington,
 * D.C. as a stand-in so it sorts reasonably for east-coast users
 * who are most likely to file federal.
 */

export const STATE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  FED: { lat: 38.89, lng: -77.04 }, // Washington, D.C. (federal)
  AL: { lat: 32.38, lng: -86.3 },
  AK: { lat: 58.3, lng: -134.42 },
  AZ: { lat: 33.45, lng: -112.07 },
  AR: { lat: 34.74, lng: -92.33 },
  CA: { lat: 38.58, lng: -121.49 },
  CO: { lat: 39.74, lng: -104.99 },
  CT: { lat: 41.76, lng: -72.68 },
  DE: { lat: 39.16, lng: -75.52 },
  DC: { lat: 38.91, lng: -77.04 },
  FL: { lat: 30.44, lng: -84.28 },
  GA: { lat: 33.75, lng: -84.39 },
  HI: { lat: 21.3, lng: -157.86 },
  ID: { lat: 43.61, lng: -116.2 },
  IL: { lat: 39.78, lng: -89.65 },
  IN: { lat: 39.77, lng: -86.16 },
  IA: { lat: 41.59, lng: -93.62 },
  KS: { lat: 39.05, lng: -95.68 },
  KY: { lat: 38.2, lng: -84.87 },
  LA: { lat: 30.45, lng: -91.19 },
  ME: { lat: 44.31, lng: -69.78 },
  MD: { lat: 38.97, lng: -76.5 },
  MA: { lat: 42.36, lng: -71.06 },
  MI: { lat: 42.73, lng: -84.55 },
  MN: { lat: 44.95, lng: -93.09 },
  MS: { lat: 32.3, lng: -90.18 },
  MO: { lat: 38.58, lng: -92.17 },
  MT: { lat: 46.59, lng: -112.04 },
  NE: { lat: 40.81, lng: -96.68 },
  NV: { lat: 39.16, lng: -119.77 },
  NH: { lat: 43.21, lng: -71.54 },
  NJ: { lat: 40.22, lng: -74.77 },
  NM: { lat: 35.69, lng: -105.94 },
  NY: { lat: 42.65, lng: -73.76 },
  NC: { lat: 35.78, lng: -78.64 },
  ND: { lat: 46.81, lng: -100.78 },
  OH: { lat: 39.96, lng: -82.99 },
  OK: { lat: 35.49, lng: -97.51 },
  OR: { lat: 44.94, lng: -123.03 },
  PA: { lat: 40.27, lng: -76.88 },
  RI: { lat: 41.83, lng: -71.42 },
  SC: { lat: 34.0, lng: -81.03 },
  SD: { lat: 44.37, lng: -100.35 },
  TN: { lat: 36.16, lng: -86.78 },
  TX: { lat: 30.27, lng: -97.74 },
  UT: { lat: 40.77, lng: -111.89 },
  VT: { lat: 44.26, lng: -72.58 },
  VA: { lat: 37.54, lng: -77.43 },
  WA: { lat: 47.04, lng: -122.9 },
  WV: { lat: 38.34, lng: -81.61 },
  WI: { lat: 43.07, lng: -89.4 },
  WY: { lat: 41.14, lng: -104.82 },
  PR: { lat: 18.47, lng: -66.11 },
  VI: { lat: 18.34, lng: -64.93 },
  GU: { lat: 13.44, lng: -144.79 },
};

/**
 * Haversine distance in kilometers between two lat/lng points.
 * Earth radius 6371km is the geometric-mean radius used by most
 * geo libraries. Approximation, not survey-grade.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
