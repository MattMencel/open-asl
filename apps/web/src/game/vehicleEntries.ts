/**
 * Wording of the fire-phase wheel entries for turning a Covered Arc and for a vehicle's smoke dispenser, where the
 * label itself has to carry the rule's consequence.
 */

/**
 * The entry that turns a hull, turret or Gun at the end of a fire phase without firing. "A Gun may also change its
 * CA without firing at the end of a friendly fire phase (not MPh) but only if it can fire without using Intensive
 * Fire ...; both the Gun and its manning Infantry then cannot move that Player Turn" (SK4 3.2.4; for vehicles SK4
 * 3.3.2): the turn takes the place of its fire, so the label says so and it is not taken for a way to turn and shoot.
 */
export function turnWithoutFiringLabel(what: string): string {
  return `${what} without firing (ends its fire)…`;
}

/**
 * Where to go to turn and fire: a shot at a target outside the Covered Arc turns the weapon as part of the shot,
 * with the CA-change To Hit DRM (SK4 3.2.4, Case 8). `fireEntry` is the label of the weapon's Fire entry, or null
 * when it cannot fire now (then there is nothing to point to).
 */
export function turnAndFireHint(fireEntry: string | null): string {
  return fireEntry
    ? ` To turn and fire, choose "${fireEntry}" and click the target outside the arc: the shot turns it first (+To Hit DRM for the change, SK4 3.2.4).`
    : '';
}

/**
 * Why a smoke dispenser is not offered in a fire phase. An AFV "may attempt to dispense smoke once per Player Turn in
 * the MPh but only if ... the AFV has not yet fired any weapon ... during that Player Turn"; in the opponent's MPh
 * the attempt is made "as if it were intervening with Defensive First Fire" (SK4 7.5).
 */
export const SMOKE_DISPENSER_MPH_ONLY =
  "Only in the Movement Phase (SK4 7.5): in your own as the AFV moves (1 MP), or in the enemy's after a move in its LOS, as Defensive First Fire; never once the AFV has fired that Player Turn";
