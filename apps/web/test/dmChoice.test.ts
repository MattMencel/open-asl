import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { dmChoices } from '../src/game/dmChoice';

/** Broken American units under DM in the RPh: a1 in the open, a2 in woods, a3 beside a German squad; a4 in Good Order. */
function game() {
  return makeEngine({
    startPhase: 'RPh',
    terrain: { yM2: { terrain: 'woods' } },
    pieces: [
      { id: 'a1', def: 'am.747', side: 'am', hex: 'yC5', tags: { broken: true, dm: true } },
      { id: 'a2', def: 'am.747', side: 'am', hex: 'yM2', tags: { broken: true, dm: true } },
      { id: 'a3', def: 'am.747', side: 'am', hex: 'yP8', tags: { broken: true, dm: true } },
      { id: 'a4', def: 'am.747', side: 'am', hex: 'yC5' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
    ],
  }) as { engine: Engine; state: GameState };
}

const choices = (engine: Engine, state: GameState) =>
  dmChoices(engine.env(state), 'am', Object.values(state.pieces).filter((p) => p.side === 'am'));

describe('the DM choice on the Rally Phase menus (SK1 3.1 g)', () => {
  it('offers "Remove DM" on each broken unit under DM, disabled with the reason where the rules decide', () => {
    const { engine, state } = game();
    const c = choices(engine, state);
    expect(c.map((x) => [x.unit, x.kind, !!x.why])).toEqual([
      ['a1', 'remove', false],
      ['a2', 'remove', true],
      ['a3', 'remove', true],
    ]);
    expect(c[1]!.why).toMatch(/woods or a building/);
    expect(c[2]!.why).toMatch(/Known enemy/);
  });

  it('once removal is chosen the entry turns to "Keep DM", which takes it back', () => {
    const { engine, state } = game();
    const s = act(engine, state, { type: 'rally.dmRemove', unit: 'a1' }).state;
    const c = choices(engine, s).find((x) => x.unit === 'a1')!;
    expect([c.kind, c.label, c.why]).toEqual(['keep', 'Keep DM', null]);
    const back = act(engine, s, { type: 'rally.dmKeep', unit: 'a1' }).state;
    expect(choices(engine, back).find((x) => x.unit === 'a1')!.kind).toBe('remove');
  });
});
