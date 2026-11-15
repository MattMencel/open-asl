import type { Ctx, HexId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { hexOfLoc, type LocId } from '../common/location';
import { statics } from '../common/pieces';
import type { Ec } from '../common/statics';
import { mod6, sideToward } from '../common/hexCorners';
import { SMOKE58, smoke58Counters, smoke58Markers, smokeGrenades, terrainOf } from '../sk1/terrain';

/*
 * Environmental Conditions and wind in full ASL (ASLRB B25.5, B25.63–B25.651, A24.6, A24.62).
 *
 * - **EC** (B25.5): the card's, or a dr on the EC Chart before play with the month's drm (Jan–Feb -3, Dec/Mar -2,
 *   Nov/Apr -1, June/Sept +1, July/Aug +2): ≤ 0 Snow -3, 1 Mud -3, 2 Wet -2, 3 Moist -1, 4 Moderate 0, 5 Dry +1,
 *   ≥ 6 Very Dry +2. The DRM applies to Kindling and Spreading Fire DRs except into a building (B25.5) or rubble, which is
 *   Kindled "in the same manner as a building" (B24.6, B25.62).
 * - **Wind Force** (B25.63): the card's, or a dr after setup: 1–3 No Wind, 4–5 Mild Breeze, 6 Heavy Winds.
 * - **Wind Direction** (B25.64, B.8): a dr when a breeze or heavier first blows, the hexside the wind blows toward: 1 is
 *   the hexside holding the grid coordinate (the top of a board placed the usual way), then clockwise. Kept here as a
 *   hexside index in `sideToward`'s numbering (0 the south-east hexside, clockwise), so `(dr + 3) mod 6`.
 * - **Wind Change** (B25.65): a DR at the start of every RPh; on a 2 a dr: 1 one hexside clockwise, 2 two, 3 one
 *   counter-clockwise, 4 two (no effect without wind), 5 force up, 6 force down (below No Wind or above Heavy Winds:
 *   Mild Breeze instead). A DR of 12 is Gusts for that Player Turn (B25.651): the Fire rules spread Blazes with it and
 *   a building Blaze collapses (B25.66, in the rubble rules); here the SMOKE counters are dispersed (A24.62).
 * - **Heavy Winds** (B25.63, A24.6): SMOKE is removed and none may be placed while they last; a Blaze gives no smoke.
 *
 * The Starter Kit's `Weather.wind` (a compass arrow on the HUD, read by no rule) is left as it is: this record is the
 * one the full ASL rules and the full ASL HUD read.
 */

export const EC_EXT = 'asl.ec';
export const WIND_EXT = 'asl.wind';

export interface EcState {
  ec: Ec;
  drm: number;
  /** The EC Chart dr and the month drm, when it was rolled rather than stated by the card. */
  dr?: number;
  monthDrm?: number;
}

export type WindForce = 'none' | 'breeze' | 'heavy';
export interface WindState {
  force: WindForce;
  /** The hexside the wind blows toward (`sideToward` numbering), once a breeze has blown. */
  dir?: number;
  /** Gusts this Player Turn (a Wind Change DR of 12, B25.651); `gustDir`: the direction rolled for them with No Wind. */
  gusts?: true;
  gustDir?: number;
}

export const EC_DRM: Record<Ec, number> = { snow: -3, mud: -3, wet: -2, moist: -1, moderate: 0, dry: 1, veryDry: 2 };
export const EC_NAME: Record<Ec, string> = { snow: 'Snow', mud: 'Mud', wet: 'Wet', moist: 'Moist', moderate: 'Moderate', dry: 'Dry', veryDry: 'Very Dry' };
export const WIND_NAME: Record<WindForce, string> = { none: 'No Wind', breeze: 'Mild Breeze', heavy: 'Heavy Winds' };

/** The EC Chart's month drm (B25.5). */
export function ecMonthDrm(month: number): number {
  if (month === 1 || month === 2) return -3;
  if (month === 12 || month === 3) return -2;
  if (month === 11 || month === 4) return -1;
  if (month === 6 || month === 9) return 1;
  if (month === 7 || month === 8) return 2;
  return 0;
}

/** The EC Chart row for a Final dr (B25.5). */
export function ecForDr(finalDr: number): Ec {
  if (finalDr <= 0) return 'snow';
  if (finalDr === 1) return 'mud';
  if (finalDr === 2) return 'wet';
  if (finalDr === 3) return 'moist';
  if (finalDr === 4) return 'moderate';
  if (finalDr === 5) return 'dry';
  return 'veryDry';
}

export const ecState = (env: QueryEnv): EcState | null => (env.state.ext[EC_EXT] as EcState | undefined) ?? null;

/** The EC DRM for Kindling or spreading into `loc`: none into a building or rubble (B25.5, B24.6). */
export function ecDrm(env: QueryEnv, loc?: LocId): number {
  const st = ecState(env);
  if (!st) return 0;
  if (loc !== undefined) {
    const t = terrainOf(env, loc).id;
    if (t.startsWith('building') || t.startsWith('rubble')) return 0;
  }
  return st.drm;
}

export const windOf = (env: QueryEnv): WindState => (env.state.ext[WIND_EXT] as WindState | undefined) ?? { force: 'none' };

/** The hexside a Random Direction dr names (B.8): 1 the top hexside of a board placed the usual way, clockwise. */
export const hexsideForDr = (dr: number): number => mod6(dr + 3);

/** The hexside index `k` lies relative to the wind blowing toward `dir`: 0 downwind, 1 beside it, 2 beside upwind, 3 upwind. */
export const windOffset = (dir: number, k: number): number => Math.min(mod6(k - dir), mod6(dir - k));

/** The Spreading Fire Wind Direction DRM for a spread across hexside `k` in a Mild Breeze (B25.64's diagram). */
export function windDirectionDrm(wind: WindState, k: number): number {
  if (wind.force !== 'breeze' || wind.dir === undefined) return 0;
  const off = windOffset(wind.dir, k);
  return off === 0 ? 2 : off === 1 ? 1 : off === 2 ? 0 : -1;
}

/** The direction a Gust spreads in: the wind's, or the one rolled for the Gust with No Wind (B25.651). */
export const gustDir = (wind: WindState): number | undefined => (wind.force === 'none' ? wind.gustDir : wind.dir);

const WIND_FORCE_OF: Record<string, WindForce> = { calm: 'none', breeze: 'breeze', heavy: 'heavy', gusts: 'breeze' };

function setWind(ctx: Ctx, next: WindState, reason: string, extra: Record<string, unknown> = {}) {
  const prev = windOf(ctx);
  ctx.emit('asl.wind.set', { wind: next, reason, ...extra });
  // Heavy Winds remove every SMOKE counter at once (A24.6).
  if (next.force === 'heavy' && prev.force !== 'heavy') clearSmoke(ctx, 'heavy');
}

/** Every Smoke counter on the board goes (Heavy Winds, A24.6). */
function clearSmoke(ctx: Ctx, reason: 'heavy') {
  const hexes = Object.keys(ctx.state.hexMarkers).sort();
  let any = false;
  for (const hex of hexes) {
    const m = ctx.state.hexMarkers[hex];
    if (!m) continue;
    if (smokeGrenades(m) > 0) {
      ctx.emit('hex.marker', { hex, key: 'smoke', value: null });
      any = true;
    }
    if (smoke58Counters(m).length) {
      for (const e of smoke58Markers(hex, m, [])) ctx.emit('hex.marker', e);
      any = true;
    }
  }
  if (any) ctx.emit('asl.wind.smokeCleared', { reason });
}

/** A Gust disperses the SMOKE on the board: Dispersed counters go, the rest flip (A24.62). Grenade Smoke is the lesser kind and goes. */
export function gustSmoke(ctx: Ctx, when: 'RPh' | 'AFPh') {
  const hexes = Object.keys(ctx.state.hexMarkers).sort();
  let any = false;
  for (const hex of hexes) {
    const m = ctx.state.hexMarkers[hex];
    if (!m) continue;
    if (smokeGrenades(m) > 0) {
      ctx.emit('hex.marker', { hex, key: 'smoke', value: null });
      any = true;
    }
    const counters = smoke58Counters(m);
    if (counters.length) {
      const kept = counters.filter((c) => !c.dispersed).map((c) => ({ ...c, dispersed: true }));
      for (const e of smoke58Markers(hex, m, kept)) ctx.emit('hex.marker', e);
      any = true;
    }
  }
  if (any) ctx.emit('asl.wind.smokeGusted', { when });
}

/** Whether `hex` holds any Smoke counter, for the module's own bookkeeping. */
export const anySmoke = (env: QueryEnv, hex: HexId) => smokeGrenades(env.state.hexMarkers[hex]) > 0 || !!env.state.hexMarkers[hex]?.[SMOKE58.kind];

export const aslWindModule: RuleModule = {
  id: 'asl.wind',
  ref: 'ASLRB B25.5, B25.63, B25.64, B25.65, B25.651, A24.6, A24.62',
  summary: 'Environmental Conditions, Wind Force and Direction, the Wind Change DR, Gusts, Heavy Winds against Smoke.',
  requires: ['sk1.terrain', 'sk1.rally'],
  install(r) {
    r.event<{ ec: EcState }>({
      type: 'asl.ec.set',
      apply(d, p) {
        d.ext[EC_EXT] = p.ec;
      },
    });
    r.event<{ wind: WindState; reason: string; dr?: number; dirDr?: number }>({
      type: 'asl.wind.set',
      apply(d, p) {
        d.ext[WIND_EXT] = p.wind;
      },
    });
    r.event<{ dr: [number, number]; change: number | null; gusts: boolean; dir?: number }>({ type: 'asl.wind.changeDr', apply() {} });
    r.event<{ reason: string }>({ type: 'asl.wind.smokeCleared', apply() {} });
    r.event<{ when: string }>({ type: 'asl.wind.smokeGusted', apply() {} });

    // ---------------------------------------------------------------- B25.5: the EC Chart dr before play
    r.setup({
      id: 'asl.ec.start',
      priority: -5,
      run(ctx) {
        const sc = statics(ctx).scenario;
        if (sc.ec) {
          ctx.emit('asl.ec.set', { ec: { ec: sc.ec, drm: EC_DRM[sc.ec] } });
          return;
        }
        const monthDrm = ecMonthDrm(sc.month);
        const dr = ctx.roll('Environmental Conditions dr', 1).total;
        const ec = ecForDr(dr + monthDrm);
        ctx.emit('asl.ec.set', { ec: { ec, drm: EC_DRM[ec], dr, monthDrm } });
      },
    });

    // A wind the card states blows from the start (no dr); an unstated one is rolled after setup, at the first RPh (B25.63).
    r.setup({
      id: 'asl.wind.start',
      priority: -4,
      run(ctx) {
        if (statics(ctx).scenario.weather?.wind?.force) initialWind(ctx);
      },
    });

    // ---------------------------------------------------------------- B25.63/B25.64/B25.65: the wind, at the start of each RPh
    r.on<{ phase: string; turn: number; attacker: SideId }>({
      id: 'asl.wind.rph',
      event: 'turn.phaseStarted',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'RPh') return;
        if (ctx.state.ext[WIND_EXT] === undefined) initialWind(ctx);
        const roll = ctx.roll('Wind Change DR');
        const wind = windOf(ctx);
        if (roll.total === 2) {
          const dr = ctx.roll('Wind Change dr', 1).total;
          const next = applyChange(wind, dr);
          const needDir = next.force !== 'none' && next.dir === undefined;
          const dirDr = needDir ? ctx.roll('Wind Direction dr', 1).total : undefined;
          const withDir: WindState = needDir ? { ...next, dir: hexsideForDr(dirDr!) } : next;
          ctx.emit('asl.wind.changeDr', { dr: roll.dice as [number, number], change: dr, gusts: false });
          setWind(ctx, withDir, 'change', { dr, ...(dirDr !== undefined ? { dirDr } : {}) });
          return;
        }
        if (roll.total === 12) {
          // Gusts: with No Wind a direction is rolled for them (B25.651).
          const dirDr = wind.force === 'none' && wind.dir === undefined ? ctx.roll('Gust Direction dr', 1).total : undefined;
          const gusting: WindState = { ...wind, gusts: true, ...(dirDr !== undefined ? { gustDir: hexsideForDr(dirDr) } : wind.force === 'none' && wind.dir !== undefined ? { gustDir: wind.dir } : {}) };
          ctx.emit('asl.wind.changeDr', { dr: roll.dice as [number, number], change: null, gusts: true, ...(gustDir(gusting) !== undefined ? { dir: gustDir(gusting) } : {}) });
          setWind(ctx, gusting, 'gusts');
          gustSmoke(ctx, 'RPh');
          return;
        }
        ctx.emit('asl.wind.changeDr', { dr: roll.dice as [number, number], change: null, gusts: false });
      },
    });
    // The Gusts last the Player Turn: they disperse the Smoke again at the AFPh's end (A24.62) and are over with the CCPh.
    r.on<{ phase: string }>({
      id: 'asl.wind.turnEnd',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        const wind = windOf(ctx);
        if (!wind.gusts) return;
        if (ev.payload.phase === 'AFPh') gustSmoke(ctx, 'AFPh');
        if (ev.payload.phase === 'CCPh') {
          const { gusts: _g, gustDir: _d, ...rest } = wind;
          setWind(ctx, rest, 'gustsOver');
        }
      },
    });

    // ---------------------------------------------------------------- B25.63, A24.6: no Smoke in Heavy Winds
    r.contribute({
      id: 'asl.wind.noSmokeGrenades',
      query: 'unit.smoke',
      ref: 'ASLRB A24.6, B25.63',
      label: 'no Smoke in Heavy Winds',
      when: (_c, env) => windOf(env).force === 'heavy',
      apply: () => 0,
    });
    r.contribute({
      id: 'asl.wind.noOrdnanceSmoke',
      query: 'ordnance.illegal',
      ref: 'ASLRB A24.6, B25.63',
      when: ({ shot }, env) => windOf(env).force === 'heavy' && (shot.ammo === 'SMOKE' || shot.ammo === 'WP'),
      apply: (v) => v ?? 'No Smoke may be placed in Heavy Winds (ASLRB A24.6, B25.63)',
    });
  },
};

/** The Wind Force dr after setup, unless the card states the wind (B25.63); the direction dr when it blows (B25.64). */
function initialWind(ctx: Ctx) {
  const card = statics(ctx).scenario.weather?.wind;
  if (card?.force) {
    const force = WIND_FORCE_OF[card.force] ?? 'none';
    const dirDr = force !== 'none' && card.dir === undefined ? ctx.roll('Wind Direction dr', 1).total : undefined;
    setWind(ctx, { force, ...(force !== 'none' ? { dir: card.dir ?? hexsideForDr(dirDr!) } : {}) }, 'card', dirDr !== undefined ? { dirDr } : {});
    return;
  }
  const dr = ctx.roll('Wind Force dr', 1).total;
  const force: WindForce = dr <= 3 ? 'none' : dr <= 5 ? 'breeze' : 'heavy';
  const dirDr = force !== 'none' ? ctx.roll('Wind Direction dr', 1).total : undefined;
  setWind(ctx, { force, ...(dirDr !== undefined ? { dir: hexsideForDr(dirDr) } : {}) }, 'dr', { dr, ...(dirDr !== undefined ? { dirDr } : {}) });
}

/** The Wind Change table (B25.65) applied to the wind. */
export function applyChange(wind: WindState, dr: number): WindState {
  const { gusts: _g, gustDir: _d, ...base } = wind;
  switch (dr) {
    case 1:
    case 2:
    case 3:
    case 4: {
      if (base.force === 'none' || base.dir === undefined) return base;
      const turn = dr === 1 ? 1 : dr === 2 ? 2 : dr === 3 ? -1 : -2;
      return { ...base, dir: mod6(base.dir + turn) };
    }
    case 5:
      return { ...base, force: base.force === 'none' ? 'breeze' : base.force === 'breeze' ? 'heavy' : 'breeze' };
    default:
      return { ...base, force: base.force === 'heavy' ? 'breeze' : base.force === 'breeze' ? 'none' : 'breeze' };
  }
}

/** The hex downwind of `hex` (across hexside `dir`), on the map, if any. */
export function downwind(env: QueryEnv, hex: HexId, dir: number): HexId | undefined {
  const map = statics(env).map;
  const h = map.hex(hexOfLoc(hex));
  if (!h) return undefined;
  for (const n of map.neighbors(h.id)) {
    const k = sideTowardOf(env, h.id, n);
    if (k === dir) return n;
  }
  return undefined;
}

const sideTowardOf = (env: QueryEnv, hex: HexId, nb: HexId): number | null => sideToward(statics(env).map, hex, nb);
