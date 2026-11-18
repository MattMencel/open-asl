import { describe, expect, it } from 'vitest';
import type { GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, piecesModule, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine } from '../fixtures';

/*
 * TI in Close Combat (ASLRB A4.8 and its EX): +1 to any CC attack a TI unit takes part in (once per attack), -1 to any
 * CC attack made against a TI unit, and with a TI and a non-TI unit attacked together "the -1 DRM for TI status applies
 * only to the TI units; the DR is not modified for the non-TI unit".
 */

const ASL: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules];
const GE_VS_RU = {
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
};

describe('TI in Close Combat (ASLRB A4.8)', () => {
  it('the -1 applies only to the TI units of a group attacked together: a DR of 5 at kill 5 eliminates the TI squad and reduces the other', () => {
    // Two 4-6-7s (8 FP) attack two 4-4-7s (8 FP) at 1:1, kill 5.
    const { engine, state } = makeEngine({
      scenario: GE_VS_RU,
      modules: ASL,
      startPhase: 'APh',
      dice: [2, 3, 6, 6, 6, 6],
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'rt', def: 'ru.447', side: 'ru', hex: 'yO5', tags: { ti: true } },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yO5' },
      ],
    });
    let s: GameState = act(engine, state, { type: 'endPhase' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1', 'g2'], targets: ['rt', 'r2'] }] }).state;
    const t = act(engine, s, { type: 'cc.declare', attacks: [] });
    const cc = t.events.find((e) => e.type === 'sk1.cc.attack')!.payload;
    expect(cc).toMatchObject({ odds: '1:1', kill: 5, dr: 5, drm: 0, targetDrm: { rt: -1 } });
    expect(t.state.pieces['rt']!.loc.kind).toBe('eliminated');
    expect(t.state.pieces['r2']!.defId).not.toBe('ru.447');
    expect(t.state.pieces['r2']!.loc.kind).toBe('hex');
  });

  it('a TI attacker adds +1 once per attack, and against a TI defender the two cancel', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_RU,
      modules: ASL,
      startPhase: 'CCPh',
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { ti: true } },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { ti: true } },
        { id: 'rt', def: 'ru.447', side: 'ru', hex: 'yO5', tags: { ti: true } },
      ],
    });
    const env = engine.env(state);
    const q = { hex: 'yO5', attackers: ['g1', 'g2'], targets: ['rt'], side: 'ge' };
    expect(env.query('cc.drm', q, 0)).toBe(1);
    expect(env.query('cc.drm', q, 0) + env.query('cc.targetDrm', { ...q, target: 'rt' }, 0)).toBe(0);
  });
});
