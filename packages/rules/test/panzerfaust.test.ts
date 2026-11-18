import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { panzerfaustModule, pfCap, pfCheckNeed, pfCheckNeedText, pfMaxRange, pfUsed } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { act, makeEngine, type PieceSpec } from './fixtures';
import type { ScenarioDef } from '../src';

/*
 * Panzerfausts (SK4 4.4.2): from 10/43 in a scenario with an enemy AFV, a PF check dr ≤ 3 gives a German
 * Infantry unit a one-shot LATW (TH 10/8/6/4, HEAT TK 31); an original 6 pins; shots per scenario are
 * the German squads in the OB (x1.5 in 1944); the range grows with the date.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules, panzerfaustModule];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const scenario = (date: string, month: number, withAfv = true): Partial<ScenarioDef> => ({
  firstSide: 'ge',
  date,
  month,
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
  forces: [
    { id: 'ge', group: 'G', side: 'ge', units: [{ def: 'ge.467', count: 2 }], setup: { kind: 'area', description: '', hexes: [] } },
    { id: 'ru', group: 'R', side: 'ru', units: [{ def: withAfv ? 'ru.T34M43' : 'ru.447', count: 1 }], setup: { kind: 'area', description: '', hexes: [] } },
  ],
});
const game = (opts: { date?: string; month?: number; withAfv?: boolean; dice?: number[]; pieces?: PieceSpec[] } = {}) =>
  makeEngine({
    scenario: scenario(opts.date ?? '10 October 1944', opts.month ?? 10, opts.withAfv ?? true),
    extra,
    startPhase: 'PFPh',
    dice: opts.dice ?? [],
    pieces: opts.pieces ?? [
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } },
    ],
  });
const why = (engine: Engine, state: GameState, pf: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { type: 'fire.pf', pf, side: 'ge', decisionId: d.id } as never);
};

describe('Panzerfausts (SK4 4.4.2)', () => {
  it('are available from 10/43 with an enemy AFV: the squads in the OB, x1.5 in 1944; range by date', () => {
    expect(pfCap(game().engine.env(game().state), 'ge')).toBe(3);
    const early = game({ date: '20 September 1943', month: 9 });
    expect(pfCap(early.engine.env(early.state), 'ge')).toBeNull();
    const noAfv = game({ withAfv: false });
    expect(pfCap(noAfv.engine.env(noAfv.state), 'ge')).toBeNull();
    const may44 = game({ date: '10 May 1944', month: 5 });
    expect(pfMaxRange(may44.engine.env(may44.state))).toBe(1);
    expect(pfMaxRange(game().engine.env(game().state))).toBe(2);
  });

  it('an SSR may set the side’s shots for the scenario ("The initial number of German Panzerfausts is 5")', () => {
    const withSsr = (params: Record<string, unknown>, withAfv = true) =>
      makeEngine({
        scenario: { ...scenario('10 October 1944', 10, withAfv), ssr: [{ module: 'panzerfaust', params }] },
        extra,
        startPhase: 'PFPh',
        pieces: [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' }],
      });
    const five = withSsr({ side: 'ge', shots: 5 });
    expect(pfCap(five.engine.env(five.state), 'ge')).toBe(5);
    // Another side's count leaves this side's alone; with no side named it is everyone's.
    const other = withSsr({ side: 'ru', shots: 5 });
    expect(pfCap(other.engine.env(other.state), 'ge')).toBe(3);
    const any = withSsr({ shots: 1 }, false);
    expect(pfCap(any.engine.env(any.state), 'ge')).toBe(1);
  });

  it('the no-panzerfaust SSR takes them away from the side it names (LMA8 SSR 1)', () => {
    const denied = (ssr: ScenarioDef['ssr']) =>
      makeEngine({ scenario: { ...scenario('18 June 1944', 6), ssr }, extra, startPhase: 'PFPh', pieces: [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    const g = denied([{ module: 'no-panzerfaust', params: { side: 'ge' }, text: 'SSR 1' }]);
    expect(pfCap(g.engine.env(g.state), 'ge')).toBeNull();
    const other = denied([{ module: 'no-panzerfaust', params: { side: 'ru' }, text: 'SSR 1' }]);
    expect(pfCap(other.engine.env(other.state), 'ge')).toBe(3);
  });

  it('a PF check dr ≤ 3 fires a one-shot PF on its own To Hit Table, HEAT To Kill 31', () => {
    // PF check 2; TH DR 3 (TH 8 at 1 hex); then To Kill.
    const { engine, state } = game({ dice: [2, 1, 2, 3, 3, 6, 6] });
    expect(why(engine, state, { unit: 'g', target: 'yK6', targetType: 'VTT' })).toBeNull();
    const r = act(engine, state, { type: 'fire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ unit: 'g', dr: 2, drm: 0, result: 'pf' });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ th: 8, ammo: 'HEAT', range: 1, outcome: 'hit' });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ tk: 31 });
    expect(pfUsed(engine.env(r.state), 'ge')).toBe(1);
    expect(Object.values(r.state.pieces).filter((p) => p.defId === 'ge.PF' && p.loc.kind !== 'eliminated')).toHaveLength(0);
    // The unit has fired; it may not try again.
    expect(why(engine, r.state, { unit: 'g', target: 'yK6', targetType: 'VTT' })).not.toBeNull();
  });

  it('≥ 4 means no PF; an original 6 pins the unit', () => {
    const none = game({ dice: [4] });
    const r1 = act(none.engine, none.state, { type: 'fire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r1, 'sk3.pf.check')[0]).toMatchObject({ result: 'none' });
    expect(ev(r1, 'sk2.ordnance.shot')).toHaveLength(0);
    expect(pfUsed(none.engine.env(r1.state), 'ge')).toBe(0);
    // No shot, but a SW use all the same (SK4 4.4.2).
    expect(r1.state.pieces['g']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1 });
    const six = game({ dice: [6] });
    const r2 = act(six.engine, six.state, { type: 'fire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r2, 'sk3.pf.check')[0]).toMatchObject({ result: 'pinned' });
    expect(r2.state.pieces['g']!.tags['pinned']).toBe(true);
  });

  it('a leader alone takes +2: his dr of 2 is a final 4 and finds no PF, and the roll says he needs a 1', () => {
    const { engine, state } = game({ dice: [2], pieces: [{ id: 'ldr', def: 'ge.L80', side: 'ge', hex: 'yK5' }, { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } }] });
    const r = act(engine, state, { type: 'fire.pf', pf: { unit: 'ldr', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ dr: 2, drm: 2, final: 4, result: 'none' });
    expect(ev(r, 'dice.rolled')[0]!['label']).toBe('PF check by ldr: needs dr ≤ 1 (+2 SMC)');
  });

  it('states the dr the unit needs: 3 less the drm, none past +3, never an original 6', () => {
    expect([-1, 0, 1, 2, 3, 4].map(pfCheckNeed)).toEqual([4, 3, 2, 1, 0, 0]);
    expect(pfCheckNeedText(0, [])).toBe('dr ≤ 3');
    expect(pfCheckNeedText(2, ['+2 SMC'])).toBe('dr ≤ 1 (+2 SMC)');
    expect(pfCheckNeedText(3, ['+1 CX', '+2 SMC'])).toBe('no dr can succeed (+1 CX, +2 SMC)');
  });

  it('a leader in the firer\'s hex may direct the To Hit DR (ASL A7.531), not the PF check; one elsewhere may not', () => {
    const pieces: PieceSpec[] = [
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'l', def: 'ge.L91', side: 'ge', hex: 'yK5' },
      { id: 'far', def: 'ge.L81', side: 'ge', hex: 'yK4' },
      { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK6', tags: { vca: 0, ca: 0 } },
    ];
    const { engine, state } = game({ dice: [2, 4, 4, 3, 3], pieces });
    expect(why(engine, state, { unit: 'g', target: 'yK6', targetType: 'VTT', director: 'far' })).toMatch(/firer's hex/);
    expect(why(engine, state, { unit: 'l', target: 'yK6', targetType: 'VTT', director: 'l' })).toMatch(/his own fire/);
    const r = act(engine, state, { type: 'fire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT', director: 'l' } });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ dr: 2, drm: 0 });
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot).toMatchObject({ drm: -1 });
    expect((shot['explain'] as { label: string }[]).map((n) => n.label)).toContain('-1 leadership');
    expect(r.state.pieces['l']!.tags['fire']).toBe('prep');
  });

  it('an original TH DR 12 misses and Casualty Reduces the firer', () => {
    const { engine, state } = game({ dice: [1, 6, 6] });
    const r = act(engine, state, { type: 'fire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'miss' });
    expect(r.state.pieces['g']!.defId).not.toBe('ge.467');
  });

  it('only at a vehicle, a Gun or Infantry in a building, within its range', () => {
    const { engine, state } = game({
      pieces: [
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' },
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK6' },
        { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK8', tags: { vca: 0, ca: 0 } },
      ],
    });
    expect(why(engine, state, { unit: 'g', target: 'yK6', targetType: 'ITT' })).toMatch(/building/);
    expect(why(engine, state, { unit: 'g', target: 'yK8', targetType: 'VTT' })).toMatch(/reaches 2 hexes/);
  });
});

describe('Panzerfausts as Defensive First Fire', () => {
  it('a PF check that finds none is still a SW use: the squad has fired at this location, and its own FP waits for the next MP', () => {
    // Russians move: the T-34 enters K6 next to the German squad, which tries a PF (dr 5: none). SK4 4.4.2: "Even if a
    // PF check fails to result in a shot, the PF check constitutes the use of a SW." A squad's one SW is free (4.0).
    const { engine, state } = makeEngine({
      scenario: { ...scenario('10 October 1944', 10), firstSide: 'ru' },
      extra,
      startPhase: 'MPh',
      dice: [5],
      pieces: [
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' },
        { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yK7', tags: { vca: 0, ca: 0 } },
      ],
    });
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'move.step', to: 'yK6' }).state;
    expect(engine.currentDecision(s)?.kind).toBe('firstFire');
    const r = act(engine, s, { type: 'defFire.pf', pf: { unit: 'g', target: 'yK6', targetType: 'VTT' } });
    expect(ev(r, 'sk3.pf.check')[0]).toMatchObject({ result: 'none' });
    expect(r.state.pieces['g']!.tags).toMatchObject({ firedSw: true, swDestroyed: 1 });
    expect(r.state.pieces['g']!.tags['ownFpForfeit']).toBeUndefined();
    // No First Fire is open to it at this MP: the mover carries on.
    expect(engine.currentDecision(r.state)).toMatchObject({ owner: 'ru' });
    // The T-34 stops (another MP in K6): the squad may fire its own FP at it now.
    s = act(engine, r.state, { type: 'vmove.stop' }).state;
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('firstFire');
    expect(engine.validate(s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'yK6' }, side: 'ge', decisionId: d.id } as never)).toBeNull();
  });
});
