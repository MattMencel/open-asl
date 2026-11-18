import { describe, expect, it } from 'vitest';
import { SMOKE_DISPENSER_MPH_ONLY, turnAndFireHint, turnWithoutFiringLabel } from '../src/game/vehicleEntries';

describe('fire-phase entries that carry their rule in the label', () => {
  it('a Covered Arc turn at the end of a fire phase says it is instead of firing (SK4 3.2.4, 3.3.2)', () => {
    expect(turnWithoutFiringLabel('turn turret')).toBe('turn turret without firing (ends its fire)…');
    expect(turnWithoutFiringLabel('Turn 57mm ATG')).toBe('Turn 57mm ATG without firing (ends its fire)…');
  });

  it('points to the Fire entry for turning and firing, only when the weapon may still fire', () => {
    expect(turnAndFireHint('Fire 75L')).toMatch(/choose "Fire 75L" and click the target outside the arc/);
    expect(turnAndFireHint(null)).toBe('');
  });

  it('the smoke dispenser in a fire phase is refused for the Movement Phase only (SK4 7.5)', () => {
    expect(SMOKE_DISPENSER_MPH_ONLY).toMatch(/Only in the Movement Phase \(SK4 7\.5\)/);
    expect(SMOKE_DISPENSER_MPH_ONLY).toMatch(/fired/);
  });
});
