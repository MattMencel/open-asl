import type { TerrainDef } from '../../common/statics';

/** SK1 terrain (SK1 1.1.1) plus SK2 brush. Roads are hex features on Open Ground; Woods-Road is woods + feature, Orchard-Road orchard + feature. */
export const SK1_TERRAIN: Record<string, TerrainDef> = {
  open: { id: 'open', name: 'Open Ground', mf: 1, tem: 0, los: 'none', openGround: true },
  woods: { id: 'woods', name: 'Woods', mf: 2, tem: 1, los: 'obstacle', openGround: false, routShelter: true, rallyCover: true, airBursts: true, height: 1, fire: { kindle: 9, spread: 7 } },
  orchard: { id: 'orchard', name: 'Orchard', mf: 1, tem: 0, los: 'hindrance', openGround: false, inherent: true, height: 1, fire: { kindle: 11, spread: 9 } },
  grain: { id: 'grain', name: 'Grain', mf: 1.5, tem: 0, los: 'hindrance', openGround: false, fire: { kindle: 10, spread: 6 } },
  /** SK2 (SK4 1.1.1): a thinly wooded area with dense undergrowth; +1 Hindrance per hex, no TEM, not Open Ground. */
  brush: { id: 'brush', name: 'Brush', mf: 2, tem: 0, los: 'hindrance', openGround: false, fire: { kindle: 9, spread: 6 } },
  /** Scenario terrain (SSR): cannot be entered, no effect on LOS. */
  flooded: { id: 'flooded', name: 'Flooded', mf: Infinity, tem: 0, los: 'none', openGround: true },
  /** Scenario terrain (S33 SSR 1: "Plowed Fields cost 1½ MF per hex entered and are treated as Open Ground for all other purposes"). */
  plowed: { id: 'plowed', name: 'Plowed Field', mf: 1.5, tem: 0, los: 'none', openGround: true },
  /**
   * Scenario terrain (S35 SSR 1: "Orchards are shellholes, which have no effect on LOS, provide a +1 TEM for infantry units,
   * and cost 2 MF to enter"; ASLRB B2). Not Open Ground (B2.4: entered at 2 MF). Vehicles pay the Open Ground rate.
   */
  shellholes: { id: 'shellholes', name: 'Shellholes', mf: 2, tem: 1, los: 'none', openGround: false },
  'building-stone': {
    id: 'building-stone',
    name: 'Stone Building',
    mf: 2,
    tem: 3,
    los: 'obstacle',
    openGround: false,
    routShelter: true,
    rallyCover: true,
    height: 1,
    fire: { kindle: 8, spread: 9 },
  },
  /**
   * Scenario terrain (SSR, S18: "All woods and orchards are stone rubble"): ASLRB B24 stone rubble, 3 MF (B24.4), +3 TEM
   * (B24.3), blocking LOS as an Inherent obstacle, along its hexsides too, and Ambush terrain; not a building, so neither
   * a rout destination nor rally cover (B24.1).
   */
  'rubble-stone': {
    id: 'rubble-stone',
    name: 'Stone Rubble',
    mf: 3,
    tem: 3,
    los: 'obstacle',
    openGround: false,
    inherent: true,
    ambush: true,
    blocksRoad: true,
    /** A half-level obstacle (ASLRB B10.1): never blocks a higher Location nor makes a Blind Hex (A6.21). */
    height: 0.5,
    /** Kindled "in the same manner as a building" (ASLRB B24.6): the stone building's numbers. */
    fire: { kindle: 8, spread: 9 },
  },
  /** Rubble of a wooden building (ASLRB B24.1, B24.3: the TEM of the building it was), made during play. */
  'rubble-wood': {
    id: 'rubble-wood',
    name: 'Wooden Rubble',
    mf: 3,
    tem: 2,
    los: 'obstacle',
    openGround: false,
    inherent: true,
    ambush: true,
    blocksRoad: true,
    height: 0.5,
    fire: { kindle: 7, spread: 8 },
  },
  'building-wood': {
    id: 'building-wood',
    name: 'Wooden Building',
    mf: 2,
    tem: 2,
    los: 'obstacle',
    openGround: false,
    routShelter: true,
    rallyCover: true,
    height: 1,
    fire: { kindle: 7, spread: 8 },
  },
};
