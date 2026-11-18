import type { GameState, PieceId, QueryEnv } from '@asl/engine';
import { defOf } from '@asl/rules';

/** Who holds a weapon now: its possessor's id, or null when it stands on its own (an emplaced Gun) or lies unpossessed. */
export function weaponHolder(state: GameState, id: PieceId): PieceId | null {
  const p = state.pieces[id];
  return p?.loc.kind === 'held' ? p.loc.by : null;
}

/** The fire the game screen has lined up: the selection, whether it is declared, and a Gun or Panzerfaust shot waiting for a target. */
export interface LinedUpFire {
  selected: ReadonlySet<PieceId>;
  declared: boolean;
  /** `holder` is the weapon's possessor when it was lined up (null for a Gun standing on its own). */
  gunShot: { gun: PieceId; holder: PieceId | null } | null;
  pfShot: { unit: PieceId } | null;
}

/** What to change so the lined-up fire matches the game again; null when nothing does. */
export interface StaleFireFix {
  selected: Set<PieceId>;
  declared: boolean;
  clearGunShot: boolean;
  clearPfShot: boolean;
}

/**
 * Lined-up fire that the game has overtaken. A weapon can only be fired by the unit possessing it (SK1 1.2.2:
 * a SW is fired by the Infantry unit possessing it; a dropped, transferred or destroyed SW is no longer that
 * unit's), and an eliminated unit fires nothing. So a Gun shot whose weapon is gone, or no longer held by the
 * unit that lined it up, is dropped; a Panzerfaust try whose unit is gone likewise; eliminated or absent pieces
 * leave the selection, and so does a SW of a declared fire group that is no longer possessed. A declared group
 * left empty is no longer declared.
 */
export function staleFire(env: QueryEnv, fire: LinedUpFire): StaleFireFix | null {
  const { state } = env;
  const gone = (id: PieceId) => {
    const p = state.pieces[id];
    return !p || p.loc.kind === 'eliminated';
  };
  const clearGunShot = !!fire.gunShot && (gone(fire.gunShot.gun) || weaponHolder(state, fire.gunShot.gun) !== fire.gunShot.holder);
  const clearPfShot = !!fire.pfShot && gone(fire.pfShot.unit);
  const unpossessedSw = (id: PieceId) => {
    const p = state.pieces[id]!;
    return defOf(env, p).kind === 'sw' && p.loc.kind !== 'held';
  };
  const selected = new Set(
    [...fire.selected].filter((id) => !gone(id) && !(fire.declared && unpossessedSw(id)) && !(clearGunShot && id === fire.gunShot!.gun)),
  );
  let declared = fire.declared;
  // A Gun or Panzerfaust shot that is dropped takes its declaration with it; a fire group does once it is empty.
  if (declared && (clearGunShot || clearPfShot || (selected.size === 0 && fire.selected.size > 0))) declared = false;
  if (!clearGunShot && !clearPfShot && declared === fire.declared && selected.size === fire.selected.size) return null;
  return { selected, declared, clearGunShot, clearPfShot };
}
