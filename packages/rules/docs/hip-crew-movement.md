# Hidden gun crews leaving their weapons

Rule inventory: SK4 6.4, including its glossary entry and the emplacement/manhandling example
on pages 21–22; ASLRB A12.2, A12.3–12.34. SK4 explicitly ends a Gun's hidden status when
its crew moves. A12.32 also forbids moving or advancing while retaining HIP.

| Obligation | Implementation and coverage |
| --- | --- |
| Eligible Emplaced Guns and their crews may set up hidden; paved roads prohibit it. | Existing setup checks in `sk2/guns.ts` and `guns.test.ts`. |
| Open Ground discovery, fire, changing CA and attempted manhandling reveal the Gun. | Existing `sk2/hip.ts`, `sk2/guns.ts`, `sk2/manhandle.ts`; HIP and Gun tests. |
| A crew moving or advancing loses HIP, including after leaving its Gun. | Shared `sk2.hip.unit-moved` trigger; movement and advancing tests in `hip.test.ts`. The trigger also covers a routing crew. |
| A dropped hidden Gun loses HIP when its former crew moves. | `hipCrew` records the former possessor when the Gun is dropped. `revealUnit` reveals that Gun with the departing crew. The movement test retains another manned hidden Gun in the same Location. |
| Recovering or revealing the Gun clears the former-crew association. | The movement replacement clears `hipCrew` on recovery; `revealBase` clears it on reveal. Both transitions have regression tests. No new decision or turn-scoped marker is introduced. |
| Both players can target the complete defending group in CC. | An advancing crew with a leader is visible before CC; `hip.test.ts` compares the redacted and authoritative legal declarations and validates every offered declaration. |
| Enemy entry, the MPh bounce, routing into HIP and the advancing ambush retain their behavior. | Existing entry hooks and HIP/hidden-unit tests; this correction does not change their declaration rules. |
| Fire against HIP retains its Area Fire/To Hit and reveal-on-effect rules. | Existing fire hooks and HIP tests. |

The movement test continues through the next Player Turn and verifies that the hidden marker
does not return. The shared movement trigger replaces the identical SSR-only trigger, so ordinary
Gun crews receive the same visibility transition. Existing saved states with a stale hidden crew
are corrected when that crew next moves; no hidden information is supplied to an opposing client.

Replaying old action logs can diverge where the additional reveal changes decisions or event IDs.
Full ASL's transition from HIP to concealment under A12.32 remains outside this SK correction;
the existing hidden-unit movement behavior is retained for that ruleset. No player control is
added: the existing movement, advance, recovery and CC controls consume the corrected state.
