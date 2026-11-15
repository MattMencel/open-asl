import { describe, expect, it } from 'vitest';
import type { Action, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, moveState, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, RU_VS_GE, type PieceSpec } from '../fixtures';

/*
 * TPBF in full ASL (ASLRB A7.21, A7.211, A8.4, A12.151): fire into one's own Location at enemy units not in Melee, the
 * A12.151 reveal of hidden units by a unit stranded in Bypass, the CC counter, and TPBF at a vehicle's crew from above.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_BR = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'br', name: 'British', nationality: 'br', elr: 3 }] };
type Ev = { type: string; payload: unknown }[];
const attackOf = (events: Ev) => events.find((e) => e.type === 'sk1.fire.attack')?.payload as { fp: number; drm: number; explain: { label?: string }[]; fpExplain: { label?: string }[] } | undefined;
const labels = (events: Ev) => (attackOf(events)?.explain ?? []).map((n) => n.label ?? '');
const fpLabels = (events: Ev) => (attackOf(events)?.fpExplain ?? []).map((n) => n.label ?? '');

describe('A12.151: a unit stranded in Bypass of an obstacle holding hidden units', () => {
  // A German squad bypasses the wooden building R3 along R3-R4; a British squad hides in R3 (HIP by SSR) and another in R5
  // fires at the corner R3-R4-S4.
  const setup = (dice: number[], asl = true) =>
    makeEngine({
      board: 'u',
      terrain: { uR3: { terrain: 'building-wood' } },
      scenario: GE_BR,
      modules: asl ? ASL : SK,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ4' },
        { id: 'h', def: 'br.457', side: 'br', hex: 'uR3', tags: { hip: true } },
        { id: 'v', def: 'br.457', side: 'br', hex: 'uR5' },
      ],
    });
  const bypass = (engine: ReturnType<typeof setup>['engine'], state: GameState) => {
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] }).state;
    return s;
  };
  const fireV = { type: 'defFire', decl: { units: ['v'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } };
  const fireH = { type: 'defFire', decl: { units: ['h'], sw: [], target: 'uR3' } };

  it('a hidden unit stays hidden, and may not fire into its own Location to stay so, while a stack merely bypasses it', () => {
    const { engine, state } = setup([6, 5]);
    const s = bypass(engine, state);
    expect(s.pieces['h']!.tags['hip']).toBe(true);
    expect(engine.currentDecision(s)!.owner).toBe('br');
    expect(engine.validate(s, { side: 'br', decisionId: engine.currentDecision(s)!.id, ...fireH } as never)).toMatch(/own hex/);
  });

  it('broken there: the hidden squad is revealed at once and may TPBF it with FFNAM and FFMO (A12.151)', () => {
    // v: 4 FP at range 2, no TEM, -1 FFNAM -1 FFMO; DR 7 - 2 = 5 on the 4 column: a NMC, failed with an 11. Then h: 4 x3 = 12.
    const { engine, state } = setup([3, 4, 6, 5, 6, 5]);
    let s = act(engine, bypass(engine, state), fireV).state;
    expect(s.pieces['g']!.tags['broken']).toBe(true);
    expect(s.pieces['h']!.tags['hip']).toBeUndefined();
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'br' });
    expect(engine.legalActions(s, 'br').some((a) => a.type === 'defFire' && (a['decl'] as { units: string[] }).units.includes('h'))).toBe(true);
    const r = act(engine, s, fireH);
    expect(attackOf(r.events)!.fp).toBe(12);
    expect(fpLabels(r.events)).toContain('x3 Triple Point Blank Fire');
    expect(labels(r.events)).toEqual(expect.arrayContaining(['-1 FFNAM', '-1 FFMO: in Bypass, in the open']));
    expect(labels(r.events).some((l) => /TEM \(/.test(l))).toBe(false);
  });

  it('pinned there: revealed too, but no FFNAM or FFMO against the pinned unit (A7.83)', () => {
    // v: DR 8 - 2 = 6 on the 4 column, a PTC, failed with a 12.
    const { engine, state } = setup([3, 5, 6, 6, 6, 5]);
    let s = act(engine, bypass(engine, state), fireV).state;
    expect(s.pieces['g']!.tags['pinned']).toBe(true);
    expect(s.pieces['h']!.tags['hip']).toBeUndefined();
    const r = act(engine, s, fireH);
    expect(attackOf(r.events)!.fp).toBe(12);
    expect(attackOf(r.events)!.drm).toBe(0);
  });

  it('across turns: the CC counter when the MPh ends, Final Fire with the building TEM, the stack\'s Advancing Fire TPBF, CC, and the next Player Turn', () => {
    const { engine, state } = setup([3, 5, 6, 6, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5]);
    let s = act(engine, bypass(engine, state), fireV).state;
    s = act(engine, s, fireH).state;
    // The defender passes; the stack's move is over; the MPh ends.
    const go = (pred: (x: GameState) => boolean, prefer: string[]) => {
      for (let i = 0; i < 300 && !pred(s); i++) {
        const d = engine.currentDecision(s)!;
        const legal = engine.legalActions(s, d.owner);
        const a = prefer.map((t) => legal.find((x) => x.type === t)).find(Boolean) ?? legal[0]!;
        s = engine.submit(s, a as Action).state;
      }
    };
    go((x) => x.phase === 'DFPh', ['defPass', 'move.end', 'endPhase']);
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.hexMarkers['uR3']?.['cc']).toBe(true);
    expect(s.hexMarkers['uR3']?.['melee']).toBeUndefined();
    // Final Fire into its own Location (A8.4 "adjacent (or same) hex"): TPBF, the building's TEM now applies.
    const ff = act(engine, s, { type: 'fire', decl: { units: ['h'], sw: [], target: 'uR3' } });
    expect(fpLabels(ff.events)).toContain('x3 Triple Point Blank Fire');
    expect(labels(ff.events).some((l) => /TEM/.test(l))).toBe(true);
    s = ff.state;
    go((x) => x.phase === 'AFPh', ['endPhase']);
    // The stack's Advancing Fire at the British in its Location: TPBF, halved.
    const af = act(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uR3' } });
    expect(fpLabels(af.events)).toEqual(expect.arrayContaining(['x3 Triple Point Blank Fire', '½ Advancing Fire']));
    s = af.state;
    go((x) => x.turn > state.turn && x.attacker === 'ge' && x.phase === 'MPh', ['defPass', 'endPhase', 'cc.pass', 'cc.declare']);
    expect(s.attacker).toBe('ge');
    expect(s.phase).toBe('MPh');
    expect(s.hexMarkers['uR3']?.['cc']).toBeUndefined();
    for (const p of Object.values(s.pieces)) expect(p.tags['fire']).toBeUndefined();
  });
});

describe('Fire into one\'s own Location (ASLRB A7.21)', () => {
  const pieces: PieceSpec[] = [
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ4' },
    { id: 'b', def: 'br.457', side: 'br', hex: 'uQ4' },
  ];
  it('in the Starter Kit only at a vehicle; in full ASL at Infantry not in Melee, never in Melee', () => {
    const sk = makeEngine({ board: 'u', scenario: GE_BR, modules: SK, startPhase: 'PFPh', pieces });
    const fire = { type: 'fire', decl: { units: ['g'], sw: [], target: 'uQ4' } };
    const v = (e: typeof sk.engine, s: GameState) => e.validate(s, { side: 'ge', decisionId: e.currentDecision(s)!.id, ...fire } as never);
    expect(v(sk.engine, sk.state)).toMatch(/own hex/);
    const asl = makeEngine({ board: 'u', scenario: GE_BR, modules: ASL, startPhase: 'PFPh', pieces });
    expect(v(asl.engine, asl.state)).toBeNull();
    const melee = makeEngine({ board: 'u', scenario: GE_BR, modules: ASL, startPhase: 'PFPh', pieces, hexMarkers: { uQ4: { melee: true } } });
    expect(v(melee.engine, melee.state)).toMatch(/Melee/);
  });
});

describe('TPBF at a vehicle\'s crew from the level above (ASLRB A7.211)', () => {
  const LEVELS = { upper: 1 as const, stairwell: 'inherent' as const };
  const HOUSE: Record<string, HexTerrainSpec> = {
    uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
    uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  };
  const game = (below: PieceSpec[]) =>
    makeEngine({ board: 'u', terrain: HOUSE, scenario: { ...RU_VS_GE, firstSide: 'ru' }, modules: ASL, startPhase: 'PFPh', dice: [3, 4], pieces: [{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 }, ...below] });
  const fire = { type: 'fire', decl: { units: ['r'], sw: [], target: 'uK4' } };
  it('tripled when every target is a vehicle; doubled (PBF) when Infantry is there too', () => {
    const v = { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uK4', tags: { vca: 0, ca: 0, ce: true } };
    const a = game([v]);
    const r = act(a.engine, a.state, fire);
    expect(attackOf(r.events)!.fp).toBe(12);
    expect(fpLabels(r.events)).toContain('x3 TPBF at the crew from the level above (ASLRB A7.211)');
    const b = game([v, { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' }]);
    expect(attackOf(act(b.engine, b.state, fire).events)!.fp).toBe(8);
    const c = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' }]);
    expect(attackOf(act(c.engine, c.state, fire).events)!.fp).toBe(8);
  });
});
