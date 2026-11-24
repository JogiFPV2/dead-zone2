/**
 * Game world → WGS84 → OpenStreetMap tile coordinates for the second HUD map (Ustawienia ›
 * Interfejs › Mapa OpenStreetMap). Only `stw2` sits on the real Earth: its world is the map2
 * local frame (tools/map2/src/project.ts: ellipsoidal transverse Mercator centred on KEN ×
 * Okulickiego, x east, y south) shifted by STW2_OFFSET (tools/map2/src/to-osm.ts).
 */
export interface LonLat {
  lon: number;
  lat: number;
}

/** map2 origin (STW_ORIGIN) and the stw2 world shift (STW2_OFFSET), copied from tools/map2. */
export const STW2_ORIGIN: LonLat = { lon: 22.0535, lat: 50.5825 };
export const STW2_OFFSET = { x: 17000, z: 19000 } as const;

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

function meridianArc(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

/** Transverse Mercator (k0 = 1), same formulas as tools/map2 `tmForward`. */
export function tmForward(lon: number, lat: number, lon0: number): [number, number] {
  const phi = lat * RAD;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = (lon - lon0) * RAD * c;
  const x =
    n *
    (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y =
    meridianArc(phi) +
    n *
      t *
      ((a * a) / 2 +
        ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 +
        ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720);
  return [x, y];
}

/** map2 local metres (x east, y south) of a WGS84 point. */
export function toLocal(p: LonLat, origin: LonLat = STW2_ORIGIN): [number, number] {
  const [, y0] = tmForward(origin.lon, origin.lat, origin.lon);
  const [x, y] = tmForward(p.lon, p.lat, origin.lon);
  return [x, y0 - y];
}

/** Inverse of `toLocal` (a few Newton steps; under 1 mm over the 30 km map). */
export function fromLocal(x: number, y: number, origin: LonLat = STW2_ORIGIN): LonLat {
  let lat = origin.lat - y / 111_200;
  let lon = origin.lon + x / (111_320 * Math.cos(lat * RAD));
  const d = 1e-5;
  for (let i = 0; i < 6; i++) {
    const [fx, fy] = toLocal({ lon, lat }, origin);
    const ex = x - fx;
    const ey = y - fy;
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    // Numeric Jacobian (the frame is nearly orthogonal here, but keep the cross terms).
    const [ax, ay] = toLocal({ lon: lon + d, lat }, origin);
    const [bx, by] = toLocal({ lon, lat: lat + d }, origin);
    const j11 = (ax - fx) / d;
    const j21 = (ay - fy) / d;
    const j12 = (bx - fx) / d;
    const j22 = (by - fy) / d;
    const det = j11 * j22 - j12 * j21;
    lon += (ex * j22 - ey * j12) / det;
    lat += (ey * j11 - ex * j21) / det;
  }
  return { lon, lat };
}

/** stw2 world (x east, z south, metres) → WGS84. */
export const stw2WorldToLonLat = (x: number, z: number): LonLat =>
  fromLocal(x - STW2_OFFSET.x, z - STW2_OFFSET.z);

/** Web Mercator tile coordinates (fractional) of a point at zoom `z` (OSM slippy map). */
export function lonLatToTile(p: LonLat, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const phi = p.lat * RAD;
  return {
    x: ((p.lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n,
  };
}

/** Ground metres per CSS pixel of a 256 px tile at `lat`, zoom `z`. */
export const metresPerPx = (lat: number, z: number): number =>
  (156_543.033_92 * Math.cos(lat * RAD)) / 2 ** z;
