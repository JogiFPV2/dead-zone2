import { Color, Vector3 } from 'three';
import type { LightingPreset } from './preset.js';

/**
 * A preset with parsed colours (linear) and vectors, so the day cycle can blend into one
 * mutable instance every frame without allocating (the hex-based `lerpPreset` allocates).
 */
export interface CompiledPreset {
  exposure: number;
  background: Color;
  fog: { color: Color; near: number; far: number };
  hemisphere: { sky: Color; ground: Color; intensity: number };
  directional: {
    color: Color;
    intensity: number;
    offset: Vector3;
    shadowRadius: number;
    shadowIntensity: number;
  };
  lamps: {
    color: Color;
    intensity: number;
    distance: number;
    angle: number;
    penumbra: number;
    decay: number;
    bulbColor: Color;
    bulbEmissive: Color;
    bulbEmissiveIntensity: number;
    glow: number;
  };
}

export function compilePreset(p: LightingPreset): CompiledPreset {
  const d = p.directional;
  const l = p.lamps;
  return {
    exposure: p.exposure,
    background: new Color(p.background),
    fog: { color: new Color(p.fog.color), near: p.fog.near, far: p.fog.far },
    hemisphere: {
      sky: new Color(p.hemisphere.sky),
      ground: new Color(p.hemisphere.ground),
      intensity: p.hemisphere.intensity,
    },
    directional: {
      color: new Color(d.color),
      intensity: d.intensity,
      offset: new Vector3(d.offset.x, d.offset.y, d.offset.z),
      shadowRadius: d.shadowRadius,
      shadowIntensity: d.shadowIntensity,
    },
    lamps: {
      color: new Color(l.color),
      intensity: l.intensity,
      distance: l.distance,
      angle: l.angle,
      penumbra: l.penumbra,
      decay: l.decay,
      bulbColor: new Color(l.bulbColor),
      bulbEmissive: new Color(l.bulbEmissive),
      bulbEmissiveIntensity: l.bulbEmissiveIntensity,
      glow: l.glow,
    },
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** out = a·(1 − t) + b·t (colours in linear space). Allocation-free; `out` may alias a or b. */
export function mixCompiled(
  out: CompiledPreset,
  a: CompiledPreset,
  b: CompiledPreset,
  t: number,
): CompiledPreset {
  out.exposure = mix(a.exposure, b.exposure, t);
  out.background.lerpColors(a.background, b.background, t);
  out.fog.color.lerpColors(a.fog.color, b.fog.color, t);
  out.fog.near = mix(a.fog.near, b.fog.near, t);
  out.fog.far = mix(a.fog.far, b.fog.far, t);
  const h = out.hemisphere;
  h.sky.lerpColors(a.hemisphere.sky, b.hemisphere.sky, t);
  h.ground.lerpColors(a.hemisphere.ground, b.hemisphere.ground, t);
  h.intensity = mix(a.hemisphere.intensity, b.hemisphere.intensity, t);
  const d = out.directional;
  const da = a.directional;
  const db = b.directional;
  d.color.lerpColors(da.color, db.color, t);
  d.intensity = mix(da.intensity, db.intensity, t);
  d.offset.lerpVectors(da.offset, db.offset, t);
  d.shadowRadius = mix(da.shadowRadius, db.shadowRadius, t);
  d.shadowIntensity = mix(da.shadowIntensity, db.shadowIntensity, t);
  const l = out.lamps;
  const la = a.lamps;
  const lb = b.lamps;
  l.color.lerpColors(la.color, lb.color, t);
  l.intensity = mix(la.intensity, lb.intensity, t);
  l.distance = mix(la.distance, lb.distance, t);
  l.angle = mix(la.angle, lb.angle, t);
  l.penumbra = mix(la.penumbra, lb.penumbra, t);
  l.decay = mix(la.decay, lb.decay, t);
  l.bulbColor.lerpColors(la.bulbColor, lb.bulbColor, t);
  l.bulbEmissive.lerpColors(la.bulbEmissive, lb.bulbEmissive, t);
  l.bulbEmissiveIntensity = mix(la.bulbEmissiveIntensity, lb.bulbEmissiveIntensity, t);
  l.glow = mix(la.glow, lb.glow, t);
  return out;
}
