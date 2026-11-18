import type { RuleModule } from '@asl/engine';
import { gun, mmc } from '../sk1/status';

/**
 * ASLRB A9.72: "Any Good Order unit may attempt to repair as many of its malfunctioned SW during any RPh as it can
 * fire in one phase, by making a dr for each": a squad two, any other unit one.
 *
 * The SK text (SK1/SK4 3.1) allows "each unit ... only one action per RPh", so one repair attempt (`sk1/rally.ts`).
 * Either way each SW gets one dr per Player Turn.
 *
 * A9.72 also: "Only a crew (not a Temporary Crew) can attempt to repair a Gun, and not while hooked up." The Starter
 * Kit lets any Good Order unit possessing a weapon of its own nationality repair it (SK4 3.1c), so this is full ASL
 * only. No Gun can be hooked up yet (no towing), so only the crew condition applies.
 */
export const aslSwRepairModule: RuleModule = {
  id: 'asl.swRepair',
  ref: 'ASLRB A9.72',
  summary: 'SW repair: a unit may try to repair as many SW as it could fire, a squad two; only a crew repairs a Gun.',
  requires: ['sk1.rally'],
  install(r) {
    r.contribute({
      id: 'asl.swRepair.squad',
      query: 'rally.repairs',
      ref: 'ASLRB A9.72',
      apply: (v, { unit }, env) => (mmc(env, env.state.pieces[unit]!)?.kind === 'squad' ? Math.max(v, 2) : v),
    });
    r.contribute({
      id: 'asl.swRepair.gunCrew',
      query: 'sw.repairIllegal',
      ref: 'ASLRB A9.72',
      apply(v, { unit, sw }, env) {
        if (v) return v;
        const u = env.state.pieces[unit];
        const w = env.state.pieces[sw];
        if (!u || !w || !gun(env, w)) return null;
        return mmc(env, u)?.kind === 'crew' ? null : 'Only a crew (not a Temporary Crew) can attempt to repair a Gun (ASLRB A9.72)';
      },
    });
  },
};
