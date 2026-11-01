/**
 * One local metric frame for the whole map: ellipsoidal transverse Mercator (WGS84, Snyder 1987,
 * scale 1 on the central meridian) centred on `origin`. x grows east, y grows south (tile rows),
 * both in metres; (0, 0) is the origin. Over ±20 km the scale error is below 5 ppm (≈ 0,1 m).
 */
export interface Origin {
  lon: number;
  lat: number;
}

/** Map origin: Stalowa Wola, crossing of KEN and Okulickiego (shared by every stage). */
export const STW_ORIGIN: Origin = { lon: 22.0535, lat: 50.5825 };

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

/** Raw transverse Mercator (easting, northing) relative to the central meridian / equator. */
export function tmForward(lon: number, lat: number, lon0: number, k0 = 1): [number, number] {
  const phi = lat * RAD;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = (lon - lon0) * RAD * c;
  const x =
    k0 *
    n *
    (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y =
    k0 *
    (meridianArc(phi) +
      n *
        t *
        ((a * a) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

export interface Projection {
  readonly origin: Origin;
  /** WGS84 → local metres (x east, y south), rounded to 1 cm. */
  toLocal(lon: number, lat: number): [number, number];
}

export function projection(origin: Origin = STW_ORIGIN): Projection {
  const [, y0] = tmForward(origin.lon, origin.lat, origin.lon);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    origin,
    toLocal(lon, lat) {
      const [x, y] = tmForward(lon, lat, origin.lon);
      return [r(x), r(y0 - y)];
    },
  };
}
