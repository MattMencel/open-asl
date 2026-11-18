import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '@asl/rules';
import { act, GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { staleFire, weaponHolder } from '../src/game/staleFire';

/** A German squad with a 50mm Mortar and an LMG in yK5, a British squad two hexes away. */
function game(startPhase: string) {
  return makeEngine({
    scenario: GE_VS_BR,
    extra: sk2CoreModules,
    startPhase,
    pieces: [
      { id: 'u', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
      { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'u' },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yM5' },
    ],
  }) as { engine: Engine; state: GameState };
}

describe('lined-up fire the game has overtaken (SK1 1.2.2: only the possessing unit fires a SW)', () => {
  it('a Mortar shot lined up and then the Mortar destroyed (SK1 4.0) is dropped with its selection and declaration', () => {
    const { engine, state } = game('PFPh');
    const lined = { selected: new Set(['m']), declared: true, gunShot: { gun: 'm', holder: weaponHolder(state, 'm') }, pfShot: null };
    expect(lined.gunShot.holder).toBe('u');
    expect(staleFire(engine.env(state), lined)).toBeNull();
    const t = act(engine, state, { type: 'sw.destroy', sw: 'm' });
    expect(t.state.pieces['m']?.loc.kind ?? 'eliminated').toBe('eliminated');
    const fix = staleFire(engine.env(t.state), lined)!;
    expect(fix).toEqual({ selected: new Set(), declared: false, clearGunShot: true, clearPfShot: false });
    // The squad goes on: destroying the Mortar was one SW use (SK1 4.0), so it may still fire the LMG.
    expect(act(engine, t.state, { type: 'fire', decl: { units: [], sw: ['lmg'], target: 'yM5' } }).state.pieces['lmg']!.tags['fire']).toBe('prep');
  });

  it('a fire group whose LMG is destroyed keeps its squad and stays declared', () => {
    const { engine, state } = game('PFPh');
    const t = act(engine, state, { type: 'sw.destroy', sw: 'lmg' });
    const fix = staleFire(engine.env(t.state), { selected: new Set(['u', 'lmg']), declared: true, gunShot: null, pfShot: null })!;
    expect(fix.selected).toEqual(new Set(['u']));
    expect(fix.declared).toBe(true);
  });

  it('a Mortar dropped (or passed to another unit) after it was lined up is no longer that unit\'s to fire', () => {
    const { engine, state } = game('MPh');
    const lined = { selected: new Set(['m']), declared: true, gunShot: { gun: 'm', holder: 'u' }, pfShot: null };
    const t = act(engine, state, { type: 'move.drop', sw: 'm' });
    expect(t.error).toBeUndefined();
    expect(weaponHolder(t.state, 'm')).toBeNull();
    expect(staleFire(engine.env(t.state), lined)).toMatchObject({ clearGunShot: true, declared: false });
    // Passed to another unit: the holder differs from the one that lined it up.
    const passed = { ...state, pieces: { ...state.pieces, m: { ...state.pieces['m']!, loc: { kind: 'held' as const, by: 'b1' } } } };
    expect(staleFire(engine.env(passed), lined)).toMatchObject({ clearGunShot: true });
  });

  it('a Panzerfaust try whose unit was eliminated is dropped; an undeclared selection only loses the eliminated piece', () => {
    const { engine, state } = game('PFPh');
    const dead = { ...state, pieces: { ...state.pieces, u: { ...state.pieces['u']!, loc: { kind: 'eliminated' as const } } } };
    const env = engine.env(dead);
    expect(staleFire(env, { selected: new Set(['u']), declared: true, gunShot: null, pfShot: { unit: 'u' } })).toEqual({
      selected: new Set(),
      declared: false,
      clearGunShot: false,
      clearPfShot: true,
    });
    expect(staleFire(env, { selected: new Set(['u', 'b1']), declared: false, gunShot: null, pfShot: null })).toEqual({
      selected: new Set(['b1']),
      declared: false,
      clearGunShot: false,
      clearPfShot: false,
    });
  });
});
