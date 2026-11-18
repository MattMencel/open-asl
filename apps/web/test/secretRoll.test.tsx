// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent, SideId } from '@asl/engine';
import { ASL_TESTBED_SCENARIO, newGame } from '@asl/content';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: GameFx | null = null;
function Screen({ engine, state, log, viewer }: { engine: Engine; state: GameState; log: LoggedEvent[]; viewer: SideId }) {
  const present = usePresentation(engine, state, log, false, 0);
  seen = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', viewer, present, 0);
  return null;
}
let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  seen = null;
  vi.useRealTimers();
});

describe('a secret dr on screen (ASLRB B28.47 Dummy Minefield Secret dr)', () => {
  it('is toasted to its side and never to the other', () => {
    const g = newGame(ASL_TESTBED_SCENARIO, 'secret-roll-fx');
    const log = g.events as LoggedEvent[];
    const roll = log.find((e) => e.type === 'dice.rolled' && /Secret dr/.test((e.payload as { label: string }).label))!;
    expect(roll.payload).toMatchObject({ secret: 'ru' });
    const toasts = (viewer: SideId) => {
      reactAct(() => root?.unmount());
      root = createRoot(document.createElement('div'));
      const first = log.filter((e) => e.seq < roll.seq);
      reactAct(() => root!.render(createElement(Screen, { engine: g.engine, state: g.state, log: first, viewer })));
      reactAct(() => root!.render(createElement(Screen, { engine: g.engine, state: g.state, log, viewer })));
      reactAct(() => vi.advanceTimersByTime(5000));
      return seen!.history.map((h) => h.label);
    };
    expect(toasts('ru').some((l) => /Secret dr/i.test(l))).toBe(true);
    expect(toasts('ge').some((l) => /Secret dr/i.test(l))).toBe(false);
  });
});
