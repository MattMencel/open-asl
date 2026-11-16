import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { act, makeEngine } from './fixtures';

/**
 * SK1 3.1 g: "All DM counters are removed at the end of the RPh unless the DM unit is adjacent to a Known Enemy Unit.
 * A broken unit may opt to keep its DM status unless in woods or building" (ASLRB A10.62: "so as to guarantee its
 * ability to rout again in the next RtPh"). A unit that may keep it keeps it unless its owner has it removed.
 */
describe('keeping DM at the end of the Rally Phase (SK1 3.1 g)', () => {
  const game = () =>
    makeEngine({
      terrain: { yM2: { terrain: 'woods' } },
      startPhase: 'RPh',
      // Every die high: no rally is attempted, and nothing else rolls before the next RPh's rally.
      dice: Array(40).fill(6),
      pieces: [
        // In the open, far from the enemy: may keep its DM.
        { id: 'open', def: 'am.747', side: 'am', hex: 'yC5', tags: { broken: true, dm: true } },
        { id: 'open2', def: 'am.747', side: 'am', hex: 'yJ3', tags: { broken: true, dm: true } },
        // In woods: its DM comes off.
        { id: 'woods', def: 'am.747', side: 'am', hex: 'yM2', tags: { broken: true, dm: true } },
        // Adjacent to a Known enemy: its DM stays.
        { id: 'near', def: 'am.747', side: 'am', hex: 'yP8', tags: { broken: true, dm: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
  const removable = (engine: Engine, s: GameState) => engine.legalActions(s, 'am').filter((a) => a.type === 'rally.dmRemove').map((a) => a['unit']);
  const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { side: 'am', decisionId: engine.currentDecision(s)!.id, ...a } as never);
  /** Both sides end the RPh. */
  const endRph = (engine: Engine, s: GameState) => {
    s = act(engine, s, { type: 'endPhase' }).state;
    return act(engine, s, { type: 'endPhase' }).state;
  };
  const dm = (s: GameState) => Object.fromEntries(['open', 'open2', 'woods', 'near'].map((id) => [id, s.pieces[id]!.tags['dm'] === true]));

  it('offers the choice only where the unit may keep it, and says why elsewhere', () => {
    const { engine, state } = game();
    expect(removable(engine, state)).toEqual(['open', 'open2']);
    expect(check(engine, state, { type: 'rally.dmRemove', unit: 'woods' })).toMatch(/woods or a building/);
    expect(check(engine, state, { type: 'rally.dmRemove', unit: 'near' })).toMatch(/Adjacent to a Known enemy/);
    expect(check(engine, state, { type: 'rally.dmKeep', unit: 'open' })).toMatch(/keeps its DM already/);
  });

  it('keeps DM by default; a removal (and its undo) is the owner’s choice, and the choice is gone with the phase', () => {
    const { engine, state } = game();
    let s = act(engine, state, { type: 'rally.dmRemove', unit: 'open2' }).state;
    expect(removable(engine, s)).toEqual(['open']);
    // Changed his mind, then back again: no RPh action is used up.
    s = act(engine, s, { type: 'rally.dmKeep', unit: 'open2' }).state;
    s = act(engine, s, { type: 'rally.dmRemove', unit: 'open2' }).state;
    s = endRph(engine, s);
    expect(s.phase).toBe('PFPh');
    expect(dm(s)).toEqual({ open: true, open2: false, woods: false, near: true });
    expect(Object.values(s.pieces).some((p) => p.tags['dmRemove'])).toBe(false);
  });

  it('a unit that kept its DM may rout in that Player Turn’s RtPh, and rallies at +4 in the next RPh', () => {
    const { engine, state } = game();
    let s = endRph(engine, state);
    for (let i = 0; i < 20 && s.phase !== 'RtPh'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('RtPh');
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'rout.step' && a['unit'] === 'open')).toBe(true);
    // It need not: it stays, and on to the next Player Turn's RPh, where it still wears DM.
    s = act(engine, s, { type: 'rout.stay', unit: 'open' }).state;
    for (let i = 0; i < 40 && !(s.phase === 'RPh' && s.attacker !== state.attacker); i++) {
      const d = engine.currentDecision(s)!;
      const l = engine.legalActions(s, d.owner);
      s = engine.submit(s, l.find((a) => a.type === 'endPhase') ?? l.find((a) => a.type === 'rout.stay') ?? l[0]!).state;
    }
    expect(s.phase).toBe('RPh');
    expect(s.pieces['open']!.tags['dm']).toBe(true);
    expect(engine.env(s).query('rally.drm', { unit: 'open', leader: null, self: true }, 0)).toBeGreaterThanOrEqual(4);
  });
});
