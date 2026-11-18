import { describe, expect, it } from 'vitest';
import { deepEqual, type GameState, type LoggedEvent } from '@asl/engine';
import { breaches, fortCounters, fortifiedKnownTo, fortifiedState, hiddenFrom, redactState, scatterState, shownCounter, type Breach, type FortRecord, type FortifiedState, type ScatterState } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, PLAYABLE_SCENARIOS, mulberry, newGame, newSk1Game } from '../src';

/** Strings the viewer must never receive: ids of pieces hidden from them, and the other side's unrevealed secrets. */
function secretsFrom(engine: ReturnType<typeof newSk1Game>['engine'], state: GameState, viewer: string | null): string[] {
  const env = engine.env(state);
  const out: string[] = [];
  for (const id of hiddenFrom(env, state, viewer)) out.push(JSON.stringify(id));
  return out;
}

/**
 * The redaction invariants, on random play of every playable scenario, for both seats and a spectator:
 * 1. the redacted event stream folds into the redacted snapshot, step by step, with the same event count;
 * 2. no hidden piece id or unrevealed secret reaches the viewer, in the snapshot or in the stream;
 * 3. the engine can still list legal actions on the redacted state (the client does that).
 */
describe('redacted views on random play', () => {
  const ACTIONS = 140;
  for (const scenario of PLAYABLE_SCENARIOS) {
    it(`${scenario.id}: every viewer's stream folds into their snapshot and leaks nothing`, { timeout: 90_000 }, () => {
      const { engine, state: s0 } = newSk1Game(scenario, `redact-${scenario.id}`, { los: 'grid' });
      const rand = mulberry(scenario.id.length * 7919);
      const viewers: (string | null)[] = [...s0.sides, null];
      const redactors = new Map(viewers.map((v) => [v, (s: GameState) => redactState(engine, s, v)]));
      let state = s0;
      let views = new Map(viewers.map((v) => [v, redactors.get(v)!(s0)]));
      let secretsSeen = 0;
      for (let i = 0; i < ACTIONS && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = doing.length && rand() < 0.75 ? doing : legal;
        const t = engine.submit(state, pool[Math.floor(rand() * pool.length)]!);
        for (const viewer of viewers) {
          const redact = redactors.get(viewer)!;
          const stream = engine.redactTransition(viewer, redact, state, t.events as LoggedEvent[]);
          expect(stream.length, `${viewer}: event count`).toBe(t.events.length);
          const folded = engine.applyEvents(views.get(viewer)!, stream);
          const snapshot = redact(t.state);
          if (!deepEqual(folded, snapshot)) {
            expect.fail(`${scenario.id} seq ${t.state.seq}, viewer ${viewer}: folded stream differs from the snapshot\n${JSON.stringify(stream.map((e) => e.type))}`);
          }
          // Hidden before and after: a piece revealed (or hidden) by this action may be named by the stream that shows it.
          const after = new Set(secretsFrom(engine, t.state, viewer));
          const secrets = secretsFrom(engine, state, viewer).filter((x) => after.has(x));
          secretsSeen += secrets.length;
          if (secrets.length) {
            const json = JSON.stringify(snapshot) + JSON.stringify(stream);
            for (const s of secrets) expect(json, `${scenario.id} seq ${t.state.seq}, viewer ${viewer} sees ${s}`).not.toContain(s);
          }
          // Fortified buildings: a building id is public (Control names it), so check the slice itself.
          const fort = snapshot.ext['sk1.fortified'] as FortifiedState | undefined;
          const realFort = fortifiedState(engine.env(t.state));
          if (fort && realFort && realFort.side !== viewer) {
            expect(fort.buildings.every((b) => realFort.revealed.includes(b)), `${viewer} sees unrevealed fortified buildings`).toBe(true);
            for (const e of stream) if (e.type === 'sk1.fortified') expect((e.payload as { state: FortifiedState }).state.buildings.every((b) => realFort.revealed.includes(b))).toBe(true);
            if (realFort.buildings.some((b) => !realFort.revealed.includes(b))) secretsSeen++;
            // Designated by Location (B23.911): only the revealed Locations, upper levels included.
            if (realFort.locations) {
              const shown = realFort.revealedLocs ?? [];
              expect(fort.locations ?? [], `${viewer} sees unrevealed fortified Locations`).toEqual(realFort.locations.filter((l) => shown.includes(l)));
              for (const e of stream) if (e.type === 'sk1.fortified') expect(((e.payload as { state: FortifiedState }).state.locations ?? []).every((l) => shown.includes(l))).toBe(true);
              if (realFort.locations.some((l) => !shown.includes(l))) secretsSeen++;
            }
            // Breaches (B23.9221): only those of Locations the viewer knows are fortified.
            const env = engine.env(t.state);
            const seenBreaches = (snapshot.ext['asl.breach'] as Breach[] | undefined) ?? [];
            expect(seenBreaches, `${viewer} sees a Breach of an unrevealed Location`).toEqual(breaches(env).filter((b) => fortifiedKnownTo(env, b.loc, viewer)));
            for (const e of stream) if (e.type === 'asl.breach.he' && (e.payload as { breached: boolean }).breached) expect(fortifiedKnownTo(env, (e.payload as { loc: string }).loc, viewer)).toBe(true);
          }
          // Fortification counters (full ASL A12.33, B28.1): a viewer sees exactly what `shownCounter` allows, nothing of a hidden one's hex, factors or arc.
          const forts = (snapshot.ext['asl.fortifications'] as { counters: FortRecord[] } | undefined)?.counters;
          const realForts = fortCounters(engine.env(t.state));
          if (forts && realForts.length) {
            const allowed = realForts.map((c) => shownCounter(c, viewer)).filter((c): c is FortRecord => !!c);
            expect(forts, `${viewer} sees other fortification counters than allowed`).toEqual(allowed);
            for (const e of stream) if (e.type === 'asl.fort.placed') expect((e.payload as { counters: FortRecord[] }).counters.every((c) => allowed.some((a) => a.id === c.id))).toBe(true);
            if (realForts.some((c) => c.side !== viewer)) {
              // A Known and a Dummy minefield are alike to the enemy, with no strength; the Dummy Secret dr is its owner's.
              const theirs = JSON.stringify([forts, stream.filter((e) => e.type.startsWith('asl.fort'))]);
              expect(theirs, `${viewer} sees a Dummy flag`).not.toContain('"dummy"');
              for (const c of forts.filter((c) => c.kind === 'mines' && !c.mines?.strengthRevealed)) expect(c.mines, `${viewer} sees a minefield's strength`).not.toHaveProperty('ap');
              expect(stream.some((e) => e.type === 'asl.fort.dummies'), `${viewer} sees the Dummy Secret dr`).toBe(false);
              secretsSeen++;
            }
            if (realForts.length > allowed.length) secretsSeen++;
            // A unit beneath a hidden entrenchment shows no position to the other side, nor does the moving stack's state
            // or a move in or out of it (B27.13 positions; A12.33 free entry while hidden).
            const hiddenEnt = new Set(realForts.filter((c) => (c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch') && c.side !== viewer && !allowed.some((a) => a.id === c.id)).map((c) => c.hex));
            if (hiddenEnt.size) {
              for (const p of Object.values(snapshot.pieces)) if (p.loc.kind === 'hex' && hiddenEnt.has(p.loc.hex)) expect(p.loc.pos?.ent, `${viewer} sees ${p.id} beneath a hidden entrenchment`).toBeUndefined();
              const ms = snapshot.ext['sk1.move'] as { hex?: string; ent?: true } | undefined;
              if (ms?.hex && hiddenEnt.has(ms.hex)) expect(ms.ent, `${viewer} sees the moving stack beneath a hidden entrenchment`).toBeUndefined();
              for (const e of stream) if (e.type === 'asl.entrench.move') expect(hiddenEnt.has((e.payload as { hex: string }).hex), `${viewer} sees a move beneath a hidden entrenchment`).toBe(false);
              secretsSeen++;
            }
          }
          // Scatter setup: the units are on the table for all to see; the plan (groups, rendezvous) is the secret.
          const plan = snapshot.ext['ssr.scatter'] as ScatterState | undefined;
          const realPlan = scatterState(engine.env(t.state));
          if (plan && realPlan && realPlan.side !== viewer) {
            realPlan.groups.forEach((_g, gi) => {
              if (realPlan.rolled.includes(gi)) return;
              expect(plan.groups[gi], `${viewer} sees scatter group ${gi}`).toEqual([]);
              expect(plan.rendezvous[gi], `${viewer} sees rendezvous ${gi}`).toBe('');
              secretsSeen++;
            });
          }
          const owner = engine.currentDecision(snapshot)?.owner;
          if (owner) expect(() => engine.legalActions(snapshot, owner)).not.toThrow();
          views.set(viewer, snapshot);
        }
        // A side's own view keeps every piece; the other secrets are the module's business.
        for (const side of s0.sides) {
          const own = views.get(side)!;
          for (const p of Object.values(t.state.pieces)) if (p.side === side) expect(own.pieces[p.id], `${side} sees its own ${p.id}`).toBeDefined();
        }
        state = t.state;
      }
      // Sanity: scenarios whose pieces hide from the other side actually exercised the leak scan.
      const env = engine.env(state);
      if (s0.sides.some((side) => hiddenFrom(env, s0, side).size > 0) || scatterState(env)) expect(secretsSeen).toBeGreaterThan(0);
    });
  }
});

describe('redacted views of a game being created', () => {
  it('the Dummy Minefield Secret dr (B28.47) reaches its owner only: no dice for the other seat or a spectator', () => {
    const { engine, init, events, state } = newGame(ASL_TESTBED_SCENARIO, 'redact-create');
    const start = engine.initialState(init);
    const isSecret = (e: LoggedEvent) => e.type === 'dice.rolled' && /Secret dr/.test((e.payload as { label: string }).label);
    expect(events.some(isSecret)).toBe(true);
    for (const viewer of ['ru', 'ge', null]) {
      const redact = (s: GameState) => redactState(engine, s, viewer);
      const stream = engine.redactTransition(viewer, redact, start, events as LoggedEvent[]);
      expect(deepEqual(engine.applyEvents(redact(start), stream), redact(state))).toBe(true);
      if (viewer === 'ru') expect(stream.some(isSecret)).toBe(true);
      else {
        expect(JSON.stringify(stream), `${viewer} sees the Secret dr`).not.toMatch(/Secret dr/);
        expect(stream.some((e) => e.type === 'asl.fort.dummies')).toBe(false);
      }
    }
  });
});
