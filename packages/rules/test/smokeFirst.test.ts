import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { T2 } from '../src/sk2/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Smoke first (SK4 6.2 "s (Smoke)"): "Once the firer has fired anything other than Smoke during that PFPh/DFPh no
 * more Smoke may be fired in that phase." The firer is the vehicle with all its weapons, or the Gun with the unit
 * manning it: a vehicle's MG burst ends its MA's Smoke for the phase, and Smoke fired first leaves the MGs free to
 * fire after it. SK4 says "the firer" (ASLRB C8.5 says "any unit"), so another unit's fire does not end it.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
/** A PzKw IVF2 (MA Smoke s8, BMG and CMG) in yM8 facing north at a Russian squad in yM6; the German PFPh. */
const pz: PieceSpec = { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM8', tags: { vca: 0, ca: 0 } };
const enemy: PieceSpec = { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM6' };
const game = (pieces: PieceSpec[], dice: number[] = []) => makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice, pieces });
const tankGame = (dice: number[] = []) => game([pz, enemy], dice);
const illegal = (engine: Engine, state: GameState, shot: Record<string, unknown>, mode = 'prep') => engine.env(state).query('ordnance.illegal', { shot: shot as never, mode: mode as never, side: 'ge' }, null);
const SMOKE = { weapon: 'pz', target: 'yM6', targetType: 'ATT', ammo: 'SMOKE' } as const;
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const MGS = { units: [], sw: ['pz.bmg', 'pz.cmg'], target: 'yM6' };

describe('Smoke before anything else the firer fires (SK4 6.2)', () => {
  it("a vehicle's MG fire ends its MA's Smoke for the phase; HE stays open", () => {
    const { engine, state } = tankGame([3, 4]);
    expect(illegal(engine, state, SMOKE)).toBeNull();
    const r = act(engine, state, { type: 'fire', decl: MGS });
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(illegal(engine, r.state, SMOKE)).toMatch(/Smoke must be fired before the firer fires anything else/);
    expect(illegal(engine, r.state, { weapon: 'pz', target: 'yM6', targetType: 'ITT' })).toBeNull();
    // The order is refused by the engine too, not only by the query.
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'fire.ordnance', shot: SMOKE, side: 'ge', decisionId: d.id } as never)).toMatch(/Smoke must be fired before/);
  });

  it('Smoke fired first leaves the MGs free to fire after it', () => {
    // Smoke depletion dr 2 (< 8, kept), TH DR 2+2 hits on the ATT.
    const { engine, state } = tankGame([2, 2, 2, 3, 4]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: SMOKE });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ ammo: 'SMOKE' });
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'fire', decl: MGS, side: 'ge', decisionId: d.id } as never)).toBeNull();
  });

  it("is per firer: another unit's fire leaves the tank's Smoke open", () => {
    const { engine, state } = game([pz, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' }, enemy], [3, 4]);
    const r = act(engine, state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'yM6' } });
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(illegal(engine, r.state, SMOKE)).toBeNull();
  });

  it("a squad manning a Gun that fired its own FP has ended the Gun's Smoke", () => {
    const { engine, state } = game([{ id: 'q', def: 'ge.467', side: 'ge', hex: 'yM8' }, { id: 'g', def: 'ge.AT75Lsa', side: 'ge', heldBy: 'q', tags: { ca: 0 } }, enemy], [3, 4]);
    const shot = { ...SMOKE, weapon: 'g' };
    expect(illegal(engine, state, shot)).toBeNull();
    const r = act(engine, state, { type: 'fire', decl: { units: ['q'], sw: [], target: 'yM6' } });
    expect(illegal(engine, r.state, shot)).toMatch(/Smoke must be fired before the firer/);
  });

  it('the bar lasts the phase: the next Player Turn the tank fires Smoke again before its MGs', () => {
    const { engine, state } = tankGame([6, 5]);
    let s = act(engine, state, { type: 'fire', decl: MGS }).state;
    expect(illegal(engine, s, SMOKE)).toMatch(/Smoke must be fired before/);
    for (let i = 0; i < 60 && !(s.phase === 'PFPh' && s.attacker === 'ge' && s.turn === 2); i++) {
      const d = engine.currentDecision(s)!;
      s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'PFPh']);
    expect(Object.values(s.pieces).filter((p) => p.tags[T2.firedNonSmoke] !== undefined)).toEqual([]);
    expect(illegal(engine, s, SMOKE)).toBeNull();
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'fire', decl: MGS, side: 'ge', decisionId: d.id } as never)).toBeNull();
  });
});
