import { describe, expect, it } from 'vitest';
import type { GunDef, SwDef, VehicleDef } from '@asl/rules';
import { BUILTIN } from '../src/audio/builtin';
import { SFX } from '../src/audio/sfx';
import { mgSound, ordnanceSound, vehicleMoveSound } from '../src/audio/weapons';

const gun = (type: GunDef['type'], caliber: number, nationality = 'ge'): GunDef => ({
  id: `${nationality}.${type}${caliber}`,
  kind: 'gun',
  nationality,
  type,
  caliber,
  m: 10,
  targetSize: 'normal',
  mount: 'NT',
  qsu: true,
  gunshield: true,
  ammo: { he: true, ap: true },
});

const vehicle = (ma: VehicleDef['ma'], tracked = true): VehicleDef => ({
  id: 'ge.test',
  kind: 'vehicle',
  name: 'Test',
  nationality: 'ge',
  tracked,
  mp: 14,
  groundPressure: 'normal',
  af: { hull: { front: 8, side: 3, rear: 3 }, turret: { front: 8, side: 4, rear: 4 } },
  turret: 'T',
  targetSize: 'normal',
  ...(ma ? { ma } : {}),
  mg: {},
  ceDrm: 2,
  crewMorale: 8,
  cvp: 0,
});

const sw = (type: SwDef['type'], fp: number, nationality = 'am'): SwDef => ({ id: `${nationality}.${type}`, kind: 'sw', nationality, type, fp, range: 8, pp: 0 });

describe('ordnance sounds', () => {
  it('goes by bore: 37 mm cracks, 75 mm booms, an 88 and up is heavy', () => {
    expect(ordnanceSound(gun('AT', 37))?.name).toBe('fire.cannon.light');
    expect(ordnanceSound(gun('AT', 47))?.name).toBe('fire.cannon.light');
    expect(ordnanceSound(gun('AT', 75))?.name).toBe('fire.cannon');
    expect(ordnanceSound(gun('INF', 75))?.name).toBe('fire.cannon');
    expect(ordnanceSound(gun('AT', 88))?.name).toBe('fire.cannon.heavy');
    expect(ordnanceSound(gun('ART', 152))?.name).toBe('fire.cannon.heavy');
    expect(ordnanceSound(gun('AT', 57))?.params.caliber).toBe(57);
  });

  it('fires a clip from a 20 mm piece or a light flak gun, but an 88 flak gun is a big gun', () => {
    expect(ordnanceSound(gun('AA', 20))?.name).toBe('fire.autocannon');
    expect(ordnanceSound(gun('AA', 37))?.name).toBe('fire.autocannon');
    expect(ordnanceSound(gun('AA', 40))?.name).toBe('fire.autocannon');
    expect(ordnanceSound(gun('AA', 88))?.name).toBe('fire.cannon.heavy');
  });

  it('gives mortars and the light anti-tank weapons their own launch', () => {
    expect(ordnanceSound(gun('MTR', 81))?.name).toBe('fire.mortar');
    expect(ordnanceSound({ ...sw('MTR', 1), ordnance: { caliber: 60 } })?.name).toBe('fire.mortar');
    expect(ordnanceSound(sw('BAZ', 0))?.name).toBe('fire.rocket');
    expect(ordnanceSound(sw('PSK', 0, 'ge'))?.name).toBe('fire.rocket');
    expect(ordnanceSound(sw('PF', 0, 'ge'))?.name).toBe('fire.pf');
    expect(ordnanceSound(sw('PIAT', 0, 'br'))?.name).toBe('fire.piat');
    expect(ordnanceSound(sw('ATR', 0, 'ru'))?.name).toBe('fire.atr');
  });

  it('hears a vehicle by its Main Armament: a 20 mm KwK is an autocannon, a MG-only MA a heavy MG, no MA nothing', () => {
    expect(ordnanceSound(vehicle({ type: 'AT', caliber: 75, ammo: { he: true, ap: true } }))?.name).toBe('fire.cannon');
    expect(ordnanceSound(vehicle({ type: 'AT', caliber: 20, ammo: { he: true, ap: true } }))?.name).toBe('fire.autocannon');
    expect(ordnanceSound(vehicle({ type: 'AT', caliber: 105, ammo: { he: true, ap: true } }))?.name).toBe('fire.cannon.heavy');
    expect(ordnanceSound(vehicle({ type: 'MG', caliber: 0, ammo: { he: false, ap: true } }))?.name).toBe('fire.hmg');
    expect(ordnanceSound(vehicle(undefined))).toBeNull();
  });

  it('is never a pistol for a vehicle or a Gun (they are not leaders)', () => {
    for (const d of [gun('AT', 37), vehicle({ type: 'AT', caliber: 75, ammo: { he: true, ap: true } })]) expect(ordnanceSound(d)?.name).not.toBe('fire.pistol');
  });
});

describe('machine gun sounds', () => {
  it('keeps the infantry MG by size', () => {
    expect(mgSound(sw('LMG', 2, 'ge'))).toEqual({ name: 'fire.lmg', params: { nation: 'ge' } });
    expect(mgSound(sw('MMG', 4, 'ge'))?.name).toBe('fire.mmg');
    expect(mgSound(sw('HMG', 6))?.name).toBe('fire.hmg');
  });

  it('hears a vehicle MG (SK4 7.8): BMG and CMG are rifle-caliber, a 4 FP AAMG is the .50', () => {
    expect(mgSound({ ...sw('BMG', 3, 'ge'), fixed: true })?.name).toBe('fire.lmg');
    expect(mgSound({ ...sw('CMG', 5, 'ge'), fixed: true })?.name).toBe('fire.lmg');
    expect(mgSound({ ...sw('RMG', 2, 'ru'), fixed: true })?.name).toBe('fire.lmg');
    expect(mgSound({ ...sw('AAMG', 2, 'ge'), fixed: true })?.name).toBe('fire.lmg');
    expect(mgSound({ ...sw('AAMG', 4, 'am'), fixed: true })?.name).toBe('fire.hmg');
    expect(mgSound({ ...sw('CMG', 10, 'br'), fixed: true })?.name).toBe('fire.hmg');
  });

  it('is not a MG sound for other SW', () => {
    expect(mgSound(sw('FT', 24))).toBeNull();
    expect(mgSound(sw('DC', 30))).toBeNull();
  });
});

describe('vehicle movement sounds', () => {
  it('clanks for a tracked vehicle and drives for an armored car', () => {
    expect(vehicleMoveSound(vehicle(undefined, true))).toBe('vehicle.move');
    expect(vehicleMoveSound(vehicle(undefined, false))).toBe('vehicle.drive');
  });
});

describe('the bundled recordings', () => {
  it('back only effects that exist, and every effect has a synthesized fallback', () => {
    for (const name of Object.keys(BUILTIN)) expect(SFX).toHaveProperty([name]);
    for (const name of ['fire.cannon.light', 'fire.cannon', 'fire.cannon.heavy', 'fire.autocannon', 'fire.mortar', 'fire.rocket', 'fire.pf', 'impact.armor', 'vehicle.start', 'vehicle.move', 'vehicle.drive', 'vehicle.stop', 'vehicle.turn', 'vehicle.turret', 'vehicle.bog'])
      expect(BUILTIN[name as keyof typeof BUILTIN]?.files.length).toBeGreaterThan(0);
  });
});
