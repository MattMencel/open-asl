import type { Ctx, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOfLoc, locOf, type LocId } from '../common/location';
import { defOf, isVehicleDef, otherSide, unitsAt } from '../common/pieces';
import { MOVE_FINISH, type MoveFinishFn } from '../sk1/movement';
import { moveState } from '../sk1/moveState';
import { inMelee, pieceOf, sw } from '../sk1/status';
import { heightOf } from '../sk2/elevation';
import { isHidden } from '../sk2/status';
import { isWreck } from '../sk3/status';

/*
 * Triple Point Blank Fire in full ASL (ASLRB A7.21, A7.211, A8.31, A8.4, A12.151).
 * - Fire into one's own Location is allowed at any enemy unit there that is not in Melee (A7.21: "on those rare instances
 *   when fire attacks are allowed vs units in the same Location"), in every fire phase: Defensive First Fire, SFF and FPF
 *   at a stack that is there in the MPh, Final Fire ("an adjacent (or same) hex", A8.4) and the ATTACKER's Prep and
 *   Advancing Fire. The Starter Kit allows it only at a vehicle (SK4 3.2.2.1). A hidden unit does not fire into its own
 *   Location to stay hidden: a voluntary reveal waits for concealment (A12.14).
 * - TPBF vs PRC from a higher Location of the hex (A7.211: "from enemy units in that Location or any higher Location in
 *   that hex"): an attack whose every target is a vehicle (its crew) is tripled, not doubled, from the level above. Against
 *   Infantry on another floor it stays PBF (A7.21: TPBF needs the same Location).
 * - When an Infantry stack's MPh ends in a Location it shares with enemy units outside Melee, that Location gets a CC
 *   counter: they are not held in Melee until after the CCPh, and broken units may rout away in the RtPh (A12.151, A7.211,
 *   A8.31; the CC marker goes on "not until the ... unit end[s] its MPh in the defender's Location").
 * Mandatory TPBF (A8.312) comes with the first rule that lets Infantry enter an enemy Location in the MPh (A4.15, A15.43,
 * A25.23).
 */

/** Enemy units of `side` in `loc` that fire into it may attack (not in Melee). */
function ownLocationFire(env: QueryEnv, loc: LocId, side: string, firer?: PieceId): boolean {
  if (inMelee(env, loc)) return false;
  if (firer && env.state.pieces[firer] && isHidden(pieceOf(env, firer))) return false;
  return unitsAt(env, loc, otherSide(env.state, side)).length > 0;
}

/** Every target of an attack is a vehicle, so the attack is on its PRC (A7.211). */
const allVehicles = (env: QueryEnv, targets: PieceId[]) =>
  targets.length > 0 && targets.every((u) => { const p = env.state.pieces[u]; return !!p && isVehicleDef(defOf(env, p)) && !isWreck(p); });

/** The firer of a part stands in a higher Location of the target's hex. */
const fromAbove = (env: QueryEnv, firer: PieceId, target: LocId) => {
  const from = locOf(env.state, pieceOf(env, firer));
  return !!from && from !== target && hexOfLoc(from) === hexOfLoc(target) && heightOf(env, from) > heightOf(env, target);
};

/** Locations where the finished stack's units now share a Location with enemy units outside Melee or CC. */
function sharedLocations(ctx: Ctx, units: PieceId[]): LocId[] {
  const out = new Set<LocId>();
  for (const u of units) {
    const p = ctx.state.pieces[u];
    if (!p || p.loc.kind !== 'hex') continue;
    const loc = locOf(ctx.state, p)!;
    const m = ctx.state.hexMarkers[loc];
    if (m?.['melee'] || m?.['cc']) continue;
    if (unitsAt(ctx, loc, otherSide(ctx.state, p.side)).length) out.add(loc);
  }
  return [...out].sort();
}

export const aslTpbfModule: RuleModule = {
  id: 'asl.tpbf',
  ref: 'ASLRB A7.21, A7.211, A8.4, A12.151',
  summary: 'TPBF in full ASL: fire into one\'s own Location at enemy units not in Melee, TPBF at PRC from above, the CC counter.',
  requires: ['sk1.fire', 'sk1.movement', 'asl.locations'],
  install(r) {
    r.contribute({ id: 'asl.tpbf.own-location', query: 'fire.ownLocation', ref: 'ASLRB A7.21, A8.4', apply: (v, { target, side, firer }, env) => v || ownLocationFire(env, target, side, firer) });
    // A7.211: TPBF at PRC from a higher Location of the hex, instead of the PBF between levels.
    const tpbfAbove = (part: { dist: number; firer: PieceId; kind: string; piece: PieceId }, attack: { target: LocId; targets: PieceId[]; residual?: boolean }, env: QueryEnv) =>
      part.dist === 0 &&
      !attack.residual &&
      !(part.kind === 'sw' && ['FT', 'DC'].includes(sw(env, pieceOf(env, part.piece))?.type ?? '')) &&
      fromAbove(env, part.firer, attack.target) &&
      allVehicles(env, attack.targets);
    r.suppress<'fire.partFp'>({ id: 'asl.tpbf.prc-not-pbf', query: 'fire.partFp', target: 'asl.levels.pbf-between-levels', ref: 'ASLRB A7.211', when: ({ part, attack }, env) => tpbfAbove(part, attack, env) });
    r.contribute({
      id: 'asl.tpbf.prc-above',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A7.211',
      label: 'x3 TPBF at the crew from the level above (ASLRB A7.211)',
      when: ({ part, attack }, env) => tpbfAbove(part, attack, env),
      apply: (v) => v * 3,
    });
    // The CC counter when an Infantry stack's MPh ends in a Location shared with the enemy.
    r.procedure<MoveFinishFn>(MOVE_FINISH, (next) => (ctx) => {
      const ms = moveState(ctx);
      const units = ms && !ms.vehicle ? [...ms.units, ...(ms.stopped ?? [])] : [];
      next?.(ctx);
      for (const loc of sharedLocations(ctx, units)) ctx.emit('hex.marker', { hex: loc, key: 'cc', value: true });
    });
  },
};
