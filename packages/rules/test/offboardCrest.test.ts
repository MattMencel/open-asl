import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { moveState } from '../src/sk1/movement';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { defaultVca } from '../src/sk3/vehicles';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Entering a hill hex from offboard crosses a Crest Line into higher terrain: every offboard hex is Open Ground
 * (ASLRB A2.51; SK4 3.3 "per normal Open Ground movement costs") at level 0. A vehicle pays the hex's cost plus 4 MP
 * (2 via a road hexside), Infantry double the hex's COT (SK4 1.1.1, whose EX has a tank pay 5 MP for Open Ground).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
type MapView = { offboard(e: string): { id: string }[]; offboardNeighbors(h: string): { onboard: string[] } };
const mapOf = (engine: Engine, state: GameState) => (engine.env(state) as unknown as { statics: { map: MapView } }).statics.map;
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = act(engine, s, a).state;
  return s;
};
/** The north edge: an offboard hex and the map hexes beside it, which `hill` raises to level 1. */
function edge() {
  const { engine, state } = makeEngine({ pieces: [], scenario: RU_VS_GE, extra, startPhase: 'MPh' });
  const map = mapOf(engine, state);
  const off = map.offboard('N')[5]!.id;
  return { off, onboard: map.offboardNeighbors(off).onboard };
}
const game = (pieces: PieceSpec[], hill: string[]) =>
  makeEngine({ pieces, scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain: Object.fromEntries(hill.map((h) => [h, { terrain: 'open', elevation: 1 }])) as never });

const tank: PieceSpec = { id: 't34', def: 'ru.T34M43', side: 'ru', tags: { vca: 0, ca: 0, motion: true, entryTurn: 1, entryEdge: 'N' } };
/** The tank in offboard hex `off`, facing into the map, started in its MPh. */
function tankEntering(off: string, hill: string[]) {
  const { engine, state } = game([tank], hill);
  const vca = defaultVca(engine.env(state), off);
  const s0: GameState = { ...state, pieces: { ...state.pieces, t34: { ...state.pieces['t34']!, loc: { kind: 'offboard', edge: 'N', hex: off }, tags: { ...state.pieces['t34']!.tags, vca, ca: vca } } } };
  const s = play(engine, s0, { type: 'vmove.start', vehicle: 't34' });
  const entries = engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step').map((a) => a['to'] as string);
  return { engine, s, entries, spent: () => moveState(engine.env(s))!.spent['t34']! };
}

describe('entering a hill hex from offboard (SK4 1.1.1, ASLRB A2.51)', () => {
  it('a tank pays 1 MP for the Open Ground and 4 for the Crest Line; the same hex at level 0 costs 1', () => {
    const { off, onboard } = edge();
    const to = tankEntering(off, []).entries.find((h) => onboard.includes(h))!;
    expect(to).toBeDefined();
    for (const [hill, cost] of [[[to], 5], [[], 1]] as const) {
      const t = tankEntering(off, [...hill]);
      const after = play(t.engine, t.s, { type: 'move.step', to });
      expect(moveState(t.engine.env(after))!.spent['t34']! - t.spent()).toBe(cost);
    }
  });

  it('a squad entering a level-1 Open Ground hex pays 2 MF', () => {
    const { off, onboard } = edge();
    const up = onboard[0]!;
    const { engine, state } = game([{ id: 'q', def: 'ru.447', side: 'ru', tags: { entryTurn: 1, entryEdge: 'N' } }], onboard);
    const s0: GameState = { ...state, pieces: { ...state.pieces, q: { ...state.pieces['q']!, loc: { kind: 'offboard', edge: 'N', hex: off } } } };
    let s = play(engine, s0, { type: 'move.start', units: ['q'] });
    s = play(engine, s, { type: 'move.step', to: up });
    expect(moveState(engine.env(s))!.spent['q']).toBe(2);
  });
});
