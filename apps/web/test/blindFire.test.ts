import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { blindFireOffered } from '../src/game/fireSelection';

describe('blind fire at a hex where no enemy is seen', () => {
  const pieces = [
    { id: 'a1', def: 'am.666', side: 'am', hex: 'yP5' },
    { id: 'aMMG', def: 'am.MMG', side: 'am', hex: 'yP7' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
  ];
  const { engine, state } = makeEngine({ pieces, startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
  const env = engine.env(state);

  it('is offered at an empty hex, and at one holding only an unpossessed weapon', () => {
    expect(blindFireOffered(env, 'yP6', 'am')).toBe(true);
    expect(blindFireOffered(env, 'yP7', 'am')).toBe(true);
  });

  it('is not offered at a hex holding the firer’s own unit: nothing hidden can be there (A12.15)', () => {
    expect(blindFireOffered(env, 'yP5', 'am')).toBe(false);
    expect(blindFireOffered(env, 'yN5', 'ge')).toBe(false);
  });
});
