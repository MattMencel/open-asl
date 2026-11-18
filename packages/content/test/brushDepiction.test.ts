import { describe, expect, it } from 'vitest';
import { statics, terrainOf } from '@asl/rules';
import { newGame, SK_S30 } from '../src';

/*
 * Pixel LOS is judged by the depiction the thread crosses, not by the terrain at a hex's centre (SK4 1.1.1 Brush: "+1
 * Hindrance DRM for every brush hex ... in which the LOS crosses the Brush depiction"; ASLRB A6.1, B13: woods block a
 * LOS only where it crosses the woods depiction). S30 joins board u turned 180° to board v: the edge hex uZ0 is woods on
 * its board-u half and brush on its board-v half, so its hex terrain is woods.
 */
describe('a board-edge hex judged by the depiction crossed (S30, boards u and v)', () => {
  const { engine, state } = newGame(SK_S30, 's30', { los: 'pixel' });
  const env = engine.env(state);
  const trace = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });

  it('uDD0 sees vL1 across the brush half of uZ0: clear, brush in vG1, uZ0 and vH1', () => {
    expect(terrainOf(env, 'uZ0').id).toBe('woods');
    const raw = statics(env).map.los('uDD0', 'vL1');
    expect(raw.clear).toBe(true);
    expect(raw.crossed.find((c) => c.hex === 'uZ0')?.terrain).toBe('brush');
    const t = trace('uDD0', 'vL1');
    expect(t.blockedBy).toBeUndefined();
    expect(t.clear).toBe(true);
    // uZ0 and vH1 are both 4 hexes from uDD0: two Hindrance hexes at one range count once (ASLRB A6.7).
    expect(t.hindrance).toBe(2);
    expect(t.parts.map((p) => p.hex).sort()).toEqual(['uZ0', 'vG1']);
    expect(t.parts.every((p) => p.terrain === 'brush' && p.drm === 1)).toBe(true);
  });

  it('woods art the thread crosses still blocks: uDD0 to uY1 through the woods of uCC1 (ASLRB B13)', () => {
    const t = trace('uDD0', 'uY1');
    expect(t.clear).toBe(false);
  });

  it('the same LOS is clear both ways (ASLRB A6.5)', () => {
    const t = trace('vL1', 'uDD0');
    expect(t.clear).toBe(true);
    expect(t.hindrance).toBe(2);
  });
});
