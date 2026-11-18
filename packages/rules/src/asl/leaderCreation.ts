import type { RuleModule } from '@asl/engine';
import { mmc, pieceOf, smc } from '../sk1/status';
import { createsNoLeader } from './fieldPromotion';

/**
 * ASLRB A18.2: when more than one type of MMC made the CC attack that created a leader, "the MMC with the highest
 * BPV involved is used to determine any Leader Creation drm". The SK text (SK1/SK4 5.3) says "use the best one", which
 * the SK rules read as the best Morale (`promotionBase` in `sk1/closeCombat.ts`), so this is ASL-only.
 *
 * A unit with no BPV on its counter def (none in the National Capabilities Chart) never outranks one with a BPV; when
 * no unit has one, or several share the highest, the SK choice stands among them (best Morale, then the first).
 *
 * A18.12: the created leader "must add his leadership to the Original 2 CC DR that created him (even if the modifier is
 * a +1)". The shared CC leadership takes only a negative DRM (the SK reading), so a positive one is added here.
 */
export const aslLeaderCreationModule: RuleModule = {
  id: 'asl.leaderCreation',
  ref: 'ASLRB A18.2, A18.12',
  summary: 'Leader Creation in CC is based on the attacking MMC with the highest BPV; the created leader\'s +1 applies to the DR that created him.',
  requires: ['sk1.cc'],
  install(r) {
    r.contribute({
      id: 'asl.leaderCreation.plusOne',
      query: 'cc.createdLeaderDrm',
      ref: 'ASLRB A18.12',
      apply(v, { leader, mmc: unit }, env) {
        const l = env.query('unit.leadership', { unit: leader, for: unit }, smc(env, pieceOf(env, leader))?.leadership ?? 0);
        return l > 0 ? v + l : v;
      },
    });
    r.contribute({
      id: 'asl.leaderCreation.highestBpv',
      query: 'cc.promotionBase',
      ref: 'ASLRB A18.2',
      apply: (v, { units: all }, env) => {
        // No leader is created from a Japanese or Finnish MMC (the table is NA to them): the others only.
        const units = all.filter((id) => !createsNoLeader(env, id));
        if (v && createsNoLeader(env, v)) v = null;
        if (units.length === 0) return null;
        const bpv = (id: string) => mmc(env, pieceOf(env, id))?.bpv ?? -1;
        const top = Math.max(...units.map(bpv));
        if (top < 0 || (v && bpv(v) === top)) return v ?? [...units].sort((a, b) => mmc(env, pieceOf(env, b))!.morale - mmc(env, pieceOf(env, a))!.morale)[0]!;
        const tied = units.filter((id) => bpv(id) === top);
        return [...tied].sort((a, b) => mmc(env, pieceOf(env, b))!.morale - mmc(env, pieceOf(env, a))!.morale)[0] ?? v;
      },
    });
  },
};
