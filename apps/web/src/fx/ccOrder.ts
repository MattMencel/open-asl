/**
 * The order the dice of a simultaneous Close Combat are played to the player in. The engine rolls every DR of the
 * batch before it applies any result (SK1 3.8: CC is simultaneous), so its log reads: one side's roll, the other
 * side's roll, then the first attack's results, then the second's. Played in that order the two rolls land a beat
 * apart and every outcome arrives at once, which is hard to follow. Shown instead, each side's roll is followed by
 * its own outcome before the next roll appears. Results are unchanged (they were fixed before either was applied);
 * only the telling is.
 *
 * A batch is a run of "CC <side> in <hex>" rolls followed by one `sk1.cc.attack` per rolled side (the events between
 * them, Field Promotion rolls and Random Selection included, go with the attack they precede). Anything else (a lone
 * roll, as in an ambush's sequential CC, or a log that does not match) is played as logged.
 */
export interface FxEvent {
  type: string;
  payload: unknown;
}

const ccRollSide = (e: FxEvent): string | null => {
  if (e.type !== 'dice.rolled') return null;
  const m = /^CC (\S+) in /.exec(String((e.payload as { label?: unknown }).label ?? ''));
  return m ? m[1]! : null;
};

export function ccPlayOrder<E extends FxEvent>(events: E[]): E[] {
  const out: E[] = [];
  let i = 0;
  while (i < events.length) {
    if (!ccRollSide(events[i]!)) {
      out.push(events[i++]!);
      continue;
    }
    let j = i;
    const rolls = new Map<string, E>();
    while (j < events.length && ccRollSide(events[j]!) && !rolls.has(ccRollSide(events[j]!)!)) rolls.set(ccRollSide(events[j]!)!, events[j++]!);
    const segments: { side: string; events: E[] }[] = [];
    let current: E[] = [];
    let k = j;
    while (k < events.length && segments.length < rolls.size && !ccRollSide(events[k]!)) {
      const e = events[k++]!;
      current.push(e);
      const side = e.type === 'sk1.cc.attack' ? String((e.payload as { side?: unknown }).side) : null;
      if (side && rolls.has(side) && !segments.some((s) => s.side === side)) {
        segments.push({ side, events: current });
        current = [];
      }
    }
    if (rolls.size < 2 || segments.length !== rolls.size) {
      out.push(...events.slice(i, j));
      i = j;
      continue;
    }
    for (const s of segments) out.push(rolls.get(s.side)!, ...s.events);
    i = k;
  }
  return out;
}
