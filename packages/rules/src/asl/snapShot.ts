import type { HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { cornerPoint, mod6, sideToward } from '../common/hexCorners';
import { hexPixel } from '../common/map';
import { hexOfLoc, locOf, type LocId } from '../common/location';
import { statics } from '../common/pieces';
import type { FireDeclaration } from '../sk1/fire';
import { FORTIFIED_DRM } from '../sk1/fortified';
import { expenditureKey, moveLoc, moveState } from '../sk1/moveState';
import { pieceOf, sw, vehicleIfe, weapon } from '../sk1/status';
import { terrainOf, type LosTrace } from '../sk1/terrain';
import { entryHexside, heightOf, levelOf } from '../sk2/elevation';
import { ceDrmApplies } from '../sk3/vehicleFire';
import { vehicleMgOf } from '../sk3/vehicleMg';

/*
 * Snap Shot (ASLRB A8.15, A8.223; C.5, C.5A–C; B9.42): a Small-Arms/MG Defensive First Fire attack traced to the whole
 * hexside the moving stack crossed in entering an on-board hex, instead of to the hex centre. Full ASL only: the Starter
 * Kit has no Snap Shot.
 * - The hexside is the one between the hex entered and the hex the stack came from, while that entry is the stack's
 *   latest MF/MP expenditure (a further expenditure there, the stairs, a step round the same Bypass hex or into its
 *   obstacle cross none). Into Bypass from the next hex, and from a Bypass corner into a hex there, the stack crosses the
 *   hexside between the two hexes. None from offboard: every board edge is a row of half hexes, so the hexside crossed
 *   lies on no board: there is no hexside to trace to.
 * - The LOS must reach both corners of the hexside (B9.42 "LOS must be drawn to both vertices"), Blind Hexes not counting
 *   ("even if that hexside is part of a Blind hex"); the Hindrance is the larger of the two traces; SMOKE in the hex
 *   entered is ignored, only SMOKE the LOF crosses counts (A8.15 "if crossed by the LOF on the way to the target
 *   hexside").
 * - Area Fire (½ FP), no FFNAM/FFMO, no TEM of the hex entered (nor its fortification, a wreck or vehicle there); Height
 *   Advantage still applies (the A8.15 EX). Range is to the hex entered (C.5A), so PBF at an adjacent one.
 * - Inherent FP and MGs only: no ATR, FT, DC, ordnance or IFE; no vehicle MG that must turn (a CA change, A8.15, C.5B),
 *   none in SFF/FPF (a vehicular MG cannot use Sustained Fire, A9.3); none at a unit entering the firer's own hex.
 * - An ordinary Defensive First Fire attack otherwise: First/Final Fire markers, the per-Location MF limit, SFF and FPF
 *   rules. A Fire Group's Snap Shot is all Snap Shot (each firing Location traces to the hexside; one without LOS drops
 *   out, A6.11), and Snap Shots form a Mandatory Fire Group only with each other (a different aiming point).
 * - One Snap Shot per firer at a unit crossing a hexside, even if it spends more than one MF to enter the hex (the record
 *   under `ext['asl.snap']`, cleared when the stack's move ends). No Residual FP (A8.223).
 * - Rubble in the hex entered or the hex left modifies the shot with its TEM when the LOF crosses one of that hex's
 *   hexsides or hexspines on its way to the target hexside (A8.15 "a wall/hedge/SMOKE/rubble hexside/spine of a hex being
 *   entered/exited"): the firer looks across the rubble (from above it, a half-level obstacle, B24.2) at the hexside.
 *   A Fire Group takes the kindest trace for the target, as with a Woods-Road (B13.31).
 * Not here: Fire Lane Snap Shots (A9.221, with Fire Lanes); wall/hedge hexside TEM (none on the boards); a stack
 * forced back by a concealed unit (A12.15, with concealment).
 */

/** The `ext` key of the firers that made a Snap Shot at the current crossing. */
export const SNAP = 'asl.snap';
interface SnapRecord {
  exp: string;
  fired: PieceId[];
}

/**
 * The hexside a Snap Shot at the stack moving in `target` is traced to (the hex entered, the hex it came from), or null:
 * only while its entry across that hexside is its latest expenditure.
 */
export function snapSide(env: QueryEnv, target: LocId): [HexId, HexId] | null {
  const ms = moveState(env);
  return ms?.hex && ms.from && !snapWhyNot(env, target) ? [ms.hex, ms.from] : null;
}

/** Why there is no Snap Shot at the moving stack in `target` now (see `snapSide`), or null when there is one. */
export function snapWhyNot(env: QueryEnv, target: LocId): string | null {
  const ms = moveState(env);
  if (!ms?.hex || ms.off || moveLoc(ms) !== target) return 'No Snap Shot: no stack is moving there (ASLRB A8.15)';
  if (!ms.from || ms.from === ms.hex) return 'No Snap Shot: the stack has crossed no hexside on its latest MF here (it took the stairs, or has not left its hex) (ASLRB A8.15)';
  // No Snap Shot at Infantry moving from one connecting trench to another (ASLRB B27.54).
  if (ms.trenchMove) return 'No Snap Shot: the stack moved from one connecting trench to another (ASLRB B27.54)';
  const map = statics(env).map;
  if (!map.hex(ms.from)) return 'No Snap Shot at a unit entering from off the map: that hexside is on no board (ASLRB A8.15)';
  if (!map.hex(ms.hex) || sideToward(map, ms.hex, ms.from) === null) return 'No Snap Shot: no hexside between the hexes (ASLRB A8.15)';
  const last = ms.trail?.[ms.trail.length - 1];
  if (!last || last.hex !== ms.hex || last.mp !== ms.mfHere) return 'No Snap Shot: the stack has crossed no hexside on its latest MF here (a further MF in the hex, or round the same Bypass hex) (ASLRB A8.15)';
  return null;
}

/** The two corners (0–5 of the hex entered) of a Snap Shot's hexside. */
export function snapCorners(env: QueryEnv, snap: [HexId, HexId]): [number, number] | null {
  const k = sideToward(statics(env).map, snap[0], snap[1]);
  return k === null ? null : [k, mod6(k + 1)];
}

const NONE: LosTrace = { clear: true, hindrance: 0, parts: [] };

/** The LOS of a firing Location to the whole hexside (A8.15, B9.42): both corners clear; the larger Hindrance. */
function snapLos(env: QueryEnv, from: LocId, decl: Pick<FireDeclaration, 'target' | 'snap'>): LosTrace {
  const corners = snapCorners(env, decl.snap!);
  if (!corners) return { clear: false, hindrance: 0, parts: [], blockedBy: 'no such hexside' };
  const [a, b] = corners.map((vertex) => env.query('los.trace', { from, to: decl.target, toAt: { vertex }, noBlind: true, noTargetSmoke: true }, NONE)) as [LosTrace, LosTrace];
  if (a.clear && b.clear) return a.hindrance >= b.hindrance ? a : b;
  const blocked = a.clear ? b : a;
  const near = (a.clear || !!a.near) && (b.clear || !!b.near);
  const { near: _n, ...rest } = blocked;
  return { ...rest, clear: false, ...(near ? { near: true } : {}), blockedBy: `the ${decl.snap!.join('-')} hexside is not wholly in view (${blocked.blockedBy ?? 'blocked'})` };
}

/** The holder of a weapon, or the unit itself. */
const holderOf = (env: QueryEnv, id: PieceId) => {
  const l = pieceOf(env, id).loc;
  return l.kind === 'held' ? pieceOf(env, l.by) : pieceOf(env, id);
};

/** Why a Snap Shot declaration is not allowed (beyond the shared rules), or null. */
function snapIllegal(env: QueryEnv, decl: FireDeclaration, mode: string, moving: boolean): string | null {
  if (!moving || !(mode === 'first' || mode === 'subsequentFirst' || mode === 'fpf')) return 'A Snap Shot is Defensive First Fire at a moving stack (ASLRB A8.15)';
  if (decl.at) return 'A Snap Shot is traced to the hexside crossed, not to a corner (ASLRB A8.15)';
  const hex = hexOfLoc(decl.target);
  for (const id of [...decl.units, ...decl.sw]) {
    const h = holderOf(env, id);
    const at = h.loc.kind === 'hex' ? h.loc.hex : null;
    if (at === hex) return 'No Snap Shot at a unit entering your own hex (ASLRB A8.15)';
  }
  for (const id of decl.sw) {
    const p = pieceOf(env, id);
    const mg = vehicleMgOf(env, id);
    if (mg) {
      if (decl.tca !== undefined) return 'A MG that must change its Covered Arc cannot make a Snap Shot (ASLRB A8.15)';
      if (mode !== 'first') return 'A vehicle MG cannot use Sustained Fire, so it makes no Subsequent First Fire or FPF Snap Shot (ASLRB A9.3)';
      continue;
    }
    if (vehicleIfe(env, p)) return 'A weapon using IFE cannot make a Snap Shot (ASLRB A8.15, C2.29)';
    const w = weapon(env, p);
    const type = sw(env, p)?.type;
    if (!w || w.kind === 'gun' || !(type === 'LMG' || type === 'MMG' || type === 'HMG')) return `Only Small Arms and MGs can make a Snap Shot: not the ${type ?? 'Gun'} (ASLRB A8.15)`;
  }
  const rec = env.state.ext[SNAP] as SnapRecord | undefined;
  if (rec && rec.exp === expenditureKey(env)) {
    const again = [...decl.units, ...decl.sw].find((id) => rec.fired.includes(id));
    if (again) return `${again} has already made its Snap Shot at this hexside (ASLRB A8.15)`;
  }
  return null;
}

/** Height Advantage for a Snap Shot (A8.15 EX): every firing Location lower than the Location entered, but not up the
 * Crest Line the stack crossed toward the firers (B10.31); the TEM of the hex entered does not count here. */
function snapHeightAdvantage(env: QueryEnv, attack: { target: LocId; parts: { firer: PieceId }[]; moving?: { from?: HexId | null } }): boolean {
  const locs = [...new Set(attack.parts.map((p) => locOf(env.state, pieceOf(env, p.firer))).filter((l): l is LocId => !!l))];
  const lt = heightOf(env, attack.target);
  if (locs.length === 0 || !locs.every((l) => heightOf(env, l) < lt)) return false;
  const target = hexOfLoc(attack.target);
  const from = attack.moving?.from;
  if (from && levelOf(env, from) < levelOf(env, target) && locs.every((l) => entryHexside(env, target, hexOfLoc(l)) === from)) return false;
  return true;
}

/** Whether the LOF from `firer`'s hex centre to point `v` reaches it through hex `hex` (its interior or along one of its
 * hexsides/hexspines): just short of the vertex the line is inside that hex or on its edge. A hex is convex, so a line
 * that enters it anywhere is in it at the vertex too. */
function lofCrossesHex(env: QueryEnv, firer: HexId, hex: HexId, v: { x: number; y: number }): boolean {
  const map = statics(env).map;
  const f = map.hex(firer);
  const h = map.hex(hex);
  if (!f || !h || firer === hex) return false;
  const fc = hexPixel(f.cube);
  const len = Math.hypot(fc.x - v.x, fc.y - v.y);
  if (len < 1e-6) return false;
  const p = { x: v.x + ((fc.x - v.x) / len) * 1, y: v.y + ((fc.y - v.y) / len) * 1 };
  const pts = [0, 1, 2, 3, 4, 5].map((k) => cornerPoint(h.cube, k));
  // Corners run clockwise on the map (y down): inside or on the edge when every cross product is ≥ 0 (within a hair).
  return pts.every((a, i) => {
    const b = pts[(i + 1) % 6]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return cross >= -1e-3 * Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/** The rubble TEM a Snap Shot's LOF crosses on its way to the target hexside (A8.15, B24.3), or 0. */
export function snapRubbleTem(env: QueryEnv, attack: { snap?: [HexId, HexId]; parts: { firer: PieceId }[] }): number {
  const snap = attack.snap;
  if (!snap) return 0;
  const corners = snapCorners(env, snap);
  const entered = statics(env).map.hex(snap[0]);
  if (!corners || !entered) return 0;
  const vs = corners.map((k) => cornerPoint(entered.cube, k));
  const firers = [...new Set(attack.parts.map((p) => locOf(env.state, pieceOf(env, p.firer))).filter((l): l is LocId => !!l).map(hexOfLoc))];
  let best = 0;
  for (const hex of snap) {
    const t = terrainOf(env, hex);
    if (!t.id.startsWith('rubble-')) continue;
    if (firers.some((f) => vs.some((v) => lofCrossesHex(env, f, hex, v)))) best = Math.max(best, t.tem);
  }
  return best;
}

export const aslSnapShotModule: RuleModule = {
  id: 'asl.snapShot',
  ref: 'ASLRB A8.15, A8.223, C.5',
  summary: 'Snap Shots: Defensive First Fire traced to the hexside the moving stack crossed, as Area Fire with no TEM, FFNAM or FFMO.',
  requires: ['sk1.movement', 'sk1.fire', 'sk1.terrain', 'asl.los'],
  install(r) {
    r.event<{ exp: string; fired: PieceId[] } | { clear: true }>({
      type: 'asl.snap.fired',
      apply(d, p) {
        if ('clear' in p) {
          delete d.ext[SNAP];
          return;
        }
        const cur = d.ext[SNAP] as SnapRecord | undefined;
        d.ext[SNAP] = { exp: p.exp, fired: [...new Set([...(cur && cur.exp === p.exp ? cur.fired : []), ...p.fired])].sort() } satisfies SnapRecord;
      },
    });
    r.contribute({ id: 'asl.snap.side', query: 'fire.snapSide', ref: 'ASLRB A8.15', apply: (v, { target }, env) => v ?? snapSide(env, target) });
    r.contribute({
      id: 'asl.snap.los',
      query: 'fire.los',
      layer: 900,
      ref: 'ASLRB A8.15, B9.42',
      apply: (v, { from, decl }, env) => (decl.snap ? snapLos(env, from, decl) : v),
    });
    r.contribute({
      id: 'asl.snap.legal',
      query: 'fire.illegal',
      layer: 50,
      ref: 'ASLRB A8.15',
      apply: (v, { decl, mode, moving }, env) => v ?? (decl.snap ? snapIllegal(env, decl, mode, !!moving) : null),
    });
    r.contribute({ id: 'asl.snap.no-residual', query: 'fire.leavesResidual', ref: 'ASLRB A8.223', apply: (v, { attack }) => v && !attack.snap });
    r.contribute({
      id: 'asl.snap.area-fire',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A8.15',
      label: '½ Snap Shot (Area Fire)',
      when: ({ attack }) => !!attack.snap,
      apply: (v) => v / 2,
    });
    // No FFNAM/FFMO, and no TEM of most terrain in the hex entered (A8.15, C.5C): every such DRM is switched off.
    for (const target of ['sk1.drm.ffnam', 'sk1.drm.ffmo', 'sk1.drm.woods-road', 'sk1.drm.tem', FORTIFIED_DRM, 'asl.bypass.ffmo', 'asl.bypass.height-advantage']) {
      r.suppress<'fire.drm'>({ id: `asl.snap.no.${target}`, query: 'fire.drm', target, ref: 'ASLRB A8.15', label: 'Snap Shot', when: ({ attack }) => !!attack.snap });
    }
    for (const target of ['sk1.drm.pinned-mover', 'sk2.drm.emplacement', 'sk3.drm.afv-cover', 'asl.bypass.unit', 'asl.bypass.pinned', 'sk2.drm.height-advantage']) {
      r.suppress<'fire.unitDrm'>({ id: `asl.snap.no.${target}`, query: 'fire.unitDrm', target, ref: 'ASLRB A8.15', label: 'Snap Shot', when: ({ attack }) => !!attack.snap });
    }
    r.contribute({
      id: 'asl.snap.height-advantage',
      query: 'fire.drm',
      ref: 'ASLRB A8.15 EX, B10.31',
      label: '+1 Height Advantage TEM',
      when: ({ attack }, env) => !!attack.snap && snapHeightAdvantage(env, attack),
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.snap.rubble',
      query: 'fire.drm',
      ref: 'ASLRB A8.15, B24.3',
      label: ({ attack }, env) => `+${snapRubbleTem(env, attack)} rubble TEM crossed (Snap Shot)`,
      when: ({ attack }, env) => !!attack.snap && snapRubbleTem(env, attack) > 0,
      apply: (v, { attack }, env) => v + snapRubbleTem(env, attack),
    });
    // ... though not for a vehicle whose crew takes the CE DRM (B10.31 "any other positive TEM or CE DRM").
    r.contribute({
      id: 'asl.snap.height-advantage.ce',
      query: 'fire.unitDrm',
      ref: 'ASLRB B10.31',
      label: '-1 no Height Advantage with a CE DRM',
      when: ({ attack, unit }, env) => !!attack.snap && snapHeightAdvantage(env, attack) && ceDrmApplies(env, attack, unit),
      apply: (v) => v - 1,
    });
    // Who has made a Snap Shot at this crossing (one each, A8.15); forgotten when the stack's move is over.
    for (const event of ['sk1.fire.attack', 'sk1.fire.noLos']) {
      r.on<{ attack: { parts: PieceId[]; snap?: [HexId, HexId] } }>({
        id: `asl.snap.record.${event}`,
        event,
        handler(ctx, ev) {
          const exp = expenditureKey(ctx);
          if (!ev.payload.attack.snap || !exp) return;
          ctx.emit('asl.snap.fired', { exp, fired: ev.payload.attack.parts });
        },
      });
    }
    r.on<{ state: unknown }>({
      id: 'asl.snap.clear',
      event: 'sk1.move.state',
      handler(ctx, ev) {
        if (ev.payload.state === null && ctx.state.ext[SNAP]) ctx.emit('asl.snap.fired', { clear: true });
      },
    });
  },
};
