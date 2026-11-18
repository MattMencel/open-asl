import type { Ctx, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOfLoc, levelOfLoc, locId, locOf, locationsOf, parseLoc, type LocId } from '../common/location';
import { sideToward } from '../common/hexCorners';
import { defOf, personnelAt, personnelInHex, statics, unpossessedWeaponsAt, unpossessedWeaponsInHex } from '../common/pieces';
import { fortifiedState } from '../sk1/fortified';
import { pieceOf } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { FP, type BeforeApplyFn, type BeforeApplyInfo } from '../sk1/fire';
import { P as MP, eliminate, type FlushFn, type RandomSelectFn } from '../sk1/morale';
import { updateControl, type ControlState } from '../sk1/scenario';
import { blazeAt, blazeLocations, flamesAt, placeBlaze, removeFlames } from './fire';
import { hexsideForDr } from './wind';
import { vehicle } from '../sk3/status';

/*
 * Rubble in full ASL (ASLRB B24.1–B24.6, B24.11, B24.12, B24.121, B25.66).
 *
 * - A rubbled Location is no longer a building Location; a building wholly rubbled is no building (B24.1): its hexes play
 *   as `rubble-stone` / `rubble-wood` terrain (B24.3 TEM of the building it was, B24.4 three MF, a half-level Inherent
 *   obstacle through the whole hex, B24.2), the fortification of a rubbled Location is gone (B24.5, B24.3), and a building
 *   with every hex rubbled from the ground counts for nobody's building Control (B24.1, `'control.adjust'`).
 * - **Creation by HE** (B24.11): a HE attack of 70mm or more (or HEAT) whose Original IFT DR is a KIA on the column fired
 *   rolls a dr (+1 stone): ≤ the KIA number rubbles that level and every level above it, eliminating the unarmored
 *   occupants and their SW instead of the IFT result; a level above ground rubbled may bring the whole hex down (dr +1
 *   per level above it ≥ 6). An Area or Indirect Fire hit on several levels picks the one by Random Selection. A DC
 *   (A23.41), Placed or a Breach attempt, reaches here through the same procedure point.
 * - **Falling rubble** (B24.12, B24.121): a hex with an upper level rubbled by any means rolls a DR: colored dr +1 per
 *   non-rooftop level above ground rubbled ≥ 7 and the rubble falls across the hexside the white dr names (B.8) into the
 *   next hex: its terrain becomes ground rubble of the fallen building's kind, its Infantry and unpossessed SW are
 *   eliminated, a building hex with an upper level is rubbled whole and rolls its own DR (a chain), a hex already rubble
 *   loses only its occupants; off the map nothing. A Blaze in the collapsing Location puts a Blaze where it falls, rubble
 *   falling into a Blaze is ablaze, and falling rubble puts out any Flame (B24.6).
 * - **Collapse** (B25.66): on an Original Wind Change DR of 12 a building Location holding a Blaze (Random Selection,
 *   every tie) collapses into burning rubble, and all levels above it.
 *
 * Fortifications under falling rubble are removed by `asl.fortifications` and `asl.entrenchments` (B24.121). Vehicles and TB in
 * the way of falling rubble (B24.121), rubble clearance (B24.7, B24.71) and printed rubble (B24.55) wait for their rules. The Starter Kit has no rubble creation: nothing here runs there.
 */

export const RUBBLE_EXT = 'asl.rubble';

export interface RubbleRecord {
  /** The lowest rubbled level: every level from it up is rubble (0: the whole hex). */
  from: number;
  kind: 'stone' | 'wood';
}

export const rubbleState = (env: QueryEnv): Record<HexId, RubbleRecord> => (env.state.ext[RUBBLE_EXT] as Record<HexId, RubbleRecord> | undefined) ?? {};
export const rubbleAt = (env: QueryEnv, hex: HexId): RubbleRecord | undefined => rubbleState(env)[hex];
/** Whether a Location is rubble: its hex is rubbled from its level or below. */
export const isRubbled = (env: QueryEnv, loc: LocId): boolean => {
  const r = rubbleAt(env, hexOfLoc(loc));
  return !!r && levelOfLoc(loc) >= r.from;
};

/** The obstacle heights the LOS tracers use for rubbled hexes (B24.2): a half level throughout, the art as high as what stands beneath upper rubble. */
export function rubbledHeights(env: QueryEnv): Record<HexId, { hex: number; art?: number }> {
  const out: Record<HexId, { hex: number; art?: number }> = {};
  for (const [hex, r] of Object.entries(rubbleState(env))) out[hex] = r.from === 0 ? { hex: 0.5 } : { hex: 0.5, art: r.from + 0.5 };
  return out;
}

const buildingKind = (env: QueryEnv, hex: HexId): 'stone' | 'wood' | null => {
  const t = statics(env).map.hex(hex)?.terrain ?? '';
  return t === 'building-stone' || t === 'rubble-stone' ? 'stone' : t === 'building-wood' || t === 'rubble-wood' ? 'wood' : null;
};
/** The upper levels a hex has (B23.21–23): what falling rubble and whole-hex collapse count. */
const upperLevels = (env: QueryEnv, hex: HexId) => statics(env).map.hex(hex)?.building?.upper ?? 0;

/** A building Location the HE rubble rule applies to: a building hex, at a level that is still a building (B24.11). */
export function isBuildingLoc(env: QueryEnv, loc: LocId): boolean {
  const hex = hexOfLoc(loc);
  return buildingKind(env, hex) !== null && statics(env).map.hex(hex)?.terrain.startsWith('building') === true && !isRubbled(env, loc);
}

/**
 * Rubble `loc` and every level above it (B24.11): the occupants and unpossessed SW of the rubbled levels are eliminated,
 * the fortification goes (B24.5), Flames go out and a Blaze there (or `burning` rubble) burns on as rubble (B24.6);
 * then the falling rubble DR if the hex has an upper level (B24.12).
 */
export function rubbleLocation(ctx: Ctx, loc: LocId, opts: { by: 'he' | 'dc' | 'collapse' | 'falling'; burning?: boolean; kind?: 'stone' | 'wood' }) {
  const hex = hexOfLoc(loc);
  const from = levelOfLoc(loc);
  const existing = rubbleAt(ctx, hex);
  const kind = opts.kind ?? existing?.kind ?? buildingKind(ctx, hex) ?? 'stone';
  const burning = !!opts.burning || !!blazeAt(ctx, loc);
  const levels = locationsOf(ctx, hex).filter((l) => !parseLoc(l).sub && levelOfLoc(l) >= from);
  const wasRubble = !!existing && existing.from <= from;
  if (!wasRubble) {
    ctx.emit('asl.rubble', { hex, from, kind, by: opts.by, burning });
    updateControl(ctx);
  }
  // Everyone and every weapon on the rubbled levels (B24.11 "All unarmored occupants (including SW) ... are eliminated").
  const units = levels.flatMap((l) => personnelAt(ctx, l).map((p) => p.id)).sort();
  const weapons = levels.flatMap((l) => unpossessedWeaponsAt(ctx, l).map((p) => p.id)).sort();
  if (units.length || weapons.length) ctx.emit('asl.rubble.eliminated', { hex, loc, units, weapons });
  for (const u of units) if (ctx.state.pieces[u]?.loc.kind === 'hex') eliminate(ctx, u, 'buried in the rubble (ASLRB B24.11)');
  for (const w of weapons) if (ctx.state.pieces[w]?.loc.kind === 'hex') ctx.emit('piece.eliminated', { id: w, reason: 'buried in the rubble' });
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
  // Fortification (B24.5), Flames (B24.6), and the Blaze that comes with burning rubble.
  for (const l of levels) {
    if (fortifiedState(ctx)?.locations?.includes(l)) ctx.emit('sk1.fortified.removed', { loc: l });
    if (flamesAt(ctx, l).length) removeFlames(ctx, l, 'rubble');
  }
  if (burning) {
    const blaze = blazeAt(ctx, loc);
    // Burning rubble: the Blaze burns on, now as rubble (B24.6).
    if (blaze && !blaze.rubble) ctx.emit('asl.fire.blaze', { loc, blaze: { ...blaze, rubble: true }, source: 'rubble' });
    else placeBlaze(ctx, loc, { kindledBy: blaze?.kindledBy ?? null, source: 'rubble', rubble: true });
  }
  // Falling rubble (B24.12): only a hex that had an upper level, +1 per non-rooftop upper level "rubbled by that
  // shot" — a level already rubble from an earlier one does not count again.
  const upper = upperLevels(ctx, hex);
  const top = existing ? Math.min(upper, existing.from - 1) : upper;
  if (upper > 0 && !wasRubble) fallingRubble(ctx, hex, Math.max(0, top - Math.max(from, 1) + 1), kind, burning);
}

/** The falling rubble DR of a hex just rubbled (B24.12): colored dr + `drm` ≥ 7, the white dr the direction (B.8). */
export function fallingRubble(ctx: Ctx, hex: HexId, drm: number, kind: 'stone' | 'wood', burning: boolean) {
  const roll = ctx.roll(`Falling rubble DR from ${hex}`);
  const [white, colored] = roll.dice as [number, number];
  const falls = colored + drm >= 7;
  const k = hexsideForDr(white);
  const map = statics(ctx).map;
  const to = falls ? map.neighbors(hex).find((n) => sideToward(map, hex, n) === k) : undefined;
  ctx.emit('asl.rubble.falling', { hex, dr: [white, colored], drm, falls, hexside: k, ...(to ? { to } : {}) });
  if (!falls || !to) return;
  rubbleFallsInto(ctx, to, kind, burning);
}

/** Rubble falling into `hex` (B24.121, B24.6). */
function rubbleFallsInto(ctx: Ctx, hex: HexId, kind: 'stone' | 'wood', burning: boolean) {
  const map = statics(ctx).map;
  if (!map.hex(hex)) return;
  const units = personnelInHex(ctx, hex).map((p) => p.id).sort();
  const weapons = unpossessedWeaponsInHex(ctx, hex).map((p) => p.id).sort();
  const existing = rubbleAt(ctx, hex);
  if (units.length || weapons.length) ctx.emit('asl.rubble.eliminated', { hex, loc: hex, units, weapons, falling: true });
  for (const u of units) if (ctx.state.pieces[u]?.loc.kind === 'hex') eliminate(ctx, u, 'crushed by falling rubble (ASLRB B24.121)');
  for (const w of weapons) if (ctx.state.pieces[w]?.loc.kind === 'hex') ctx.emit('piece.eliminated', { id: w, reason: 'buried by falling rubble' });
  ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
  for (const l of locationsOf(ctx, hex)) if (flamesAt(ctx, l).length) removeFlames(ctx, l, 'rubble');
  // A hex already rubble: only the danger to its occupants (B24.2).
  if (existing && existing.from === 0) {
    if (burning && !blazeAt(ctx, hex)) placeBlaze(ctx, hex, { kindledBy: null, source: 'rubble', rubble: true });
    return;
  }
  const h = map.hex(hex)!;
  if (h.terrain.startsWith('building')) {
    // Another building hex (even a higher one): rubbled whole, and the chain goes on (B24.121).
    rubbleLocation(ctx, hex, { by: 'falling', burning: burning || !!blazeAt(ctx, hex) });
    return;
  }
  // Any other terrain becomes ground rubble of the fallen building's kind (B24.121).
  ctx.emit('asl.rubble', { hex, from: 0, kind, by: 'falling', burning: burning || !!blazeAt(ctx, hex) });
  updateControl(ctx);
  if (burning || blazeAt(ctx, hex)) {
    const blaze = blazeAt(ctx, hex);
    placeBlaze(ctx, hex, { kindledBy: blaze?.kindledBy ?? null, source: 'rubble', rubble: true });
  }
}

/**
 * One Original DR against several levels of a building hex (Indirect Fire, B23.32): "The level affected in an Area-Target-
 * Type/OBA attack vs a multi-level building is determined via Random Selection among those levels hit" (B24.11). The
 * selection and the rubble dr are made at the first of the levels; which Locations collapsed is kept in
 * `ext['asl.rubble.pick']` for the rest of the levels of that attack, and cleared at its last.
 */
const PICK_EXT = 'asl.rubble.pick';
interface RubblePick {
  key: string;
  rubbled: LocId[];
}

function rubbleCheck(ctx: Ctx, info: BeforeApplyInfo): boolean {
  const group = info.group ?? [];
  if (group.length > 1 && group.includes(info.target)) {
    if (kiaOf(ctx, info) === null) return false;
    const key = `${group.join(',')}|${info.originalDr}|${info.column}`;
    let pick = ctx.state.ext[PICK_EXT] as RubblePick | undefined;
    if (!pick || pick.key !== key || info.target === group[0]) {
      const levels = group.filter((l) => isBuildingLoc(ctx, l));
      if (levels.length < 2) return singleCheck(ctx, info);
      const [chosen] = ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, levels, 1, 'Rubble: the building level hit');
      const before = new Set(levels.filter((l) => isRubbled(ctx, l)));
      singleCheck(ctx, { ...info, target: chosen! });
      pick = { key, rubbled: levels.filter((l) => isRubbled(ctx, l) && !before.has(l)) };
      ctx.emit('asl.rubble.pick', { pick });
    }
    const out = pick.rubbled.includes(info.target);
    if (info.target === group[group.length - 1]) ctx.emit('asl.rubble.pick', { pick: null });
    return out;
  }
  return singleCheck(ctx, info);
}

/**
 * The KIA# of an attack that can rubble a building, or null: HE ≥ 70mm or HEAT (B24.11), or a DC (A23.41 "may ... cause a
 * Building to rubble (B24.11)"; A23.1 sets the column it is judged on).
 */
function kiaOf(ctx: Ctx, info: BeforeApplyInfo): number | null {
  if (info.by === 'other') return null;
  if (info.by === 'he' && !info.heat && (info.caliber ?? 0) < 70) return null;
  const res = statics(ctx).tables.ift(info.column, info.originalDr);
  return res.kind === 'KIA' ? (res.n ?? 1) : null;
}

function singleCheck(ctx: Ctx, info: BeforeApplyInfo): boolean {
  if (!isBuildingLoc(ctx, info.target)) return false;
  const kia = kiaOf(ctx, info);
  if (kia === null) return false;
  const stone = buildingKind(ctx, hexOfLoc(info.target)) === 'stone';
  const dr = ctx.roll(`Rubble dr for ${info.target}`, 1).total;
  const rubbled = dr + (stone ? 1 : 0) <= kia;
  ctx.emit('asl.rubble.check', { loc: info.target, dr, drm: stone ? 1 : 0, kia, rubbled });
  if (!rubbled) return false;
  const level = levelOfLoc(info.target);
  const hex = hexOfLoc(info.target);
  let loc = info.target;
  if (level > 0) {
    // "Even if the KIA occurs in a higher building level, there is still a possibility that the entire building will collapse."
    const above = upperLevels(ctx, hex) - level;
    const whole = ctx.roll(`Whole-hex collapse dr for ${hex}`, 1).total;
    const falls = whole + above >= 6;
    ctx.emit('asl.rubble.whole', { hex, dr: whole, drm: above, rubbled: falls });
    if (falls) loc = hex;
  }
  rubbleLocation(ctx, loc, { by: info.by === 'dc' ? 'dc' : 'he' });
  return true;
}

export const aslRubbleModule: RuleModule = {
  id: 'asl.rubble',
  ref: 'ASLRB B24.1–B24.6, B24.11, B24.12, B24.121, B25.66',
  summary: 'Rubble: buildings collapsed by HE, by a burning building on a Wind Change DR of 12, and by falling rubble; rubble terrain.',
  requires: ['asl.fire', 'asl.wind', 'sk1.terrain', 'sk1.fire'],
  install(r) {
    r.event<{ hex: HexId; from: number; kind: 'stone' | 'wood'; by: string; burning: boolean }>({
      type: 'asl.rubble',
      apply(d, p) {
        const st = { ...((d.ext[RUBBLE_EXT] as Record<HexId, RubbleRecord> | undefined) ?? {}) };
        const cur = st[p.hex];
        st[p.hex] = { from: cur ? Math.min(cur.from, p.from) : p.from, kind: cur?.kind ?? p.kind };
        d.ext[RUBBLE_EXT] = st;
      },
    });
    r.event<{ loc: LocId; dr: number; drm: number; kia: number; rubbled: boolean }>({ type: 'asl.rubble.check', apply() {} });
    r.event<{ pick: RubblePick | null }>({
      type: 'asl.rubble.pick',
      apply(d, p) {
        if (p.pick) d.ext[PICK_EXT] = p.pick;
        else delete d.ext[PICK_EXT];
      },
    });
    r.event<{ hex: HexId; dr: number; drm: number; rubbled: boolean }>({ type: 'asl.rubble.whole', apply() {} });
    r.event<{ hex: HexId; dr: [number, number]; drm: number; falls: boolean; hexside: number; to?: HexId }>({ type: 'asl.rubble.falling', apply() {} });
    r.event<{ hex: HexId; loc: LocId; units: PieceId[]; weapons: PieceId[]; falling?: boolean }>({ type: 'asl.rubble.eliminated', apply() {} });
    r.event<{ candidates: LocId[]; chosen: LocId[] }>({ type: 'asl.rubble.collapse', apply() {} });

    // ---------------------------------------------------------------- the rubbled hex plays as rubble terrain
    r.contribute({
      id: 'asl.rubble.terrain',
      query: 'hex.terrain',
      layer: 6,
      ref: 'ASLRB B24.1, B24.3, B24.4',
      label: 'rubble',
      when: ({ hex, loc }, env) => {
        const rb = rubbleAt(env, hex);
        return !!rb && (loc ? levelOfLoc(loc) >= rb.from : rb.from === 0);
      },
      apply: (_v, { hex }, env) => `rubble-${rubbleAt(env, hex)!.kind}`,
    });
    // B24.2: the ground level of a hex holding upper level rubble is covered with rubble throughout: entering it costs the
    // rubble's MF, except across a connecting (non-rubble) building hexside, at the building's rate (EX: I2 to H2 three MF,
    // G3/H3/I3 to H2 two). Infantry only; vehicles and rubble are their own rules.
    r.contribute({
      id: 'asl.rubble.ground-under',
      query: 'move.cost',
      layer: 2,
      ref: 'ASLRB B24.2',
      label: 'rubble-covered ground (B24.2)',
      when: ({ unit, from, to, loc }, env) => {
        if (loc || defOf(env, pieceOf(env, unit)).kind === 'vehicle') return false;
        const rb = rubbleAt(env, to);
        if (!rb || rb.from === 0) return false;
        const map = statics(env).map;
        const b = map.hex(to)?.buildingId;
        const connecting = !!from && !!b && map.hex(from)?.buildingId === b && !isRubbled(env, from);
        return !connecting;
      },
      apply: (_v, { to }, env) => terrainOf(env, locId(to, rubbleAt(env, to)!.from)).mf,
    });
    // B24.4: "Vehicles may not enter a rubble Location unless they are fully-tracked" (half their MP and a Bog Check +3
    // are the vehicle movement rules', `sk3/vehicleMove.ts`).
    r.contribute({
      id: 'asl.rubble.vehicle-tracked',
      query: 'vehicle.stepIllegal',
      layer: 10,
      ref: 'ASLRB B24.4',
      apply(v, { ms, to }, env) {
        if (v || !rubbleAt(env, to) || rubbleAt(env, to)!.from !== 0) return v;
        const p = env.state.pieces[ms.units[0]!];
        const d = p ? vehicle(env, p) : null;
        return d && !d.tracked ? 'Only a fully tracked vehicle may enter rubble (ASLRB B24.4)' : null;
      },
    });
    // B24.4: the stairwell to or from a rubble level costs three MF, not one.
    r.contribute({
      id: 'asl.rubble.stairs',
      query: 'move.stepCost',
      ref: 'ASLRB B24.4',
      label: '+2 stairs to or from rubble',
      when: ({ ms, to }, env) => !!ms.hex && hexOfLoc(to) === ms.hex && levelOfLoc(to) !== (ms.level ?? 0) && (isRubbled(env, to) || isRubbled(env, locId(ms.hex, ms.level ?? 0))),
      apply: (v) => v + 2,
    });

    // ---------------------------------------------------------------- B24.11: a HE KIA may rubble the Location before the attack is applied
    r.procedure<BeforeApplyFn>(FP.beforeApply, (next) => (ctx, info) => {
      const done = next?.(ctx, info) ?? false;
      if (done) return true;
      return rubbleCheck(ctx, info);
    });

    // ---------------------------------------------------------------- B25.66: Collapse on a Wind Change DR of 12
    r.on<{ gusts: boolean }>({
      id: 'asl.rubble.collapse',
      event: 'asl.wind.changeDr',
      handler(ctx, ev) {
        if (!ev.payload.gusts) return;
        const candidates = blazeLocations(ctx).filter((loc) => isBuildingLoc(ctx, loc));
        if (!candidates.length) return;
        const chosen = candidates.length === 1 ? candidates : ctx.proc<RandomSelectFn>(MP.randomSelect)(ctx, candidates, 1, 'Collapse: the burning building Location', { ties: true });
        ctx.emit('asl.rubble.collapse', { candidates, chosen });
        for (const loc of [...chosen].sort()) rubbleLocation(ctx, loc, { by: 'collapse', burning: true });
      },
    });

    // ---------------------------------------------------------------- B24.1: a building wholly reduced to rubble is no building
    r.contribute({
      id: 'asl.rubble.control',
      query: 'control.adjust',
      ref: 'ASLRB B24.1',
      when: (_c, env) => Object.keys(rubbleState(env)).length > 0,
      apply(v, _c, env) {
        const map = statics(env).map;
        const rb = rubbleState(env);
        const gone = new Set<string>();
        const hexesOf = new Map<string, HexId[]>();
        for (const h of map.hexes()) if (h.buildingId) hexesOf.set(h.buildingId, [...(hexesOf.get(h.buildingId) ?? []), h.id]);
        for (const [b, hexes] of hexesOf) if (hexes.every((h) => rb[h]?.from === 0)) gone.add(b);
        if (![...gone].some((b) => v.buildings[b] !== undefined)) return v;
        const buildings = { ...v.buildings };
        for (const b of gone) delete buildings[b];
        const out: ControlState = { ...v, buildings };
        return out;
      },
    });
  },
};

/** The rubble a viewer sees (all of it): for the board and the peek card. */
export function rubbleView(env: QueryEnv): { hex: HexId; from: number; kind: 'stone' | 'wood'; burning: boolean }[] {
  return Object.entries(rubbleState(env))
    .map(([hex, r]) => ({ hex, from: r.from, kind: r.kind, burning: !!blazeAt(env, locId(hex, r.from)) }))
    .sort((a, b) => (a.hex < b.hex ? -1 : 1));
}

/** Whether `side`'s unit `unit` stands in rubble (for messages). */
export const inRubble = (env: QueryEnv, unit: PieceId): boolean => {
  const p = env.state.pieces[unit];
  const loc = p ? locOf(env.state, p) : null;
  return !!loc && isRubbled(env, loc);
};
