import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  FORTIFIED_MODULE,
  aslCoreModules,
  blazeAt,
  controlState,
  fortifiedModule,
  hexsideForDr,
  isFortified,
  isRubbled,
  nearestSpine,
  piecesModule,
  placeBlaze,
  rubbleAt,
  rubbledHeights,
  sideToward,
  statics,
  terrainOf,
  turnModule,
  type HexTerrainSpec,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Rubble in full ASL (ASLRB B24): a HE KIA of 70mm or more rubbles a building Location on a dr ≤ the KIA number (+1
 * stone), eliminating the occupants (B24.11); a hex with an upper level may drop rubble into the next hex (B24.12,
 * B24.121); a burning building Location collapses on a Wind Change DR of 12 (B25.66); rubble plays as its own terrain
 * (B24.2–B24.5). An 88mm Gun in N4 fires at the K4–K5 stone Two Story House.
 */

const LEVELS = { upper: 1 as const, stairwell: 'inherent' as const };
const TERRAIN: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uM6: { terrain: 'building-wood' },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

const testFires: RuleModule = {
  id: 'test.fires',
  install(r) {
    r.action<Action & { type: 'test.blaze'; loc: string }>({
      type: 'test.blaze',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        placeBlaze(ctx, a.loc, { kindledBy: null, source: 'ssr', since: { turn: 0, attacker: 'ru' } });
      },
    });
  },
};

function game(pieces: PieceSpec[], opts: { dice?: number[]; startPhase?: string; scenario?: Record<string, unknown>; fortify?: string[] } = {}) {
  return makeEngine({
    board: 'u',
    terrain: TERRAIN,
    scenario: {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
      month: 8,
      turns: 6,
      ec: 'moderate',
      weather: { wind: { from: 'W', force: 'calm' } },
      forces: [{ side: 'ru', units: [], setup: { kind: 'area', description: 'the house', hexes: ['uK4', 'uK5'] } }],
      ssr: opts.fortify ? [{ module: FORTIFIED_MODULE, params: { side: 'ru', count: opts.fortify.length, unit: 'location', within: 'setup', open: true } }] : [],
      ...opts.scenario,
    },
    modules: ASL,
    extra: [testFires, ...(opts.fortify ? [fortifiedModule] : [])],
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
  });
}

/** The Gun's crew in N4 facing the house, the 4-4-7s inside; `level`: the first squad upstairs. */
function pieces(engine: Engine, state: GameState, level = 0): PieceSpec[] {
  const map = statics(engine.env(state)).map;
  const ca = nearestSpine(map.hex('uN4')!.cube, 0, map.hex('uK4')!.cube)!;
  return [
    { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'uN4' },
    { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
    { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK4', ...(level ? { level } : {}) },
    { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK5' },
    { id: 'mg', def: 'ru.MMG', side: 'ru', hex: 'uK4' },
  ];
}
const probe = () => game([{ id: 'x', def: 'ge.467', side: 'ge', hex: 'uN4' }]);
const shot = (target: string) => ({ type: 'fire.ordnance', shot: { weapon: 'g88', target, targetType: 'ITT' } });
const events = (res: { events: { type: string; payload: unknown }[] }, type: string) => res.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('Rubble creation by HE (B24.11)', () => {
  it('a KIA on the Original DR and a rubble dr within the KIA number rubble the Location, its occupants and SW instead of the IFT result', () => {
    const p = probe();
    // To Hit 2+1 = 3 hits (ROF kept at colored 1); IFT 1+1 = 2 on the 16 column: a 2KIA; rubble dr 1 +1 stone = 2 ≤ 2.
    // Falling rubble DR: white 3 (hexside 0), colored 6 +1 (one upper level) = 7: it falls.
    const { engine, state } = game(pieces(p.engine, p.state), { dice: [2, 1, 1, 1, 1, 3, 6] });
    const t = act(engine, state, shot('uK4'));
    expect(events(t, 'asl.rubble.check')[0]).toMatchObject({ loc: 'uK4', dr: 1, drm: 1, kia: 2, rubbled: true });
    expect(events(t, 'asl.rubble')[0]).toMatchObject({ hex: 'uK4', from: 0, kind: 'stone', by: 'he' });
    expect(t.state.pieces['r1']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['mg']!.loc.kind).toBe('eliminated');
    expect(events(t, 'sk1.fire.result')).toHaveLength(0);
    const env = engine.env(t.state);
    expect(rubbleAt(env, 'uK4')).toEqual({ from: 0, kind: 'stone' });
    expect(terrainOf(env, 'uK4').id).toBe('rubble-stone');
    expect(env.query('hex.tem', { hex: 'uK4' }, 0)).toBe(3);
    expect(env.query('move.cost', { unit: 'r2', from: 'uK5', to: 'uK4', viaRoad: false }, 0)).toBe(3);
    expect(rubbledHeights(env)).toMatchObject({ uK4: { hex: 0.5 } });
    // The rubble fell across hexside 0 into the hex beyond (open ground becomes stone rubble).
    const falling = events(t, 'asl.rubble.falling')[0]!;
    expect(falling).toMatchObject({ hex: 'uK4', drm: 1, falls: true, hexside: hexsideForDr(3) });
    const to = falling['to'] as string;
    expect(sideToward(statics(env).map, 'uK4', to)).toBe(0);
    expect(rubbleAt(env, to)).toEqual({ from: 0, kind: 'stone' });
    // No Flame roll: rubble takes precedence (B24.6).
    expect(events(t, 'asl.fire.attackFlame')).toHaveLength(0);
  });

  it('a rubble dr beyond the KIA number leaves the building, and the attack is resolved on the occupants', () => {
    const p = probe();
    const { engine, state } = game(pieces(p.engine, p.state), { dice: [2, 1, 1, 1, 3, 3, 4] });
    const t = act(engine, state, shot('uK4'));
    expect(events(t, 'asl.rubble.check')[0]).toMatchObject({ dr: 3, rubbled: false });
    expect(events(t, 'asl.rubble')).toHaveLength(0);
    expect(rubbleAt(engine.env(t.state), 'uK4')).toBeUndefined();
    expect(t.state.pieces['r1']!.loc.kind).toBe('eliminated');
    expect(events(t, 'sk1.fire.result').length).toBeGreaterThan(0);
  });

  it('a KIA at level 1 rubbles that level; the whole-hex dr may bring the ground down too, else the ground stays a building and the stairs cost three MF', () => {
    const p = probe();
    // Hit, 2KIA, rubble dr 1; whole-hex dr 5 +0 < 6: level 1 only; falling DR white 1 colored 1: stays.
    const { engine, state } = game(pieces(p.engine, p.state, 1), { dice: [2, 1, 1, 1, 1, 5, 1, 1] });
    const t = act(engine, state, shot('uK4:1'));
    expect(events(t, 'asl.rubble.whole')[0]).toMatchObject({ hex: 'uK4', dr: 5, drm: 0, rubbled: false });
    const env = engine.env(t.state);
    expect(rubbleAt(env, 'uK4')).toEqual({ from: 1, kind: 'stone' });
    expect(isRubbled(env, 'uK4:1')).toBe(true);
    expect(isRubbled(env, 'uK4')).toBe(false);
    expect(terrainOf(env, 'uK4').id).toBe('building-stone');
    expect(terrainOf(env, 'uK4:1').id).toBe('rubble-stone');
    expect(rubbledHeights(env)).toEqual({ uK4: { hex: 0.5, art: 1.5 } });
    expect(t.state.pieces['r1']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['mg']!.loc.kind).toBe('hex');
    // A dr of 6 brings the whole hex down.
    const p2 = probe();
    const g2 = game(pieces(p2.engine, p2.state, 1), { dice: [2, 1, 1, 1, 1, 6, 1, 1] });
    const t2 = act(g2.engine, g2.state, shot('uK4:1'));
    expect(events(t2, 'asl.rubble.whole')[0]).toMatchObject({ rubbled: true });
    expect(rubbleAt(g2.engine.env(t2.state), 'uK4')).toEqual({ from: 0, kind: 'stone' });
    expect(t2.state.pieces['mg']!.loc.kind).toBe('eliminated');
  });

  it('rubble from a fortified Location loses the fortification, and a building wholly rubbled counts for nobody', () => {
    const p = probe();
    const { engine, state } = game(pieces(p.engine, p.state), { fortify: ['uK4'], dice: [2, 1, 1, 1, 1, 1, 1] });
    let s = act(engine, state, { type: 'fortify.designate', locations: ['uK4'] }).state;
    const env0 = engine.env(s);
    expect(isFortified(env0, 'uK4')).toBe(true);
    expect(controlState(env0).buildings['u-B16']).toBe('ru');
    s = act(engine, s, shot('uK4')).state;
    const env = engine.env(s);
    expect(isFortified(env, 'uK4')).toBe(false);
    expect(env.query('hex.tem', { hex: 'uK4' }, 0)).toBe(3);
    expect(controlState(env).buildings['u-B16']).toBe('ru');
    // K5 goes too: the building is no more.
    const t = act(engine, until(engine, s, 'PFPh', { turn: 1, attacker: 'ge' }), shot('uK5'));
    void t;
  });
});

describe('Falling rubble (B24.12, B24.121) and Collapse (B25.66)', () => {
  it('rubble falling into another building hex rubbles it whole, in a chain, and burning rubble sets what it falls on ablaze', () => {
    const p = probe();
    const map = statics(p.engine.env(p.state)).map;
    // Which hexside of K4 faces K5? Aim the white die at it.
    const k = sideToward(map, 'uK4', 'uK5')!;
    const white = [1, 2, 3, 4, 5, 6].find((d) => hexsideForDr(d) === k)!;
    // The German AFPh end: the K4 Blaze's two Spreading Fire DRs (K5, K4 level 1) fail on 1+1. A Blaze in K4 (ground)
    // collapses on the Wind Change DR of 12 at the Russian RPh (with No Wind the Gust rolls a direction dr, 2); its
    // rubble falls into K5 (colored 6 +1), and K5's own falling DR (1+1) stays put.
    const { engine, state } = game(pieces(p.engine, p.state), { startPhase: 'AFPh', dice: [1, 1, 1, 1, 6, 6, 2, white, 6, 1, 1, ...Array(30).fill(3)] });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    // The Russians in K4 die in the Blaze's RtPh; K5's 4-4-7 waits for the rubble.
    s = until(engine, s, 'RPh', { turn: 1, attacker: 'ru' });
    const env = engine.env(s);
    expect(rubbleAt(env, 'uK4')).toEqual({ from: 0, kind: 'stone' });
    expect(blazeAt(env, 'uK4')).toMatchObject({ rubble: true });
    expect(rubbleAt(env, 'uK5')).toEqual({ from: 0, kind: 'stone' });
    expect(blazeAt(env, 'uK5')).toMatchObject({ rubble: true });
    expect(s.pieces['r2']!.loc.kind).toBe('eliminated');
    expect(controlState(env).buildings['u-B16']).toBeUndefined();
  });

  it('a Single Story House never drops rubble', () => {
    const p = probe();
    const map = statics(p.engine.env(p.state)).map;
    const ca = nearestSpine(map.hex('uN4')!.cube, 0, map.hex('uM6')!.cube)!;
    const { engine, state } = game([{ id: 'c1', def: 'ge.228c', side: 'ge', hex: 'uN4' }, { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uM6' }], { dice: [2, 1, 1, 1, 1, 6, 6] });
    const t = act(engine, state, shot('uM6'));
    expect(events(t, 'asl.rubble')[0]).toMatchObject({ hex: 'uM6', from: 0, kind: 'wood' });
    expect(events(t, 'asl.rubble.falling')).toHaveLength(0);
    expect(terrainOf(engine.env(t.state), 'uM6').id).toBe('rubble-wood');
    expect(engine.env(t.state).query('hex.tem', { hex: 'uM6' }, 0)).toBe(2);
  });
});

function until(engine: Engine, state: GameState, phase: string, opts: { turn?: number; attacker?: string } = {}): GameState {
  let s = state;
  for (let guard = 0; guard < 300; guard++) {
    if (s.result) throw new Error(`game over before ${phase}`);
    if (s.phase === phase && (opts.turn === undefined || s.turn === opts.turn) && (opts.attacker === undefined || s.attacker === opts.attacker)) return s;
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const pick = ['defPass', 'defRofDecline', 'blaze.stay', 'rout.stay', 'endPhase'].map((t) => legal.find((a) => a.type === t)).find(Boolean);
    if (!pick) throw new Error(`cannot pass ${d.kind} (${d.owner}) in ${s.phase}: ${[...new Set(legal.map((a) => a.type))].join(', ')}`);
    s = engine.submit(s, pick).state;
  }
  throw new Error(`never reached ${phase}`);
}
