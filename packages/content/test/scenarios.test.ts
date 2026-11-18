import { describe, expect, it } from 'vitest';
import { T, T2, T3, TAG_LIFECYCLE } from '@asl/rules';
import { ALL_SCENARIOS, PLAYABLE_SCENARIOS, applyBalance, isPlayable, mulberry, newSk1Game, playRandom, scenarioById, sk1Ruleset, staticsFor, weightedPicker } from '../src';
import { skLocationViolation, tankWeights, turnBoundaryCheck } from './randomPlayChecks';

describe('tag lifecycles', () => {
  it('lists every declared tag (T, T2, T3) in TAG_LIFECYCLE', () => {
    const declared = [...Object.values(T), ...Object.values(T2), ...Object.values(T3)];
    expect(declared.filter((k) => !TAG_LIFECYCLE[k])).toEqual([]);
  });
});

describe('catalogued scenarios', () => {
  it('marks every coming-soon card with what it needs and no forces', () => {
    for (const s of ALL_SCENARIOS.filter((x) => !isPlayable(x))) {
      expect(s.needs?.length, s.id).toBeGreaterThan(0);
      expect(s.forces, s.id).toEqual([]);
      expect(s.place, s.id).toBeTruthy();
    }
    expect(PLAYABLE_SCENARIOS.map((s) => s.id)).toEqual(expect.arrayContaining(['sk-s7', 'sk-s8', 'sk-s17', 'sk-s18', 'sk-s19', 'sk-s28', 'sk-s29', 'sk-s30', 'sk-s31', 'sk-s32', 'sk-s33', 'sk-s34', 'sk-s35', 'sk-s36', 'lma-10', 'lma-8', 'lma-6', 'lma-2', 'lma-9', 'lma-5', 'lma-7', 'lma-4']));
  });

  it('fields only counters its game loads', () => {
    for (const s of PLAYABLE_SCENARIOS) {
      const counters = staticsFor(s, { los: 'grid' }).counters;
      for (const f of s.forces) for (const u of f.units) for (const id of [u.def, ...(u.withSw ?? [])]) expect(counters[id], `${s.id}: ${id}`).toBeDefined();
    }
  });

  it('treats off-board hexes as Open Ground (SK4 3.x) except where an SSR says off-board terrain exists', () => {
    for (const s of PLAYABLE_SCENARIOS) {
      const ssr = s.ssr.some((r) => r.module === 'offboard-terrain');
      const off = staticsFor(s, { los: 'grid' }).map.offboard('N,E,S,W');
      expect(off.length, s.id).toBeGreaterThan(0);
      if (ssr) expect(off.some((h) => h.terrain !== 'open'), s.id).toBe(true);
      else expect(off.filter((h) => h.terrain !== 'open').map((h) => `${h.id}:${h.terrain}`), s.id).toEqual([]);
    }
  });

  it('demo-armor: weighted random play between the tank forces produces shots, Bounding First Fire, To Kill rolls and wrecks', () => {
    const scenario = scenarioById('demo-armor')!;
    let wrecks = 0;
    let toKill = 0;
    let shots = 0;
    let bff = 0;
    // The tanks start in range of each other: often skip the PFPh so they move, and fire on the move.
    const weigh = weightedPicker((a, legal, state, engine) => (state.phase === 'PFPh' && a.type === 'endPhase' ? 20 : tankWeights(a, legal, state, engine)));
    for (const seed of [1, 2]) {
      const check = turnBoundaryCheck(`demo-armor seed ${seed}`);
      const { state, steps } = playRandom(scenario, `armor-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (s, events, a) => {
          if (a.type === 'vmove.bff' || a.type === 'vmove.bffMg') bff++;
          for (const ev of events) {
            if (ev.type === 'sk3.toKill') toKill++;
            if (ev.type === 'sk2.ordnance.shot') shots++;
          }
          check(s);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
      wrecks += Object.values(state.pieces).filter((p) => p.tags['wreck']).length;
    }
    expect(shots).toBeGreaterThan(10);
    expect(bff).toBeGreaterThan(0);
    expect(toKill).toBeGreaterThan(0);
    expect(wrecks).toBeGreaterThan(0);
  }, 60_000);

  it('asl-testbed-fire: weighted random play kindles, spreads and fights fires, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed-fire')!;
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    // Kindle whenever offered, fight a Flame whenever offered, otherwise mostly end phases so the AFPh ends come round.
    const weigh = weightedPicker((a) => (a.type === 'fire.kindle' ? 40 : a.type === 'fire.extinguish' ? 20 : a.type === 'endPhase' ? 6 : a.type === 'blaze.break' ? 5 : 1));
    for (const seed of [1, 2, 3]) {
      const check = turnBoundaryCheck(`asl-testbed-fire seed ${seed}`);
      const { state, steps } = playRandom(scenario, `fire-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) if (ev.type.startsWith('asl.fire') || ev.type.startsWith('asl.rubble') || ev.type.startsWith('asl.wind')) bump(ev.type);
          check(st, events);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['fire.kindle'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.blazeCheck'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.spread'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.fire.blaze'] ?? 0).toBeGreaterThan(0);
    expect(counts['asl.wind.changeDr'] ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('asl-testbed: weighted random play places the fortification counters, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    // Place the counters whenever the setup offers it, otherwise play as usual.
    const weigh = weightedPicker((a) => (a.type === 'fort.place' ? 400 : a.type === 'endPhase' ? 4 : 1));
    for (const seed of [1, 2]) {
      const check = turnBoundaryCheck(`asl-testbed forts seed ${seed}`);
      let placed = false;
      const { state, steps } = playRandom(scenario, `forts-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 8000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          for (const ev of events) if (ev.type.startsWith('asl.fort')) bump(ev.type);
          check(st, events);
          // Once this game's counters are placed they stay where they were put, whatever the turn.
          if (a.type === 'fort.place') placed = true;
          const forts = (st.ext['asl.fortifications'] as { counters: unknown[] } | undefined)?.counters ?? [];
          if (placed) expect(forts.length).toBeGreaterThan(0);
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['fort.place'] ?? 0).toBe(2);
    // The two setup placements, plus any foxhole dug in play (B27.11).
    expect(counts['asl.fort.placed'] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('asl-testbed: weighted random play entrenches, moves in and out of foxholes and routs beneath them, and every Player Turn boundary is clean', () => {
    const scenario = scenarioById('asl-testbed')!;
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    // Dig whenever the PFPh offers it, go in and out of entrenchments and beneath them in the RtPh, else play as usual.
    const weigh = weightedPicker((a) => (a.type === 'fort.place' ? 400 : a.type === 'entrench.attempt' ? 80 : a.type === 'move.entrenchment' ? 30 : a['beneath'] !== undefined ? 30 : a.type === 'endPhase' ? 4 : 1));
    for (const seed of [11, 12, 13]) {
      const check = turnBoundaryCheck(`asl-testbed entrench seed ${seed}`);
      const { state, steps } = playRandom(scenario, `entrench-${seed}`, {
        rand: mulberry(seed),
        maxSteps: 9000,
        pick: weigh,
        onStep: (st, events, a) => {
          bump(a.type);
          if (a['beneath'] !== undefined) bump(`${a.type}:beneath`);
          for (const ev of events) {
            if (ev.type === 'asl.entrench.attempt') bump((ev.payload as { success: boolean }).success ? 'dug' : 'failed');
            if (ev.type === 'asl.entrench.move') bump(`move:${(ev.payload as { phase: string }).phase}`);
            if (ev.type === 'asl.fort.grown') bump('grown');
          }
          check(st, events);
          // Every unit beneath an entrenchment stands in a hex that holds one, and a Labor counter names the Location its unit is in.
          const forts = (st.ext['asl.fortifications'] as { counters: { kind: string; hex: string }[] } | undefined)?.counters ?? [];
          for (const p of Object.values(st.pieces)) {
            if (p.loc.kind !== 'hex') continue;
            if (p.loc.pos?.ent) expect(forts.some((c) => c.hex === (p.loc as { hex: string }).hex && (c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch')), `${p.id} beneath nothing in ${p.loc.hex}`).toBe(true);
            const labor = typeof p.tags['labor'] === 'string' ? p.tags['labor'] : null;
            if (labor) expect(labor.replace(/^[a-z]+:/, '').replace(/@.*$/, ''), `${p.id} carries Labor away`).toBe(p.loc.hex);
          }
        },
      });
      expect(state.result, `seed ${seed} reached no result in ${steps} steps`).not.toBeNull();
    }
    expect(counts['entrench.attempt'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['dug'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect(counts['move.entrenchment'] ?? 0, JSON.stringify(counts)).toBeGreaterThan(0);
    expect((counts['move:MPh'] ?? 0) + (counts['move:RtPh'] ?? 0) + (counts['move:APh'] ?? 0), JSON.stringify(counts)).toBeGreaterThan(0);
  }, 120_000);

  for (const s of PLAYABLE_SCENARIOS) {
    it(`${s.id}: builds, applies every balance option, and plays through at random`, () => {
      expect(() => sk1Ruleset(s)).not.toThrow();
      for (const b of s.balance ?? []) {
        if (b.unavailable) expect(() => applyBalance(s, [b.side]), `${s.id} unavailable balance ${b.side}`).toThrow();
        else expect(() => newSk1Game(applyBalance(s, [b.side]), 'x', { los: 'grid' }), `${s.id} balance ${b.side}`).not.toThrow();
      }
      const check = turnBoundaryCheck(s.id);
      const { state, steps } = playRandom(s, 'seed-7', { rand: mulberry(7), maxSteps: 6000, onStep: check });
      expect(state.result, `${s.id} reached no result in ${steps} steps`).not.toBeNull();
      if (s.ruleset !== 'full-asl') expect(skLocationViolation(state)).toBeNull();
      expect(s.sides.map((x) => x.side)).toContain(state.result!.winner ?? s.sides[0]!.side);
    });
  }
});
