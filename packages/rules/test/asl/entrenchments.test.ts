import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  aslCoreModules,
  entrenchDrm,
  entrenchmentRoom,
  fortCounters,
  fortificationView,
  moveState,
  parseLabor,
  piecesModule,
  routRequirement,
  turnModule,
  type FortPlacement,
  type HexTerrainSpec,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Foxholes and trenches in play and Entrenching (ASLRB B27, A4.8, A25.21, B24.8): the Entrenching DR and its DRM, the
 * foxhole that grows, TI and Labor, the separate MF into and out of a foxhole with the Defensive First Fire it draws,
 * the combined entry under Assault Movement, the TEM per unit, the reveal of a hidden foxhole by its TEM, capacity per
 * side, connected trenches, rout beneath a foxhole, rally in a trench, advancing beneath and Recovery across the rim.
 * The ground is a stretch of board u: K4 a stone building, L4 woods, M4 a paved road hex, N4 brush, P3 a level-one hill
 * hex with a stone house (level 1 at height 2); everything else Open Ground.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: { upper: 1, stairwell: 'inherent' }, obstacleHeight: 1.5 },
  uL4: { terrain: 'woods' },
  uM4: { terrain: 'open', features: ['road:paved'] },
  uN4: { terrain: 'brush' },
  uP3: { terrain: 'building-stone', buildingId: 'u-B99', building: { upper: 1, stairwell: 'inherent' }, obstacleHeight: 1.5, elevation: 1 },
  uQ3: { terrain: 'open', elevation: 1 },
  uM6: { terrain: 'woods' },
};

/** Test actions: counters placed outright (the special rule's placement answers a setup decision), teleports and tags. */
const testModule: RuleModule = {
  id: 'test.entrench',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; ent?: 'foxhole' | 'trench' | 'ditch'; wire?: 'on' | 'beneath' }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        const pos = { ...(a.ent ? { ent: a.ent } : {}), ...(a.wire ? { wire: a.wire } : {}) };
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(Object.keys(pos).length ? { pos } : {}) } });
      },
    });
    r.action<Action & { id: string }>({
      type: 'test.eliminate',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.eliminated', { id: a.id });
      },
    });
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru'; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uM4', 'uM5']], scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'PFPh', dice: opts.dice ?? [], ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}) });
}
type Eng = Engine;
const fox = (hex: string, capacity: 1 | 2 | 3 = 1, hidden = false): FortPlacement => ({ kind: 'foxhole', hex, hidden, capacity });
const trench = (hex: string, hidden = false): FortPlacement => ({ kind: 'trench', hex, hidden });
const place = (engine: Eng, state: GameState, fortSide: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide, counters }).state;
const tele = (engine: Eng, state: GameState, id: string, hex: string, ent?: 'foxhole' | 'trench' | 'ditch', wire?: 'on' | 'beneath') => act(engine, state, { type: 'test.teleport', id, hex, ...(ent ? { ent } : {}), ...(wire ? { wire } : {}) }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const legal = (engine: Eng, s: GameState, type: string) => engine.legalActions(s, engine.currentDecision(s)!.owner).filter((a) => a.type === type);
const loc = (s: GameState, id: string) => s.pieces[id]!.loc as { hex: string; pos?: { ent?: string } };
const pass = (engine: Eng, s: GameState, side: string) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === side) x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uY10'), ru('rfar', 'uA1')];
const labels = (events: { type: string; payload: unknown }[], type = 'sk1.fire.attack') => ((events.find((e) => e.type === type)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const unitLabels = (events: { type: string; payload: unknown }[], unit: string) =>
  ((events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === unit)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');

describe('Entrenching (B27.11, B27.12, A25.21, B24.8, A4.8)', () => {
  it('a Russian squad in Open Ground digs a 1S foxhole on a DR of 5 with the -1 (A25.21), stands beneath it and is TI for the Player Turn', () => {
    const { engine, state } = game([ru('r', 'uN5'), ...far], { first: 'ru', dice: [2, 3] });
    const offered = legal(engine, state, 'entrench.attempt');
    expect(offered.map((a) => a['loc'])).toContain('uN5');
    expect(entrenchDrm(engine.env(state), 'uN5', 'r')).toEqual({ drm: -1, explain: ['-1 Russian'] });
    const r = act(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'r' }] });
    expect(r.events.find((e) => e.type === 'asl.entrench.attempt')?.payload).toMatchObject({ unit: 'r', dr: [2, 3], drm: -1, success: true, capacity: 1 });
    expect(fortCounters(engine.env(r.state))).toMatchObject([{ kind: 'foxhole', hex: 'uN5', side: 'ru', capacity: 1, hidden: false }]);
    expect(loc(r.state, 'r')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    expect(r.state.pieces['r']!.tags['ti']).toBe(true);
    const env = engine.env(r.state);
    expect(env.query('fire.illegal', { decl: { units: ['r'], sw: [], target: 'uN8' }, mode: 'prep', side: 'ru' }, null)).toMatch(/TI/);
    expect(env.query('move.cannotStart', { units: ['r'], doubleTime: false, assault: false }, null)).toMatch(/TI/);
    expect(env.query('unit.cannotAdvance', { unit: 'r' }, null)).toMatch(/TI/);
    expect(check(engine, r.state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'r' }] })).toMatch(/TI|already beneath/);
  });

  it('a German HS needs a 4 (+1 HS); a failure earns Labor -1, a second -2, and the third attempt rolls at -2 (B24.8)', () => {
    const { engine, state } = game([ge('h', 'uN5', 'ge.247'), ...far], { dice: [3, 3, 4, 3, 1, 2] });
    expect(entrenchDrm(engine.env(state), 'uN5', 'h')).toEqual({ drm: 1, explain: ['+1 HS'] });
    let r = act(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'h' }] });
    expect(r.events.find((e) => e.type === 'asl.entrench.attempt')?.payload).toMatchObject({ success: false, labor: -1 });
    expect(parseLabor(r.state.pieces['h']!.tags['labor'])).toEqual({ task: 'entrench:uN5', drm: -1 });
    let s = act(engine, r.state, { type: 'test.tag', id: 'h', tags: { ti: null } }).state;
    expect(entrenchDrm(engine.env(s), 'uN5', 'h')).toEqual({ drm: 0, explain: ['+1 HS', '-1 Labor'] });
    r = act(engine, s, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'h' }] });
    expect(r.events.find((e) => e.type === 'asl.entrench.attempt')?.payload).toMatchObject({ success: false, labor: -2 });
    s = act(engine, r.state, { type: 'test.tag', id: 'h', tags: { ti: null } }).state;
    r = act(engine, s, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'h' }] });
    expect(r.events.find((e) => e.type === 'asl.entrench.attempt')?.payload).toMatchObject({ dr: [1, 2], drm: -1, success: true });
    // The Task achieved: the Labor counter comes off.
    expect(r.state.pieces['h']!.tags['labor']).toBeUndefined();
  });

  it('a leader directs every attempt in his Location with his leadership, is TI and goes beneath with the diggers; a leader alone cannot entrench', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ge('l', 'uN5', 'ge.L91'), ...far], { dice: [4, 3, 4, 3] });
    const r = act(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a', director: 'l' }, { unit: 'b', director: 'l' }] });
    const attempts = r.events.filter((e) => e.type === 'asl.entrench.attempt').map((e) => e.payload as { success: boolean; drm: number; capacity?: number });
    expect(attempts).toMatchObject([{ drm: -1, success: false }, { drm: -1, success: false }]);
    for (const id of ['a', 'b', 'l']) expect(r.state.pieces[id]!.tags['ti']).toBe(true);
    expect(loc(r.state, 'l').pos).toBeUndefined();
    expect(check(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'l' }] })).toMatch(/not an Infantry MMC/);
    const ok = game([ge('a', 'uN5'), ge('b', 'uN5'), ge('l', 'uN5', 'ge.L91'), ...far], { dice: [3, 3, 3, 3] });
    const r2 = act(ok.engine, ok.state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a', director: 'l' }, { unit: 'b', director: 'l' }] });
    expect(fortCounters(ok.engine.env(r2.state))).toMatchObject([{ kind: 'foxhole', hex: 'uN5', capacity: 2 }]);
    for (const id of ['a', 'b', 'l']) expect(loc(r2.state, id).pos).toEqual({ ent: 'foxhole' });
  });

  it('a second success grows the 1S to 2S and a third to 3S; a hex never holds more (B27.12)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ge('c', 'uN5'), ge('d', 'uN5'), ...far], { dice: [1, 1, 1, 1, 1, 1] });
    const r = act(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a' }, { unit: 'b' }, { unit: 'c' }] });
    expect(fortCounters(engine.env(r.state))).toMatchObject([{ kind: 'foxhole', hex: 'uN5', capacity: 3 }]);
    expect(r.events.filter((e) => e.type === 'asl.fort.grown')).toHaveLength(2);
    for (const id of ['a', 'b', 'c']) expect(loc(r.state, id).pos).toEqual({ ent: 'foxhole' });
    expect(entrenchmentRoom(engine.env(r.state), 'uN5', 'ge')).toMatchObject({ se: 0, smc: 4 });
    expect(check(engine, r.state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'd' }] })).toMatch(/3S already/);
    expect(check(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a' }, { unit: 'b' }, { unit: 'c' }, { unit: 'd' }] })).toMatch(/three squads/);
  });

  it('is refused in a building, paved road, trench or pillbox hex, beneath an entrenchment, on top of Wire, after firing, broken, outside the PFPh and to the DEFENDER', () => {
    const { engine, state } = game([ge('k', 'uK4'), ge('m', 'uM4'), ge('t', 'uO5'), ge('p', 'uO6'), ge('w', 'uN6'), ge('f', 'uN7'), ge('b', 'uN8'), ...far]);
    let s = place(engine, state, 'ge', [trench('uO5'), { kind: 'pillbox', hex: 'uO6', hidden: false, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } }, { kind: 'wire', hex: 'uN6', hidden: false }]);
    s = tele(engine, s, 't', 'uO5', 'trench');
    s = tele(engine, s, 'w', 'uN6', undefined, 'on');
    s = act(engine, s, { type: 'test.tag', id: 'f', tags: { fire: 'prep' } }).state;
    s = act(engine, s, { type: 'test.tag', id: 'b', tags: { broken: true } }).state;
    const refuse = (unit: string, loc: string) => check(engine, s, { type: 'entrench.attempt', loc, attempts: [{ unit }] });
    expect(refuse('k', 'uK4')).toMatch(/building/);
    expect(refuse('m', 'uM4')).toMatch(/paved road/);
    expect(refuse('t', 'uO5')).toMatch(/trench/);
    expect(refuse('p', 'uO6')).toMatch(/pillbox/);
    expect(refuse('w', 'uN6')).toMatch(/Wire/);
    expect(refuse('f', 'uN7')).toMatch(/already attempted/);
    expect(refuse('b', 'uN8')).toMatch(/broken/);
    const offered = legal(engine, s, 'entrench.attempt').map((a) => a['loc']);
    expect(offered).not.toContain('uK4');
    expect(offered).not.toContain('uO5');
    const mph = game([ge('g', 'uN5'), ...far], { phase: 'MPh' });
    expect(check(mph.engine, mph.state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'g' }] })).toMatch(/Prep Fire Phase/);
    const def = game([ru('r', 'uN5'), ...far], { first: 'ge' });
    expect(def.engine.validate(def.state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'r' }], side: 'ru', decisionId: def.engine.currentDecision(def.state)!.id } as never)).toBeTruthy();
  });

  it('needs no foxhole allotment and does not touch an open counter the other side already has there', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far], { dice: [1, 1] });
    const s = place(engine, state, 'ru', [fox('uO5', 1)]);
    const r = act(engine, s, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a' }] });
    expect(fortCounters(engine.env(r.state)).map((c) => `${c.side}:${c.hex}`).sort()).toEqual(['ge:uN5', 'ru:uO5']);
  });

  it('TI comes off at the end of the CCPh and at once when the unit breaks; Labor goes when the unit leaves the Location (A4.8, B24.8)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uO5'), ...far], { dice: [6, 6, 6, 6] });
    let s = act(engine, state, { type: 'entrench.attempt', loc: 'uN5', attempts: [{ unit: 'a' }] }).state;
    s = act(engine, s, { type: 'entrench.attempt', loc: 'uO5', attempts: [{ unit: 'b' }] }).state;
    expect(s.pieces['a']!.tags['ti']).toBe(true);
    s = act(engine, s, { type: 'test.tag', id: 'a', tags: { broken: true } }).state;
    expect(s.pieces['a']!.tags['ti']).toBeUndefined();
    expect(parseLabor(s.pieces['b']!.tags['labor'])).toEqual({ task: 'entrench:uO5', drm: -1 });
    s = tele(engine, s, 'b', 'uP5');
    expect(s.pieces['b']!.tags['labor']).toBeUndefined();
    // Through the Player Turn: the b squad's TI is gone once the CCPh has ended.
    let guard = 0;
    while (s.phase !== 'APh' && guard++ < 40) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['b']!.tags['ti']).toBe(true);
    while (s.attacker === 'ge' && guard++ < 40) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.pieces['b']!.tags['ti']).toBeUndefined();
  });
});

describe('Into and out of a foxhole during the MPh (B27.1 EX, B27.4, B27.42, A8.12, A8.2, A12.33, B27.56)', () => {
  it('the B27.1 example: one MF to enter the hex, one more to go beneath, one to come out, each a Defensive First Fire target of its own; a stack beneath may not step out directly', () => {
    const { engine, state } = game([ge('g', 'uM5'), ru('r', 'uN8'), ...far], { phase: 'MPh' });
    let s = place(engine, state, 'ge', [fox('uN5', 1)]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    s = pass(engine, s, 'ru');
    expect(legal(engine, s, 'move.entrenchment')).toEqual([expect.objectContaining({ beneath: true })]);
    expect(check(engine, s, { type: 'move.step', to: 'uO5' })).toBeNull();
    s = act(engine, s, { type: 'move.entrenchment', beneath: true }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    s = pass(engine, s, 'ru');
    expect(loc(s, 'g')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    expect(moveState(engine.env(s))).toMatchObject({ ent: true, mfHere: 2, spent: { g: 2 } });
    expect(check(engine, s, { type: 'move.step', to: 'uO5' })).toMatch(/Leave the foxhole 1S first/);
    expect(legal(engine, s, 'move.entrenchment')).toEqual([expect.objectContaining({ beneath: false })]);
    s = act(engine, s, { type: 'move.entrenchment', beneath: false }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    s = pass(engine, s, 'ru');
    expect(loc(s, 'g')).toEqual({ kind: 'hex', hex: 'uN5' });
    expect(moveState(engine.env(s))).not.toHaveProperty('ent');
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = pass(engine, s, 'ru');
    expect(moveState(engine.env(s))).toMatchObject({ hex: 'uO5', spent: { g: 4 } });
  });

  it('FFMO applies on top, not beneath: +2 TEM and FFNAM against the unit beneath, the hex TEM replaced, Residual FP fires again only when it leaves', () => {
    const { engine, state } = game([ge('g', 'uM5'), ru('r', 'uN8'), ru('r2', 'uO8'), ...far], { phase: 'MPh', dice: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], hexMarkers: { uN5: { residualFp: 2 } } });
    let s = place(engine, state, 'ge', [fox('uN5', 1)]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    let r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(r.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(1);
    r = act(engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uN5' } });
    expect(labels(r.events)).toEqual(expect.arrayContaining([expect.stringMatching(/FFMO/), expect.stringMatching(/FFNAM/)]));
    s = pass(engine, r.state, 'ru');
    r = act(engine, s, { type: 'move.entrenchment', beneath: true });
    // Residual FP does not attack a unit going beneath (A8.2).
    expect(r.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(0);
    r = act(engine, r.state, { type: 'defFire', decl: { units: ['r2'], sw: [], target: 'uN5' } });
    expect(labels(r.events)).toEqual(expect.arrayContaining([expect.stringMatching(/FFNAM/)]));
    expect(unitLabels(r.events, 'g')).toEqual([expect.stringMatching(/\+2 TEM \(foxhole 1S\).*no FFMO/)]);
    s = pass(engine, r.state, 'ru');
    // Leaving makes it more vulnerable: the Residual FP attacks again (A8.2).
    r = act(engine, s, { type: 'move.entrenchment', beneath: false });
    expect(r.events.filter((e) => e.type === 'sk1.fire.attack')).toHaveLength(1);
  });

  it('in woods the unit beneath gets +2, not +3; a unit on top of the same foxhole keeps the woods +1 (B27.3)', () => {
    const { engine, state } = game([ge('in', 'uL4'), ge('top', 'uL4'), ru('r', 'uL7'), ...far], { first: 'ru', dice: [6, 6, 6, 6] });
    let s = place(engine, state, 'ge', [fox('uL4', 1)]);
    s = tele(engine, s, 'in', 'uL4', 'foxhole');
    const r = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uL4' } });
    expect(labels(r.events)).toContain('+1 TEM (Woods)');
    expect(unitLabels(r.events, 'in')).toEqual([expect.stringMatching(/\+2 TEM \(foxhole 1S\), not with the \+1 Woods TEM/)]);
    expect(unitLabels(r.events, 'top')).toEqual([]);
    const results = r.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; drm?: number });
    expect(results.find((x) => x.unit === 'in')?.drm).toBe(1);
    expect(results.find((x) => x.unit === 'top')?.drm).toBeUndefined();
  });

  it("a firer's elevation advantage beyond the range reduces the foxhole TEM (B9.33); no Height Advantage against a unit beneath (B10.31)", () => {
    const { engine, state } = game([ge('in', 'uO3'), ge('top', 'uO3'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uP3', level: 1 }, ...far], { first: 'ru', dice: [6, 6, 6, 6] });
    let s = place(engine, state, 'ge', [fox('uO3', 2)]);
    s = tele(engine, s, 'in', 'uO3', 'foxhole');
    const r = act(engine, s, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uO3' } });
    expect(unitLabels(r.events, 'in')).toEqual([expect.stringMatching(/\+2 TEM \(foxhole 2S\), -1 firer's elevation advantage/)]);
    const results = r.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; drm?: number });
    expect(results.find((x) => x.unit === 'in')?.drm).toBe(1);
    // On the hill the unit on top has the +1 Height Advantage TEM; the unit beneath its +2 and nothing more (B10.31).
    const hill = game([ge('in', 'uQ3'), ge('top', 'uQ3'), ru('r', 'uQ6'), ...far], { first: 'ru', dice: [6, 6, 6, 6] });
    let h = place(hill.engine, hill.state, 'ge', [fox('uQ3', 2)]);
    h = tele(hill.engine, h, 'in', 'uQ3', 'foxhole');
    const rh = act(hill.engine, h, { type: 'fire', decl: { units: ['r'], sw: [], target: 'uQ3' } });
    expect(unitLabels(rh.events, 'top')).toEqual([expect.stringMatching(/Height Advantage/)]);
    const hr = rh.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; drm?: number });
    expect(hr.find((x) => x.unit === 'top')?.drm).toBe(1);
    expect(hr.find((x) => x.unit === 'in')?.drm).toBe(2);
  });

  it('a hidden foxhole is revealed when its TEM is claimed: the first attack on a unit beneath it (A12.33)', () => {
    const { engine, state } = game([ru('in', 'uN5'), ge('g', 'uN8'), ...far], { dice: [6, 6, 6, 6] });
    let s = tele(engine, state, 'in', 'uN5', 'foxhole');
    s = place(engine, s, 'ru', [fox('uN5', 2, true)]);
    expect(fortificationView(engine.env(s), 'ge')).toEqual([]);
    const r = act(engine, s, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } });
    expect(r.events.find((e) => e.type === 'asl.fort.revealed')?.payload).toMatchObject({ reason: 'tem', counter: { hex: 'uN5', kind: 'foxhole' } });
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uN5', kind: 'foxhole', capacity: 2 }]);
    expect(unitLabels(r.events, 'in')).toEqual([expect.stringMatching(/\+2 TEM \(foxhole 2S\)/)]);
  });

  it('under Assault Movement the entry and the foxhole MF are one expenditure, the stack arriving beneath (B27.4); a step out of a foxhole costs its MF too', () => {
    const { engine, state } = game([ge('g', 'uM5'), ru('r', 'uN8'), ...far], { phase: 'MPh' });
    let s = place(engine, state, 'ge', [fox('uN5', 1)]);
    s = act(engine, s, { type: 'move.start', units: ['g'], assault: true }).state;
    expect(legal(engine, s, 'move.step')).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'uN5', beneath: true })]));
    let r = act(engine, s, { type: 'move.step', to: 'uN5', beneath: true });
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    expect(loc(r.state, 'g')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    expect(moveState(engine.env(r.state))).toMatchObject({ ent: true, mfHere: 2, spent: { g: 2 } });
    expect(r.events.find((e) => e.type === 'asl.entrench.move')?.payload).toMatchObject({ units: ['g'], hex: 'uN5', beneath: true });
    // Not Assault Moving: the combined step is refused and the plain MPh step is on offer instead.
    const plain = game([ge('g', 'uM5'), ...far], { phase: 'MPh' });
    let p = place(plain.engine, plain.state, 'ge', [fox('uN5', 1)]);
    p = act(plain.engine, p, { type: 'move.start', units: ['g'] }).state;
    expect(check(plain.engine, p, { type: 'move.step', to: 'uN5', beneath: true })).toMatch(/paid separately/);
    expect(legal(plain.engine, p, 'move.step').some((a) => a['beneath'])).toBe(false);
    // An Assault Moving stack beneath a foxhole steps out for the exit MF plus the hex's.
    const out = game([ge('g', 'uN5'), ...far], { phase: 'MPh' });
    let o = place(out.engine, out.state, 'ge', [fox('uN5', 1)]);
    o = tele(out.engine, o, 'g', 'uN5', 'foxhole');
    o = act(out.engine, o, { type: 'move.start', units: ['g'], assault: true }).state;
    expect(moveState(out.engine.env(o))).toMatchObject({ ent: true });
    r = act(out.engine, o, { type: 'move.step', to: 'uO5' });
    expect(moveState(out.engine.env(r.state))).toMatchObject({ hex: 'uO5', spent: { g: 2 } });
    expect(loc(r.state, 'g')).toEqual({ kind: 'hex', hex: 'uO5' });
  });

  it('capacity per side: a 1S holds one squad plus SMC; a Gun never goes beneath a foxhole; a stack half beneath cannot move as one; the hidden own foxhole costs nothing (A12.33); the A-T Ditch two MF (B27.56)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ge('l', 'uN5', 'ge.L91'), ge('x', 'uN5'), ge('l2', 'uN5', 'ge.L91'), ge('y', 'uN5'), ge('c', 'uN5', 'ge.228c'), { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'c' }, ...far], { phase: 'MPh' });
    let s = place(engine, state, 'ge', [fox('uN5', 1), { kind: 'ditch', hex: 'uO6', hidden: false }, fox('uP5', 1, true)]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b', 'l'] }).state;
    expect(check(engine, s, { type: 'move.entrenchment', beneath: true })).toMatch(/room for 1 squad/);
    s = act(engine, s, { type: 'move.end' }).state;
    s = act(engine, s, { type: 'move.start', units: ['x', 'l2'] }).state;
    s = act(engine, s, { type: 'move.entrenchment', beneath: true }).state;
    expect(loc(s, 'x').pos).toEqual({ ent: 'foxhole' });
    expect(loc(s, 'l2').pos).toEqual({ ent: 'foxhole' });
    s = act(engine, s, { type: 'move.end' }).state;
    expect(entrenchmentRoom(engine.env(s), 'uN5', 'ge')).toMatchObject({ se: 0, smc: 3 });
    expect(entrenchmentRoom(engine.env(s), 'uN5', 'ru')).toMatchObject({ se: 1, smc: 4 });
    const mixed = game([ge('in', 'uN5'), ge('top', 'uN5'), ...far], { phase: 'MPh' });
    let m = place(mixed.engine, mixed.state, 'ge', [fox('uN5', 1)]);
    m = tele(mixed.engine, m, 'in', 'uN5', 'foxhole');
    expect(check(mixed.engine, m, { type: 'move.start', units: ['in', 'top'] })).toMatch(/separate stacks/);
    expect(check(mixed.engine, m, { type: 'move.start', units: ['in'] })).toBeNull();
    // The crew pushing its Gun may enter the hex but not go beneath the foxhole (B27.1).
    s = act(engine, s, { type: 'move.start', units: ['c'], manhandle: 'gun' }).state;
    expect(check(engine, s, { type: 'move.entrenchment', beneath: true })).toMatch(/Gun cannot go beneath a foxhole/);
    s = act(engine, s, { type: 'move.end' }).state;
    // The hidden foxhole of its own side: free, and no First Fire question for a 0 MF expenditure.
    s = act(engine, s, { type: 'move.start', units: ['y'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    s = act(engine, s, { type: 'move.step', to: 'uP5' }).state;
    const spent = moveState(engine.env(s))!.spent['y'];
    s = act(engine, s, { type: 'move.entrenchment', beneath: true }).state;
    expect(engine.currentDecision(s)?.kind).toBe('phase');
    expect(moveState(engine.env(s))!.spent['y']).toBe(spent);
    expect(loc(s, 'y').pos).toEqual({ ent: 'foxhole' });
    s = act(engine, s, { type: 'move.end' }).state;
    // The A-T Ditch: two MF beneath.
    const d = game([ge('a', 'uN6'), ...far], { phase: 'MPh' });
    let t = place(d.engine, d.state, 'ge', [{ kind: 'ditch', hex: 'uO6', hidden: false }]);
    t = act(d.engine, t, { type: 'move.start', units: ['a'] }).state;
    t = act(d.engine, t, { type: 'move.step', to: 'uO6' }).state;
    t = act(d.engine, t, { type: 'move.entrenchment', beneath: true }).state;
    expect(moveState(d.engine.env(t))).toMatchObject({ ent: true, spent: { a: 3 } });
    expect(loc(t, 'a').pos).toEqual({ ent: 'ditch' });
  });

  it('a Gun beneath a trench stays there; its crew may leave alone (B27.51)', () => {
    const { engine, state } = game([ge('c', 'uN5', 'ge.228c'), { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'c' }, ...far], { phase: 'MPh' });
    let s = place(engine, state, 'ge', [trench('uN5')]);
    s = tele(engine, s, 'c', 'uN5', 'trench');
    expect(check(engine, s, { type: 'move.start', units: ['c'], manhandle: 'gun' })).toMatch(/B27.51/);
    expect(check(engine, s, { type: 'move.start', units: ['c'] })).toMatch(/drop it first/);
  });

  it('between connecting trenches: one MF whatever the terrain, beneath throughout, no FFNAM or FFMO and no Snap Shot (B27.54)', () => {
    const { engine, state } = game([ge('g', 'uN5'), ru('r', 'uN8'), ...far], { phase: 'MPh', dice: [6, 6, 6, 6] });
    let s = place(engine, state, 'ge', [trench('uN5'), trench('uL4'), trench('uO5')]);
    s = tele(engine, s, 'g', 'uN5', 'trench');
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    expect(moveState(engine.env(s))).toMatchObject({ ent: true });
    const steps = legal(engine, s, 'move.step');
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'uO5', beneath: true })]));
    expect(steps.some((a) => a['to'] === 'uO5' && !a['beneath'])).toBe(false);
    let r = act(engine, s, { type: 'move.step', to: 'uO5', beneath: true });
    expect(loc(r.state, 'g')).toEqual({ kind: 'hex', hex: 'uO5', pos: { ent: 'trench' } });
    expect(moveState(engine.env(r.state))).toMatchObject({ hex: 'uO5', ent: true, trenchMove: true, spent: { g: 1 } });
    expect(engine.env(r.state).query('fire.snapSide', { target: 'uO5' }, null)).toBeNull();
    r = act(engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uO5' } });
    expect(labels(r.events).join(' ')).not.toMatch(/FFNAM|FFMO/);
    expect(unitLabels(r.events, 'g')).toEqual([expect.stringMatching(/\+2 TEM \(trench\)/)]);
  });
});

describe('Rout, rally and advance with entrenchments (B27.41, A10.5, A10.531, A10.61, A10.62, A4.7, B27.44)', () => {
  it('a broken unit beneath a foxhole in Open Ground need not rout for the Open Ground reason; one on top must (A10.5)', () => {
    const { engine, state } = game([ru('in', 'uN5'), ru('top', 'uN5'), ge('g', 'uN8'), ...far], { phase: 'RtPh', first: 'ru' });
    let s = place(engine, state, 'ru', [fox('uN5', 2)]);
    s = tele(engine, s, 'in', 'uN5', 'foxhole');
    s = act(engine, s, { type: 'test.tag', id: 'in', tags: { broken: true } }).state;
    s = act(engine, s, { type: 'test.tag', id: 'top', tags: { broken: true } }).state;
    const env = engine.env(s);
    expect(routRequirement(env, s.pieces['in']!)).toBeNull();
    expect(routRequirement(env, s.pieces['top']!)).toMatchObject({ kind: 'openGround' });
  });

  it('routing beneath the foxhole of the hex entered costs the extra MF and nullifies Interdiction there; leaving one combines the exit MF with the next hex (B27.41)', () => {
    const { engine, state } = game([{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru' });
    const s = place(engine, state, 'ru', [fox('uN5', 1)]);
    const steps = legal(engine, s, 'rout.step').filter((a) => a['to'] === 'uN5');
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ beneath: true }), expect.not.objectContaining({ beneath: true })]));
    const r = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uN5', beneath: true });
    const step = (r.events.find((e) => e.type === 'sk1.rout.state' && (e.payload as { step?: unknown }).step)?.payload as { step: { interdiction: string } }).step;
    expect(step.interdiction).toBe('entrenched');
    expect(loc(r.state, 'b')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    expect(r.events.find((e) => e.type === 'asl.entrench.move')?.payload).toMatchObject({ hex: 'uN5', beneath: true, phase: 'RtPh' });
    // Out of the foxhole into the woods next door: 1 + 2 MF, the exit MF never Interdicted on its own.
    const out = game([{ ...ru('b', 'uN5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru' });
    let o = place(out.engine, out.state, 'ru', [fox('uN5', 1)]);
    o = tele(out.engine, o, 'b', 'uN5', 'foxhole');
    const rr = act(out.engine, o, { type: 'rout.step', unit: 'b', to: 'uM6' });
    const spent = rr.events.filter((e) => e.type === 'sk1.rout.state').map((e) => (e.payload as { state: { active?: { spent: number } } | null }).state?.active?.spent).filter((x): x is number => x !== undefined);
    expect(Math.max(...spent)).toBe(3);
    expect(loc(rr.state, 'b')).toEqual({ kind: 'hex', hex: 'uM6' });
  });

  it('beneath a trench a unit rallies at -1 and may not keep its DM; beneath a foxhole neither (A10.61, A10.62)', () => {
    const { engine, state } = game([ge('t', 'uN5'), ge('f', 'uO5'), ...far], { phase: 'RPh' });
    let s = place(engine, state, 'ge', [trench('uN5'), fox('uO5', 1)]);
    s = tele(engine, s, 't', 'uN5', 'trench');
    s = tele(engine, s, 'f', 'uO5', 'foxhole');
    for (const id of ['t', 'f']) s = act(engine, s, { type: 'test.tag', id, tags: { broken: true, dm: true } }).state;
    const env = engine.env(s);
    expect(env.explain('rally.drm', { unit: 't', leader: null, self: true }, 0).value).toBe(env.explain('rally.drm', { unit: 'f', leader: null, self: true }, 0).value - 1);
    expect(check(engine, s, { type: 'rally.dmKeep', unit: 't' })).toMatch(/trench/);
    expect(env.query('rally.dmKeepIllegal', { unit: 'f' }, null)).toBeNull();
  });

  it('an advance may go beneath the foxhole of the next hex, an enemy-held one included (CC follows), or change position within its own hex (A4.7, B27.44)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ge('b', 'uO5'), ru('r', 'uN5'), ...far], { phase: 'APh' });
    let s = place(engine, state, 'ru', [fox('uN5', 1), fox('uO5', 1)]);
    s = tele(engine, s, 'r', 'uN5', 'foxhole');
    const offered = legal(engine, s, 'advance');
    expect(offered).toEqual(expect.arrayContaining([expect.objectContaining({ units: ['a'], to: 'uN5', beneath: true }), expect.objectContaining({ units: ['b'], to: 'uO5', beneath: true })]));
    let r = act(engine, s, { type: 'advance', units: ['a'], to: 'uN5', beneath: true });
    expect(loc(r.state, 'a')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
    expect(r.state.hexMarkers['uN5']?.['cc']).toBe(true);
    expect(entrenchmentRoom(engine.env(r.state), 'uN5', 'ge')).toMatchObject({ se: 0 });
    r = act(engine, r.state, { type: 'advance', units: ['b'], to: 'uO5', beneath: true });
    expect(loc(r.state, 'b')).toEqual({ kind: 'hex', hex: 'uO5', pos: { ent: 'foxhole' } });
  });

  it('Recovery does not cross the rim of a foxhole (B27.13); a weapon dropped by a unit beneath it stays beneath', () => {
    const { engine, state } = game([ge('in', 'uN5'), ge('top', 'uN5'), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }, ...far], { phase: 'RPh' });
    let s = place(engine, state, 'ge', [fox('uN5', 2)]);
    s = tele(engine, s, 'in', 'uN5', 'foxhole');
    s = tele(engine, s, 'lmg', 'uN5', 'foxhole');
    expect(check(engine, s, { type: 'rally.recover', unit: 'top', sw: 'lmg' })).toMatch(/beneath the foxhole/);
    expect(check(engine, s, { type: 'rally.recover', unit: 'in', sw: 'lmg' })).toBeNull();
    const e = game([ge('in', 'uN5'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'in' }, ...far], { phase: 'RPh' });
    let t = place(e.engine, e.state, 'ge', [fox('uN5', 1)]);
    t = tele(e.engine, t, 'in', 'uN5', 'foxhole');
    t = act(e.engine, t, { type: 'test.eliminate', id: 'in' }).state;
    expect(loc(t, 'mmg')).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
  });
});
