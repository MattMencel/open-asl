import type { HexId, QueryEnv, SideId } from '@asl/engine';
import { otherSide, personnelInHex, statics } from './pieces';
import type { VictoryCondition } from './statics';
import {
  achieved,
  atEndOfPhase,
  atEndOfTurn,
  casualtyVp,
  controlState,
  cvpGoal,
  exitedPieces,
  exitHexesEver,
  exitVp,
  infantryCount,
  isImmediate,
  mmcLost,
  squadEquivalentsInArea,
  vehicleExitVp,
} from '../sk1/scenario';
import { isBroken, isGoodOrder, mmc, smc } from '../sk1/status';
import { clearAreasTally, squadEquivalentsLost } from '../sk1/clearAreas';
import { areaVp } from '../sk1/areaVp';
import { losFirepower } from '../sk1/losFirepower';
import { vpTally } from '../sk1/vpTally';
import { victoryGuns } from '../sk2/guns';
import { gunHex } from '../sk2/status';
import { afvLeadTally, afvMobile } from '../sk3/scenario';

/** A count in the condition's own units; strict inequalities retain their boundary. */
export interface VictoryMetric {
  id: string;
  /** The ordinary predicate, or the separate tally used for an immediate mid-game check. */
  scope: 'condition' | 'immediate';
  current: number;
  /** Null until a scenario's variable threshold is revealed. */
  required: number | null;
  comparison: '>=' | '>' | '<=' | '<';
  unit: 'targets' | 'units' | 'leaders' | 'hs' | 'se' | 'vp' | 'fp' | 'afv' | 'groups';
}

/** A location contributing to a condition, with its exact current ownership or occupants. */
export interface VictoryTarget {
  id: string;
  hexes: HexId[];
  owner: SideId | null;
  units: string[];
  value: number;
}

/**
 * Read-only observation of a condition. `achieved` is the rules' current predicate, not a
 * prediction and not permission to end the game before its checkpoint. The original condition
 * retains eligibility restrictions, source weights, and composition for consumers.
 */
export interface VictoryObservation {
  id: string;
  condition: VictoryCondition;
  side: SideId;
  achieved: boolean;
  timing: { immediate: boolean; turn: number | null; phase: string | null };
  metrics: VictoryMetric[];
  targets: VictoryTarget[];
  children: VictoryObservation[];
}

/** Observe every condition in card order. Unknown custom conditions require an explicit adapter. */
export function observeVictory(env: QueryEnv): VictoryObservation[] {
  return statics(env).scenario.victory.map((vc, i) => observeCondition(env, vc, `${i}`));
}

export function observeCondition(
  env: QueryEnv,
  vc: VictoryCondition,
  id = '0',
): VictoryObservation {
  const { map, scenario } = statics(env);
  const pieces = Object.values(env.state.pieces);
  const enemy = otherSide(env.state, vc.side);
  const ctl = controlState(env);
  const o: VictoryObservation = {
    id,
    condition: vc,
    side: vc.side,
    achieved: achieved(env, vc),
    timing: {
      immediate: isImmediate(vc),
      turn: atEndOfTurn(vc) ?? null,
      phase: atEndOfPhase(vc) ?? null,
    },
    metrics: [],
    targets: [],
    children: [],
  };
  const metric = (
    key: string,
    current: number,
    required: number,
    unit: VictoryMetric['unit'],
    comparison: VictoryMetric['comparison'] = '>=',
    scope: VictoryMetric['scope'] = 'condition',
  ) =>
    o.metrics.push({
      id: key,
      scope,
      current,
      required: Number.isFinite(required) ? required : null,
      unit,
      comparison,
    });
  const canonical = (hexes: HexId[]) => [...new Set(hexes.map((h) => map.hex(h)?.id ?? h))];
  const inside = (hexes: HexId[]) =>
    pieces.filter((p) => p.loc.kind === 'hex' && hexes.includes(p.loc.hex));
  const target = (
    key: string,
    hexes: HexId[],
    owner: SideId | null = null,
    value = 1,
    units?: string[],
  ) => {
    const hs = canonical(hexes);
    o.targets.push({
      id: key,
      hexes: hs,
      owner,
      value,
      units: units ?? inside(hs).map((p) => p.id),
    });
  };
  const buildingHexes = (b: string) =>
    [...map.hexes()].filter((h) => h.buildingId === b).map((h) => h.id);
  switch (vc.kind) {
    case 'all':
    case 'any':
      o.children = vc.of.map((c, i) => observeCondition(env, c, `${id}.${i}`));
      break;
    case 'controlBuildings': {
      const mine = vc.buildings.filter((b) => ctl.buildings[b] === vc.side).length;
      const theirs = vc.buildings.filter((b) => ctl.buildings[b] === enemy).length;
      const exited = exitedPieces(env, enemy).filter((p) => !!mmc(env, p)).length;
      // A relative majority replaces the exit adjustment in the authoritative predicate.
      metric(
        'controlled',
        mine,
        vc.atLeast + (vc.moreThanEnemy ? 0 : (vc.perEnemyExit ?? 0) * exited),
        'targets',
      );
      if (vc.moreThanEnemy) metric('majority', mine, theirs, 'targets', '>');
      for (const b of vc.buildings) target(`b:${b}`, buildingHexes(b), ctl.buildings[b] ?? null);
      break;
    }
    case 'controlHexes':
      metric(
        'controlled',
        vc.hexes.filter((h) => ctl.hexes[map.hex(h)?.id ?? h] === vc.side).length,
        vc.atLeast,
        'targets',
      );
      for (const h of canonical(vc.hexes)) target(h, [h], ctl.hexes[h] ?? null);
      break;
    case 'exitVp':
      metric('exited', exitVp(env, vc.side), vc.vp, 'vp');
      if (vc.afvVpAtLeast !== undefined)
        metric('exitedArmor', vehicleExitVp(env, vc.side), vc.afvVpAtLeast, 'vp');
      target('exit', vc.hexes?.length ? vc.hexes : map.edge(vc.edge));
      break;
    case 'exitForce': {
      const mine = infantryCount(env, exitedPieces(env, vc.side));
      const theirs = infantryCount(env, exitedPieces(env, enemy));
      metric(
        'exitedInfantry',
        mine.hs,
        vc.hsEquivalents + (vc.perEnemyHsExit ?? 0) * theirs.hs,
        'hs',
      );
      metric('exitedLeaders', mine.smc, vc.smc, 'leaders');
      target('exit', [...exitHexesEver(scenario, map, vc.side)]);
      break;
    }
    case 'noGoodOrderEnemyIn': {
      const bs = new Set(
        vc.buildings ? vc.hexes.map((h) => map.hex(h)?.buildingId).filter(Boolean) : [],
      );
      const area = canonical([
        ...vc.hexes,
        ...[...map.hexes()].filter((h) => h.buildingId && bs.has(h.buildingId)).map((h) => h.id),
      ]);
      const holders = inside(area).filter(
        (p) =>
          p.side !== vc.side &&
          (mmc(env, p) || (!vc.mmcOnly && smc(env, p))) &&
          (vc.allUnits || (vc.unbroken ? !isBroken(p) : isGoodOrder(env, p))),
      );
      metric('remainingEnemy', holders.length, vc.atMost ?? 0, 'units', '<=');
      target(
        'area',
        area,
        holders.length ? enemy : vc.side,
        1,
        holders.map((p) => p.id),
      );
      break;
    }
    case 'clearAreas': {
      const t = clearAreasTally(env, vc);
      metric('clear', t.clear, vc.atLeast, 'targets');
      for (const [i, a] of t.areas.entries())
        target(`area:${i}`, a.hexes, a.clear ? vc.side : enemy, 1, a.holders);
      break;
    }
    case 'eliminateCvp':
      metric('casualties', casualtyVp(env, enemy), cvpGoal(env, vc), 'vp');
      break;
    case 'cvpBelow':
      metric('casualties', casualtyVp(env, vc.side), vc.cvp, 'vp', '<');
      break;
    case 'fewerLosses':
      metric(
        'losses',
        squadEquivalentsLost(env, vc.side),
        squadEquivalentsLost(env, enemy),
        'se',
        '<',
      );
      break;
    case 'fewerMmcLost':
      metric('losses', mmcLost(env, vc.side).length, mmcLost(env, enemy).length, 'units', '<');
      break;
    case 'goodOrderVp': {
      const t = areaVp(env, vc);
      metric('present', t.total, vc.vp, 'vp');
      if (vc.leaders !== undefined)
        metric(
          'leaders',
          t.units.filter((u) => !!smc(env, env.state.pieces[u.unit]!)).length,
          vc.leaders,
          'leaders',
        );
      target(
        'area',
        vc.hexes,
        null,
        1,
        t.units.map((u) => u.unit),
      );
      break;
    }
    case 'squadEquivalentsIn':
      metric('present', squadEquivalentsInArea(env, vc).total, vc.atLeast, 'se');
      target('area', vc.hexes);
      break;
    case 'losFirepower':
      metric('firepower', losFirepower(env, vc).total, vc.fp, 'fp');
      target('area', vc.hexes);
      break;
    case 'vpTally': {
      metric('vp', vpTally(env, vc).total, vc.vp, 'vp');
      if (vc.immediate)
        metric(
          'immediateVp',
          vpTally(env, vc, { midGame: true }).total,
          vc.vp,
          'vp',
          '>=',
          'immediate',
        );
      for (const [i, s] of vc.sources.entries())
        if (s.kind === 'controlledHexes') {
          for (const h of canonical(s.hexes)) target(`${i}:${h}`, [h], ctl.hexes[h] ?? null, s.vp);
        }
      break;
    }
    case 'afvLead': {
      const t = afvLeadTally(env, vc);
      metric('lead', t.eliminated + t.exited, t.lost, 'afv', '>');
      if (vc.exitedCountAsEliminated)
        target(
          'exit',
          vc.exitedCountAsEliminated.hexes?.length
            ? vc.exitedCountAsEliminated.hexes
            : map.edge(vc.exitedCountAsEliminated.edge),
        );
      break;
    }
    case 'mobileAfv':
      metric('mobile', afvMobile(env, vc.side).length, vc.atLeast, 'afv');
      break;
    case 'gunsEliminatedOrCaptured':
    case 'occupyGunHexes': {
      const guns = victoryGuns(env, vc).filter(
        (p) => vc.kind !== 'occupyGunHexes' || (p.loc.kind !== 'eliminated' && p.side !== vc.side),
      );
      let done = 0;
      for (const g of guns) {
        const h = gunHex(env, g);
        const met =
          vc.kind === 'gunsEliminatedOrCaptured'
            ? g.loc.kind === 'eliminated' || (!vc.eliminatedOnly && g.side === vc.side)
            : !!h &&
              personnelInHex(env, h, vc.side).length > 0 &&
              personnelInHex(env, h, vc.of).length === 0;
        if (met) done++;
        target(g.id, h ? [h] : [], met ? vc.side : vc.of, 1, [g.id]);
      }
      metric('guns', done, guns.length, 'units');
      // With no qualifying Guns these predicates explicitly do not hold.
      metric('qualifyingGuns', guns.length, 0, 'units', '>');
      break;
    }
    case 'forcesInBuilding': {
      let best = 0;
      const buildings = [
        ...new Set([...map.hexes()].map((h) => h.buildingId).filter((b): b is string => !!b)),
      ];
      for (const b of buildings) {
        const hs = buildingHexes(b);
        const mine = inside(hs).filter((p) => p.side === vc.side && (mmc(env, p) || smc(env, p)));
        const forces = new Set(mine.map((p) => scenario.forces[p.tags['force'] as number]?.id));
        const n = vc.groups.filter((g) => g.forces.some((f) => forces.has(f))).length;
        best = Math.max(best, n);
        target(
          `b:${b}`,
          hs,
          null,
          n,
          mine.map((p) => p.id),
        );
      }
      metric('groupsTogether', best, vc.groups.length, 'groups');
      break;
    }
    case 'custom':
      throw new Error(`No victory observation adapter for custom module ${vc.module}`);
    default: {
      const exhaustive: never = vc;
      throw new Error(`Unknown victory condition ${String(exhaustive)}`);
    }
  }
  return o;
}
