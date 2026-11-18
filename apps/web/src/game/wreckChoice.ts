import type { Action, Piece, PieceId } from '@asl/engine';

/**
 * The vehicles in a hex the owner may flip to their wreck side. "If two friendly AFV occupy the same hex at the end
 * of the MPh, the owner must flip one over to its wreck side" (SK4 3.3.2): the owner picks which, so every vehicle
 * there the rules accept is offered, the one that moved in and the one already there alike. `check` is the
 * session's validation (null when the action is legal).
 */
export function wreckChoices(vehicles: Piece[], check: (a: Omit<Action, 'side' | 'decisionId'>) => string | null): PieceId[] {
  return vehicles.filter((v) => check({ type: 'vmove.wreck', vehicle: v.id }) === null).map((v) => v.id);
}
