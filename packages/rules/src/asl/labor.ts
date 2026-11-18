import type { Piece, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { byId } from '../common/pieces';
import { locOf } from '../common/location';
import { pieceOf, setTags } from '../sk1/status';

/*
 * Temporarily Immobilized units and Labor Status (ASLRB A4.8, B24.8), shared by every task that earns them: Flame
 * clearance (B24.72), Entrenching (B27.11) and, later, Manhandling (C10.3).
 *
 * A4.8: TI "is incurred by Infantry engaged in various tasks requiring prolonged effort throughout the Player Turn"; the
 * counter "is removed at the end of its CCPh (or if the unit breaks)"; a TI unit "may not move, advance, fire, or perform
 * other labor tasks anytime during its Player Turn" and, in CC, adds +1 to any attack it takes part in (once per attack)
 * while every attack against it takes -1 (the -1 only when every unit attacked is TI, A4.8's example).
 *
 * B24.8: a unit that fails a Clearance, Entrenchment or Manhandling DR goes beneath a Labor (-1) counter; a second
 * failure of the same DR flips it to -2; it stays "until the Task is achieved or all MMC beneath it are eliminated or
 * removed from their current Location", and applies only to that Task. The tag is `labor: '<task>@<drm>'`, the task
 * naming its kind and Location (`flame:uK4`, `entrench:uO6`).
 */

export const laborTag = (task: string, drm: number) => `${task}@${drm}`;
export function parseLabor(v: unknown): { task: string; drm: number } | null {
  if (typeof v !== 'string') return null;
  const at = v.lastIndexOf('@');
  if (at < 0) return null;
  const drm = Number(v.slice(at + 1));
  return Number.isFinite(drm) ? { task: v.slice(0, at), drm } : null;
}
/** The Location a Labor task names (`flame:uK4` → `uK4`). */
export const laborLoc = (task: string) => task.replace(/^[a-z]+:/, '');

export const isTi = (p: Piece) => p.tags['ti'] === true;
export const tiUnits = (env: QueryEnv, ids: PieceId[]) => ids.filter((u) => env.state.pieces[u]?.tags['ti'] === true);

/** Why a unit may not take up a task now: TI this Player Turn (A4.8 "other labor tasks"), or null. */
export const tiIllegal = (p: Piece): string | null => (isTi(p) ? `${p.id} is TI this Player Turn (ASLRB A4.8)` : null);

export const aslLaborModule: RuleModule = {
  id: 'asl.labor',
  ref: 'ASLRB A4.8, B24.8',
  summary: 'Temporarily Immobilized units (no fire, movement or advance; CC +1/-1; off at the end of the CCPh or on a break) and Labor Status counters.',
  requires: ['sk1.movement', 'sk1.fire', 'sk1.advance', 'sk1.cc'],
  install(r) {
    // A4.8: a TI unit may not fire, move or advance during its Player Turn.
    r.contribute({
      id: 'asl.labor.tiNoFire',
      query: 'fire.illegal',
      ref: 'ASLRB A4.8',
      apply(v, { decl }, env) {
        if (v) return v;
        const holders = decl.sw.map((s) => env.state.pieces[s]?.loc).flatMap((l) => (l?.kind === 'held' ? [l.by] : []));
        const ti = tiUnits(env, [...decl.units, ...holders, ...(decl.directors ?? [])]);
        return ti.length ? `${ti[0]} is TI this Player Turn and may not fire (ASLRB A4.8)` : null;
      },
    });
    r.contribute({
      id: 'asl.labor.tiNoMove',
      query: 'move.cannotStart',
      ref: 'ASLRB A4.8',
      apply(v, { units }, env) {
        if (v) return v;
        const ti = tiUnits(env, units);
        return ti.length ? `${ti[0]} is TI this Player Turn and may not move (ASLRB A4.8)` : null;
      },
    });
    r.contribute({
      id: 'asl.labor.tiNoAdvance',
      query: 'unit.cannotAdvance',
      ref: 'ASLRB A4.8',
      when: ({ unit }, env) => env.state.pieces[unit]?.tags['ti'] === true,
      apply: () => 'is TI this Player Turn and may not advance (ASLRB A4.8)',
    });
    // A4.8: +1 to any CC attack a TI unit takes part in (limit one per attack); -1 to any CC attack made against it,
    // which "applies only to the TI units" of a group attacked together (A4.8 EX): a DRM per target. A TI attacker
    // against TI defenders nets 0.
    r.contribute({
      id: 'asl.labor.tiCc',
      query: 'cc.drm',
      ref: 'ASLRB A4.8',
      label: '+1 TI attacker',
      when: ({ attackers }, env) => tiUnits(env, attackers).length > 0,
      apply: (v) => v + 1,
    });
    r.contribute({
      id: 'asl.labor.tiCcTarget',
      query: 'cc.targetDrm',
      ref: 'ASLRB A4.8',
      label: '-1 TI defender',
      when: ({ target }, env) => env.state.pieces[target]?.tags['ti'] === true,
      apply: (v) => v - 1,
    });
    // The TI counter comes off at the end of the CCPh (A4.8).
    r.on<{ phase: string }>({
      id: 'asl.labor.ccphEnd',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        // The Flames fought this Player Turn (B24.72) are forgotten with it.
        for (const p of Object.values(ctx.state.pieces).sort(byId)) {
          if (p.tags['ti'] !== undefined || p.tags['flameClear'] !== undefined) setTags(ctx, p.id, { ...(p.tags['ti'] !== undefined ? { ti: null } : {}), ...(p.tags['flameClear'] !== undefined ? { flameClear: null } : {}) });
        }
      },
    });
    // ... "or if the unit breaks" (A4.8).
    r.on<{ id: PieceId; tags: Record<string, unknown> }>({
      id: 'asl.labor.tiBreak',
      event: 'piece.tagged',
      handler(ctx, ev) {
        if (ev.payload.tags['broken'] !== true) return;
        const p = ctx.state.pieces[ev.payload.id];
        if (p && p.tags['ti'] === true) setTags(ctx, p.id, { ti: null });
      },
    });
    // A Labor counter goes when its MMC leave the Location of the Task (B24.8).
    r.on<{ id: PieceId }>({
      id: 'asl.labor.left',
      event: 'piece.moved',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.id];
        const labor = p ? parseLabor(p.tags['labor']) : null;
        if (!p || !labor) return;
        if (p.loc.kind !== 'hex' || locOf(ctx.state, pieceOf(ctx, p.id)) !== laborLoc(labor.task)) setTags(ctx, p.id, { labor: null });
      },
    });
  },
};
