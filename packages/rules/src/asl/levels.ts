import type { HexId, QueryEnv, RuleModule } from '@asl/engine';
import { adjacentLocs, hexOfLoc, isGroundLoc, levelOfLoc, locOf, locationsOf, parseLoc, type LocId } from '../common/location';
import { defOf, statics } from '../common/pieces';
import { acrossSide, mod6, sidePoint } from '../common/hexCorners';
import { hexPixel } from '../common/map';
import { heightOf } from '../sk2/elevation';
import { ordnanceOf } from '../sk2/status';
import { pieceOf, sw } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';

/**
 * Multi-level buildings in full ASL: what an upper building level changes beyond the Location model
 * (`asl/locations.ts`) and the shared movement rules (`sk1/movement.ts`, `sk1/advance.ts`, `sk1/rout.ts`).
 *
 * - PBF between the levels of one hex (ASLRB A7.21): ground and level 1 of a Two Story House hex are ADJACENT.
 * - No LOS between non-ADJACENT Locations of the same building next to each other (B23.25).
 * - LOS between different hexes to a building Location only if, as it enters that hex, it crosses no hexside within the
 *   building depiction (B23.25): a higher firer seeing over one hex of a building into the next one beyond it.
 * - Indirect Fire (mortars, OBA; ASLRB C.1) on a building hex attacks every level with one DR, +1 DRM per non-rooftop
 *   level above the one attacked; an Interior Building Hex only at its highest level (B23.32).
 *
 * The Starter Kit has no upper levels ('hex.locations' gives one Location per hex), so none of these ever applies there.
 */
/** A hexside of a building hex the building depiction crosses: the hex across it is of the same building and the art
 * touches the hexside from both hexes (neither is open to Bypass there, A4.3). */
function insideDepiction(env: QueryEnv, hex: HexId, k: number): boolean {
  const map = statics(env).map;
  const h = map.hex(hex);
  const nb = acrossSide(map, hex, k);
  const n = nb ? map.hex(nb) : undefined;
  if (!h?.buildingId || !n || n.buildingId !== h.buildingId || !map.bypassSides) return false;
  const closed = (id: HexId, side: number) => (map.bypassSides!(id) & (1 << mod6(side))) === 0;
  return closed(hex, k) && closed(nb!, k + 3);
}

/**
 * The hexside (of `end`'s hex) within a building depiction that the LOS from `other` crosses as it enters `end`'s hex, if
 * `end` is a building Location (not a rooftop) and there is one; else null. Traced centre to centre: a LOS entering at a
 * vertex counts only when both hexsides there are within the depiction.
 */
function enteredAcrossBuilding(env: QueryEnv, end: LocId, other: LocId): number | null {
  const map = statics(env).map;
  const hex = hexOfLoc(end);
  const h = map.hex(hex);
  const o = map.hex(hexOfLoc(other));
  if (!h || !o || !h.buildingId || parseLoc(end).sub || !terrainOf(env, end).id.startsWith('building')) return null;
  const c = hexPixel(h.cube);
  const t = hexPixel(o.cube);
  const dir = { x: t.x - c.x, y: t.y - c.y };
  const len = Math.hypot(dir.x, dir.y);
  const score = [0, 1, 2, 3, 4, 5].map((k) => {
    const m = sidePoint(h.cube, k);
    return ((m.x - c.x) * dir.x + (m.y - c.y) * dir.y) / (Math.hypot(m.x - c.x, m.y - c.y) * len);
  });
  const best = Math.max(...score);
  const sides = score.flatMap((v, k) => (best - v < 1e-6 ? [k] : []));
  return sides.every((k) => insideDepiction(env, hex, k)) ? sides[0]! : null;
}

export const aslLevelsModule: RuleModule = {
  id: 'asl.levels',
  ref: 'ASLRB A7.21, B23.25, B23.32',
  summary: 'Upper building levels: PBF between levels, LOS within a building, Indirect Fire against every level.',
  requires: ['asl.locations', 'sk1.fire', 'sk1.terrain'],
  install(r) {
    // A7.21: "doubled while ADJACENT to its target"; the level above or below in the same hex is ADJACENT (B23.25),
    // though at hex distance 0, which the Starter Kit's PBF (distance 1) does not see. Not for FT and DC, as there.
    r.contribute({
      id: 'asl.levels.pbf-between-levels',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A7.21, B23.25',
      label: 'x2 Point Blank Fire (the level above or below)',
      when: ({ part, attack }, env) => {
        if (part.dist !== 0 || attack.residual) return false;
        if (part.kind === 'sw' && ['FT', 'DC'].includes(sw(env, pieceOf(env, part.piece))?.type ?? '')) return false;
        const from = locOf(env.state, pieceOf(env, part.firer));
        return !!from && from !== attack.target && adjacentLocs(env, from).includes(attack.target);
      },
      apply: (v) => v * 2,
    });

    // B23.25: inside a building, LOS exists only between ADJACENT Locations, unless traced clear of the building
    // depiction through intervening hexes, which two Locations of one hex, or of two adjacent hexes, never are.
    // Farther apart, the ground-level trace decides as before (`asl/los.ts` adds heights).
    r.contribute({
      id: 'asl.levels.los-within-building',
      query: 'los.trace',
      layer: 160,
      ref: 'ASLRB B23.25',
      apply(v, { from, to }, env) {
        if (!v.clear || from === to || (isGroundLoc(from) && isGroundLoc(to))) return v;
        const map = statics(env).map;
        const a = hexOfLoc(from);
        const b = hexOfLoc(to);
        const ba = map.hex(a)?.buildingId;
        if (!ba || ba !== map.hex(b)?.buildingId || (a !== b && map.distance(a, b) > 1)) return v;
        if (adjacentLocs(env, from).includes(to)) return v;
        return { ...v, clear: false, blockedBy: 'the building: not ADJACENT Locations of one building (ASLRB B23.25)' };
      },
    });

    // B23.25: "LOS to a unit in a building Location ... can exist only if drawn to an ADJACENT unit or (for LOS between
    // different hexes) if the LOS as it enters the hex does not cross a hexside within the building depiction". Either end
    // (LOS is reciprocal, A6.5).
    r.contribute({
      id: 'asl.levels.los-entry-hexside',
      query: 'los.trace',
      layer: 161,
      ref: 'ASLRB B23.25',
      apply(v, { from, to }, env) {
        if (!v.clear || hexOfLoc(from) === hexOfLoc(to) || adjacentLocs(env, from).includes(to)) return v;
        for (const [end, other] of [[to, from], [from, to]] as const) {
          const k = enteredAcrossBuilding(env, end, other);
          if (k !== null) return { ...v, clear: false, blockedBy: `the building: the LOS enters ${hexOfLoc(end)} across a hexside within the building depiction (ASLRB B23.25)` };
        }
        return v;
      },
    });

    // B23.32: one Original Resolution DR against each level of the building hex hit (only its highest in an Interior
    // Building Hex), with +1 DRM for each non-rooftop level above the one attacked.
    r.contribute({
      id: 'asl.levels.indirect-every-level',
      query: 'fire.indirectLocations',
      ref: 'ASLRB B23.32',
      apply(v, { target }, env) {
        const hex = hexOfLoc(target);
        const levels = locationsOf(env, hex).filter((l) => !parseLoc(l).sub);
        if (levels.length < 2) return v;
        return interiorBuildingHex(env, hex) ? [levels[levels.length - 1]!] : levels;
      },
    });
    r.contribute({
      id: 'asl.levels.indirect-levels-above',
      query: 'fire.drm',
      ref: 'ASLRB B23.32',
      label: ({ attack }, env) => `+${levelsAbove(env, attack.target)} Indirect Fire: ${levelsAbove(env, attack.target) === 1 ? 'a building level' : 'building levels'} above`,
      when: ({ attack }, env) => !!attack.ordnance?.indirect && levelsAbove(env, attack.target) > 0,
      apply: (v, { attack }, env) => v + levelsAbove(env, attack.target),
    });

    // C2.6 Gun depression/elevation: a Gun fires at a target on another level only at a range at least the difference
    // in levels [EXC: mortars and AA Guns at a higher target]; in a building hex never at a lower level of its own
    // hex, and at a higher level of its own hex only an AA Gun of at most 40mm. The same for SW ordnance (a mortar).
    // Guns stand at an upper level only in a fortified stone building (B23.93), which is where this comes up.
    r.contribute({
      id: 'asl.levels.gun-elevation',
      query: 'ordnance.illegal',
      ref: 'ASLRB C2.6',
      apply(v, { shot }, env) {
        if (v) return v;
        const w = env.state.pieces[shot.weapon];
        const d = w ? ordnanceOf(env, w) : null;
        const from = w ? locOf(env.state, w) : null;
        if (!w || !d || !from || defOf(env, w).kind === 'vehicle') return null;
        const map = statics(env).map;
        const fromHex = hexOfLoc(from);
        const toHex = hexOfLoc(shot.target);
        const diff = heightOf(env, shot.target) - heightOf(env, from);
        if (diff === 0) return null;
        const aa = d.type === 'AA' || d.type === 'MTR';
        if (fromHex === toHex) {
          if (diff < 0) return 'A Gun in a building hex may not fire at a lower level of its own hex (ASLRB C2.6)';
          return d.type === 'AA' && d.caliber <= 40 ? null : 'Only an AA Gun of at most 40mm may fire at a higher level of its own hex (ASLRB C2.6)';
        }
        const range = map.distance(fromHex, toHex);
        if (range >= Math.abs(diff) || (diff > 0 && aa)) return null;
        return `A Gun may fire at a target ${Math.abs(diff)} level${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'above' : 'below'} it only at a range of at least ${Math.abs(diff)} (ASLRB C2.6)`;
      },
    });
  },
};

/** Non-rooftop building levels above a Location in its hex (ASLRB B23.32). */
function levelsAbove(env: QueryEnv, loc: LocId): number {
  const top = Math.max(0, ...locationsOf(env, hexOfLoc(loc)).filter((l) => !parseLoc(l).sub).map(levelOfLoc));
  return Math.max(0, top - levelOfLoc(loc));
}

/** A building hex completely surrounded by hexes of the same building (ASLRB B23.32, Index "Interior Building Hex"). */
export function interiorBuildingHex(env: QueryEnv, hex: HexId): boolean {
  const map = statics(env).map;
  const b = map.hex(hex)?.buildingId;
  const n = map.neighbors(hex);
  return !!b && n.length === 6 && n.every((h) => map.hex(h)?.buildingId === b);
}
