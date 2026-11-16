import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { moveState } from '../src';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/**
 * Assault Movement is a move of one hex without using all MF (SK1 3.3; ASLRB A4.61). Once the stack is in that hex, with
 * nothing left to spend MF on there, its move is over: it is finished once the defender has had its say on the step,
 * with no end-of-move First Fire chance. With something left (Smoke grenades), it ends by hand, as any other stack.
 */
describe('the end of an Assault Movement', () => {
  const kind = (engine: Engine, s: GameState) => engine.currentDecision(s)?.kind;

  it('without anything else to do, the stack is finished after the defender’s answer to its step', () => {
    // A Russian 4-4-7 (no Smoke exponent) Assault Moves one hex in the open; a German squad sees it.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yI4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yI6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'], assault: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'yJ4' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    s = act(engine, s, { type: 'defPass' }).state;
    // Done: no end-of-move First Fire question, the Russian picks the next stack.
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(s.pieces['r1']!.tags['moved']).toBe(true);
    // The other squad moves as usual, and may still Assault Move itself.
    s = act(engine, s, { type: 'move.start', units: ['r2'], assault: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'yJ6' }).state;
    expect(kind(engine, s)).toBe('firstFire');
  });

  it('with Smoke grenades it could still throw, it stays to be ended by hand, and the ending is a last First Fire chance', () => {
    // A US 7-4-7 (Smoke exponent 3) Assault Moves one hex in the open in sight of a German squad.
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yI4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['a1'], assault: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'yJ4' }).state;
    s = act(engine, s, { type: 'defPass' }).state;
    expect(moveState(engine.env(s))?.units).toEqual(['a1']);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'am' });
    s = act(engine, s, { type: 'move.end' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge', data: { ending: true } });
  });

  it('a stack the defender cannot fire at is finished as soon as it has entered its hex', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yA4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yGG5' },
      ],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1'], assault: true }).state;
    s = act(engine, s, { type: 'move.step', to: 'yB4' }).state;
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
  });
});
