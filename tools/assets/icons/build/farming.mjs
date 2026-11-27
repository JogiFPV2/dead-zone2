/* global console */
// Low-poly icon models for the farming items (25.11.2026): hoe, rake, watering can, bucket,
// glass, seed packets and five crops. Original work for Deadzone, CC0 1.0.
// Run from tools/assets: `node icons/build/farming.mjs` → icons/src/custom/uprawa-*.glb.
// Flat shading (faceted, unindexed triangles) and flat colours, like the other custom icons.
import { Document, NodeIO } from '@gltf-transform/core';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'custom');

// ---- tiny 3D helpers ------------------------------------------------------------------------
const rad = (d) => (d * Math.PI) / 180;
/** 3×3 rotation (XYZ, degrees) applied after scale, then translation. */
function xform({ s = [1, 1, 1], r = [0, 0, 0], t = [0, 0, 0] } = {}) {
  const [a, b, c] = r.map(rad);
  const rx = (p) => [
    p[0],
    p[1] * Math.cos(a) - p[2] * Math.sin(a),
    p[1] * Math.sin(a) + p[2] * Math.cos(a),
  ];
  const ry = (p) => [
    p[0] * Math.cos(b) + p[2] * Math.sin(b),
    p[1],
    -p[0] * Math.sin(b) + p[2] * Math.cos(b),
  ];
  const rz = (p) => [
    p[0] * Math.cos(c) - p[1] * Math.sin(c),
    p[0] * Math.sin(c) + p[1] * Math.cos(c),
    p[2],
  ];
  return (p) => {
    const q = rz(ry(rx([p[0] * s[0], p[1] * s[1], p[2] * s[2]])));
    return [q[0] + t[0], q[1] + t[1], q[2] + t[2]];
  };
}
const quad = (a, b, c, d) => [a, b, c, a, c, d];

/** Unit box centred at 0 (size 1). */
function box() {
  const v = (x, y, z) => [x - 0.5, y - 0.5, z - 0.5];
  const P = [
    v(0, 0, 0),
    v(1, 0, 0),
    v(1, 1, 0),
    v(0, 1, 0),
    v(0, 0, 1),
    v(1, 0, 1),
    v(1, 1, 1),
    v(0, 1, 1),
  ];
  const f = (i, j, k, l) => quad(P[i], P[j], P[k], P[l]);
  return [
    ...f(4, 5, 6, 7),
    ...f(1, 0, 3, 2),
    ...f(5, 1, 2, 6),
    ...f(0, 4, 7, 3),
    ...f(7, 6, 2, 3),
    ...f(0, 1, 5, 4),
  ];
}

/** Frustum along y from -0.5 to 0.5, bottom radius rb, top radius rt, n sides, capped. */
function frustum(n, rb = 0.5, rt = 0.5, { top = true, bottom = true } = {}) {
  const out = [];
  const ring = (r, y) =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [Math.cos(t) * r, y, Math.sin(t) * r];
    });
  const B = ring(rb, -0.5);
  const T = ring(rt, 0.5);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(...quad(B[i], T[i], T[j], B[j]));
    if (top && rt > 0) out.push([0, 0.5, 0], T[j], T[i]);
    if (bottom && rb > 0) out.push([0, -0.5, 0], B[i], B[j]);
  }
  return out;
}
const cyl = (n) => frustum(n, 0.5, 0.5);
const cone = (n) => frustum(n, 0.5, 0, { top: false });

/** Low-poly UV sphere of radius 0.5 (rows × cols); `shape(y01)` scales the ring radius. */
function sphere(rows, cols, shape = () => 1) {
  const out = [];
  const pt = (i, j) => {
    const th = (i / rows) * Math.PI;
    const ph = (j / cols) * Math.PI * 2;
    const k = shape(1 - i / rows);
    return [
      Math.sin(th) * Math.cos(ph) * 0.5 * k,
      Math.cos(th) * 0.5,
      Math.sin(th) * Math.sin(ph) * 0.5 * k,
    ];
  };
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = pt(i, j),
        b = pt(i + 1, j),
        c = pt(i + 1, j + 1),
        d = pt(i, j + 1);
      if (i === 0) out.push(a, c, b);
      else if (i === rows - 1) out.push(a, d, b);
      else out.push(...quad(a, d, c, b));
    }
  return out;
}

/** Torus-like arc (handle) in the xy plane: radius R, tube r, from a0 to a1 degrees. */
function arc(R, r, a0, a1, seg = 8, side = 5) {
  const out = [];
  const pt = (i, k) => {
    const a = rad(a0 + ((a1 - a0) * i) / seg);
    const b = (k / side) * Math.PI * 2;
    const rr = R + r * Math.cos(b);
    return [Math.cos(a) * rr, Math.sin(a) * rr, r * Math.sin(b)];
  };
  for (let i = 0; i < seg; i++)
    for (let k = 0; k < side; k++)
      out.push(...quad(pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1)));
  return out;
}

// ---- model builder --------------------------------------------------------------------------
function model() {
  const parts = [];
  const api = {
    add(tris, color, tf = {}, mat = {}) {
      const f = xform(tf);
      parts.push({ tris: tris.map(f), color, mat });
      return api;
    },
    parts,
  };
  return api;
}

async function save(name, m) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(name);
  const mats = new Map();
  m.parts.forEach((p, idx) => {
    const key = `${p.color}|${JSON.stringify(p.mat)}`;
    let mat = mats.get(key);
    if (!mat) {
      const c = parseInt(p.color.slice(1), 16);
      const lin = (v) =>
        v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
      mat = doc
        .createMaterial(`m${mats.size}`)
        .setBaseColorFactor([
          lin((c >> 16) & 255),
          lin((c >> 8) & 255),
          lin(c & 255),
          p.mat.alpha ?? 1,
        ])
        .setRoughnessFactor(p.mat.rough ?? 0.8)
        .setMetallicFactor(p.mat.metal ?? 0);
      if (p.mat.alpha !== undefined) mat.setAlphaMode('BLEND');
      mats.set(key, mat);
    }
    const pos = new Float32Array(p.tris.length * 3);
    const nor = new Float32Array(p.tris.length * 3);
    for (let i = 0; i < p.tris.length; i += 3) {
      const [a, b, c] = [p.tris[i], p.tris[i + 1], p.tris[i + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((x) => x / l);
      for (let k = 0; k < 3; k++) {
        pos.set(p.tris[i + k], (i + k) * 3);
        nor.set(n, (i + k) * 3);
      }
    }
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
      .setMaterial(mat);
    scene.addChild(doc.createNode(`${name}-${idx}`).setMesh(doc.createMesh().addPrimitive(prim)));
  });
  await writeFile(join(OUT, `${name}.glb`), await new NodeIO().writeBinary(doc));
  console.log(`${name}.glb`);
}

// ---- palette --------------------------------------------------------------------------------
const WOOD = '#9a6a3c';
const STEEL = '#8f969b';
const DARK = '#3d4246';
const LEAF = '#3f8f3a';

// ---- tools ----------------------------------------------------------------------------------
const handle = (m, len) => m.add(cyl(7), WOOD, { s: [0.07, len, 0.07], t: [0, len / 2, 0] });

const hoe = model();
handle(hoe, 2.2);
hoe.add(box(), DARK, { s: [0.32, 0.08, 0.08], t: [0.14, 2.16, 0] });
hoe.add(box(), STEEL, { s: [0.03, 0.42, 0.72], t: [0.3, 1.99, 0], r: [0, 0, 12] }, { metal: 0.3 });
await save('uprawa-motyka', hoe);

const rake = model();
handle(rake, 2.2);
rake.add(box(), STEEL, { s: [0.66, 0.06, 0.06], t: [0, 2.2, 0.04] }, { metal: 0.3 });
for (let i = 0; i < 8; i++)
  rake.add(
    box(),
    STEEL,
    { s: [0.035, 0.2, 0.035], t: [-0.3 + (i * 0.6) / 7, 2.16, 0.12], r: [-60, 0, 0] },
    { metal: 0.3 },
  );
await save('uprawa-grabie', rake);

const can = model();
const CAN = '#3f8a5a';
can.add(frustum(12, 0.5, 0.46), CAN, { s: [1, 0.9, 1], t: [0, 0.45, 0] });
can.add(frustum(10, 0.5, 0.5, { bottom: false }), DARK, { s: [0.5, 0.06, 0.5], t: [0, 0.93, 0] });
can.add(cyl(7), CAN, { s: [0.08, 0.9, 0.08], t: [0.62, 0.62, 0], r: [0, 0, -52] });
can.add(frustum(8, 0.5, 0.9), '#2f6f47', {
  s: [0.13, 0.12, 0.13],
  t: [1.0, 0.92, 0],
  r: [0, 0, -52],
});
can.add(arc(0.38, 0.045, 30, 180), CAN, { t: [-0.12, 0.72, 0] });
await save('uprawa-konewka', can);

const bucket = model();
bucket.add(
  frustum(14, 0.4, 0.5, { top: false }),
  '#a3aab0',
  { s: [1, 0.9, 1], t: [0, 0.45, 0] },
  { metal: 0.3 },
);
bucket.add(
  frustum(14, 0.5, 0.5, { top: false, bottom: false }),
  '#c2c8cc',
  { s: [1.04, 0.06, 1.04], t: [0, 0.89, 0] },
  { metal: 0.3 },
);
bucket.add(frustum(14, 0.5, 0.5, { bottom: false }), '#5f8fb8', {
  s: [0.94, 0.01, 0.94],
  t: [0, 0.76, 0],
});
bucket.add(arc(0.5, 0.025, 0, 180, 10), DARK, { t: [0, 0.9, 0], s: [1, 0.8, 1] });
await save('uprawa-wiadro', bucket);

const glass = model();
glass.add(
  frustum(12, 0.4, 0.5, { top: false }),
  '#bcd8e2',
  { s: [0.6, 1, 0.6], t: [0, 0.5, 0] },
  { alpha: 0.75, rough: 0.3 },
);
glass.add(frustum(12, 0.4, 0.47), '#7fb3d0', { s: [0.55, 0.55, 0.55], t: [0, 0.3, 0] });
glass.add(
  cyl(12),
  '#9fc4d4',
  { s: [0.5, 0.06, 0.5], t: [0, 0.03, 0] },
  { alpha: 0.85, rough: 0.3 },
);
await save('uprawa-szklanka', glass);

// ---- crops ----------------------------------------------------------------------------------
const tomato = (m, tf = {}) => {
  const f = xform(tf);
  const add = (tris, col) => m.parts.push({ tris: tris.map(f), color: col, mat: {} });
  add(
    sphere(5, 9, (y) => 1 + 0.08 * Math.sin(y * Math.PI)).map(xform({ s: [1, 0.78, 1] })),
    '#d63a2a',
  );
  for (let i = 0; i < 5; i++)
    add(box().map(xform({ s: [0.06, 0.02, 0.26], t: [0, 0.4, 0.12], r: [10, i * 72, 0] })), LEAF);
  add(cyl(5).map(xform({ s: [0.04, 0.14, 0.04], t: [0, 0.46, 0] })), '#2f6e2b');
};
const t = model();
tomato(t);
await save('uprawa-pomidor', t);

const cucumber = (m, tf = {}) => {
  const f = xform(tf);
  m.parts.push({
    tris: sphere(5, 8)
      .map(xform({ s: [0.36, 1.3, 0.36] }))
      .map(f),
    color: '#2f7d32',
    mat: {},
  });
  m.parts.push({
    tris: sphere(3, 6)
      .map(xform({ s: [0.12, 0.1, 0.12], t: [0, 0.65, 0] }))
      .map(f),
    color: '#c9b35a',
    mat: {},
  });
};
const cu = model();
cucumber(cu, { r: [0, 0, -55] });
await save('uprawa-ogorek', cu);

const onion = (m, tf = {}) => {
  const f = xform(tf);
  const p = (tris, col) => m.parts.push({ tris: tris.map(f), color: col, mat: {} });
  p(
    sphere(6, 9, (y) => (y > 0.75 ? 0.5 + (1 - y) * 2 : 1)).map(xform({ s: [1, 0.95, 1] })),
    '#c78a3b',
  );
  p(cone(6).map(xform({ s: [0.14, 0.3, 0.14], t: [0, 0.6, 0] })), '#a56b2a');
  for (let i = 0; i < 4; i++)
    p(
      box().map(xform({ s: [0.02, 0.14, 0.02], t: [0, -0.5, 0.04], r: [25, i * 90, 0] })),
      '#e3d7b8',
    );
};
const o = model();
onion(o);
await save('uprawa-cebula', o);

const beans = (m, tf = {}) => {
  const f = xform(tf);
  for (let i = 0; i < 3; i++) {
    const pod = sphere(
      6,
      7,
      (y) => Math.min(1, Math.sin(y * Math.PI) * 2.5) * (1 + 0.12 * Math.sin(y * Math.PI * 6)),
    ).map(xform({ s: [0.24, 1.4, 0.18] }));
    m.parts.push({
      tris: pod.map(xform({ r: [0, 0, -50 + i * 18], t: [-0.25 + i * 0.25, 0, i * 0.08] })).map(f),
      color: ['#7cc152', '#8fcf5f', '#6cb447'][i],
      mat: {},
    });
  }
};
const b = model();
beans(b);
await save('uprawa-fasolka', b);

const strawberry = (m, tf = {}) => {
  const f = xform(tf);
  const p = (tris, col) => m.parts.push({ tris: tris.map(f), color: col, mat: {} });
  const sh = (y) => 0.25 + 0.85 * Math.min(1, y * 1.25);
  p(sphere(7, 9, sh).map(xform({ s: [0.9, 1.1, 0.9], t: [0, -0.05, 0] })), '#d8283b');
  for (let i = 0; i < 6; i++)
    p(box().map(xform({ s: [0.09, 0.02, 0.3], t: [0, 0.48, 0.13], r: [-12, i * 60, 0] })), LEAF);
  p(cyl(5).map(xform({ s: [0.035, 0.16, 0.035], t: [0, 0.56, 0] })), '#2f6e2b');
  for (let i = 0; i < 18; i++) {
    const y01 = 0.25 + (i % 6) * 0.11;
    const r = 0.45 * 0.9 * sh(y01) * Math.sin(y01 * Math.PI) + 0.02;
    const a = rad(i * 67);
    p(
      box().map(
        xform({
          s: [0.035, 0.05, 0.035],
          t: [Math.cos(a) * r, -0.05 + (y01 - 0.5) * 1.1, Math.sin(a) * r],
        }),
      ),
      '#f2d65c',
    );
  }
};
const st = model();
strawberry(st);
await save('uprawa-truskawka', st);

// ---- seed packets: paper packet with the crop on the front ------------------------------------
const carrot = (m, tf = {}) => {
  const f = xform(tf);
  m.parts.push({
    tris: cone(7)
      .map(xform({ s: [0.32, 1.2, 0.32], r: [180, 0, 0] }))
      .map(f),
    color: '#e0782a',
    mat: {},
  });
  for (let i = 0; i < 3; i++)
    m.parts.push({
      tris: box()
        .map(xform({ s: [0.08, 0.5, 0.03], t: [0, 0.82, 0], r: [0, i * 60, -15 + i * 15] }))
        .map(f),
      color: LEAF,
      mat: {},
    });
};
const cabbage = (m, tf = {}) => {
  const f = xform(tf);
  m.parts.push({ tris: sphere(5, 8).map(f), color: '#5fae55', mat: {} });
  for (let i = 0; i < 5; i++)
    m.parts.push({
      tris: sphere(3, 6)
        .map(xform({ s: [0.7, 0.55, 0.35], t: [0, -0.12, 0.3], r: [-25, i * 72, 0] }))
        .map(f),
      color: '#3f8f3a',
      mat: {},
    });
};
const SEEDS = [
  ['marchew', '#e8a24a', carrot],
  ['kapusta', '#7cbf6a', cabbage],
  ['cebula', '#d9b46a', onion],
  ['pomidor', '#e06a5a', tomato],
  ['ogorek', '#69b05a', cucumber],
  ['fasolka', '#8fc46a', beans],
  ['truskawka', '#e8768a', strawberry],
];
for (const [name, col, crop] of SEEDS) {
  const m = model();
  m.add(box(), '#efe4c8', { s: [1, 1.4, 0.08] });
  m.add(box(), col, { s: [1.02, 0.5, 0.09], t: [0, -0.3, 0] });
  m.add(box(), '#d8cba8', { s: [1.02, 0.12, 0.1], t: [0, 0.66, 0] });
  crop(m, { s: [0.5, 0.5, 0.5], t: [0, 0.16, 0.16] });
  for (let i = 0; i < 3; i++)
    m.add(sphere(2, 5), '#6b4a2a', { s: [0.08, 0.05, 0.06], t: [-0.25 + i * 0.25, -0.3, 0.06] });
  await save(`uprawa-nasiona-${name}`, m);
}
