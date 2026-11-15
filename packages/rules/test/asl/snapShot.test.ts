import { describe, expect, it } from 'vitest';
import type { Action, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, moveState, piecesModule, SNAP, snapSide, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Snap Shot (ASLRB A8.15, A8.223, C.5): Defensive First Fire traced to the whole hexside the moving stack crossed. Board
 * u's grid with the single-hex wooden building R3: the German squad steps from Q4 into R3 across the R3-Q4 hexside.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const BUILDING: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };

function game(pieces: PieceSpec[], opts: { terrain?: Record<string, HexTerrainSpec>; dice?: number[]; asl?: boolean; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  return makeEngine({
    board: 'u',
    terrain: opts.terrain ?? BUILDING,
    scenario: { ...RU_VS_GE, firstSide: 'ge' },
    modules: opts.asl === false ? SK : ASL,
    startPhase: 'MPh',
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}),
  });
}
type Eng = ReturnType<typeof game>['engine'];
const squad = (id = 'g', hex = 'uQ4'): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const SIDE: [string, string] = ['uR3', 'uQ4'];
const start = (engine: Eng, s: GameState, units = ['g']) => act(engine, s, { type: 'move.start', units }).state;
const into = (engine: Eng, s: GameState, to = 'uR3', extra: Record<string, unknown> = {}) => act(engine, start(engine, s), { type: 'move.step', to, ...extra }).state;
const check = (engine: Eng, s: GameState, a: Record<string, unknown>) => engine.validate(s, { side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id, ...a } as never);
const pass = (engine: Eng, s: GameState) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === 'ru' && engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
type Ev = { type: string; payload: unknown }[];
const attackOf = (events: Ev) => events.find((e) => e.type === 'sk1.fire.attack')?.payload as { fp: number; drm: number; explain: { label?: string }[]; fpExplain: { label?: string }[]; attack: { snap?: unknown } } | undefined;
const labels = (events: Ev) => (attackOf(events)?.explain ?? []).map((n) => n.label ?? '');
const fpLabels = (events: Ev) => (attackOf(events)?.fpExplain ?? []).map((n) => n.label ?? '');
const snapFire = (units: string[], sw: string[] = [], extra: Record<string, unknown> = {}) => ({ type: 'defFire', decl: { units, sw, target: 'uR3', snap: SIDE, ...extra } });

describe('Snap Shot (ASLRB A8.15)', () => {
  it('is not in the Starter Kit', () => {
    const { engine, state } = game([squad(), ru('r', 'uR5')], { asl: false });
    const s = into(engine, state);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    expect(engine.legalActions(s, 'ru').some((a) => (a['decl'] as { snap?: unknown } | undefined)?.snap)).toBe(false);
    expect(check(engine, s, snapFire(['r']))).toMatch(/No Snap Shot here/);
  });

  it('at a unit entering a building: Area Fire, no TEM, FFNAM or FFMO, no Residual FP; the hexside is recorded and the firer marked First Fire', () => {
    const { engine, state } = game([squad(), ru('r', 'uR5')], { dice: [3, 4] });
    const s = into(engine, state);
    expect(snapSide(engine.env(s), 'uR3')).toEqual(SIDE);
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'defFire' && (a['decl'] as { snap?: unknown }).snap)).toBe(true);
    const r = act(engine, s, snapFire(['r']));
    const at = attackOf(r.events)!;
    expect(at.attack.snap).toEqual(SIDE);
    expect(at.fp).toBe(2);
    expect(fpLabels(r.events)).toContain('½ Snap Shot (Area Fire)');
    expect(at.drm).toBe(0);
    expect(labels(r.events).some((l) => /TEM|FFNAM|FFMO/.test(l))).toBe(false);
    expect(r.state.hexMarkers['uR3']?.['residualFp']).toBeUndefined();
    expect(r.state.pieces['r']!.tags['fire']).toBe('first');
    // The same shot at the hex centre: full FP, the building's TEM and FFNAM.
    const { engine: e2, state: s2 } = game([squad(), ru('r', 'uR5')], { dice: [3, 4] });
    const r2 = act(e2, into(e2, s2), { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(attackOf(r2.events)!.fp).toBe(4);
    expect(labels(r2.events).some((l) => /TEM/.test(l))).toBe(true);
    expect(labels(r2.events)).toContain('-1 FFNAM');
  });

  it('prompts a defender who can see only the hexside, never deciding LOS for him; the Starter Kit does not', () => {
    // Woods in S5 hide R3's centre from T7, not the R3-Q4 hexside (the A8.15 EX, the 4-4-7 in K2).
    const terrain = { ...BUILDING, uS5: { terrain: 'woods' } };
    const { engine, state } = game([squad(), ru('r', 'uT7')], { terrain, dice: [6, 5] });
    const s = into(engine, state);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const centre = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(centre.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    const sk = game([squad(), ru('r', 'uT7')], { terrain, asl: false });
    expect(engine.currentDecision(into(sk.engine, sk.state))).not.toMatchObject({ owner: 'ru' });
    // From S4 the far corner is behind the building in R3: the Snap Shot is declared, fired and blocked (A6.11).
    const g2 = game([squad(), ru('r', 'uS4')], { dice: [6, 5] });
    const blocked = act(g2.engine, into(g2.engine, g2.state), snapFire(['r']));
    expect(blocked.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    expect(blocked.state.pieces['r']!.tags['fire']).toBe('first');
  });

  it('one Snap Shot per firer at a crossing, though the stack spent two MF entering; the per-MF limit counts it', () => {
    const { engine, state } = game([squad(), ru('r', 'uR5')], { dice: [6, 5, 6, 5, 6, 5] });
    let s = into(engine, state);
    expect(moveState(engine.env(s))!.mfHere).toBe(2);
    s = act(engine, s, snapFire(['r'])).state;
    expect(check(engine, s, snapFire(['r']))).toMatch(/already made its Snap Shot/);
    // A normal shot at the hex is its Subsequent First Fire, within the MF spent there.
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(fpLabels(r.events)).toContain('½ Subsequent First Fire');
    // r has now fired twice for the two MF spent there: no further shot, so the defender is no longer asked.
    expect(engine.currentDecision(r.state)!.owner).toBe('ge');
  });

  it('a Subsequent First Fire Snap Shot is halved twice; FPF at an adjacent hexside takes its NMC', () => {
    // r first fires at the stack in Q5, then snaps at it entering R3 (its range 2 from R5) at ¼ FP.
    const { engine, state } = game([squad('g', 'uQ5'), ru('r', 'uR5')], { dice: [6, 5, 6, 5, 6, 5] });
    let s = act(engine, start(engine, state), { type: 'move.step', to: 'uQ4' }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uQ4' } }).state;
    s = act(engine, pass(engine, s), { type: 'move.step', to: 'uR3' }).state;
    const r = act(engine, s, snapFire(['r']));
    expect(fpLabels(r.events)).toEqual(expect.arrayContaining(['½ Subsequent First Fire', '½ Snap Shot (Area Fire)']));
    expect(attackOf(r.events)!.fp).toBe(1);
    // Marked Final now: a Snap Shot from R4, adjacent to R3, is FPF and checks the firer.
    const f = game([squad(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR4', tags: { fire: 'final' } }], { dice: [6, 5, 3, 3] });
    const fr = act(f.engine, into(f.engine, f.state), snapFire(['r']));
    expect(attackOf(fr.events)!.attack.snap).toEqual(SIDE);
    expect(fr.events.some((e) => e.type === 'sk1.check' && (e.payload as { reason?: string }).reason === 'FPF')).toBe(true);
  });

  it('Small Arms and MGs only: an ATR is refused with the reason, an LMG fires', () => {
    const { engine, state } = game([squad(), ru('r', 'uR5'), { id: 'atr', def: 'ru.ATR', side: 'ru', heldBy: 'r' }, ru('r2', 'uR6'), { id: 'lmg', def: 'ru.LMG', side: 'ru', heldBy: 'r2' }], { dice: [6, 6] });
    const s = into(engine, state);
    expect(check(engine, s, snapFire([], ['atr']))).toMatch(/Only Small Arms and MGs.*ATR/);
    expect(check(engine, s, snapFire(['r2'], ['lmg']))).toBeNull();
    // The squad holding the ATR is still offered its Snap Shot, the ATR left out (a weapon that cannot, its holder can).
    const offered = engine.legalActions(s, 'ru').filter((a) => a.type === 'defFire' && (a['decl'] as { snap?: unknown }).snap).map((a) => a['decl'] as { units: string[]; sw: string[] });
    expect(offered.some((d) => d.units.includes('r') && !d.sw.includes('atr'))).toBe(true);
    expect(offered.some((d) => d.sw.includes('atr'))).toBe(false);
  });

  it('a vehicle MG Snap Shot: allowed in its Covered Arc, refused if the turret must turn', () => {
    const t34 = { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'uR5', tags: { vca: 0, ca: 0 } };
    const { engine, state } = game([squad(), t34], { dice: [6, 6] });
    const s = into(engine, state);
    const turned = check(engine, s, snapFire([], ['t34.cmg'], { tca: 3 }));
    expect(turned).toMatch(/Covered Arc cannot make a Snap Shot|turret/);
    const inArc = [0, 1, 2, 3, 4, 5].some((tca) => check(engine, s, snapFire([], ['t34.cmg'], tca === 0 ? {} : { tca })) === null);
    expect(inArc).toBe(true);
  });

  it('Snap Shots form a Mandatory Fire Group only with each other; a Location without LOS drops out (A6.11)', () => {
    const { engine, state } = game([squad(), ru('a', 'uR5'), ru('b', 'uR5'), ru('c', 'uS5')], { dice: [6, 5, 6, 5, 6, 5] });
    let s = into(engine, state);
    s = act(engine, s, snapFire(['a'])).state;
    expect(check(engine, s, snapFire(['b']))).toMatch(/must form one Fire Group/);
    expect(check(engine, s, { type: 'defFire', decl: { units: ['b'], sw: [], target: 'uR3' } })).toBeNull();
    // R5 and S5 together: S5 does not see the whole hexside, so only R5's FP attacks.
    const g2 = game([squad(), ru('a', 'uR5'), ru('c', 'uS5')], { dice: [6, 5] });
    const r = act(g2.engine, into(g2.engine, g2.state), snapFire(['a', 'c']));
    const noLos = r.events.find((e) => e.type === 'sk1.fire.noLos')!.payload as { from: string[] };
    expect(noLos.from).toEqual(['uS5']);
    expect(attackOf(r.events)!.fp).toBe(2);
  });

  it('SMOKE in the hex entered does not count; SMOKE the LOF crosses does', () => {
    const inR3 = game([squad(), ru('r', 'uR5')], { dice: [6, 6], hexMarkers: { uR3: { smoke: true } } });
    const a = act(inR3.engine, into(inR3.engine, inR3.state), snapFire(['r']));
    expect(attackOf(a.events)!.drm).toBe(0);
    const inR4 = game([squad(), ru('r', 'uR5')], { dice: [6, 6], hexMarkers: { uR4: { smoke: true } } });
    const b = act(inR4.engine, into(inR4.engine, inR4.state), snapFire(['r']));
    expect(attackOf(b.events)!.drm).toBeGreaterThan(0);
  });

  it('no Snap Shot once the stack spends another MF there, up the stairs, or round the same Bypass hex', () => {
    const { engine, state } = game([squad(), ru('r', 'uR5')]);
    let s = pass(engine, into(engine, state, 'uR4'));
    expect(snapSide(engine.env(s), 'uR4')).toEqual(['uR4', 'uQ4']);
    s = pass(engine, act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uR4' }).state);
    expect(snapSide(engine.env(s), 'uR4')).toBeNull();
    // Into Bypass of R3 from Q4: the R3-Q4 hexside; on round: none.
    const b = game([squad(), ru('r', 'uY9')]);
    let x = pass(b.engine, into(b.engine, b.state, 'uR3', { bypass: ['uR4', 'uS4'] }));
    expect(snapSide(b.engine.env(x), 'uR3')).toEqual(SIDE);
    // A third hexside costs another MF (A4.31): a new expenditure in the same hex, no hexside crossed.
    x = pass(b.engine, act(b.engine, x, { type: 'move.step', to: 'uR3', bypass: ['uS3'] }).state);
    expect(snapSide(b.engine.env(x), 'uR3')).toBeNull();
  });

  it('across turns: a Snap Shot pins one unit, the MPh goes on and ends, and next Player Turn everything moves and fires normally', () => {
    // 4 FP x½ = 2 column, DR 6: a PTC; the PTC DR 12 pins the squad.
    const { engine, state } = game([squad('g'), squad('h', 'uQ5'), ru('r', 'uR5')], { dice: [2, 4, 6, 6] });
    let s = into(engine, state);
    const r = act(engine, s, snapFire(['r']));
    s = r.state;
    expect(s.pieces['g']!.tags['pinned']).toBe(true);
    // g's move is over (pinned; r has no shot left that it may take there): the crossing's record is gone with it.
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.ext[SNAP]).toBeUndefined();
    // Play on to the Germans' next MPh, passing and ending phases.
    for (let i = 0; i < 400 && !(s.turn > state.turn && s.attacker === 'ge' && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase') ?? engine.legalActions(s, d.owner)[0]!;
      s = engine.submit(s, a as Action).state;
    }
    expect(s.attacker).toBe('ge');
    expect(s.phase).toBe('MPh');
    expect(s.ext[SNAP]).toBeUndefined();
    expect(s.pieces['g']!.tags['pinned']).toBeUndefined();
    expect(s.pieces['r']!.tags['fire']).toBeUndefined();
    // g leaves R3 into R4 across a new hexside, and r may Snap Shot again.
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uR4' }).state;
    expect(snapSide(engine.env(s), 'uR4')).toEqual(['uR4', 'uR3']);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    expect(check(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR4', snap: ['uR4', 'uR3'] } })).toBeNull();
  });
});
