import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import type { HexTerrainSpec } from '../src';
import { shotContext, statics } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, makeEngine, type PieceSpec } from './fixtures';

/*
 * TEM on the Vehicle Target Type (SK4 3.2.4 To Hit case 17 "TEM (NA for ATT)"; ASLRB C6.8 Case Q): the target's TEM is
 * a To Hit DRM on the Vehicle Target Type as on the Infantry Target Type, whether or not the vehicle is in Motion. A
 * vehicle in a Woods-Road hex is always on the road (ASLRB B13.31), so it has the woods TEM only against a firer whose
 * LOS crosses the woods art. Height Advantage is a TEM for "any unit" (ASLRB B10.31).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const TERRAIN: Record<string, HexTerrainSpec> = {
  yK8: { terrain: 'building-stone', buildingId: 'K8' },
  yM4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] },
  yN5: { terrain: 'open', elevation: 1 },
};
const ROADS: [string, string][] = [
  ['yM3', 'yM4'],
  ['yM4', 'yM5'],
];
const pz = (hex: string, tags: Record<string, unknown> = {}): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0, ...tags } });
/** A Russian squad with a LMG (MG vs AFV, SK4 4.1) in yK5, and the German AFV. */
const game = (target: PieceSpec, dice: number[] = []) =>
  makeEngine({
    scenario: { ...RU_VS_GE, firstSide: 'ru' },
    extra,
    terrain: TERRAIN,
    roadHexsides: ROADS,
    startPhase: 'PFPh',
    dice,
    pieces: [{ id: 'q', def: 'ru.447', side: 'ru', hex: 'yK5' }, { id: 'm', def: 'ru.LMG', side: 'ru', heldBy: 'q' }, target],
  });
const shot = (hex: string, targetType = 'VTT') => ({ weapon: 'm', target: hex, targetType }) as never;
const explain = (engine: Engine, state: GameState, hex: string, targetType = 'VTT') => {
  const env = engine.env(state);
  return env.explain('ordnance.thDrm', shotContext(env, shot(hex, targetType), 'prep', 'ru'), 0);
};
const applied = (ex: ReturnType<typeof explain>, id: string) => ex.trace.some((t) => t.id === id && !t.suppressedBy);

describe('TEM on the Vehicle Target Type (case 17)', () => {
  it('a stone building adds +3 to the To Hit DR against a vehicle in it, in Motion or not', () => {
    const still = game(pz('yK8'));
    const ex = explain(still.engine, still.state, 'yK8');
    expect(applied(ex, 'sk2.th.tem')).toBe(true);
    const moving = game(pz('yK8', { motion: true }));
    const exm = explain(moving.engine, moving.state, 'yK8');
    expect(applied(exm, 'sk2.th.tem')).toBe(true);
    // In the open the same shots differ by the +3 alone.
    const open = game(pz('yK2'));
    expect(ex.value - explain(open.engine, open.state, 'yK2').value).toBe(3);
  });

  it('no woods TEM for a vehicle in a Woods-Road hex unless the LOS crosses the woods art', () => {
    const { engine, state } = game(pz('yM4'));
    expect(applied(explain(engine, state, 'yM4'), 'sk2.th.tem')).toBe(false);
    const map = statics(engine.env(state)).map;
    const los = map.los.bind(map);
    map.los = (from, to) => {
      const r = los(from, to);
      return to === 'yM4' ? { ...r, woods: ['yM4'] } : r;
    };
    expect(applied(explain(engine, state, 'yM4'), 'sk2.th.tem')).toBe(true);
  });

  it('Height Advantage gives a vehicle on higher ground +1 (ASLRB B10.31 "any unit")', () => {
    const { engine, state } = game(pz('yN5'));
    expect(applied(explain(engine, state, 'yN5'), 'sk2.th.heightAdvantage')).toBe(true);
  });

  it('still never on the Area Target Type', () => {
    const { engine, state } = game(pz('yK8'));
    expect(applied(explain(engine, state, 'yK8', 'ATT'), 'sk2.th.tem')).toBe(false);
  });
});
