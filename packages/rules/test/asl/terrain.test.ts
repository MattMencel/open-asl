import { describe, expect, it } from 'vitest';
import type { GameState, PieceId, RuleModule } from '@asl/engine';
import { aslCoreModules, buildAttack, moveState, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';
import { vehicleEntryCost } from '../../src/sk3/vehicleMove';

/*
 * The board-u Chapter B pass, in the full ASL ruleset: board u's hexes as the real board data gives them
 * (the hex-level map; the pixel LOS cases are in content/test/orchardRoad.test.ts and terrainU.test.ts).
 * - The road J1-J10 (paved; J5-J8 are Orchard-Road hexes on the real board, here plain road for the bonus count).
 * - The D-hill: D8 is level 1 open hill, D7 and D6 below it at ground level, D9 level 1.
 * - Brush D2, orchard B7, woods C3, the Woods-Road DD4.
 */
const road = { terrain: 'open', features: ['road:paved'] };
const MAP: Record<string, HexTerrainSpec> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`uJ${i + 1}`, road])),
  uD6: { terrain: 'open' },
  uD7: { terrain: 'open' },
  uD8: { terrain: 'open', elevation: 1 },
  uD9: { terrain: 'open', elevation: 1 },
  uD2: { terrain: 'brush' },
  uB7: { terrain: 'orchard' },
  uC3: { terrain: 'woods' },
  uDD4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] },
};
const roadHexsides = Array.from({ length: 9 }, (_, i) => [`uJ${i + 1}`, `uJ${i + 2}`] as [string, string]);
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_FIRST = {
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
};

const game = (pieces: PieceSpec[], opts: { asl?: boolean; hexMarkers?: Record<string, Record<string, unknown>>; startPhase?: string } = {}) =>
  makeEngine({ board: 'u', terrain: MAP, roadHexsides, scenario: GE_FIRST, modules: opts.asl === false ? SK : ASL, startPhase: opts.startPhase ?? 'MPh', pieces, ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}) });

describe('B.2 COT: SMOKE is part of the Cost of Terrain doubled uphill (full ASL)', () => {
  const pieces: PieceSpec[] = [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD7' }];
  const cost = (asl: boolean, smoke: boolean) => {
    const { engine, state } = game(pieces, { asl, ...(smoke ? { hexMarkers: { uD8: { smoke: true } } } : {}) });
    return engine.env(state).query('move.cost', { unit: 'g1' as PieceId, from: 'uD7', to: 'uD8', viaRoad: false }, 1);
  };

  it('Open Ground uphill into SMOKE costs 2 × (1 + 1) = 4 MF; the Starter Kit adds the Smoke after the doubling (3)', () => {
    expect(cost(true, false)).toBe(2);
    expect(cost(true, true)).toBe(4);
    expect(cost(false, true)).toBe(3);
  });

  it('on level ground SMOKE still costs one MF more', () => {
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD6' }], { hexMarkers: { uD7: { smoke: true } } });
    expect(engine.env(state).query('move.cost', { unit: 'g1' as PieceId, from: 'uD6', to: 'uD7', viaRoad: false }, 1)).toBe(2);
  });
});

describe('A4.5 Double Time and B3.4 the road bonus (full ASL)', () => {
  it('a leader with a squad Double Timing along the J road enters nine road hexes: eight MF and the road bonus', () => {
    const { engine, state } = game([
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ1' },
      { id: 'l1', def: 'ge.L80', side: 'ge', hex: 'uJ1' },
    ]);
    let s: GameState = act(engine, state, { type: 'move.start', units: ['g1', 'l1'], doubleTime: true }).state;
    expect(moveState(engine.env(s))!.allowance).toEqual({ g1: 8, l1: 8 });
    for (let i = 2; i <= 10; i++) {
      s = act(engine, s, { type: 'move.step', to: `uJ${i}` }).state;
      while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    }
    expect(s.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'uJ10' });
  });
});

describe('B10.31 Height Advantage on the D-hill (full ASL)', () => {
  // A German squad climbs from D7 into D8 (level 1); Russians below fire from D6 (their LOS crosses the D7-D8 hexside it
  // came through) and from C8 (it does not).
  const pieces: PieceSpec[] = [
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD8' },
    { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uD6' },
    { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uC8' },
  ];
  const ids = (t: { id: string; suppressedBy?: string }[]) => t.filter((x) => !x.suppressedBy).map((x) => x.id);

  it('a unit that crossed the Crest Line through the hexside the LOS crosses gets no Height Advantage and is subject to FFMO', () => {
    const { engine, state } = game(pieces, { startPhase: 'PFPh' });
    const env = engine.env(state);
    const at = (firer: string) => buildAttack(env, { units: [firer], sw: [], target: 'uD8' }, 'first', 'ru', ['g1'], { assault: false, viaRoadIntoWoodsRoad: false, from: 'uD7' });
    const below = at('r1');
    expect(ids(env.explain('fire.unitDrm', { attack: below, unit: 'g1' }, 0).trace)).not.toContain('sk2.drm.height-advantage');
    expect(ids(env.explain('fire.drm', { attack: below }, 0).trace)).toContain('sk1.drm.ffmo');
    const aside = at('r2');
    expect(ids(env.explain('fire.unitDrm', { attack: aside, unit: 'g1' }, 0).trace)).toContain('sk2.drm.height-advantage');
    expect(ids(env.explain('fire.drm', { attack: aside }, 0).trace)).not.toContain('sk1.drm.ffmo');
  });
});

describe('B1, B12, B13, B14 TEM and Open Ground on board u (full ASL)', () => {
  it('Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1', () => {
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ1' }]);
    const env = engine.env(state);
    const og = (h: string) => env.query('hex.openGround', { hex: h }, false);
    const tem = (h: string) => env.query('hex.tem', { hex: h }, 0);
    expect([og('uD7'), og('uD8'), og('uD2'), og('uB7'), og('uC3')]).toEqual([true, true, false, false, false]);
    expect([tem('uD2'), tem('uB7'), tem('uC3')]).toEqual([0, 0, 1]);
    const mf = (from: string, to: string) => env.query('move.cost', { unit: 'g1' as PieceId, from, to, viaRoad: false }, 1);
    expect([mf('uD3', 'uD2'), mf('uB6', 'uB7'), mf('uC4', 'uC3')]).toEqual([2, 1, 2]);
  });

  it('Woods-Road DD4 entered along the road: road rate, and FFMO with no woods TEM (B13.31)', () => {
    const { engine, state } = game([
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uDD3' },
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uDD6' },
    ]);
    const env = engine.env(state);
    const a = buildAttack(env, { units: ['r1'], sw: [], target: 'uDD4' }, 'first', 'ru', ['g1'], { assault: false, viaRoadIntoWoodsRoad: true, from: 'uDD3' });
    const drm = env.explain('fire.drm', { attack: a }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id);
    expect(drm).toEqual(expect.arrayContaining(['sk1.drm.ffmo', 'sk1.drm.woods-road']));
  });
});

describe('B10.31: no Height Advantage for a unit receiving a CE DRM (full ASL)', () => {
  // A CE T-34 and a Russian squad on the level 1 hill D8; a German squad below in D6 Prep Fires at them.
  const pieces: PieceSpec[] = [
    { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'uD8', tags: { ce: true } },
    { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uD8' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD6' },
  ];
  const ids = (t: { id: string; suppressedBy?: string }[]) => t.filter((x) => !x.suppressedBy).map((x) => x.id);
  it('the CE crew keeps its CE DRM and gets no +1 Height Advantage; the squad beside it does; the Starter Kit gives both', () => {
    for (const asl of [true, false]) {
      const { engine, state } = game(pieces, { startPhase: 'PFPh', asl });
      const env = engine.env(state);
      const attack = buildAttack(env, { units: ['g1'], sw: [], target: 'uD8' }, 'prep', 'ge');
      const crew = ids(env.explain('fire.unitDrm', { attack, unit: 't' }, 0).trace);
      expect(crew).toContain('sk3.drm.ce');
      if (asl) expect(crew).not.toContain('sk2.drm.height-advantage');
      else expect(crew).toContain('sk2.drm.height-advantage');
      expect(ids(env.explain('fire.unitDrm', { attack, unit: 'r1' }, 0).trace)).toContain('sk2.drm.height-advantage');
    }
  });
  it('a Snap Shot at the CE tank entering the hill keeps the CE DRM and takes back the Height Advantage (A8.15 EX, B10.31)', () => {
    const { engine, state } = game(pieces, { startPhase: 'PFPh' });
    const env = engine.env(state);
    const attack = buildAttack(env, { units: ['g1'], sw: [], target: 'uD8', snap: ['uD8', 'uC8'] }, 'first', 'ge', ['t'], { assault: false, viaRoadIntoWoodsRoad: false, from: 'uC8' });
    expect(ids(env.explain('fire.drm', { attack }, 0).trace)).toContain('asl.snap.height-advantage');
    const crew = env.explain('fire.unitDrm', { attack, unit: 't' }, 0);
    expect(ids(crew.trace)).toEqual(expect.arrayContaining(['sk3.drm.ce', 'asl.snap.height-advantage.ce']));
  });
});

describe('A4.12: the leader MF bonus only from a leader of the same nationality (full ASL)', () => {
  const pieces: PieceSpec[] = [
    { id: 'l', def: 'ge.L91', side: 'ge', hex: 'uD6' },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uD6' },
    { id: 'i', def: 'ru.447', side: 'ge', hex: 'uD6' },
  ];
  it('a German leader gives the German squad 6 MF, not an allied squad of another nationality stacked with them; the Starter Kit gives both', () => {
    const { engine, state } = game(pieces);
    const ms = moveState(engine.env(act(engine, state, { type: 'move.start', units: ['l', 'g', 'i'] }).state))!;
    expect(ms.allowance['g']).toBe(6);
    expect(ms.allowance['i']).toBe(4);
    expect(ms.leaderBonus).toEqual(['g']);
    const sk = game(pieces, { asl: false });
    const msk = moveState(sk.engine.env(act(sk.engine, sk.state, { type: 'move.start', units: ['l', 'g', 'i'] }).state))!;
    expect(msk.allowance['i']).toBe(6);
  });
});

describe('B3 roads and B1.17 Artificial Terrain with vehicles (full ASL)', () => {
  // The J road (paved) with J6 on a level 1 hill and a dirt road K1-K2 beside it; a T-34 drives along it.
  const ROADS: Record<string, HexTerrainSpec> = {
    ...MAP,
    uJ6: { terrain: 'open', features: ['road:paved'], elevation: 1 },
    uK1: { terrain: 'open', features: ['road:dirt'] },
    uK2: { terrain: 'open', features: ['road:dirt'] },
  };
  const at = (pieces: PieceSpec[], startPhase = 'MPh', first = 'ru') =>
    makeEngine({ board: 'u', terrain: ROADS, roadHexsides: [...roadHexsides, ['uK1', 'uK2']], scenario: { ...GE_FIRST, firstSide: first }, modules: ASL, startPhase, pieces });
  const t34 = (hex: string, tags: Record<string, boolean | number> = {}): PieceSpec => ({ id: 't', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
  const wreck = (id: string, hex: string): PieceSpec => ({ id, def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 0, ca: 0, wreck: true } });
  const cost = (pieces: PieceSpec[], from: string, to: string, viaRoad: boolean) => {
    const { engine, state } = at(pieces);
    const env = engine.env(state);
    return vehicleEntryCost(env, state.pieces['t']!, from, to, { viaRoad });
  };

  it('paved and dirt road alike are Open Ground, one MF for Infantry and ½ MP for a CE vehicle along them (B3.1, B3.4, B3.41)', () => {
    const { engine, state } = at([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uY10' }, t34('uA1')]);
    const env = engine.env(state);
    for (const hex of ['uJ2', 'uK2']) {
      expect(env.query('hex.openGround', { hex }, false)).toBe(true);
      expect(env.query('move.cost', { unit: 'g' as PieceId, from: hex === 'uJ2' ? 'uJ1' : 'uK1', to: hex, viaRoad: true }, 0)).toBe(1);
    }
    expect(cost([t34('uJ1', { ce: true })], 'uJ1', 'uJ2', true)).toBe(0.5);
    expect(cost([t34('uK1', { ce: true })], 'uK1', 'uK2', true)).toBe(0.5);
  });

  it('a vehicle along a road: ½ MP (1 Buttoned Up, D5.2), the uphill surcharge halved to 2, and 2 MP per vehicle or wreck in the hex (B3.41, B3.42)', () => {
    expect(cost([t34('uJ1', { ce: true })], 'uJ1', 'uJ2', true)).toBe(0.5);
    expect(cost([t34('uJ1')], 'uJ1', 'uJ2', true)).toBe(1);
    expect(cost([t34('uJ1')], 'uJ1', 'uJ2', false)).toBe(1);
    // Up onto the hill: +2 along the road, +4 otherwise.
    expect(cost([t34('uJ5', { ce: true })], 'uJ5', 'uJ6', true)).toBe(2.5);
    expect(cost([t34('uJ5', { ce: true })], 'uJ5', 'uJ6', false)).toBe(5);
    // A wreck in the road hex entered: +2 at the road rate, +1 otherwise.
    expect(cost([t34('uJ1', { ce: true }), wreck('w', 'uJ2')], 'uJ1', 'uJ2', true)).toBe(2.5);
    expect(cost([t34('uJ1', { ce: true }), wreck('w', 'uJ2')], 'uJ1', 'uJ2', false)).toBe(2);
    expect(cost([t34('uJ1', { ce: true }), wreck('w', 'uJ2'), wreck('w2', 'uJ2')], 'uJ1', 'uJ2', true)).toBe(4.5);
  });

  it('a wreck in an Open Ground road hex negates FFMO for a squad entering it at the road rate, and is its +1 TEM (B1.17 EX)', () => {
    const { engine, state } = at([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ3' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uJ1' }, wreck('w', 'uJ4')], 'MPh', 'ge');
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uJ4' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uJ4' } });
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] };
    const labels = attack.explain.map((n) => n.label ?? '');
    expect(labels).toContain('-1 FFNAM');
    expect(labels.some((l) => /FFMO/.test(l))).toBe(false);
    const res = r.events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'g')!.payload as { explain?: { label?: string }[] };
    expect((res.explain ?? []).map((n) => n.label)).toContain('+1 behind a vehicle or wreck');
  });
});
