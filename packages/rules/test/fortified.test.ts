import { describe, expect, it } from 'vitest';
import type { Action, Ctx, RuleModule } from '@asl/engine';
import { FORTIFIED_MODULE, FP, FPP, fortifiableBuildings, fortifiedModule, fortifiedKnownTo, fortifiedState, inCoveredArc, nearestSpine, sk2CoreModules, statics, withoutSecrets, type FireAttackCtx, type FireDeclaration, type FireMode, type ResolveDcFn, type ResolveFireFn } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/** Test-only action: resolve a fire declaration in a given mode. */
const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

// Two stone buildings in the German setup area (P5/P6 and P1), one outside it (K2).
const terrain = {
  yP5: { terrain: 'building-stone', buildingId: 'b-P5' },
  yP6: { terrain: 'building-stone', buildingId: 'b-P5' },
  yP1: { terrain: 'building-stone', buildingId: 'b-P1' },
  yK2: { terrain: 'building-wood', buildingId: 'b-K2' },
};

const scenario = {
  firstSide: 'am',
  forces: [{ side: 'ge', units: [], setup: { kind: 'area' as const, description: 'hexrow P', hexes: ['yP1', 'yP2', 'yP3', 'yP4', 'yP5', 'yP6'] } }],
  ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ge', count: 2, within: 'setup' } }],
};

function game(dice?: number[]) {
  return makeEngine({
    terrain,
    extra: [fortifiedModule, testFire],
    scenario,
    pieces: [
      { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
      { id: 'a2', def: 'am.666', side: 'am', hex: 'yO1' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yP1' },
    ],
    ...(dice ? { dice } : {}),
  });
}

describe('fortified buildings (SSR)', () => {
  it('asks the fortifying side first, for buildings in its setup area only', () => {
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(d.kind).toBe('fortify');
    expect(d.owner).toBe('ge');
    expect(fortifiableBuildings(engine.env(state), 'ge')).toEqual(['b-P1', 'b-P5']);
    expect(() => act(engine, state, { type: 'fortify.designate', buildings: ['b-K2'] })).toThrow(/not a building in your setup area/);
    expect(() => act(engine, state, { type: 'fortify.designate', buildings: ['b-P1', 'b-P5', 'b-P5'] })).toThrow(/once|At most/);
    const t = act(engine, state, { type: 'fortify.designate', buildings: ['b-P5'] });
    expect(fortifiedState(engine.env(t.state))).toEqual({ side: 'ge', buildings: ['b-P5'], revealed: [] });
    expect(engine.currentDecision(t.state)!.kind).toBe('phase');
    // Only the German side knows; the American side and a shared screen do not.
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'ge')).toBe(true);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', null)).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP1', 'ge')).toBe(false);
  });

  it('may fortify nothing', () => {
    const { engine, state } = game();
    const t = act(engine, state, { type: 'fortify.designate', buildings: [] });
    expect(fortifiedState(engine.env(t.state))!.buildings).toEqual([]);
  });

  // a1 (7 FP) fires at g1 in the stone building P5 from two hexes away: the 6 column, +3 TEM, and
  // secretly +1 more. On that column a final DR of 6 is a 1MC and 7 a NMC; 9 and 10 are both blank.
  const attackOf = (t: { events: { type: string; payload: unknown }[] }) =>
    t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; explain: { id: string; label?: string }[] };
  const fire = (decl: FireDeclaration) => ({ type: 'test.fire', mode: 'prep', decl });

  it('applies the +1 and reveals the building when the +1 changes a result', () => {
    const { engine, state: s0 } = game([1, 2, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' }));
    expect(attackOf(t)).toMatchObject({ drm: 4 });
    expect(attackOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
    const result = t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { finalDr: number; result: { kind: string } };
    expect(result).toMatchObject({ finalDr: 7, result: { kind: 'NMC' } });
    expect(t.events.find((e) => e.type === 'sk1.fortified.revealed')!.payload).toMatchObject({ building: 'b-P5', hex: 'yP5', reason: 'fire' });
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(true);
  });

  it('keeps the +1 out of the attack entirely when the result is the same without it', () => {
    const { engine, state: s0 } = game([3, 3, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' }));
    // Reported as an ordinary +3 stone building attack: final DR 9, no result, no reveal.
    expect(attackOf(t)).toMatchObject({ drm: 3 });
    expect(attackOf(t).explain.map((n) => n.label)).not.toContain('+1 Fortified Building');
    expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ finalDr: 9, result: { kind: 'none' } });
    expect(t.events.some((e) => e.type === 'sk1.fortified.revealed')).toBe(false);
    expect(fortifiedKnownTo(engine.env(t.state), 'yP6', 'am')).toBe(false);
    // An unfortified building: the same attack, the same report.
    const u = act(engine, s1, fire({ units: ['a2'], sw: [], target: 'yP1' }));
    expect(attackOf(u).drm).toBe(3);
  });

  it('shows the +1 as a matter of course once the building is revealed', () => {
    const { engine, state: s0 } = game([1, 2, 3, 3, 3, 3]);
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const s2 = act(engine, s1, fire({ units: ['a1'], sw: [], target: 'yP5' })).state;
    expect(fortifiedState(engine.env(s2))!.revealed).toEqual(['b-P5']);
    // a2 (6 FP, 6 column) rolls 6: final 10 with the +1, 9 without, both blank, but it is known now.
    const t = act(engine, s2, fire({ units: ['a2'], sw: [], target: 'yP5' }));
    expect(attackOf(t)).toMatchObject({ drm: 4 });
    expect(attackOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
  });

  it('is left out of what the firer is shown beforehand until revealed', () => {
    const { engine, state: s0 } = game();
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const env = engine.env(s1);
    const attack: FireAttackCtx = { mode: 'prep', side: 'am', target: 'yP5', parts: [], targets: ['g1'], hindrance: 0 };
    const full = env.explain('fire.drm', { attack }, 0);
    expect(full.value).toBe(4);
    expect(full.trace.find((t) => t.id === 'ssr.fortified.drm')?.secret).toBe(true);
    const shown = withoutSecrets(full);
    expect(shown.value).toBe(3);
    expect(shown.trace.map((t) => t.id)).not.toContain('ssr.fortified.drm');
  });

  it('is revealed when an enemy unit enters any hex of it', () => {
    const { engine, state: s0 } = game();
    const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const mover: RuleModule = {
      id: 'test.move',
      install(r) {
        r.action<Action & { id: string; hex: string }>({
          type: 'test.move',
          decisionKinds: ['phase'],
          resolve(ctx, a) {
            ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex } });
          },
        });
      },
    };
    const { engine: e2, state: r0 } = makeEngine({ terrain, extra: [fortifiedModule, mover], scenario, pieces: [{ id: 'a1', def: 'am.747', side: 'am', hex: 'yO6' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' }] });
    void s1;
    const r1 = act(e2, r0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
    const t = act(e2, r1, { type: 'test.move', id: 'a1', hex: 'yP6' });
    expect((t.events.find((e) => e.type === 'sk1.fortified.revealed')!.payload as { reason: string }).reason).toBe('entered');
    expect(fortifiedState(e2.env(t.state))!.revealed).toEqual(['b-P5']);
  });
});

/*
 * The +1 applies to every attack that takes the building's TEM, not only small arms: a Placed DC (the card: "an
 * additional +1 to the regular building TEM"; ASLRB B23.921 "including vs DC"), the To Hit DR of ordnance against the
 * Infantry Target Type (TEM is a To Hit DRM, case 17) and a Critical Hit's reversed TEM (-4 for stone, -3 for wood,
 * B23.921). Each stays secret until it changes a result, like the small-arms +1.
 */
describe('the +1 against a DC attack, on the To Hit DR and in a Critical Hit', () => {
  const attackOf = (t: { events: { type: string; payload: unknown }[] }) =>
    t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; explain: { id: string; label?: string }[] };
  const revealed = (t: { events: { type: string }[] }) => t.events.some((e) => e.type === 'sk1.fortified.revealed');

  describe('a Placed DC', () => {
    // A DC placed in the stone building P5 by a1 attacks (as in the AFPh): 30 FP, +3 TEM, secretly +4.
    const testDc: RuleModule = {
      id: 'test.dc',
      install(r) {
        r.action<Action & { dc: string }>({
          type: 'test.dc',
          decisionKinds: ['phase'],
          resolve(ctx: Ctx, a) {
            ctx.proc<ResolveDcFn>(FPP.resolveDc)(ctx, ctx.state.pieces[a.dc]!);
          },
        });
      },
    };
    const dcGame = (dice: number[]) =>
      makeEngine({
        terrain,
        extra: [fortifiedModule, testDc],
        scenario,
        dice,
        pieces: [
          { id: 'a1', def: 'am.747', side: 'am', hex: 'yO5' },
          { id: 'd1', def: 'am.DC', side: 'am', hex: 'yP5', tags: { dcPlaced: true, dcPlacer: 'a1' } },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
        ],
      });
    it('takes the +1 when it changes the result, and reveals the building', () => {
      // DR 10: +3 is a NMC, +4 a PTC on the fixture's 30 column.
      const { engine, state: s0 } = dcGame([5, 5]);
      const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
      const t = act(engine, s1, { type: 'test.dc', dc: 'd1' });
      expect(attackOf(t).drm).toBe(4);
      expect(attackOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
      expect(revealed(t)).toBe(true);
      expect(t.events.find((e) => e.type === 'sk1.fire.result')!.payload).toMatchObject({ result: { kind: 'PTC' } });
    });
    it('is reported without the +1 when the result is the same either way', () => {
      // DR 2: a KIA with +3 or +4.
      const { engine, state: s0 } = dcGame([1, 1]);
      const s1 = act(engine, s0, { type: 'fortify.designate', buildings: ['b-P5'] }).state;
      const t = act(engine, s1, { type: 'test.dc', dc: 'd1' });
      expect(attackOf(t).drm).toBe(3);
      expect(attackOf(t).explain.map((n) => n.label)).not.toContain('+1 Fortified Building');
      expect(revealed(t)).toBe(false);
    });
  });

  describe('ordnance', () => {
    // A German 88 in O4 fires at a British squad in O5, a building the British fortified (range 1: To Hit 10, CH 5).
    const gunGame = (dice: number[], building: 'building-stone' | 'building-wood', open = false) => {
      const scenario = {
        ...GE_VS_BR,
        forces: [{ side: 'br', units: [], setup: { kind: 'area' as const, description: 'O5', hexes: ['yO5'] } }],
        ssr: [{ module: FORTIFIED_MODULE, params: { side: 'br', count: 1, within: 'setup', ...(open ? { open: true } : {}) } }],
      };
      const terrain = { yO5: { terrain: building, buildingId: 'b-O5' } };
      const pieces = (ca: number) => [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yO4' },
        { id: 'g88', def: 'ge.AA88L', side: 'ge', heldBy: 'c1', tags: { ca } },
        { id: 'b1', def: 'br.457', side: 'br', hex: 'yO5' },
      ];
      const probe = makeEngine({ scenario, extra: [...sk2CoreModules, fortifiedModule], terrain, pieces: pieces(0) });
      const map = statics(probe.engine.env(probe.state)).map;
      const ca = inCoveredArc(map.hex('yO4')!.cube, 0, map.hex('yO5')!.cube) ? 0 : nearestSpine(map.hex('yO4')!.cube, 0, map.hex('yO5')!.cube)!;
      const { engine, state } = makeEngine({ scenario, extra: [...sk2CoreModules, fortifiedModule], terrain, dice, pieces: pieces(ca) });
      return { engine, state: act(engine, state, { type: 'fortify.designate', buildings: ['b-O5'] }).state };
    };
    const shotOf = (t: { events: { type: string; payload: unknown }[] }) => t.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { drm: number; outcome: string; explain: { label?: string }[] };
    const fire = { type: 'fire.ordnance', shot: { weapon: 'g88', target: 'yO5', targetType: 'ITT' } };

    it('adds the +1 to the To Hit DR when it changes the hit or the Critical Hit, revealing the building', () => {
      // Original 2: with +3 a Critical Hit (5), with +4 an ordinary hit (6).
      const { engine, state } = gunGame([1, 1, 3, 3], 'building-stone');
      const t = act(engine, state, fire);
      expect(shotOf(t)).toMatchObject({ drm: 4, outcome: 'hit' });
      expect(shotOf(t).explain.map((n) => n.label)).toContain('+1 Fortified Building');
      expect(revealed(t)).toBe(true);
    });
    it('leaves it out of the To Hit DR when the shot hits the same either way', () => {
      // Original 3: 6 or 7, both an ordinary hit against 10.
      const { engine, state } = gunGame([1, 2, 3, 3], 'building-stone');
      const t = act(engine, state, fire);
      expect(shotOf(t)).toMatchObject({ drm: 3, outcome: 'hit' });
      expect(shotOf(t).explain.map((n) => n.label)).not.toContain('+1 Fortified Building');
      expect(revealed(t)).toBe(false);
    });
    it('reverses the fortified TEM on a Critical Hit: -3 for a wooden building (B23.921)', () => {
      // Known from the start (the card names it). Original 2 +3 = 5: a Critical Hit; its IFT DR takes -3, not -2.
      const { engine, state } = gunGame([1, 1, 3, 3], 'building-wood', true);
      const t = act(engine, state, fire);
      expect(shotOf(t)).toMatchObject({ drm: 3, outcome: 'ch' });
      expect(attackOf(t).drm).toBe(-3);
      expect(attackOf(t).explain.map((n) => n.label)).toEqual(expect.arrayContaining(['-2 Critical Hit: TEM reversed', '-1 Critical Hit: Fortified Building TEM reversed']));
    });
  });
});
