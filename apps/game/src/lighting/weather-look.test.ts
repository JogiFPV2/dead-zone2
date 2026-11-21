import { weatherAt } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { compilePreset } from './compiled.js';
import { DAY_PRESET } from './day-cycle-config.js';
import { NIGHT_PRESET } from './preset.js';
import { applyWeatherLook, fogAmount } from './weather-look.js';

const wx = (kind: Parameters<typeof weatherAt>[3], minute = 12 * 60) =>
  weatherAt(1, minute, undefined, kind);

describe('weather on the lighting look', () => {
  it('no weather: unchanged', () => {
    const a = compilePreset(DAY_PRESET);
    applyWeatherLook(a, undefined, 1);
    expect(a).toEqual(compilePreset(DAY_PRESET));
  });

  it('overcast day: weaker sun and shadow than clear', () => {
    const clear = compilePreset(DAY_PRESET);
    const grey = compilePreset(DAY_PRESET);
    applyWeatherLook(clear, wx('clear'), 1);
    applyWeatherLook(grey, wx('overcast'), 1);
    expect(grey.directional.intensity).toBeLessThan(clear.directional.intensity * 0.6);
    expect(grey.directional.shadowIntensity).toBeLessThan(clear.directional.shadowIntensity * 0.5);
  });

  it('night: full moon keeps the approved look; a new moon is much darker', () => {
    const full = compilePreset(NIGHT_PRESET);
    applyWeatherLook(full, wx('clear', 0), 0);
    // Clear sky still has 10 % cloud and the moon is just short of full: close to the approved night.
    expect(full.directional.intensity).toBeGreaterThan(NIGHT_PRESET.directional.intensity * 0.85);
    const dark = compilePreset(NIGHT_PRESET);
    applyWeatherLook(dark, wx('clear', 15 * 1440), 0);
    expect(dark.directional.intensity).toBeLessThan(full.directional.intensity * 0.3);
  });

  it('fog pulls the fog in; rain only hazes the distance', () => {
    expect(fogAmount(wx('fog'))).toBe(1);
    expect(fogAmount(wx('rain'))).toBeLessThan(0.2);
    const a = compilePreset(DAY_PRESET);
    applyWeatherLook(a, wx('fog'), 1);
    expect(a.fog.far).toBeLessThan(DAY_PRESET.fog.far * 0.6);
    expect(a.fog.near).toBeLessThan(DAY_PRESET.fog.near);
  });
});
