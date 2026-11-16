import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { FP, inCoveredArc, isVisibleTo, redactState, sk2CoreModules, statics, type FireDeclaration, type FireMode, type ResolveFireFn } from '../src';
import { GE_VS_BR, act, makeEngine } from './fixtures';

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
const extra = [...sk2CoreModules, testFire];
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** A hidden British crew and 40L in woods at yM5 (not Open Ground, so no LOS reveal), Germans about. */
const hidden = (gunHex = 'yM5', extraTags: Record<string, unknown> = {}) => [
  { id: 'c1', def: 'br.228c', side: 'br', hex: gunHex, tags: { hip: true } },
  { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true, ...extraTags } },
];

describe('Hidden Initial Placement (SK4 6.4)', () => {
  it('reveals a departing crew and its dropped Gun, without revealing another manned Gun', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' }, extra,
      terrain: { yM5: { terrain: 'woods' }, yL5: { terrain: 'woods' } }, startPhase: 'MPh',
      pieces: [...hidden(), { id: 'c2', def: 'br.228c', side: 'br', hex: 'yM5', tags: { hip: true } },
        { id: 'g2', def: 'br.AA40L', side: 'br', heldBy: 'c2', tags: { hip: true, ca: 0, emplaced: true } },
        { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yJ5' }],
    });
    let s = act(engine, state, { type: 'move.drop', sw: 'g40' }).state;
    expect(s.pieces['c1']!.tags['hip']).toBe(true);
    expect(s.pieces['g40']!.tags['hip']).toBe(true);
    s = settle(engine, act(engine, s, { type: 'move.start', units: ['c1'] }).state);
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yL5' }).state);
    for (const id of ['c1', 'g40']) expect(isVisibleTo(engine.env(s), s.pieces[id]!, 'ge')).toBe(true);
    for (const id of ['c2', 'g2']) expect(s.pieces[id]!.tags['hip']).toBe(true);
    expect(s.pieces['g40']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(s.pieces['g40']!.tags['hipCrew']).toBeUndefined();
    s = settle(engine, act(engine, s, { type: 'move.end' }).state);
    while (s.attacker === 'br') s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('RPh');
    for (const id of ['c1', 'g40']) expect(s.pieces[id]!.tags['hip']).toBeUndefined();
    expect(s.pieces['c1']!.tags['moved']).toBeUndefined();
    expect(redactState(engine, s, 'ge').pieces['c1']).toBeDefined();
  });

  it('shows an advancing crew with its leader before the opposing Close Combat declaration', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' }, extra,
      terrain: { yM5: { terrain: 'woods' } }, startPhase: 'APh',
      pieces: [...hidden(), { id: 'l1', def: 'br.L80', side: 'br', hex: 'yM5', tags: { stackedOn: 'c1' } },
        { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    let s = act(engine, state, { type: 'move.drop', sw: 'g40' }).state;
    s = act(engine, s, { type: 'advance', units: ['c1', 'l1'], to: 'yL5' }).state;
    expect(s.pieces['c1']!.tags['hip']).toBeUndefined();
    expect(s.pieces['g40']!.tags['hip']).toBeUndefined();
    s = act(engine, s, { type: 'endPhase' }).state;
    if (engine.currentDecision(s)?.kind === 'ccHex') s = act(engine, s, { type: 'cc.choose', hex: 'yL5' }).state;
    s = act(engine, s, { type: 'cc.declare', attacks: [] }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    const visible = redactState(engine, s, 'ge');
    const options = engine.legalActions(visible, 'ge');
    expect(options).toEqual(engine.legalActions(s, 'ge'));
    expect(options.some(a => JSON.stringify(a).includes('c1') && JSON.stringify(a).includes('l1'))).toBe(true);
    for (const a of options) expect(engine.validate(s, a)).toBeNull();
  });

  it('clears the former-crew association when the hidden Gun is recovered', () => {
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' }, extra, dice: [1],
      terrain: { yM5: { terrain: 'woods' } }, startPhase: 'MPh',
      pieces: [...hidden(), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yA1' }],
    });
    let s = act(engine, state, { type: 'move.drop', sw: 'g40' }).state;
    expect(s.pieces['g40']!.tags['hipCrew']).toBe('c1');
    s = act(engine, s, { type: 'move.start', units: ['c1'] }).state;
    s = act(engine, s, { type: 'move.recover', unit: 'c1', sw: 'g40' }).state;
    expect(s.pieces['g40']!.loc).toEqual({ kind: 'held', by: 'c1' });
    expect(s.pieces['g40']!.tags['hipCrew']).toBeUndefined();
  });

  it('hides the Gun and crew from the other side: not a target, not a Known Enemy Unit, not an obstacle to movement orders', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain: { yM5: { terrain: 'woods' } }, startPhase: 'PFPh', pieces: [...hidden(), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const env = engine.env(state);
    expect(isVisibleTo(env, state.pieces['c1']!, 'ge')).toBe(false);
    expect(isVisibleTo(env, state.pieces['c1']!, 'br')).toBe(true);
    expect(isVisibleTo(env, state.pieces['c1']!, null)).toBe(false);
    expect(engine.legalActions(state, 'ge').filter((a) => a.type === 'fire').map((a) => (a as unknown as { decl: { target: string } }).decl.target)).not.toContain('yM5');
  });

  it('is not the closest Known Enemy Unit for Subsequent First Fire: a nearer hidden crew does not bar the shot at the mover', () => {
    // SK1 3.3.1 limits Subsequent First Fire to the range of the closest Known Enemy Unit; a KEU is an unconcealed
    // enemy unit in the firer's LOS (SK4 glossary), which a hidden Gun crew (SK4 6.4) is not. The British move:
    // their hidden crew sits in woods two hexes from a German marked First Fire, their squad walks past three off.
    const { engine, state } = makeEngine({
      scenario: { ...GE_VS_BR, firstSide: 'br' },
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'MPh',
      dice: [3, 3, 3, 3, 3, 3],
      pieces: [...hidden('yM5'), { id: 'b1', def: 'br.458', side: 'br', hex: 'yH7' }, { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yM7', tags: { fire: 'first' } }],
    });
    let s = act(engine, state, { type: 'move.start', units: ['b1'] }).state;
    s = settle(engine, s);
    s = act(engine, s, { type: 'move.step', to: 'yI7' }).state;
    s = settle(engine, s);
    s = act(engine, s, { type: 'move.step', to: 'yJ7' }).state;
    const d = engine.currentDecision(s)!;
    expect(d).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const shot = { type: 'defFire', decl: { units: ['e1'], sw: [], target: 'yJ7' }, side: 'ge', decisionId: d.id } as unknown as Action;
    expect(engine.validate(s, shot)).toBeNull();
    expect(s.pieces['c1']!.tags['hip']).toBe(true);
    // Once revealed, the crew is a Known Enemy Unit and the farther mover may not be the target.
    const revealed = { ...s, pieces: { ...s.pieces, c1: { ...s.pieces['c1']!, tags: {} }, g40: { ...s.pieces['g40']!, tags: { ca: 0, emplaced: true } } } };
    expect(engine.validate(revealed, shot)).toBe('Subsequent First Fire must target the closest Known Enemy Unit');
  });

  it('is found in Open Ground by a Good Order enemy within 16 hexes with a LOS', () => {
    const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, startPhase: 'MPh', pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yA1' }] });
    // Nobody has seen it yet (the German is 12+ hexes off... in LOS on the fixture grid: it is seen at the first phase start).
    const seen = state.pieces['g40']!.tags['hip'] === undefined;
    expect(seen).toBe(true);
    const far = makeEngine({ scenario: GE_VS_BR, extra, startPhase: 'MPh', pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yGG10' }] });
    expect(far.state.pieces['g40']!.tags['hip']).toBe(true);
    let s = act(far.engine, far.state, { type: 'move.start', units: ['e1'] }).state;
    // Walk west until within 16 hexes and in LOS (board y fixture: grid LOS, open ground).
    for (let i = 0; i < 20 && s.pieces['g40']!.tags['hip']; i++) {
      const steps = far.engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step') as unknown as { to: string }[];
      if (!steps.length) break;
      const map = (far.engine.statics as { map: { distance(a: string, b: string): number } }).map;
      const best = [...steps].sort((a, b) => map.distance(a.to, 'yM5') - map.distance(b.to, 'yM5'))[0]!;
      s = settle(far.engine, act(far.engine, s, { type: 'move.step', to: best.to }).state);
      if (!s.pieces['e1'] || far.engine.currentDecision(s)?.kind !== 'phase') break;
    }
    expect(s.pieces['g40']!.tags['hip']).toBeUndefined();
    expect(s.pieces['c1']!.tags['hip']).toBeUndefined();
  });

  it('turns back enemy Infantry that tries to enter its hex in the MPh: the Gun is revealed and may fire on them where they stand', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'MPh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }],
    });
    let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
    s = settle(engine, act(engine, s, { type: 'move.step', to: 'yL5' }).state);
    expect(s.pieces['g40']!.tags['hip']).toBe(true);
    // Entering M5 is offered (the hex looks empty) and costs the MF, but the stack stays in L5.
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && (a as unknown as { to: string }).to === 'yM5')).toBe(true);
    const t = act(engine, s, { type: 'move.step', to: 'yM5' });
    expect(t.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ gun: 'g40', crew: 'c1', hex: 'yM5', reason: 'entered' });
    expect(t.events.some((e) => e.type === 'sk2.hip.bounce')).toBe(true);
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
    expect(t.state.pieces['g40']!.tags['hip']).toBeUndefined();
    // The defender is asked to fire at the halted stack in L5; afterwards the stack has ended its move.
    expect(engine.currentDecision(t.state)?.kind).toBe('firstFire');
    const shots = engine.legalActions(t.state, 'br').filter((a) => a.type === 'defFire.ordnance');
    expect(shots.length).toBeGreaterThan(0);
    s = act(engine, t.state, { type: 'defPass' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('phase');
    expect(s.pieces['e1']!.tags['moved']).toBe(true);
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step')).toBe(false);
  });

  it('attacks on a hex with hidden units are Area Fire (half FP) for small arms and +2 To Hit for ordnance', async () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      dice: [3, 4, 6, 6],
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    // Fire that lands on the hex (the test action skips target checks) attacks the hidden crew on half the column.
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['e1'], sw: [], target: 'yM5' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { column: number };
    expect(attack.column).toBe(8);
    const result = t.events.find((e) => e.type === 'sk1.fire.result')!.payload as { unit: string; result: { kind: string } };
    expect(result.unit).toBe('c1');
    // A German Gun firing on the ATT at the empty-looking hex takes +2.
    const g = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      pieces: [...hidden('yM5'), { id: 'c2', def: 'ge.228c', side: 'ge', hex: 'yK5' }, { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c2', tags: { ca: 1 } }],
    });
    const env = g.engine.env(g.state);
    const illegal = env.query('ordnance.illegal', { shot: { weapon: 'g75', target: 'yM5', targetType: 'ITT', ca: 1 }, mode: 'prep', side: 'ge' }, null);
    expect(illegal).toMatch(/No target there/);
    const { shotContext } = await import('../src');
    const sc = shotContext(env, { weapon: 'g75', target: 'yM5', targetType: 'ATT', ca: 1 }, 'prep', 'ge');
    expect(env.explain('ordnance.thDrm', sc, 0).trace.some((x) => x.id === 'sk2.th.hip-target' && !x.suppressedBy)).toBe(true);
  });

  it('a router entering the hex is revealed to and eliminated for failure to rout; an advance into it is an ambush', () => {
    // Rout: the broken German must rout from L5 (adjacent to a known British squad in K5... use a woods target M5).
    const rout = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'woods' } },
      startPhase: 'RtPh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5', tags: { broken: true } }, { id: 'b2', def: 'br.457', side: 'br', hex: 'yK5' }],
    });
    const routs = rout.engine.legalActions(rout.state, 'ge').filter((a) => a.type === 'rout.step' && a['to'] === 'yM5' && !a['lowCrawl']);
    expect(routs.length).toBeGreaterThan(0);
    const t = act(rout.engine, rout.state, routs[0]!);
    expect(t.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ reason: 'entered' });
    expect(t.state.pieces['e1']!.loc).toEqual({ kind: 'eliminated' });
    // Advance: the German walks into M5 (grain: not Open Ground, so the Gun was not spotted) for Close
    // Combat; the British get -2 on the ambush dr, in terrain where no ambush is otherwise possible.
    const adv = makeEngine({
      scenario: GE_VS_BR,
      extra,
      terrain: { yM5: { terrain: 'grain' } },
      startPhase: 'APh',
      pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yL5' }],
    });
    const a = act(adv.engine, adv.state, { type: 'advance', units: ['e1'], to: 'yM5' });
    expect(a.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ reason: 'advanced' });
    expect(a.state.hexMarkers['yM5']).toMatchObject({ cc: true, hipAmbush: 'br' });
    const env = adv.engine.env(a.state);
    expect(env.query('cc.ambushDrm', { hex: 'yM5', side: 'br', units: ['c1'] }, 0)).toBe(-2);
    expect(env.query('cc.ambushDrm', { hex: 'yM5', side: 'ge', units: ['e1'] }, 0)).toBe(0);
  });

  describe('firing on the IFT reveals the Gun and its crew (ASLRB A12.121, A12.2, A12.34)', () => {
    const woods = { yM5: { terrain: 'woods' as const } };
    const brFirst = { ...GE_VS_BR, firstSide: 'br' as const };

    it('the crew firing its own FP in Prep Fire', () => {
      const { engine, state } = makeEngine({ scenario: brFirst, extra, terrain: woods, startPhase: 'PFPh', pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
      const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['c1'], sw: [], target: 'yK5' } });
      expect(t.events.find((e) => e.type === 'sk2.hip.revealed')!.payload).toMatchObject({ gun: 'g40', crew: 'c1', hex: 'yM5', reason: 'fire' });
      expect(t.state.pieces['c1']!.tags['hip']).toBeUndefined();
      expect(t.state.pieces['g40']!.tags['hip']).toBeUndefined();
      expect(isVisibleTo(engine.env(t.state), t.state.pieces['c1']!, 'ge')).toBe(true);
    });

    it('the Gun firing its IFE (SK4 6.8)', () => {
      const probe = makeEngine({ scenario: brFirst, extra, terrain: woods, startPhase: 'PFPh', pieces: hidden('yM5') });
      const map = statics(probe.engine.env(probe.state)).map;
      const ca = [0, 1, 2, 3, 4, 5].find((c) => inCoveredArc(map.hex('yM5')!.cube, c, map.hex('yK5')!.cube))!;
      const { engine, state } = makeEngine({ scenario: brFirst, extra, terrain: woods, startPhase: 'PFPh', pieces: [...hidden('yM5', { ca }), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
      const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: [], sw: ['g40'], target: 'yK5' } });
      expect(t.state.pieces['c1']!.tags['hip']).toBeUndefined();
      expect(t.state.pieces['g40']!.tags['hip']).toBeUndefined();
    });

    it('a hidden crew in Defensive First Fire, then on into the next Player Turn', () => {
      const { engine, state } = makeEngine({ scenario: GE_VS_BR, extra, terrain: woods, startPhase: 'MPh', dice: [4, 4, 4, 4, 4, 4, 4, 4], pieces: [...hidden('yM5'), { id: 'e1', def: 'ge.467', side: 'ge', hex: 'yJ5' }] });
      let s = act(engine, state, { type: 'move.start', units: ['e1'] }).state;
      s = act(engine, s, { type: 'move.step', to: 'yK5' }).state;
      const d = engine.currentDecision(s)!;
      expect(d).toMatchObject({ kind: 'firstFire', owner: 'br' });
      expect(s.pieces['c1']!.tags['hip']).toBe(true);
      const t = act(engine, s, { type: 'defFire', decl: { units: ['c1'], sw: [], target: 'yK5' } });
      expect(t.events.some((e) => e.type === 'sk2.hip.revealed')).toBe(true);
      s = t.state;
      expect(s.pieces['c1']!.tags['hip']).toBeUndefined();
      expect(s.pieces['g40']!.tags['hip']).toBeUndefined();
      // The rest of the turn and the British Player Turn: the crew stays revealed, a target, and may fire again.
      s = settle(engine, s);
      while (!(s.attacker === 'br' && s.phase === 'PFPh')) s = settle(engine, act(engine, s, { type: 'endPhase' }).state);
      expect(s.pieces['c1']!.tags['hip']).toBeUndefined();
      expect(isVisibleTo(engine.env(s), s.pieces['g40']!, 'ge')).toBe(true);
      if (s.pieces['e1']?.loc.kind === 'hex' && s.pieces['c1']?.loc.kind === 'hex') {
        const env = engine.env(s);
        expect(env.query('fire.illegal', { decl: { units: ['c1'], sw: [], target: hexOfTest(s, 'e1') }, mode: 'prep', side: 'br' }, null)).toBeNull();
      }
    });
  });
});

const hexOfTest = (s: GameState, id: string) => (s.pieces[id]!.loc as { hex: string }).hex;
