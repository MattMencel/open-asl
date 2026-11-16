import type { Piece, QueryEnv } from '@asl/engine';
import { UNKNOWN_DEF_ID, stackOrder, vehicle as vehicleDef } from '@asl/rules';

/**
 * The personnel and vehicles of a hex, bottom to top, side by side. A side's vehicle (the big counter) lies under its
 * Infantry, the selected one of an offboard pile on top of the pile; then its "?" stand-in: a concealment counter sits
 * on top of the concealed units only (SK4 8.3), so the side's Known units in the hex go above it and stay in view;
 * then the Infantry in stacking order (a leader on top of the MMC he is stacked on, SK1 3.8). In its owner's view the
 * concealed (and HIP) units wear their own "?", so they go under the side's unconcealed units the same way: a Known unit
 * that joins a concealed stack sits on top of its "?", not among the concealed units where it would look concealed.
 */
export function personnelStack(env: QueryEnv, people: Piece[], selected?: ReadonlySet<string>): Piece[] {
  return [...new Set(people.map((p) => p.side))].sort().flatMap((side) => {
    const mine = people.filter((p) => p.side === side);
    const standIns = mine.filter((p) => p.defId === UNKNOWN_DEF_ID);
    const known = mine.filter((p) => p.defId !== UNKNOWN_DEF_ID);
    const under = (p: Piece) => p.tags['concealed'] === true || p.tags['hip'] === true;
    const vehicles = known.filter((p) => vehicleDef(env as never, p)).sort((a, b) => Number(!under(a)) - Number(!under(b)) || Number(!!selected?.has(a.id)) - Number(!!selected?.has(b.id)));
    const infantry = stackOrder(env as never, known.filter((p) => !vehicleDef(env as never, p)));
    return [...vehicles, ...standIns, ...infantry.filter(under), ...infantry.filter((p) => !under(p))];
  });
}
