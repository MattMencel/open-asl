import type { CounterDef, SwDef } from '@asl/rules';
import type { SfxName, SfxParams } from './sfx';

export interface WeaponSound {
  name: SfxName;
  params: SfxParams;
}

/**
 * What an ordnance weapon sounds like when it fires: a Gun (SK4 6.0), a vehicle's Main Armament
 * (7.2) or an ordnance SW (4.4, 4.5). Light mortars and the LATW have their own launch; guns go by
 * bore, and a 20 mm piece or light flak gun fires a clip.
 */
export function ordnanceSound(d: CounterDef): WeaponSound | null {
  const nation = d.nationality;
  let type: string;
  let caliber = 0;
  if (d.kind === 'gun') {
    type = d.type;
    caliber = d.caliber;
  } else if (d.kind === 'vehicle') {
    if (!d.ma) return null;
    type = d.ma.type;
    caliber = d.ma.caliber;
  } else if (d.kind === 'sw') {
    type = d.type;
    caliber = d.ordnance?.caliber ?? 0;
  } else return null;
  const params: SfxParams = { nation, ...(caliber ? { caliber } : {}) };
  switch (type) {
    case 'MTR':
      return { name: 'fire.mortar', params };
    case 'BAZ':
    case 'PSK':
      return { name: 'fire.rocket', params };
    case 'PF':
      return { name: 'fire.pf', params };
    case 'PIAT':
      return { name: 'fire.piat', params };
    case 'ATR':
      return { name: 'fire.atr', params };
    case 'MG':
      // A MG as Main Armament (the Light Tank Mk VIB's Vickers .50).
      return { name: 'fire.hmg', params };
  }
  if (!caliber) return null;
  if (caliber <= 20 || (type === 'AA' && caliber <= 40)) return { name: 'fire.autocannon', params };
  if (caliber <= 47) return { name: 'fire.cannon.light', params };
  if (caliber <= 80) return { name: 'fire.cannon', params };
  return { name: 'fire.cannon.heavy', params };
}

/**
 * A machine gun SW, an infantry one or a vehicle's (SK4 7.8). A vehicle's BMG, CMG and RMG are the
 * rifle-caliber MG of its nation; an AAMG of 4 FP or more, and any MG of 6 FP or more, is a heavy MG
 * (the Sherman's .50 calibre).
 */
export function mgSound(d: SwDef): WeaponSound | null {
  const params: SfxParams = { nation: d.nationality };
  switch (d.type) {
    case 'LMG':
      return { name: 'fire.lmg', params };
    case 'MMG':
      return { name: 'fire.mmg', params };
    case 'HMG':
      return { name: 'fire.hmg', params };
    case 'BMG':
    case 'CMG':
    case 'RMG':
    case 'AAMG':
      return { name: d.fp >= 6 || (d.type === 'AAMG' && d.fp >= 4) ? 'fire.hmg' : 'fire.lmg', params };
  }
  return null;
}

/** A vehicle on the move: tracks clatter, an armored car's tires do not. */
export const vehicleMoveSound = (d: CounterDef): SfxName => (d.kind === 'vehicle' && !d.tracked ? 'vehicle.drive' : 'vehicle.move');
