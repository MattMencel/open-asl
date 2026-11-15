import { describe, expect, it } from 'vitest';
import { buildMap } from '../src';

describe('pixel LOS on a board placed half a board along', () => {
  it('reads the board’s own terrain: the same LOS at "0.5,0" as at "0,0"', () => {
    const at0 = buildMap([{ board: 'y', x: 0, y: 0 }], {});
    const half = buildMap([{ board: 'y', x: 0.5, y: 0 }], {});
    // Across the U3 stone building, past it, through the K5/K6 villages and over open ground.
    const pairs: [string, string][] = [['yU2', 'yU4'], ['yQ7', 'yV2'], ['yI5', 'yM5'], ['yA1', 'yG9'], ['yN2', 'yN8']];
    const verdicts = (m: typeof at0) => pairs.map(([a, b]) => m.los(a, b).clear);
    expect(verdicts(half)).toEqual(verdicts(at0));
    // At least one of them is blocked: the check is not passing on open ground everywhere.
    expect(verdicts(at0)).toContain(false);
  });
});
