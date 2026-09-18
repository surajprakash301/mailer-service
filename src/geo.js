/**
 * Loky Patna screen corridors — used as geofence centers for Maps + SERP queries.
 * Lat/lng approximate CBD / arterial midpoints (WGS84).
 */
export const LOKY_GEO_FENCES = [
  {
    id: "dakbangla_fraser",
    label: "Dakbangla Chauraha / Fraser Road",
    lat: 25.6095,
    lng: 85.1415,
    radiusM: 3000,
  },
  {
    id: "boring_road",
    label: "Boring Road",
    lat: 25.6175,
    lng: 85.1165,
    radiusM: 2800,
  },
  {
    id: "rukanpura",
    label: "Rukanpura / Jagdeo Path",
    lat: 25.607,
    lng: 85.068,
    radiusM: 3000,
  },
  {
    id: "mithapur",
    label: "Mithapur Bypass / Patna Junction approach",
    lat: 25.594,
    lng: 85.137,
    radiusM: 3000,
  },
  {
    id: "danapur",
    label: "Danapur Station corridor",
    lat: 25.634,
    lng: 85.046,
    radiusM: 3200,
  },
];

export function fenceLabels() {
  return LOKY_GEO_FENCES.map((f) => f.label).join("; ");
}

/** Rotate fences so gather waves diversify corridors. */
export function pickFences(count = 3) {
  const n = Math.max(1, Math.min(Number(count) || 3, LOKY_GEO_FENCES.length));
  const day = Math.floor(Date.now() / 86_400_000);
  const start = day % LOKY_GEO_FENCES.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(LOKY_GEO_FENCES[(start + i) % LOKY_GEO_FENCES.length]);
  }
  return out;
}
