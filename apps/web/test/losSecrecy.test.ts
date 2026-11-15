import { describe, expect, it } from 'vitest';
import { newGame, scenarioById } from '@asl/content';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { describeEvents } from '../src/game/describe';
import { sideTally } from '../src/panels/CasualtyLedger';

/** No LOS may be checked ahead of an attack (ASLRB A6.11, SK4 3.2.1): what the screen shows outside one. */
describe('LOS shown only as the rules allow', () => {
  it('a shot picked in the log carries its own outcome: blocked for one that found no LOS, nothing to re-trace for one that resolved', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
    });
    const attack = { mode: 'prep', target: 'yP5', parts: ['a1'] };
    const events = [
      { seq: 1, type: 'sk1.fire.noLos', payload: { attack, from: ['yN5'], blockedBy: ['terrain obstacle'], dr: [6, 5], cowered: false } },
      { seq: 2, type: 'sk1.fire.attack', payload: { attack, from: ['yN5'], fp: 7, column: 6, dr: [6, 5], drm: 0, cowered: false, explain: [] } },
    ];
    const lines = describeEvents(engine.env(state), events as never);
    expect(lines.find((l) => l.seq === 1)!.los).toMatchObject({ from: ['yN5'], to: 'yP5', blocked: true });
    expect(lines.find((l) => l.seq === 2)!.los).toEqual({ from: ['yN5'], to: 'yP5' });
  });

  it('a victory condition counted by LOS shows no count while the game is on, only at its end', () => {
    const s31 = scenarioById('sk-s31')!;
    const { engine, state } = newGame(s31, 'los', { los: 'grid' });
    const side = s31.victory.find((v) => v.kind === 'losFirepower')!.side as string;
    expect(sideTally(engine.env(state), s31, side)).toMatchObject({ kind: 'fp', pending: true, points: 0, units: [] });
    const over = { ...state, result: { winner: side, reason: 'test' } };
    expect(sideTally(engine.env(over as never), s31, side)).not.toHaveProperty('pending');
  });
});
