import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { attackFp, buildAttack } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Final Fire under the manning unit's First Fire marker (SK4 3.3.3): "A unit marked with First Fire has its and its
 * Weapon's FP halved", and "A Gun/MA marked with a First Fire counter may Intensive Fire (3.2.4) at units in an adjacent
 * (or same) hex" (+2 To Hit, B# -2; ASLRB C2.241). A crew fires its Gun or its own FP, not both (SK4 4.0), so a crew
 * that First Fired its own FP in the MPh has its unfired Gun marked with it: in the DFPh the Gun fires only as Intensive
 * Fire at an adjacent hex. A squad's SW keeps its own marker: the squad fires one SW at no cost to its own FP (SK1 4.0),
 * and its MMG fires unmarked after the squad First Fired (SK4 Movement Phase and Defensive First Fire Example; A8.41).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
/** A German crew in yK5 with a 75L AT Gun aimed south (spine 3); Russian squads to the south move in their MPh. */
const crewGun: PieceSpec[] = [{ id: 'c', def: 'ge.228c', side: 'ge', hex: 'yK5' }, { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'c', tags: { ca: 3 } }];
const russians: PieceSpec[] = [{ id: 'r1', def: 'ru.447', side: 'ru', hex: 'yK8' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yK8' }];
const game = (pieces: PieceSpec[], dice: number[]) => makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ru' }, extra, startPhase: 'MPh', dice, pieces });
const pass = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const validate = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { ...a, side: d.owner, decisionId: d.id } as never);
};
const toPhase = (engine: Engine, s: GameState, phase: string, attacker: string) => {
  for (let i = 0; i < 60 && !(s.phase === phase && s.attacker === attacker); i++) {
    const d = engine.currentDecision(s)!;
    s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
  }
  return s;
};

/**
 * The Russian MPh: r1 moves into yK7 (2 hexes from the crew), where the crew First Fires its own FP at it (DR 6+5, no
 * effect); then r2 moves through yK7 (the Residual FP there attacks it: DR 6+5, no effect) into yK6, next to the crew,
 * unfired on. Then the DFPh, the crew marked First Fire.
 */
function crewFirstFired(dice: number[], pieces: PieceSpec[] = [...crewGun, ...russians], firer: { units: string[]; sw: string[] } = { units: ['c'], sw: [] }) {
  const { engine, state } = game(pieces, [6, 5, 6, 5, ...dice]);
  let s = pass(engine, act(engine, state, { type: 'move.start', units: ['r1'] }).state);
  s = act(engine, s, { type: 'move.step', to: 'yK7' }).state;
  expect(engine.currentDecision(s)?.kind).toBe('firstFire');
  s = act(engine, s, { type: 'defFire', decl: { ...firer, target: 'yK7' } }).state;
  s = pass(engine, s);
  s = pass(engine, act(engine, s, { type: 'move.end' }).state);
  s = pass(engine, act(engine, s, { type: 'move.start', units: ['r2'] }).state);
  s = pass(engine, act(engine, s, { type: 'move.step', to: 'yK7' }).state);
  s = pass(engine, act(engine, s, { type: 'move.step', to: 'yK6' }).state);
  s = pass(engine, act(engine, s, { type: 'move.end' }).state);
  s = toPhase(engine, s, 'DFPh', 'ru');
  return { engine, s };
}

describe("a Gun in Final Fire under its crew's First Fire marker (SK4 3.3.3)", () => {
  it('the crew is marked First Fire and its Gun is not, yet in the DFPh the Gun fires only as Intensive Fire at an adjacent hex', () => {
    const { engine, s } = crewFirstFired([]);
    expect(s.pieces['c']!.tags['fire']).toBe('first');
    expect(s.pieces['gun']!.tags['fire']).toBeUndefined();
    // At yK7, two hexes away: neither a normal shot nor Intensive Fire.
    expect(validate(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK7', targetType: 'ITT' } })).toMatch(/manning unit is marked First Fire/);
    expect(validate(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK7', targetType: 'ITT', intensive: true } })).toMatch(/only possible against an adjacent hex/);
    // At yK6, adjacent: Intensive Fire only.
    expect(validate(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK6', targetType: 'ITT' } })).toMatch(/manning unit is marked First Fire/);
    expect(validate(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK6', targetType: 'ITT', intensive: true } })).toBeNull();
    // What the side is offered agrees: no normal Gun shot in the legal list.
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'fire.ordnance') as unknown as { shot: { weapon: string; target: string; intensive?: boolean } }[];
    expect(offered.filter((a) => a.shot.weapon === 'gun' && !a.shot.intensive)).toEqual([]);
  });

  it('the Intensive Fire shot takes +2 To Hit, and an original DR 11 malfunctions the Gun (B# 12 - 2 = 10, removal only from 12)', () => {
    const { engine, s } = crewFirstFired([5, 6]);
    const r = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK6', targetType: 'ITT', intensive: true } });
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot).toMatchObject({ intensive: true, mode: 'final', dr: [5, 6] });
    expect((shot['explain'] as { label?: string }[]).some((n) => /Intensive/.test(n.label ?? ''))).toBe(true);
    expect(r.state.pieces['gun']!.tags).toMatchObject({ malf: true, intensive: true });
  });

  it('a crew marked Final Fire leaves its Gun no Final Fire at all', () => {
    const { engine, s } = crewFirstFired([]);
    const t = { ...s, pieces: { ...s.pieces, c: { ...s.pieces['c']!, tags: { ...s.pieces['c']!.tags, fire: 'final' } } } };
    expect(validate(engine, t, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK6', targetType: 'ITT', intensive: true } })).toMatch(/marked Final Fire/);
  });

  it('next Player Turn the markers are gone and the Gun fires normally at any range', () => {
    const { engine, s } = crewFirstFired([]);
    const t = toPhase(engine, s, 'PFPh', 'ge');
    expect(t.pieces['c']!.tags['fire']).toBeUndefined();
    expect(t.pieces['gun']!.tags['fire']).toBeUndefined();
    expect(validate(engine, t, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK7', targetType: 'ITT' } })).toBeNull();
  });
});

describe('Final Fire of a SW whose holder is marked First Fire (SK4 3.3.3, SK1 4.0)', () => {
  it("a half-squad's LMG fires with it: adjacent only, at half FP", () => {
    const pieces: PieceSpec[] = [{ id: 'h', def: 'ge.247', side: 'ge', hex: 'yK5' }, { id: 'l', def: 'ge.LMG', side: 'ge', heldBy: 'h' }, ...russians];
    const { engine, s } = crewFirstFired([], pieces, { units: ['h'], sw: [] });
    expect(s.pieces['h']!.tags['fire']).toBe('first');
    expect(validate(engine, s, { type: 'fire', decl: { units: [], sw: ['l'], target: 'yK7' } })).toMatch(/marked First Fire and may only fire at an adjacent hex|may not then fire a weapon/);
    expect(validate(engine, s, { type: 'fire', decl: { units: [], sw: ['l'], target: 'yK6' } })).toBeNull();
    const env = engine.env(s);
    // 3 FP halved, then doubled Point Blank ("halved (and doubled due to the effect of PBF)", SK4 3.3.3): 3, not 6.
    expect(attackFp(env, buildAttack(env, { units: [], sw: ['l'], target: 'yK6' }, 'final', 'ge'))).toBe(3);
  });

  it("a squad's unfired LMG keeps its own marker: full FP at any range in its reach", () => {
    const pieces: PieceSpec[] = [{ id: 'q', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'l', def: 'ge.LMG', side: 'ge', heldBy: 'q' }, ...russians];
    const { engine, s } = crewFirstFired([], pieces, { units: ['q'], sw: [] });
    expect(s.pieces['q']!.tags['fire']).toBe('first');
    expect(validate(engine, s, { type: 'fire', decl: { units: [], sw: ['l'], target: 'yK7' } })).toBeNull();
    const env = engine.env(s);
    expect(attackFp(env, buildAttack(env, { units: [], sw: ['l'], target: 'yK7' }, 'final', 'ge'))).toBe(3);
  });
});

/*
 * A crew fires its Gun or its own FP, not both (SK4 4.0): its own fire marks the Gun's fire too in every phase. Prep
 * Fire marks "the firing unit (and Weapon)" (SK4 3.2.2), and only units "which did not fire in the PFPh" fire in the
 * AFPh (ASLRB A3.5).
 */
describe("a Gun after its crew fired its own FP (SK4 4.0)", () => {
  const ge = (dice: number[]) => makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice, pieces: [...crewGun, ...russians] });
  const shot = (target: string, intensive = false) => ({ type: 'fire.ordnance', shot: { weapon: 'gun', target, targetType: 'ITT', ...(intensive ? { intensive } : {}) } });
  const gunShots = (engine: Engine, s: GameState) =>
    (engine.legalActions(s, 'ge').filter((a) => a.type === 'fire.ordnance') as unknown as { shot: { weapon: string } }[]).filter((a) => a.shot.weapon === 'gun');

  it('a crew that Prep Fired its own FP fires its Gun neither in the PFPh nor in the AFPh', () => {
    const { engine, state } = ge([6, 5]);
    const s = act(engine, state, { type: 'fire', decl: { units: ['c'], sw: [], target: 'yK8' } }).state;
    expect(s.pieces['c']!.tags['fire']).toBe('prep');
    expect(validate(engine, s, shot('yK8'))).toMatch(/crew that fired its own FP this phase/);
    expect(validate(engine, s, shot('yK8', true))).toMatch(/crew that fired its own FP this phase/);
    expect(gunShots(engine, s)).toEqual([]);
    const afph = toPhase(engine, s, 'AFPh', 'ge');
    expect(validate(engine, afph, shot('yK8'))).toMatch(/crew that fired its own FP in the PFPh/);
    expect(gunShots(engine, afph)).toEqual([]);
    // Next Player Turn the crew's marker is gone and the Gun fires.
    const next = toPhase(engine, afph, 'DFPh', 'ru');
    expect(next.pieces['c']!.tags['fire']).toBeUndefined();
    expect(validate(engine, next, { type: 'fire.ordnance', shot: { weapon: 'gun', target: 'yK8', targetType: 'ITT' } })).toBeNull();
  });

  it('a Gun that keeps ROF fires again; one that loses it is done for the phase', () => {
    // To Hit 3+1: colored 1 within ROF 2, a hit (IFT 6+6, no effect). Then 4+5: colored 5, ROF lost (a miss).
    const { engine, state } = ge([3, 1, 6, 6, 4, 5]);
    let s = act(engine, state, shot('yK8')).state;
    expect(validate(engine, s, shot('yK8'))).toBeNull();
    s = act(engine, s, shot('yK8')).state;
    expect(validate(engine, s, shot('yK8'))).toMatch(/already fired this phase/);
    // Nor may the crew then fire its own FP.
    expect(validate(engine, s, { type: 'fire', decl: { units: ['c'], sw: [], target: 'yK8' } })).not.toBeNull();
  });
});
