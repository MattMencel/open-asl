import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { panzerfaustModule, simplePfShots } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { act, makeEngine, type PieceSpec } from './fixtures';
import type { ScenarioDef } from '../src';

/*
 * A PF check is a SW use (SK4 4.4.2): "Even if a PF check fails to result in a shot, the PF check constitutes the use of
 * a SW." A HS or crew fires one weapon and forfeits its own FP (SK4 4.0); a squad fires one SW free, and "provided a
 * squad has not yet fired its inherent FP, it can attempt to fire a second PF in the same phase even if its first check
 * did not yield a shot, but that would constitute the use of two SW and the squad would lose its inherent FP" (4.4.2;
 * ASLRB A7.35, A7.351, C13.31). So a crew manning a Gun that tries a PF has used its one weapon: no Gun shot after it.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules, panzerfaustModule];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const scenario = (firstSide: string): Partial<ScenarioDef> => ({
  firstSide,
  date: '10 October 1944',
  month: 10,
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
  forces: [
    // The order of battle sets the PF shots (four German squads) and the enemy AFV; its counters wait offboard.
    { id: 'ge', group: 'G', side: 'ge', units: [{ def: 'ge.467', count: 4 }], setup: { kind: 'enter', turn: 9, edge: 'north' } },
    { id: 'ru', group: 'R', side: 'ru', units: [{ def: 'ru.T34M43', count: 1 }], setup: { kind: 'enter', turn: 9, edge: 'south' } },
  ],
});
const t34: PieceSpec = { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } };
/** A German crew in yK5 manning a 75L AT Gun aimed south at the T-34 next door (yK6); the German PFPh. */
const crewGun: PieceSpec[] = [{ id: 'c', def: 'ge.228c', side: 'ge', hex: 'yK5' }, { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'c', tags: { ca: 3 } }];
const game = (pieces: PieceSpec[], dice: number[], startPhase = 'PFPh', firstSide = 'ge') => makeEngine({ scenario: scenario(firstSide), extra, startPhase, dice, pieces });
const validate = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { ...a, side: d.owner, decisionId: d.id } as never);
};
const PF = { unit: 'c', target: 'yK6', targetType: 'VTT' };
const GUN = { weapon: 'gun', target: 'yK6', targetType: 'VTT' };

describe('a PF check is a SW use (SK4 4.4.2)', () => {
  it('a crew whose PF check finds none has used its one weapon: no Gun shot, no own FP, no second check this phase', () => {
    const { engine, state } = game([...crewGun, t34], [5]);
    expect(validate(engine, state, { type: 'fire.ordnance', shot: GUN })).toBeNull();
    const r = act(engine, state, { type: 'fire.pf', pf: PF });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ unit: 'c', result: 'none' });
    expect(r.state.pieces['c']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1, ownFpForfeit: true });
    expect(validate(engine, r.state, { type: 'fire.ordnance', shot: GUN })).toMatch(/crew that used another weapon this phase may not also fire its Gun/);
    expect(validate(engine, r.state, { type: 'fire.pf', pf: PF })).toMatch(/already fired/);
    expect(validate(engine, r.state, { type: 'fire', decl: { units: ['c'], sw: [], target: 'yK6' } })).not.toBeNull();
    // Nothing the crew could do is offered: no Gun shot, no PF.
    const offered = engine.legalActions(r.state, 'ge');
    expect(offered.filter((a) => a.type === 'fire.ordnance' || a.type === 'fire.pf')).toEqual([]);
  });

  it('a pinning PF check (an original 6) is a SW use too', () => {
    const { engine, state } = game([...crewGun, t34], [6]);
    const r = act(engine, state, { type: 'fire.pf', pf: PF });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ result: 'pinned' });
    expect(validate(engine, r.state, { type: 'fire.ordnance', shot: GUN })).toMatch(/used another weapon/);
  });

  it('a crew whose Gun fired may not try a PF, and the Gun may still fire again with ROF', () => {
    // TH DR 6+1 = 7 misses (AP at the T-34's front); colored 1 keeps ROF 2.
    const { engine, state } = game([...crewGun, t34], [6, 1, 6, 1]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: GUN });
    expect(ev(r, 'sk2.ordnance.rof')[0]).toMatchObject({ kept: true });
    expect(validate(engine, r.state, { type: 'fire.ordnance', shot: GUN })).toBeNull();
    expect(validate(engine, r.state, { type: 'fire.pf', pf: PF })).not.toBeNull();
    expect(simplePfShots(engine.env(r.state), 'ge', 'prep', ['yK6'])).toEqual([]);
  });

  it('a squad may try a second PF while its own FP is unspent, and then loses that FP; never a third', () => {
    const { engine, state } = game([{ id: 'q', def: 'ge.467', side: 'ge', hex: 'yK5' }, t34], [5, 4]);
    const pf = { ...PF, unit: 'q' };
    let s = act(engine, state, { type: 'fire.pf', pf }).state;
    expect(s.pieces['q']!.tags['ownFpForfeit']).toBeUndefined();
    expect(validate(engine, s, { type: 'fire.pf', pf })).toBeNull();
    s = act(engine, s, { type: 'fire.pf', pf }).state;
    expect(s.pieces['q']!.tags).toMatchObject({ swDestroyed: 2, ownFpForfeit: true });
    expect(validate(engine, s, { type: 'fire.pf', pf })).toMatch(/at most two SW/);
    expect(validate(engine, s, { type: 'fire', decl: { units: ['q'], sw: [], target: 'yK6' } })).toMatch(/forfeited its own FP/);
  });

  it('a squad that fired its own FP may try one PF, not a second', () => {
    const { engine, state } = game([{ id: 'q', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK4' }, t34], [5, 5, 5]);
    const pf = { ...PF, unit: 'q' };
    // Its own FP at the Russian squad north of it: Prep Fire, and one SW still free (SK4 4.0).
    let s = act(engine, state, { type: 'fire', decl: { units: ['q'], sw: [], target: 'yK4' } }).state;
    expect(s.pieces['q']!.tags['fire']).toBe('prep');
    expect(validate(engine, s, { type: 'fire.pf', pf })).toBeNull();
    s = act(engine, s, { type: 'fire.pf', pf }).state;
    expect(validate(engine, s, { type: 'fire.pf', pf })).toMatch(/fired its own FP may use only one SW/);
  });

  it('a found PF that fires counts as well: the squad then fires two more SW only by giving up its own FP', () => {
    // PF check 2 finds one; TH DR 6+6 misses (an original 12 also Casualty Reduces; use 6+5).
    const { engine, state } = game([{ id: 'q', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'l', def: 'ge.LMG', side: 'ge', heldBy: 'q' }, { id: 'm', def: 'ge.MMG', side: 'ge', heldBy: 'q' }, t34], [2, 6, 5]);
    const s = act(engine, state, { type: 'fire.pf', pf: { ...PF, unit: 'q' } }).state;
    expect(s.pieces['q']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1 });
    expect(validate(engine, s, { type: 'fire', decl: { units: [], sw: ['l', 'm'], target: 'yK6' } })).toMatch(/at most two SW/);
    expect(validate(engine, s, { type: 'fire', decl: { units: [], sw: ['l'], target: 'yK6' } })).toBeNull();
  });
});

describe('a PF check as Defensive First Fire (SK4 4.4.2)', () => {
  /** The Russian MPh: the T-34 drives from yK8 into yK6, next to the crew and its Gun in yK5. */
  const dff = (dice: number[]) => {
    const { engine, state } = game([...crewGun, { ...t34, hex: 'yK8' }], dice, 'MPh', 'ru');
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    const pass = () => {
      while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    };
    pass();
    s = act(engine, s, { type: 'move.step', to: 'yK7' }).state;
    pass();
    s = act(engine, s, { type: 'move.step', to: 'yK6' }).state;
    return { engine, s, pass: (x: GameState) => ((s = x), pass(), s) };
  };

  it('marks the crew as having fired at this location even when it finds no PF, and its Gun may not fire after it', () => {
    const { engine, s } = dff([5]);
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    const r = act(engine, s, { type: 'defFire.pf', pf: PF });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ result: 'none' });
    const d = engine.currentDecision(r.state);
    // No other First Fire is open to the crew: the window closes and the mover carries on.
    if (d?.kind === 'firstFire') expect(validate(engine, r.state, { type: 'defFire.ordnance', shot: GUN })).not.toBeNull();
    else expect(d?.owner).toBe('ru');
    expect(r.state.pieces['c']!.tags).toMatchObject({ firedSw: true, ownFpForfeit: true });
  });

  it('the crew and its Gun fire normally in the next Player Turn', () => {
    const { engine, s, pass } = dff([5]);
    let t = pass(act(engine, s, { type: 'defFire.pf', pf: PF }).state);
    // End the Russian Player Turn: every phase passes until the German PFPh.
    for (let i = 0; i < 60 && !(t.phase === 'PFPh' && t.attacker === 'ge'); i++) {
      const d = engine.currentDecision(t)!;
      t = act(engine, t, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
    }
    expect(t.phase).toBe('PFPh');
    expect(t.attacker).toBe('ge');
    expect(t.pieces['c']!.tags['firedSw']).toBeUndefined();
    expect(t.pieces['c']!.tags['swDestroyed']).toBeUndefined();
    expect(t.pieces['c']!.tags['ownFpForfeit']).toBeUndefined();
    expect(validate(engine, t, { type: 'fire.ordnance', shot: GUN })).toBeNull();
  });
});
