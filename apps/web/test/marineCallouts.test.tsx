// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { setupDeployModule, sk2CoreModules, sk3CoreModules, usmcModule } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

const sfx = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock('../src/audio/engine', () => ({ playSfx: (name: string) => sfx.played.push(name) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: GameFx | null = null;
function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log, false, 0);
  seen = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', 'am', present, 0);
  return null;
}
let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  root = createRoot(document.createElement('div'));
  sfx.played = [];
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  seen = null;
  vi.useRealTimers();
});

const SC = {
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
  ],
  forces: [{ side: 'am', units: [{ def: 'am.768', count: 2 }, { def: 'am.L91', count: 1 }], setup: { kind: 'area', description: 'west', hexes: ['yK5', 'yL5'] } }],
};

/** The board callouts of one Marine RPh action (SK4 8.4): their texts and the sounds played. */
function after(action: Record<string, unknown>) {
  const { engine, state } = makeEngine({
    scenario: SC as never,
    extra: [...sk2CoreModules, ...sk3CoreModules, setupDeployModule, usmcModule],
    terrain: {},
    startPhase: 'RPh',
    dice: [4, 4],
    pieces: [
      { id: 's', def: 'am.768', side: 'am', hex: 'yK5' },
      { id: 'l', def: 'am.L91', side: 'am', hex: 'yK5' },
      { id: 'h1', def: 'am.348h', side: 'am', hex: 'yL5' },
      { id: 'h2', def: 'am.348h', side: 'am', hex: 'yL5' },
      { id: 'l2', def: 'am.L91', side: 'am', hex: 'yL5' },
    ],
  });
  const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
  reactAct(() => root!.render(createElement(Screen, { engine, state, log: created.events })));
  const t = act(engine, state, action as never);
  reactAct(() => root!.render(createElement(Screen, { engine, state: t.state, log: [...created.events, ...t.events] })));
  reactAct(() => vi.advanceTimersByTime(4000));
  const texts = seen!.boardFx.filter((f) => f.kind === 'text').map((f) => (f as { text: string }).text);
  return { texts, sounds: sfx.played };
}

describe('Marine half-squads (SK4 8.4) are no casualty on the board', () => {
  it('a squad deployed by NTC says DEPLOYED, not REDUCED, without the hit sound', () => {
    const { texts, sounds } = after({ type: 'rally.deploy', unit: 's' });
    expect(texts).toContain('DEPLOYED');
    expect(texts).not.toContain('REDUCED');
    expect(sounds).not.toContain('hit.break');
  });

  it('two half-squads recombined by a leader say RECOMBINED, not REDUCED', () => {
    const { texts, sounds } = after({ type: 'rally.recombine', units: ['h1', 'h2'], leader: 'l2' });
    expect(texts).toContain('RECOMBINED');
    expect(texts).not.toContain('REDUCED');
    expect(sounds).not.toContain('hit.break');
  });
});
