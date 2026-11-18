import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/maps';

/*
 * A road that runs off one board onto the next continues across the seam (each board's data knows only its own road
 * hexsides), so the road movement rate and the road bonus (SK1 3.3) go on across it.
 */
describe('roads across the seam between two boards', () => {
  // Board z above board y turned 180°: board y's dirt road in I1 meets board z's paved road in Y1.
  const map = buildMap([
    { board: 'z', x: 0, y: 1 },
    { board: 'y', x: 0, y: 0, rotation: 180 },
  ]);

  it('joins two road hexes whose roads both end at the seam', () => {
    expect(map.neighbors('yI1')).toContain('zY1');
    expect(map.roadHexside('yI1', 'zY1')).toBe(true);
  });

  it('joins nothing else along that seam: a road hex there meets the other board only where a road continues', () => {
    const across: string[] = [];
    for (const h of map.hexes()) for (const n of map.neighbors(h.id)) if (h.id < n && map.hex(n)?.board !== h.board && map.roadHexside(h.id, n)) across.push(`${h.id}-${n}`);
    expect(across.sort()).toEqual(['yI1-zY1', 'yY1-zI1']);
    // Board y's road in H1 runs along its edge row to I1: no hexside of H1 crosses the seam as a road.
    expect(map.neighbors('yH1').filter((n) => map.hex(n)?.board === 'z' && map.roadHexside('yH1', n))).toEqual([]);
  });
});
