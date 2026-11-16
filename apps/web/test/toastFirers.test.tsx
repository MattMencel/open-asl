// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { sk2CoreModules } from '../../../packages/rules/src/sk2';
import { sk3CoreModules } from '../../../packages/rules/src/sk3';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: GameFx | null = null;
function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log, false, 0);
  seen = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present, 0);
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

describe('the firers on a To Hit toast', () => {
  it('shows a vehicle firing its Main Armament once: the vehicle is both the weapon and the firer', () => {
    const { engine, state } = makeEngine({
      pieces: [
        { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM8', tags: { vca: 0, ca: 0 } },
        { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' },
      ],
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'PFPh',
      dice: [6, 6],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    reactAct(() => root!.render(createElement(Screen, { engine, state, log: created.events })));
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM6', targetType: 'ITT' } });
    reactAct(() => root!.render(createElement(Screen, { engine, state: r.state, log: [...created.events, ...r.events] })));
    reactAct(() => vi.advanceTimersByTime(5000));
    const toast = seen!.history.find((t) => t.label.startsWith('To Hit'));
    expect(toast).toBeDefined();
    expect(toast!.firers.map((u) => u.id)).toEqual(['t34']);
  });
});
