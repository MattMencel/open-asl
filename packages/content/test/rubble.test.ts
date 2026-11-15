import { describe, expect, it } from 'vitest';
import type { LosEnd } from '@asl/rules';
import { buildMap } from '../src';

/*
 * Rubble on the real board art (ASLRB B24.2): a hex rubbled in play is a half-level Inherent obstacle through the whole
 * hex, hexsides included, whatever its printed terrain; with the ground level intact under level 1 rubble the building
 * art stands at a level and a half. The tracers take the rubbled hexes per trace (`LosAtOptions.rubbled`).
 */

const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
const at = (hex: string, height: number): LosEnd => ({ hex, height });
const AUGUST = { orchardInSeason: true };

describe('a rubbled hex on board u', () => {
  it('ground rubble blocks a ground LOS through it and along its hexsides, and a level 1 viewer sees over it', () => {
    // The stone house K4 between K3 (open ground, north of it) and K5 (its other hex): standing, 1½ levels block a level 1 viewer.
    expect(u.losAt(at('uK3', 0), at('uK5', 0), AUGUST).clear).toBe(false);
    expect(u.losAt(at('uK3', 1), at('uK5', 0), AUGUST).clear).toBe(false);
    // Rubbled: still blocked at ground level (half a level is a level to a ground viewer), seen over from level 1.
    const rubbled = { uK4: { hex: 0.5 } };
    const ground = u.losAt(at('uK3', 0), at('uK5', 0), { ...AUGUST, rubbled });
    expect(ground.clear).toBe(false);
    expect(ground.obstacle).toMatchObject({ hex: 'uK4', terrain: 'rubble' });
    expect(u.losAt(at('uK3', 1), at('uK5', 0), { ...AUGUST, rubbled }).clear).toBe(true);
  });

  it('rubble in open ground blocks a ground LOS where nothing stood before, and the result is not cached across traces', () => {
    expect(u.losAt(at('uQ5', 0), at('uS5', 0), AUGUST).clear).toBe(true);
    const r = u.losAt(at('uQ5', 0), at('uS5', 0), { ...AUGUST, rubbled: { uR5: { hex: 0.5 } } });
    expect(r.clear).toBe(false);
    expect(r.obstacle?.hex).toBe('uR5');
    expect(u.losAt(at('uQ5', 0), at('uS5', 0), AUGUST).clear).toBe(true);
  });

  it('level 1 rubble over an intact ground level keeps the house a 1½-level obstacle to level 1 viewers', () => {
    const rubbled = { uK4: { hex: 0.5, art: 1.5 } };
    expect(u.losAt(at('uK3', 1), at('uK5', 0), { ...AUGUST, rubbled }).clear).toBe(false);
  });
});
