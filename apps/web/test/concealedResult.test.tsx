// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Action, Ctx, Engine, GameState, LoggedEvent, RuleModule, SideId } from '@asl/engine';
import { FP, concealmentModule, sk2CoreModules, sk3CoreModules, type FireDeclaration, type FireMode, type ResolveFireFn } from '@asl/rules';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';
import { describeEvents } from '../src/game/describe';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({ type: 'test.fire', decisionKinds: ['phase'], resolve: (ctx: Ctx, a) => ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode) });
  },
};

let seen: GameFx | null = null;
function Screen({ engine, state, log, viewer }: { engine: Engine; state: GameState; log: LoggedEvent[]; viewer: SideId | null }) {
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

/** A Russian squad fires at a concealed German squad in a stone building: no effect, so it stays concealed (SK4 8.3). */
function shoot(viewer: SideId) {
  const { engine, state } = makeEngine({
    scenario: { ...RU_VS_GE, firstSide: 'ru', ssr: [{ module: 'concealment', params: {}, text: 'Concealment is in effect (SK4 8.3)' }] },
    extra: [...sk2CoreModules, ...sk3CoreModules, concealmentModule, testFire],
    terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
    startPhase: 'PFPh',
    pieces: [
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK7' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5', tags: { concealed: true } },
    ],
    dice: [6, 5],
  });
  const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
  reactAct(() => root!.render(createElement(Screen, { engine, state, log: created.events, viewer })));
  const t = act(engine, state, { type: 'test.fire', decl: { units: ['r'], sw: [], target: 'yK5' }, mode: 'prep' });
  expect(t.state.pieces['g']!.tags['concealed']).toBe(true);
  reactAct(() => root!.render(createElement(Screen, { engine, state: t.state, log: [...created.events, ...t.events], viewer })));
  reactAct(() => vi.advanceTimersByTime(3000));
  return { engine, t };
}

describe('a result on a concealed unit the viewer cannot see', () => {
  it('reads "?" on the dice card and in the log for the firer: what the attack did, not what it hit', () => {
    const { engine, t } = shoot('ru');
    const results = seen!.history.flatMap((h) => h.results);
    expect(results).toEqual(['? (concealed): no effect']);
    expect(results.join(' ')).not.toMatch(/4-6-7|German/);
    const log = describeEvents(engine.env(t.state), t.events, 'ru').map((l) => l.text).join('\n');
    expect(log).toContain('? (concealed): no effect');
    expect(log).not.toMatch(/German 4/);
  });

  it('names the unit for its owner', () => {
    shoot('ge');
    expect(seen!.history.flatMap((h) => h.results).join(' ')).toMatch(/German 4.?-6-7: no effect/);
  });
});
