import type { SfxName } from './sfx';

/*
 * The recorded effects that ship with the game (CC0 recordings, see sounds/CREDITS.md),
 * bundled by Vite. A manifest in the asset store (audio/manifest.json) can override any
 * entry; see samples.ts.
 */
const files = import.meta.glob('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** URL of a bundled sound by its base name. */
const url = (name: string): string => {
  const u = files[`./sounds/${name}.mp3`];
  if (!u) throw new Error(`No bundled sound ${name}`);
  return u;
};
const all = (...names: string[]) => names.map(url);

export interface BuiltinEntry {
  files: string[];
  gain: number;
}

export const BUILTIN: Partial<Record<SfxName, BuiltinEntry>> = {
  'fire.rifle': { files: all('rifle_volley_1', 'rifle_volley_2', 'rifle_volley_3'), gain: 0.85 },
  'fire.pistol': { files: all('pistol_1', 'pistol_2'), gain: 0.7 },
  'fire.lmg': { files: all('lmg_1', 'lmg_2'), gain: 0.85 },
  'fire.mmg': { files: all('mmg_1', 'mmg_2', 'mmg_3'), gain: 0.9 },
  'fire.hmg': { files: all('hmg_1', 'hmg_2', 'hmg_3'), gain: 1 },
  'fire.ft': { files: all('flamethrower_1', 'flamethrower_2'), gain: 0.9 },
  'fire.explosion': { files: all('explosion_1', 'explosion_2', 'explosion_3'), gain: 1 },
  'hit.none': { files: all('ricochet_1', 'ricochet_2', 'ricochet_3', 'ricochet_4'), gain: 0.5 },
  'dice.roll': { files: all('dice_1', 'dice_2', 'dice_3'), gain: 0.7 },
  'move.step': { files: all('steps_walk'), gain: 0.6 },
  rout: { files: all('steps_run'), gain: 0.6 },
  'fire.cannon.light': { files: all('cannon_light_1', 'cannon_light_2'), gain: 0.9 },
  'fire.cannon': { files: all('cannon_1', 'cannon_2', 'cannon_3'), gain: 0.95 },
  'fire.cannon.heavy': { files: all('cannon_heavy_1', 'cannon_heavy_2', 'cannon_heavy_3', 'cannon_heavy_4'), gain: 1 },
  'fire.autocannon': { files: all('autocannon_1'), gain: 0.9 },
  'fire.mortar': { files: all('mortar_2', 'mortar_3'), gain: 0.85 },
  'fire.rocket': { files: all('bazooka_1', 'launcher_1', 'launcher_2'), gain: 0.85 },
  'fire.pf': { files: all('rpg_1', 'rpg_2', 'rpg_3'), gain: 0.85 },
  'impact.armor': { files: all('armor_1', 'armor_2', 'armor_3'), gain: 0.75 },
  'vehicle.start': { files: all('tank_start_1', 'tank_start_2'), gain: 0.7 },
  'vehicle.move': { files: all('tank_move_1', 'tank_move_2', 'tank_move_3', 'tank_move_4', 'tank_move_5'), gain: 0.65 },
  'vehicle.drive': { files: all('car_drive_1', 'car_drive_2'), gain: 0.65 },
  'vehicle.stop': { files: all('tank_stop_1', 'tank_stop_2'), gain: 0.6 },
  'vehicle.turn': { files: all('tank_turn_1', 'tank_turn_2', 'tank_turn_3'), gain: 0.6 },
  'vehicle.turret': { files: all('turret_1', 'turret_2'), gain: 0.45 },
  'vehicle.bog': { files: all('tank_rev_1'), gain: 0.65 },
};
