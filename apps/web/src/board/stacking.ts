import type { Piece, QueryEnv } from '@asl/engine';
import { UNKNOWN_DEF_ID, stackOrder, vehicle as vehicleDef } from '@asl/rules';

/**
 * The personnel and vehicles of a hex, bottom to top, side by side. A side's vehicle (the big counter) lies under its
 * Infantry, the selected one of an offboard pile on top of the pile; then its "?" stand-in: a concealment counter sits
 * on top of the concealed units only (SK4 8.3), so the side's Known units in the hex go above it and stay in view;
 * then the Infantry in stacking order (a leader on top of the MMC he is stacked on, SK1 3.8).
 */
export function personnelStack(env: QueryEnv, people: Piece[], selected?: ReadonlySet<string>): Piece[] {
  return [...new Set(people.map((p) => p.side))].sort().flatMap((side) => {
    const mine = people.filter((p) => p.side === side);
    const standIns = mine.filter((p) => p.defId === UNKNOWN_DEF_ID);
    const known = mine.filter((p) => p.defId !== UNKNOWN_DEF_ID);
    const vehicles = known.filter((p) => vehicleDef(env as never, p)).sort((a, b) => Number(!!selected?.has(a.id)) - Number(!!selected?.has(b.id)));
    return [...vehicles, ...standIns, ...stackOrder(env as never, known.filter((p) => !vehicleDef(env as never, p)))];
  });
}
