import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { SMOKE58, applyChange, aslCoreModules, ecForDr, ecMonthDrm, ecState, piecesModule, smoke58Counters, smokeGrenades, turnModule, windDirectionDrm, windOf, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Environmental Conditions and wind in full ASL (ASLRB B25.5, B25.63–B25.651, A24.6, A24.62): the EC Chart dr with the
 * month's drm, the Wind Force and Direction dice after setup, the Wind Change DR at every RPh, Gusts, and what Heavy
 * Winds and Gusts do to Smoke.
 */

const TERRAIN: Record<string, HexTerrainSpec> = { uK3: { terrain: 'woods' } };
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const PIECES: PieceSpec[] = [
  { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK3' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uR4' },
];

function game(opts: { dice?: number[]; startPhase?: string; scenario?: Record<string, unknown>; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  return makeEngine({
    board: 'u',
    terrain: TERRAIN,
    scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }], month: 8, turns: 6, ...opts.scenario },
    modules: ASL,
    pieces: PIECES,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
    ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}),
  });
}

function until(engine: Engine, state: GameState, phase: string, opts: { turn?: number; attacker?: string } = {}): GameState {
  let s = state;
  for (let guard = 0; guard < 300; guard++) {
    if (s.result) throw new Error(`game over before ${phase}`);
    if (s.phase === phase && (opts.turn === undefined || s.turn === opts.turn) && (opts.attacker === undefined || s.attacker === opts.attacker)) return s;
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const pick = ['defPass', 'blaze.stay', 'rout.stay', 'endPhase'].map((t) => legal.find((a) => a.type === t)).find(Boolean);
    if (!pick) throw new Error(`cannot pass ${d.kind} in ${s.phase}`);
    s = engine.submit(s, pick).state;
  }
  throw new Error(`never reached ${phase}`);
}

describe('Environmental Conditions (B25.5)', () => {
  it('maps the month to its drm and the Final dr to the EC', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(ecMonthDrm)).toEqual([-3, -3, -2, -1, 0, 1, 2, 2, 1, 0, -1, -2]);
    expect([-1, 0, 1, 2, 3, 4, 5, 6, 8].map(ecForDr)).toEqual(['snow', 'snow', 'mud', 'wet', 'moist', 'moderate', 'dry', 'veryDry', 'veryDry']);
  });

  it('rolls the dr before play with the month drm unless the card states the EC', () => {
    // August (+2): a dr of 3 is 5, Dry (+1). The dr is the game's first roll.
    const { engine, state } = game({ dice: [3], scenario: { ec: undefined } });
    expect(ecState(engine.env(state))).toEqual({ ec: 'dry', drm: 1, dr: 3, monthDrm: 2 });
    const stated = game({ scenario: { ec: 'mud' } });
    expect(ecState(stated.engine.env(stated.state))).toEqual({ ec: 'mud', drm: -3 });
  });
});

describe('Wind Force and Direction (B25.63, B25.64)', () => {
  it('is rolled at the first RPh when the card says nothing: 1–3 No Wind, 4–5 Mild Breeze, 6 Heavy Winds, then a direction dr', () => {
    for (const [dr, force] of [[1, 'none'], [4, 'breeze'], [6, 'heavy']] as const) {
      // At the RPh: Wind Force dr, (Wind Direction dr 2), Wind Change DR 3+4.
      const { engine, state } = game({ dice: [dr, 2, 3, 4], scenario: { ec: 'moderate', weather: undefined }, startPhase: 'RPh' });
      const s = until(engine, state, 'PFPh', { turn: 1, attacker: 'ge' });
      const wind = windOf(engine.env(s));
      expect(wind.force).toBe(force);
      if (force === 'none') expect(wind.dir).toBeUndefined();
      else expect(wind.dir).toBe(5);
    }
  });

  it('a wind the card states blows from the start, toward the hexside given', () => {
    const { engine, state } = game({ scenario: { ec: 'moderate', weather: { wind: { from: 'W', force: 'breeze', dir: 3 } } } });
    expect(windOf(engine.env(state))).toEqual({ force: 'breeze', dir: 3 });
    expect([0, 1, 2, 3, 4, 5].map((k) => windDirectionDrm({ force: 'breeze', dir: 3 }, k))).toEqual([-1, 0, 1, 2, 1, 0]);
    expect(windDirectionDrm({ force: 'heavy', dir: 3 }, 3)).toBe(0);
  });
});

describe('Wind Changes (B25.65, B25.651)', () => {
  it('applies the Wind Change table: direction turns only with a wind, the force steps, and off the ends it is a Mild Breeze', () => {
    expect(applyChange({ force: 'none' }, 1)).toEqual({ force: 'none' });
    expect(applyChange({ force: 'breeze', dir: 0 }, 1)).toEqual({ force: 'breeze', dir: 1 });
    expect(applyChange({ force: 'breeze', dir: 0 }, 2)).toEqual({ force: 'breeze', dir: 2 });
    expect(applyChange({ force: 'breeze', dir: 0 }, 3)).toEqual({ force: 'breeze', dir: 5 });
    expect(applyChange({ force: 'breeze', dir: 0 }, 4)).toEqual({ force: 'breeze', dir: 4 });
    expect(applyChange({ force: 'none' }, 5)).toEqual({ force: 'breeze' });
    expect(applyChange({ force: 'breeze', dir: 2 }, 5)).toEqual({ force: 'heavy', dir: 2 });
    expect(applyChange({ force: 'heavy', dir: 2 }, 5)).toEqual({ force: 'breeze', dir: 2 });
    expect(applyChange({ force: 'none' }, 6)).toEqual({ force: 'breeze' });
    expect(applyChange({ force: 'breeze', dir: 2 }, 6)).toEqual({ force: 'none', dir: 2 });
    expect(applyChange({ force: 'heavy', dir: 2 }, 6)).toEqual({ force: 'breeze', dir: 2 });
  });

  it('a DR of 2 at the RPh changes the wind; a rise from No Wind rolls a direction', () => {
    // EC stated; RPh of turn 1: Wind Force dr 2 (none), Wind Change DR 1+1, dr 5 (up: breeze), direction dr 4.
    const { engine, state } = game({ dice: [2, 1, 1, 5, 4], scenario: { ec: 'moderate', weather: undefined }, startPhase: 'RPh' });
    const s = until(engine, state, 'PFPh', { turn: 1, attacker: 'ge' });
    expect(windOf(engine.env(s))).toEqual({ force: 'breeze', dir: 1 });
  });

  it('a DR of 12 is Gusts for the Player Turn: the Smoke counters disperse at the RPh and again at the AFPh, and a Collapse check is made', () => {
    const markers = { uR4: { smoke: 2 }, uK3: { [SMOKE58.kind]: 'smoke@ge,wp.d@ru' } };
    // Wind Force dr 2 (none), Wind Change DR 6+6, Gust Direction dr 3 (the south-east hexside).
    const { engine, state } = game({ dice: [2, 6, 6, 3, 4, 4], scenario: { ec: 'moderate', weather: undefined }, hexMarkers: markers, startPhase: 'RPh' });
    // The RPh has begun: the grenade Smoke is gone, the Dispersed WP removed, the full German Smoke flipped.
    const wind = windOf(engine.env(state));
    expect(state.phase).toBe('RPh');
    expect(wind.gusts).toBe(true);
    expect(wind.gustDir).toBe(0);
    expect(smokeGrenades(state.hexMarkers['uR4'])).toBe(0);
    expect(smoke58Counters(state.hexMarkers['uK3'])).toEqual([{ kind: 'smoke', dispersed: true, side: 'ge' }]);
    let s = until(engine, state, 'APh', { turn: 1, attacker: 'ge' });
    expect(smoke58Counters(s.hexMarkers['uK3'])).toEqual([]);
    s = until(engine, s, 'PFPh', { turn: 1, attacker: 'ru' });
    expect(windOf(engine.env(s)).gusts).toBeUndefined();
  });
});

describe('Heavy Winds and Smoke (B25.63, A24.6)', () => {
  it('removes every Smoke counter when Heavy Winds begin and refuses Smoke grenades while they last', () => {
    const markers = { uR4: { smoke: 1 }, uK3: { [SMOKE58.kind]: 'smoke@ge' } };
    // RPh: Wind Force dr 6 (heavy), direction dr 1, Wind Change DR 3+4.
    const { engine, state } = game({ dice: [6, 1, 3, 4], scenario: { ec: 'moderate', weather: undefined }, hexMarkers: markers, startPhase: 'RPh' });
    let s = until(engine, state, 'MPh', { turn: 1, attacker: 'ge' });
    expect(windOf(engine.env(s)).force).toBe('heavy');
    expect(smokeGrenades(s.hexMarkers['uR4'])).toBe(0);
    expect(smoke58Counters(s.hexMarkers['uK3'])).toEqual([]);
    expect(engine.env(s).query('unit.smoke', { unit: 'g1' }, 0)).toBe(0);
    s = act(engine, s, { type: 'move.start', units: ['g1'] }).state;
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.smoke')).toBe(false);
  });
});

/** Keeps the type import used when the list of actions is empty. */
void (null as Action | null);
