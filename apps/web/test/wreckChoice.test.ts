import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { act, makeEngine, RU_VS_GE } from '../../../packages/rules/test/fixtures';
import { wreckChoices } from '../src/game/wreckChoice';

const check = (engine: Engine, state: GameState) => (a: Omit<Action, 'side' | 'decisionId'>) =>
  engine.validate(state, { ...a, side: 'ru', decisionId: engine.currentDecision(state)!.id } as Action);
const here = (state: GameState, hex: string) =>
  Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex && p.side === 'ru');

describe('the wreck choice for two friendly AFV in one hex (SK4 3.3.2: the owner flips one of them)', () => {
  it('a T-34 that moved in beside another may flip either, during its move or once it has ended', () => {
    // t34 in yM5 points at spine 0; whichever neighbour that is, t34b waits there.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'MPh',
      pieces: [{ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } }],
    }) as { engine: Engine; state: GameState };
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    const ahead = (engine.legalActions(s, 'ru').find((a) => a.type === 'move.step') as { to: string } | undefined)!.to;
    // Put the second T-34 in the hex ahead, then drive in and stop.
    s = { ...s, pieces: { ...s.pieces, t34b: { ...s.pieces['t34']!, id: 't34b', tags: { vca: 0, ca: 0 }, loc: { kind: 'hex', hex: ahead } } } };
    s = act(engine, s, { type: 'move.step', to: ahead }).state;
    s = act(engine, s, { type: 'vmove.stop' }).state;
    expect(wreckChoices(here(s, ahead), check(engine, s)).sort()).toEqual(['t34', 't34b']);
    // Flip the one that was already there; the mover goes on.
    const r = act(engine, s, { type: 'vmove.wreck', vehicle: 't34b' }).state;
    expect(r.pieces['t34b']!.tags['wreck']).toBe(true);
    expect(wreckChoices(here(r, ahead), check(engine, r))).toEqual([]);
  });

  it('a vehicle alone in its hex is not offered the wreck', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'MPh',
      pieces: [{ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } }],
    }) as { engine: Engine; state: GameState };
    expect(wreckChoices(here(state, 'yM5'), check(engine, state))).toEqual([]);
  });
});
