import type { Action, Ctx, Decision, HexId, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { adjacentLocs, hexOfLoc, isGroundLoc, locKey, type LocId } from '../common/location';
import { acrossSide, cornerHexes, mod6 } from '../common/hexCorners';
import { hexPixel } from '../common/map';
import { byId, otherSide, personnelAt, statics } from '../common/pieces';
import { PHASE_DECISION, askPhaseOwner } from '../common/turn';
import { AP, type AdvanceEnterFn } from '../sk1/advance';
import { FP, iftColumn, type ApplyResultFn, type AttackResolvedFn, type FireAttackCtx } from '../sk1/fire';
import { FPP, type ResolveDcFn } from '../sk1/firePhases';
import { fortifiedKnownTo, fortifiedState, isFortified, revealFortified } from '../sk1/fortified';
import { knownEnemyAt } from '../sk1/known';
import { P as MP, type FlushFn } from '../sk1/morale';
import { MOVE_ENTER, moveInternals, moveLoc, moveState, type MoveEnterFn, type MoveState } from '../sk1/movement';
import { drmNotes, gun, isGoodOrder, isPinned, mmc, pieceOf, setTags, squadEquivalents, sw } from '../sk1/status';
import { revealHex } from '../sk2/hip';
import { T4 } from '../sk4/status';

/*
 * Fortified Building Locations in full ASL (ASLRB B23.9), beyond the shared designation and +1 TEM of
 * `sk1/fortified.ts`:
 *
 * - B23.922 ENTRY: Infantry may not enter a Fortified Building Location, in any phase, while an unpinned, Good Order,
 *   armed enemy squad (or its equivalent) is inside, unless through a Breach. A unit that attempts to loses that MPh
 *   (its MF are spent in its present hex, where it may be fired on, and its move is over) or APh (it stays put, its
 *   advance used up). The attempt reveals the Location (B23.911) and anything hidden inside (A12.15 applies "even
 *   though the Fortified Location cannot be entered"). A Location whose fortification the moving side has already
 *   seen is refused up front, with the reason; one it has not seen is never refused by legality, so that no refusal
 *   leaks the secret to a client that validates on its own, redacted view: the attempt is resolved and refused.
 * - B23.9221 BREACH: unpinned Good Order Infantry with a DC may Place it against a hexside of a known Fortified
 *   Location for one MF (B23.711), declaring the hexside (the one toward its own hex, at its own level). In the AFPh
 *   one DR resolves the DC against the hexside (30 FP, the Location's TEM with the fortification's +1, CX) and, as
 *   Area Fire with the same DR, against the units inside (the A23.3 example). A NMC or better Breaches the hexside;
 *   an Original 12 (10 captured) does neither. A hexside is also Breached by the line of fire of a HE attack whose
 *   Final IFT DR is a KIA (ordnance and on-board mortar HE; the firer chooses one of the two hexsides along a
 *   hexspine). A Breach lasts the game and lets either side through that hexside at that level; every other
 *   benefit of the fortification remains. A plain DC may still be Placed on a Fortified Location at the building's
 *   entry cost, whether or not the placer could enter it.
 * - B23.93 GUNS: any Gun may set up in a fortified ground Location; ART/AT/INF Guns of at most 76mm may set up at a
 *   fortified upper level of a stone multi-level building, and never move from it; no Gun may be moved into a
 *   Fortified Building Location during play. A mortar there has no Indirect Fire, which the shared rule that a
 *   mortar may not fire from a building already covers.
 * - Not here: B23.94 (a Flame in a fortified Location, -1 DRM: with Fire and Kindling), the reveal by Searching,
 *   Mopping Up and Snipers (A12.152, A12.153, A14.21: with those rules), a berserk unit's charge (A15.43), and the
 *   TEM of rubble from a fortified building (B24.3: with Rubble).
 */

declare module '@asl/engine' {
  interface QueryCatalog {
    /** The Breach records in play (B23.9221). */
    'fortified.breaches': { ctx: Record<string, never>; value: Breach[] };
  }
}

/** A breached hexside: of `loc`, toward the adjacent hex `toward` (at `loc`'s level). */
export interface Breach {
  loc: LocId;
  toward: HexId;
  by: 'dc' | 'he';
}

const EXT = 'asl.breach';
/** A hexspine Breach choice waiting for the firing action to finish (its decision goes on top of whatever it asks next). */
const PENDING = 'asl.breach.pending';
export const BREACH_SIDE_DECISION = 'breachSide';

export const breaches = (env: QueryEnv): Breach[] => (env.state.ext[EXT] as Breach[] | undefined) ?? [];

/** Whether the hexside between `loc` and the adjacent hex `from` has been Breached. */
export const breachedToward = (env: QueryEnv, loc: LocId, from: HexId): boolean => breaches(env).some((b) => b.loc === loc && b.toward === from);

/** The hexes a stack would be entering `to` from: its own hex, or the two hexes at its Bypass corner (A4.3). */
function entryHexes(env: QueryEnv, ms: MoveState, to: LocId): HexId[] {
  if (ms.bypass && ms.bypass.hex === hexOfLoc(to)) return cornerHexes(statics(env).map, ms.bypass.hex, ms.bypass.at);
  return ms.hex ? [ms.hex] : [];
}

/** Unpinned, Good Order, armed enemy MMC in `loc` totalling at least a squad (B23.922 "a squad (or its equivalent)"). */
export function heldBySquad(env: QueryEnv, loc: LocId, side: SideId, knownOnly = false): boolean {
  const enemy = otherSide(env.state, side);
  const there = knownOnly ? knownEnemyAt(env, loc, side) : personnelAt(env, loc, enemy);
  const good = there.filter((p) => mmc(env, p) && isGoodOrder(env, p) && !isPinned(p));
  return squadEquivalents(env, good) >= 1;
}

/**
 * Why Infantry may not enter `loc` from `from` (B23.922), or null. `known`: judge only by what `side` has seen (for
 * legality), else by the real state (for the attempt).
 */
export function fortifiedEntryBarred(env: QueryEnv, loc: LocId, side: SideId, from: HexId[], known: boolean): string | null {
  if (known ? !fortifiedKnownTo(env, loc, side) : !isFortified(env, loc)) return null;
  if (!heldBySquad(env, loc, side, known)) return null;
  if (from.some((h) => breachedToward(env, loc, h))) return null;
  return 'A Fortified Building Location held by an unpinned Good Order enemy squad cannot be entered: Breach it, or pin, break or reduce them first (ASLRB B23.922)';
}

/**
 * The hexside(s) of `target` the line of fire from `from` crosses: one, or the two either side of a corner when the
 * line runs along a hexspine (B23.9221: the firer chooses). Hexside k runs from corner k to corner k + 1, corners
 * clockwise from the east; a corner lies at 60k degrees from the hex centre (y down).
 */
export function lofSides(target: HexId, from: HexId, map: { hex(id: HexId): { cube: { q: number; r: number; s: number } } | undefined }): number[] {
  const a = map.hex(target);
  const b = map.hex(from);
  if (!a || !b) return [];
  const pa = hexPixel(a.cube);
  const pb = hexPixel(b.cube);
  let deg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const k = Math.round(deg / 60);
  if (Math.abs(deg - k * 60) < 0.5) return [mod6(k - 1), mod6(k)];
  return [Math.floor(deg / 60) % 6];
}

export const aslFortifiedModule: RuleModule = {
  id: 'asl.fortified',
  ref: 'ASLRB B23.9, B23.911, B23.922, B23.9221, B23.711, B23.93',
  summary: 'Fortified Building Locations: no entry while an enemy squad holds one, Breach by DC or HE KIA, Guns in them.',
  requires: ['asl.locations', 'sk1.movement', 'sk1.advance', 'sk1.firePhases'],
  install(r) {
    r.event<{ breach: Breach }>({
      type: 'asl.breach',
      apply(d, p) {
        const list = (d.ext[EXT] as Breach[] | undefined) ?? [];
        if (!list.some((b) => b.loc === p.breach.loc && b.toward === p.breach.toward)) d.ext[EXT] = [...list, p.breach];
      },
    });
    r.event<{ dc: PieceId; placer: PieceId; loc: LocId; toward: HexId }>({ type: 'asl.breach.declared', apply() {} });
    r.event<{ dc: PieceId; loc: LocId; toward: HexId; dr: [number, number]; drm: number; result: string | null; breached: boolean; malfunctioned: boolean }>({ type: 'asl.breach.attempt', apply() {} });
    r.event<{ units: PieceId[]; loc: LocId; phase: 'MPh' | 'APh'; side: SideId; reason: 'held' | 'gun' }>({ type: 'asl.fortified.refused', apply() {} });
    r.contribute({ id: 'asl.fortified.breaches', query: 'fortified.breaches', layer: 0, apply: (_v, _c, env) => breaches(env) });

    // ---------------------------------------------------------------- B23.922: entry in the MPh
    // A Location the moving side knows is fortified: a Gun push is refused up front (B23.93). Infantry entering a held
    // Location is already refused by A4.14 when the occupants are Known; hidden occupants are found by the attempt.
    r.contribute({
      id: 'asl.fortified.gun-push',
      query: 'move.stepIllegal',
      ref: 'ASLRB B23.93',
      when: ({ ms, to }, env) => !!ms.manhandle && fortifiedKnownTo(env, to, env.state.attacker),
      apply: () => 'No Gun may be moved into a Fortified Building Location during play (ASLRB B23.93)',
    });
    r.procedure<MoveEnterFn>(MOVE_ENTER, (next) => (ctx, ms, to, cost, woods, extra) => {
      const side = ctx.state.attacker;
      // Going round the hex in Bypass is not entering it (A4.3); a vehicle is not Infantry (B23.41 governs it).
      if (extra?.bypass || ms.vehicle || !fortifiedState(ctx) || !isFortified(ctx, to)) return next?.(ctx, ms, to, cost, woods, extra);
      const gunPush = !!ms.manhandle;
      const barred = gunPush || fortifiedEntryBarred(ctx, to, side, entryHexes(ctx, ms, to), false) !== null;
      if (!barred) return next?.(ctx, ms, to, cost, woods, extra);
      // The attempt reveals the Location (B23.911) and what hides in it (A12.15); the MF are spent in the present
      // hex, where Residual FP, Defensive First Fire, SFF and FPF may attack the stack, and then its MPh is over.
      revealFortified(ctx, to, 'attempt');
      revealHex(ctx, hexOfLoc(to), side, 'entered');
      ctx.emit('asl.fortified.refused', { units: ms.units, loc: to, phase: 'MPh', side, reason: gunPush ? 'gun' : 'held' });
      moveInternals.spendInPlace(ctx, moveState(ctx) ?? ms, cost, { halted: true, residualDrmHere: null });
      moveInternals.afterMfExpenditure(ctx);
      const after = moveState(ctx);
      if (after && ctx.state.decisions[ctx.state.decisions.length - 1]?.kind !== 'firstFire') {
        moveInternals.finishStack(ctx);
        moveInternals.reAskMover(ctx);
      }
    });

    // ---------------------------------------------------------------- B23.922: entry in the APh
    r.contribute({
      id: 'asl.fortified.advance',
      query: 'advance.illegal',
      ref: 'ASLRB B23.922',
      when: ({ units, to, side }, env) => {
        const from = units.map((u) => env.state.pieces[u]).filter((p) => p?.loc.kind === 'hex').map((p) => (p!.loc as { hex: HexId }).hex);
        return !!fortifiedState(env) && fortifiedEntryBarred(env, to, side, [...new Set(from)], true) !== null;
      },
      apply: (_v, { units, to, side }, env) => {
        const from = units.map((u) => env.state.pieces[u]).filter((p) => p?.loc.kind === 'hex').map((p) => (p!.loc as { hex: HexId }).hex);
        return fortifiedEntryBarred(env, to, side, [...new Set(from)], true);
      },
    });
    r.procedure<AdvanceEnterFn>(AP.enter, (next) => (ctx, a) => {
      const map = statics(ctx).map;
      if (!fortifiedState(ctx) || !map.hex(hexOfLoc(a.to)) || !isFortified(ctx, a.to)) return next?.(ctx, a);
      const from = [...new Set(a.units.map((u) => pieceOf(ctx, u)).filter((p) => p.loc.kind === 'hex').map((p) => (p.loc as { hex: HexId }).hex))];
      if (fortifiedEntryBarred(ctx, a.to, a.side, from, false) === null) return next?.(ctx, a);
      // "loses that APh capability for that turn and must remain in its present hex": every unit of the attempt.
      revealFortified(ctx, a.to, 'attempt');
      revealHex(ctx, hexOfLoc(a.to), a.side, 'advanced');
      ctx.emit('asl.fortified.refused', { units: [...a.units].sort(), loc: a.to, phase: 'APh', side: a.side, reason: 'held' });
      for (const id of [...a.units].sort()) setTags(ctx, id, { advanced: true });
      ctx.popDecision();
      askPhaseOwner(ctx, ctx.state.attacker);
    });

    // ---------------------------------------------------------------- B23.9221: a Breach attempt with a DC
    r.action<Action & { type: 'move.breach'; dc: PieceId; target: LocId }>({
      type: 'move.breach',
      decisionKinds: [PHASE_DECISION],
      legal(env) {
        const ms = moveState(env);
        if (!ms || !ms.hex || ms.bypass || ms.dcPending || !fortifiedState(env)) return [];
        const out: { type: 'move.breach'; dc: PieceId; target: LocId }[] = [];
        for (const u of ms.units) {
          for (const dc of Object.values(env.state.pieces).filter((p) => p.loc.kind === 'held' && p.loc.by === u && sw(env, p)?.type === 'DC').sort(byId)) {
            for (const target of adjacentLocs(env, moveLoc(ms)!)) {
              if (!breachIllegal(env, ms, dc.id, target)) out.push({ type: 'move.breach', dc: dc.id, target });
            }
          }
        }
        return out;
      },
      validate(env, a) {
        const ms = moveState(env);
        if (!ms || !ms.hex) return 'No stack is moving on the map';
        return breachIllegal(env, ms, a.dc, a.target);
      },
      resolve(ctx, a) {
        const ms = moveState(ctx)!;
        const placer = (pieceOf(ctx, a.dc).loc as { by: PieceId }).by;
        // Declaring a Breach attempt names the Location as fortified for everyone.
        revealFortified(ctx, a.target, 'attempt');
        ctx.emit('asl.breach.declared', { dc: a.dc, placer, loc: a.target, toward: ms.hex! });
        // One MF, spent in the placer's hex (B23.711; the DC is operably Placed once the stack has survived the fire there).
        moveInternals.spendInPlace(ctx, ms, 1, { dcPending: { dc: a.dc, placer, target: a.target, breach: ms.hex! } });
        moveInternals.afterMfExpenditure(ctx);
      },
    });
    r.procedure<ResolveDcFn>(FPP.resolveDc, (next) => (ctx, dc) => {
      const toward = dc.tags['dcBreach'] as HexId | undefined;
      if (!toward) return next?.(ctx, dc);
      resolveBreachDc(ctx, dc, toward);
    });

    // ---------------------------------------------------------------- B23.9221: a Breach by a HE KIA
    r.procedure<AttackResolvedFn>(FP.attackResolved, (next) => (ctx, info) => {
      next?.(ctx, info);
      if (info.by !== 'he' || info.result !== 'KIA' || !info.from || !info.side || !fortifiedState(ctx) || !isFortified(ctx, info.target)) return;
      const map = statics(ctx).map;
      const target = hexOfLoc(info.target);
      const sides = lofSides(target, info.from, map);
      const options = sides.map((k) => acrossSide(map, target, k)).filter((h): h is HexId => !!h && !!map.hex(h) && !breachedToward(ctx, info.target, h));
      if (options.length === 0) return;
      if (options.length === 1) {
        ctx.emit('asl.breach', { breach: { loc: info.target, toward: options[0]!, by: 'he' } });
        return;
      }
      // Along a hexspine: the firer chooses which of the two hexsides at that corner is Breached. The choice is asked once
      // the firing action has put its next decision up (it pops and re-asks its own when the shot is over), so that the
      // question sits on top.
      ctx.emit('asl.breach.pending', { pending: { loc: info.target, options, owner: info.side } });
    });
    r.event<{ pending: { loc: LocId; options: HexId[]; owner: SideId } | null }>({
      type: 'asl.breach.pending',
      apply(d, p) {
        if (p.pending) d.ext[PENDING] = p.pending;
        else delete d.ext[PENDING];
      },
    });
    r.on<{ decision: Decision }>({
      id: 'asl.breach.ask',
      event: 'decision.pushed',
      handler(ctx, ev) {
        const pending = ctx.state.ext[PENDING] as { loc: LocId; options: HexId[]; owner: SideId } | undefined;
        if (!pending || ev.payload.decision.kind === BREACH_SIDE_DECISION) return;
        ctx.emit('asl.breach.pending', { pending: null });
        ctx.pushDecision({ kind: BREACH_SIDE_DECISION, owner: pending.owner, deadlineClass: 'interrupt', data: { loc: pending.loc, options: pending.options } });
      },
    });
    r.action<Action & { type: 'breach.choose'; toward: HexId }>({
      type: 'breach.choose',
      decisionKinds: [BREACH_SIDE_DECISION],
      legal(_env, d) {
        return ((d.data?.['options'] as HexId[] | undefined) ?? []).map((toward) => ({ type: 'breach.choose', toward }));
      },
      validate: (_env, a, d) => (((d.data?.['options'] as HexId[] | undefined) ?? []).includes(a.toward) ? null : 'Not one of the hexsides the line of fire crossed'),
      resolve(ctx, a, d: Decision) {
        ctx.emit('asl.breach', { breach: { loc: d.data!['loc'] as LocId, toward: a.toward, by: 'he' } });
        ctx.popDecision(d.id);
      },
    });

    // ---------------------------------------------------------------- B23.93: Guns
    r.contribute({
      id: 'asl.fortified.gun-setup',
      query: 'gun.setupIllegal',
      layer: 100,
      ref: 'ASLRB B23.93',
      apply(v, { gun: id, loc }, env) {
        if (!v || !fortifiedState(env) || !isFortified(env, loc)) return v;
        if (isGroundLoc(loc)) return null;
        // An upper level: ART/AT/INF Guns of at most 76mm, in a stone multi-level building.
        const d = gun(env, pieceOf(env, id))!;
        const hex = statics(env).map.hex(hexOfLoc(loc));
        const stone = hex?.terrain === 'building-stone';
        return (d.type === 'ART' || d.type === 'AT' || d.type === 'INF') && d.caliber <= 76 && stone ? null : `${id}: only an ART/AT/INF Gun of at most 76mm may set up in the fortified upper level of a stone building (ASLRB B23.93)`;
      },
    });
    r.contribute({
      id: 'asl.fortified.gun-fixed',
      query: 'move.cannotStart',
      ref: 'ASLRB B23.93',
      apply(v, { units }, env) {
        if (v) return v;
        for (const u of units) {
          const g = Object.values(env.state.pieces).find((p) => p.loc.kind === 'held' && p.loc.by === u && gun(env, p));
          const at = g ? pieceOf(env, u).loc : null;
          if (g && at?.kind === 'hex' && at.level) return `${g.id} was set up in a fortified upper level and cannot be moved from it (ASLRB B23.93)`;
        }
        return null;
      },
    });
  },
};

/** Why a Breach attempt is illegal (B23.711, B23.9221, A23.3), or null. */
export function breachIllegal(env: QueryEnv, ms: MoveState, dcId: PieceId, target: LocId): string | null {
  const dc = env.state.pieces[dcId];
  if (!dc || dc.loc.kind !== 'held' || !ms.units.includes(dc.loc.by) || sw(env, dc)?.type !== 'DC') return 'No DC carried by the moving stack';
  if (ms.bypass) return 'A Breach attempt is made from a hex, not from Bypass';
  const placer = pieceOf(env, dc.loc.by);
  if (!isGoodOrder(env, placer) || isPinned(placer)) return 'Only unpinned Good Order Infantry may attempt a Breach (ASLRB B23.711)';
  if (ms.dcPending) return 'A DC placement is already in progress';
  if (hexOfLoc(target) === ms.hex) return 'A stairwell is not a hexside: a Breach is made from the next hex at the same level (ASLRB B23.9221)';
  if (!adjacentLocs(env, moveLoc(ms)!).includes(target)) return 'The hexside must be one of the placer’s own Location (ADJACENT, at the same level)';
  if (!fortifiedKnownTo(env, target, env.state.attacker)) return 'Only a Location known to be fortified can be Breached (ASLRB B23.9221)';
  if (breachedToward(env, target, ms.hex!)) return 'That hexside is already Breached';
  if (moveInternals.remaining(ms, dc.loc.by) < 1) return 'Not enough MF to place the DC (one MF)';
  return null;
}

/**
 * The AFPh resolution of a Breach DC (B23.711 via B23.9221, and the A23.3 example): one Original DR, resolved on the
 * DC's full column against the hexside (NMC or better Breaches it) and, as Area Fire, against the units in the
 * Location, both with the Location's TEM, the fortification's +1 and the placer's CX; no leadership. An Original
 * malfunction DR removes the DC without either.
 */
function resolveBreachDc(ctx: Ctx, dc: { id: PieceId; loc: { kind: string }; tags: Record<string, unknown> }, toward: HexId) {
  const loc = locKey(dc.loc as { kind: 'hex'; hex: HexId; level?: number });
  const d = sw(ctx, pieceOf(ctx, dc.id))!;
  const placer = dc.tags['dcPlacer'] as PieceId;
  const placerDef = ctx.state.pieces[placer] ? mmc(ctx, ctx.state.pieces[placer]!) : null;
  const x = (dc.tags['dcX'] as number | undefined) ?? (d.x ?? 12) - (placerDef && placerDef.quality !== 'E' ? 2 : 0);
  const enemy = otherSide(ctx.state, ctx.state.attacker);
  const targets = personnelAt(ctx, loc, enemy).map((p) => p.id).sort();
  const attack: FireAttackCtx = { mode: 'advancing', side: ctx.state.attacker, target: loc, parts: [], targets, hindrance: 0, residual: true };
  // The Location is known fortified (a Breach is only declared against one), so nothing here is secret.
  const extraRes = ctx.explain('dc.drm', { target: loc }, 0);
  const tem = ctx.query('hex.tem', { hex: loc }, 0);
  const drm = tem + (dc.tags['dcCx'] ? 1 : 0) + extraRes.value;
  const roll = ctx.roll(`Breach attempt on ${loc}`);
  const column = iftColumn(ctx, d.fp);
  const detonated = roll.total < x && column !== null;
  const wall = detonated ? statics(ctx).tables.ift(column!, roll.total + drm) : null;
  const breached = !!wall && wall.kind !== 'none' && wall.kind !== 'PTC';
  ctx.emit('sk1.fire.attack', {
    attack: { mode: 'advancing', target: loc, parts: [dc.id] },
    fp: d.fp,
    column,
    dr: roll.dice as [number, number],
    drm,
    cowered: false,
    explain: [
      { id: 'asl.breach', label: `Breach attempt: DC ${d.fp} FP vs the hexside toward ${toward}` },
      ...(tem ? [{ id: 'sk1.drm.tem', label: `+${tem} TEM` }] : []),
      ...(dc.tags['dcCx'] ? [{ id: 'sk1.drm.cx', label: '+1 CX' }] : []),
      ...drmNotes(extraRes),
    ],
  });
  ctx.emit('asl.breach.attempt', { dc: dc.id, loc, toward, dr: roll.dice as [number, number], drm, result: wall?.kind ?? null, breached, malfunctioned: !detonated });
  if (breached) ctx.emit('asl.breach', { breach: { loc, toward, by: 'dc' } });
  // The same DR attacks the units inside as Area Fire (halved again if they were concealed when the DC was Placed).
  if (detonated && targets.length) {
    const fp = d.fp / 2 / (dc.tags[T4.dcVsConcealed] ? 2 : 1);
    const half = iftColumn(ctx, fp);
    ctx.emit('sk1.fire.attack', {
      attack: { mode: 'advancing', target: loc, parts: [dc.id] },
      fp,
      column: half,
      dr: roll.dice as [number, number],
      drm,
      cowered: false,
      explain: [{ id: 'asl.breach.area', label: `Area Fire at the units: ${fp} FP (the same DR)` }],
    });
    if (half !== null) {
      ctx.proc<ApplyResultFn>(FP.applyResult)(ctx, attack, half, roll.total + drm, {});
      ctx.proc<FlushFn>(MP.flushLeaderLoss)(ctx);
    }
  }
  ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, { target: loc, by: 'dc', result: wall?.kind ?? null, malfunctioned: !detonated });
  ctx.emit('piece.eliminated', { id: dc.id, reason: detonated ? 'DC detonated' : 'DC malfunctioned' });
}

/** The fortified Locations and Breaches a viewer may know of, for the board. */
export function fortifiedView(env: QueryEnv, viewer: SideId | null): { loc: LocId; breached: HexId[] }[] {
  const st = fortifiedState(env);
  if (!st) return [];
  const out: { loc: LocId; breached: HexId[] }[] = [];
  const seen = new Set<LocId>();
  for (const loc of st.locations ?? []) {
    if (!fortifiedKnownTo(env, loc, viewer) || seen.has(loc)) continue;
    seen.add(loc);
    out.push({ loc, breached: breaches(env).filter((b) => b.loc === loc).map((b) => b.toward) });
  }
  return out;
}
