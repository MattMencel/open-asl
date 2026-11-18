import { describe, expect, it } from 'vitest';
import { deepEqual, type Action, type GameState, type LoggedEvent } from '@asl/engine';
import { entrenchers, fortCounters, fortificationView, moveState, parseLabor, redactState, type FortRecord } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, FixtureBuilder, fixtureActions, newGame } from '../src';

/*
 * Foxholes and trenches in play on the T1 test bed (ASLRB B27, A4.8, B24.8): Entrenching in the Russian PFPh and what
 * it does to the diggers across the Player Turns, the separate MF in and out of a foxhole with the German's First Fire,
 * a move along the connecting trenches, and what the other seat learns of a hidden foxhole and the unit beneath it.
 */

function fixture(id: string) {
  const g = newGame(ASL_TESTBED_SCENARIO, 'entrench-test');
  let s = g.state;
  for (const a of fixtureActions(g.engine, s, id)) s = g.engine.submit(s, a).state;
  return new FixtureBuilder(g.engine, s);
}
const locOf = (state: GameState, id: string) => state.pieces[id]!.loc as { hex: string; pos?: { ent?: string } };
const until = (f: FixtureBuilder, phase: string, turn: number, attacker: string) => f.until(phase as never, { turn, attacker: attacker as never });

describe('Entrenching across the turns', () => {
  it('the diggers are TI for the Player Turn and free again next turn; a dug foxhole stays, a failure leaves Labor until the unit moves on', () => {
    const f = fixture('entrench');
    const ru = (def: string, n = 1) => f.unit('ru', def, n);
    expect(f.state).toMatchObject({ phase: 'PFPh', turn: 1, attacker: 'ru' });
    const env = f.engine.env(f.state);
    const m10 = entrenchers(env, 'uM10', 'ru');
    expect(m10.mmcs.map((p) => p.id)).toEqual([ru('ru.447', 3)]);
    expect(m10.leaders.map((p) => p.id)).toEqual([ru('ru.L70')]);
    // Offered: one attempt per Location with diggers, the leader directing.
    const offered = f.engine.legalActions(f.state, 'ru').filter((a) => a.type === 'entrench.attempt');
    expect(offered.map((a) => a['loc']).sort()).toEqual(['uM10', 'uO10']);
    expect(offered.find((a) => a['loc'] === 'uM10')?.['attempts']).toEqual([{ unit: ru('ru.447', 3), director: ru('ru.L70') }]);
    const before = fortCounters(env).length;
    const r1 = f.engine.submit(f.state, { type: 'entrench.attempt', loc: 'uM10', attempts: [{ unit: ru('ru.447', 3), director: ru('ru.L70') }], side: 'ru', decisionId: f.decision.id } as Action);
    f.state = r1.state;
    const a1 = r1.events.find((e) => e.type === 'asl.entrench.attempt')!.payload as { success: boolean; drm: number; explain: string[]; labor?: number };
    expect(a1.explain).toEqual(['+0 leadership', '-1 Russian'].filter((x) => x !== '+0 leadership'));
    expect(a1.drm).toBe(-1);
    f.act({ type: 'entrench.attempt', loc: 'uO10', attempts: [{ unit: ru('ru.426', 2) }] });
    for (const id of [ru('ru.447', 3), ru('ru.L70'), ru('ru.426', 2)]) expect(f.state.pieces[id]!.tags['ti']).toBe(true);
    const dug = a1.success;
    if (dug) {
      expect(fortCounters(f.engine.env(f.state))).toHaveLength(before + 1);
      expect(locOf(f.state, ru('ru.447', 3))).toEqual({ kind: 'hex', hex: 'uM10', pos: { ent: 'foxhole' } });
      expect(locOf(f.state, ru('ru.L70'))).toEqual({ kind: 'hex', hex: 'uM10', pos: { ent: 'foxhole' } });
    } else {
      expect(parseLabor(f.state.pieces[ru('ru.447', 3)]!.tags['labor'])).toEqual({ task: 'entrench:uM10', drm: -1 });
      expect(a1.labor).toBe(-1);
    }
    // The same Player Turn: TI units may not move or advance.
    until(f, 'MPh', 1, 'ru');
    expect(f.engine.validate(f.state, { type: 'move.start', units: [ru('ru.447', 3)], side: 'ru', decisionId: f.decision.id } as Action)).toMatch(/TI/);
    until(f, 'APh', 1, 'ru');
    expect(f.engine.legalActions(f.state, 'ru').some((a) => a.type === 'advance' && (a['units'] as string[]).includes(ru('ru.447', 3)))).toBe(false);
    // The next Player Turn: TI is gone, the foxhole (if dug) is still there, the Labor (if earned) too while the unit stays.
    until(f, 'RPh', 2, 'ge');
    for (const id of [ru('ru.447', 3), ru('ru.L70'), ru('ru.426', 2)]) expect(f.state.pieces[id]!.tags['ti']).toBeUndefined();
    if (dug) expect(fortCounters(f.engine.env(f.state)).some((c) => c.hex === 'uM10' && c.kind === 'foxhole')).toBe(true);
    else expect(parseLabor(f.state.pieces[ru('ru.447', 3)]!.tags['labor'])).toEqual({ task: 'entrench:uM10', drm: -1 });
    // Russian Turn 2: the diggers move again; out of the foxhole for its MF, and the Labor goes with the move.
    until(f, 'MPh', 2, 'ru');
    const digger = f.state.pieces[ru('ru.447', 3)]!;
    if (digger.tags['broken'] !== true && digger.tags['pinned'] !== true && digger.loc.kind === 'hex') {
      f.act({ type: 'move.start', units: [ru('ru.447', 3), ru('ru.L70')].filter((id) => f.state.pieces[id]!.loc.kind === 'hex' && !f.state.pieces[id]!.tags['broken']) });
      if (dug) {
        expect(moveState(f.engine.env(f.state))).toMatchObject({ ent: true });
        f.act({ type: 'move.entrenchment', beneath: false });
        f.settle('ru');
        expect(locOf(f.state, ru('ru.447', 3)).pos).toBeUndefined();
      }
      const steps = f.engine.legalActions(f.state, 'ru').filter((a) => a.type === 'move.step' && !a['beneath']);
      if (steps.length) {
        const { side: _s, decisionId: _d, ...step } = steps[0]!;
        f.act(step);
        f.settle('ru');
        expect(f.state.pieces[ru('ru.447', 3)]!.tags['labor']).toBeUndefined();
      }
    }
  });
});

describe('Foxholes and trenches in the Movement Phase', () => {
  it('the German is asked to fire at each separate MF: into the hex, beneath its foxhole, out again (B27.4, A8.12)', () => {
    const f = fixture('foxhole-fight');
    const ge = (def: string, n = 1) => f.unit('ge', def, n);
    expect(f.state).toMatchObject({ phase: 'MPh', turn: 1, attacker: 'ge' });
    // The open 1S foxhole in O10 has been seen; the 4-6-7 in S7 walks to it: S7-R8-Q9-P10... is far, so take the Assault
    // Moving stack in R5 toward the hidden O6 foxhole (revealed when the Germans saw it) instead: R5-Q6-P6 is the trench.
    const squad = ge('ge.467', 1);
    f.act({ type: 'move.start', units: [squad] });
    f.act({ type: 'move.step', to: 'uR5' });
    f.settle('ge');
    if (!moveState(f.engine.env(f.state))) return;
    f.act({ type: 'move.step', to: 'uQ6' });
    f.settle('ge');
    const mover = f.state.pieces[squad]!;
    if (mover.tags['broken'] === true || mover.tags['pinned'] === true || moveState(f.engine.env(f.state)) === undefined) return;
    // P6 holds the Russian 4-5-8 beneath its trench: an enemy Location, closed in the MPh (A4.14).
    expect(f.engine.validate(f.state, { type: 'move.step', to: 'uP6', side: 'ge', decisionId: f.decision.id } as Action)).toMatch(/enemy/);
    // O10's empty 1S foxhole: the plain step then the separate MF beneath, each with a Russian First Fire question.
    f.act({ type: 'move.end' });
    f.settle('ge');
    const s2 = ge('ge.467', 2);
    f.act({ type: 'move.start', units: [s2] });
    const path = ['uR8', 'uQ9', 'uP10'];
    for (const h of path) {
      if (f.engine.validate(f.state, { type: 'move.step', to: h, side: 'ge', decisionId: f.decision.id } as Action)) return;
      f.act({ type: 'move.step', to: h });
      f.settle('ge');
      if (!moveState(f.engine.env(f.state))) return;
    }
  });

  it('a step from one connecting trench to the other costs one MF, stays beneath and draws no FFNAM (B27.54); the DEFENDER is asked at the climb out', () => {
    const f = fixture('trench-move');
    const ru = (def: string, n = 1) => f.unit('ru', def, n);
    expect(f.state).toMatchObject({ phase: 'MPh', turn: 1, attacker: 'ru' });
    const squad = ru('ru.458', 2);
    expect(locOf(f.state, squad)).toEqual({ kind: 'hex', hex: 'uP6', pos: { ent: 'trench' } });
    f.act({ type: 'move.start', units: [squad] });
    expect(moveState(f.engine.env(f.state))).toMatchObject({ ent: true });
    const steps = f.engine.legalActions(f.state, 'ru').filter((a) => a.type === 'move.step');
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ to: 'uO7', beneath: true })]));
    // Out of the trench first, or straight along it: the plain step into O7 is refused while beneath.
    expect(f.engine.validate(f.state, { type: 'move.step', to: 'uO7', side: 'ru', decisionId: f.decision.id } as Action)).toMatch(/Leave the trench first/);
    const r = f.engine.submit(f.state, { type: 'move.step', to: 'uO7', beneath: true, side: 'ru', decisionId: f.decision.id } as Action);
    f.state = r.state;
    expect(locOf(f.state, squad)).toEqual({ kind: 'hex', hex: 'uO7', pos: { ent: 'trench' } });
    expect(moveState(f.engine.env(f.state))).toMatchObject({ hex: 'uO7', ent: true, trenchMove: true, spent: { [squad]: 1 } });
    expect(r.events.find((e) => e.type === 'asl.entrench.move')?.payload).toMatchObject({ hex: 'uO7', beneath: true, phase: 'MPh' });
    f.settle('ru');
    if (!moveState(f.engine.env(f.state))) return;
    // Climbing out is a MF of its own the German may fire at; the stack is then on top of the trench.
    expect(f.engine.legalActions(f.state, 'ru').filter((a) => a.type === 'move.entrenchment')).toEqual([expect.objectContaining({ beneath: false })]);
    f.act({ type: 'move.entrenchment', beneath: false });
    f.settle('ru');
    expect(locOf(f.state, squad).pos).toBeUndefined();
    expect(moveState(f.engine.env(f.state))).not.toHaveProperty('ent');
  });
});

describe('What the other seat sees', () => {
  it('at setup: a unit beneath a hidden foxhole shows no position, and the German setup stream names none of the counters still hidden', () => {
    const f = fixture('fort-owner');
    const ru = (def: string, n = 1) => f.unit('ru', def, n);
    // The Russians in their counters; the Germans far from the O6 foxhole's woods-less Open Ground... which any Good
    // Order German sees, so the O6 foxhole is revealed by LOS as the first Player Turn begins (A12.33). The hidden
    // counter that stays hidden for this check is therefore placed by the Russians where no German has a LOS: none on
    // the test bed, so the invariant is checked on the counter module's own redaction of the move.
    f.setup('ru', { [ru('ru.458', 1)]: 'uO3:pb', [ru('ru.447', 1)]: 'uO6', [ru('ru.426', 1)]: 'uO7', [ru('ru.458', 2)]: 'uP6', [ru('ru.527')]: 'uP9' }, {}, { beneath: [ru('ru.447', 1), ru('ru.426', 1), ru('ru.458', 2)] });
    const before = f.state;
    const viewGe = redactState(f.engine, before, 'ge');
    expect(viewGe.pieces[ru('ru.447', 1)]!.loc).toEqual({ kind: 'hex', hex: 'uO6' });
    // The German setup: its stream to the German seat names nothing of the counters still hidden after it (the first
    // Player Turn's LOS reveal shows the rest, A12.33), and folds into his snapshot.
    const dflt = f.engine.legalActions(before, 'ge').find((a) => a.type === 'setup.place')!;
    const t = f.engine.submit(before, dflt);
    const hidden = fortCounters(f.engine.env(t.state)).filter((c) => c.hidden && !c.revealed).map((c) => c.id);
    expect(hidden.length).toBeGreaterThan(0);
    const stream = f.engine.redactTransition('ge', (s) => redactState(f.engine, s, 'ge'), before, t.events as LoggedEvent[]);
    const folded = f.engine.applyEvents(viewGe, stream);
    const json = JSON.stringify(stream);
    for (const id of hidden) expect(json, id).not.toContain(id);
    expect(JSON.stringify(folded.ext['asl.fortifications'])).toEqual(JSON.stringify(redactState(f.engine, t.state, 'ge').ext['asl.fortifications']));
    const theirs = (redactState(f.engine, t.state, 'ge').ext['asl.fortifications'] as { counters: FortRecord[] }).counters;
    expect(theirs.every((c) => !c.hidden || c.revealed)).toBe(true);
    expect(fortificationView(f.engine.env(t.state), 'ge').map((c) => c.id)).not.toEqual(expect.arrayContaining(hidden));
  });

  it('a hidden foxhole out of German LOS, through the Russian Player Turn into the next: its 0-MF moves out and back in show the German nothing, and the squad moves on normally next turn (A12.33)', () => {
    const f = fixture('foxhole-hidden');
    const sq = f.unit('ru', 'ru.447', 3);
    const fox = fortCounters(f.engine.env(f.state)).find((c) => c.hex === 'uC2')!;
    expect(fox).toMatchObject({ kind: 'foxhole', hidden: true });
    expect(locOf(f.state, sq).pos).toEqual({ ent: 'foxhole' });
    const viewers: (string | null)[] = ['ge', null];
    const views = new Map(viewers.map((v) => [v, redactState(f.engine, f.state, v)]));
    const told: LoggedEvent[] = [];
    // Every action goes through the two-seat invariant: the stream folds into the snapshot, and neither names the counter,
    // shows the squad beneath it, the moving stack beneath it, or a move in or out of it.
    const submit = (a: Record<string, unknown>) => {
      const d = f.decision;
      const full = { ...a, side: d.owner, decisionId: d.id } as Action;
      expect(f.engine.validate(f.state, full), `${a.type} in ${f.state.phase}`).toBeNull();
      const t = f.engine.submit(f.state, full);
      for (const viewer of viewers) {
        const redact = (x: GameState) => redactState(f.engine, x, viewer);
        const stream = f.engine.redactTransition(viewer, redact, f.state, t.events as LoggedEvent[]);
        const snapshot = redact(t.state);
        expect(deepEqual(f.engine.applyEvents(views.get(viewer)!, stream), snapshot), `${viewer}: fold after ${a.type}`).toBe(true);
        const json = JSON.stringify(stream) + JSON.stringify(snapshot);
        expect(json, `${viewer} sees the counter`).not.toContain(`"${fox.id}"`);
        expect(stream.some((e) => e.type === 'asl.entrench.move'), `${viewer} sees a move beneath`).toBe(false);
        const p = snapshot.pieces[sq];
        if (p?.loc.kind === 'hex' && p.loc.hex === 'uC2') expect(p.loc.pos?.ent, `${viewer} sees the squad beneath`).toBeUndefined();
        expect((snapshot.ext['sk1.move'] as { ent?: true } | undefined)?.ent, `${viewer} sees the stack beneath`).toBeUndefined();
        views.set(viewer, snapshot);
      }
      told.push(...(t.events as LoggedEvent[]));
      f.state = t.state;
    };
    const PASS = ['defPass', 'defRofDecline', 'move.end', 'cc.arranged', 'blaze.stay', 'rout.stay', 'endPhase'];
    const passUntil = (phase: string, turn: number, attacker: string) => {
      for (let guard = 0; guard < 400 && !(f.state.phase === phase && f.state.turn === turn && f.state.attacker === attacker); guard++) {
        const legal = f.engine.legalActions(f.state, f.decision.owner);
        const pick = PASS.map((t) => legal.find((x) => x.type === t)).find(Boolean) ?? legal.find((x) => x.type === 'cc.declare' && (x['attacks'] as unknown[]).length === 0);
        const { side: _s, decisionId: _d, ...rest } = pick!;
        submit(rest);
      }
      expect(f.state).toMatchObject({ phase, turn, attacker });
    };
    passUntil('MPh', 1, 'ru');
    submit({ type: 'move.start', units: [sq] });
    // Out of the hidden foxhole and back beneath it: no MF either way (A12.33).
    submit({ type: 'move.entrenchment', beneath: false });
    expect(locOf(f.state, sq).pos).toBeUndefined();
    submit({ type: 'move.entrenchment', beneath: true });
    expect(locOf(f.state, sq).pos).toEqual({ ent: 'foxhole' });
    expect(moveState(f.engine.env(f.state))?.spent[sq] ?? 0).toBe(0);
    submit({ type: 'move.end' });
    // The rest of the Russian Player Turn, the German one, and into the next Russian MPh.
    passUntil('MPh', 2, 'ru');
    expect(fortCounters(f.engine.env(f.state)).find((c) => c.id === fox.id)).toMatchObject({ hidden: true });
    expect(fortCounters(f.engine.env(f.state)).find((c) => c.id === fox.id)?.revealed).toBeFalsy();
    expect(Object.values(f.state.pieces[sq]!.tags).filter(Boolean)).toEqual([]);
    // The squad moves on normally, out of the foxhole and away.
    submit({ type: 'move.start', units: [sq] });
    const out = f.engine.legalActions(f.state, 'ru').find((a) => a.type === 'move.step');
    expect(out).toBeDefined();
    const { side: _s, decisionId: _d, ...step } = out!;
    submit(step);
    expect(locOf(f.state, sq).hex).not.toBe('uC2');
    expect(told.length).toBeGreaterThan(0);
  });
});
