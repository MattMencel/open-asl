import type { RuleModule } from '@asl/engine';
import { aslBypassModule } from './bypass';
import { aslFieldPromotionModule } from './fieldPromotion';
import { aslFireModule } from './fire';
import { aslFortifiedModule } from './fortified';
import { aslLeaderCreationModule } from './leaderCreation';
import { aslLevelsModule } from './levels';
import { aslLocationsModule } from './locations';
import { aslLosModule } from './los';
import { aslRandomSelectionModule } from './randomSelection';
import { aslRubbleModule } from './rubble';
import { aslSnapShotModule } from './snapShot';
import { aslSwRepairModule } from './swRepair';
import { aslTerrainModule } from './terrain';
import { aslTpbfModule } from './tpbf';
import { aslWindModule } from './wind';

export { aslBypassModule, bypassable, bypassCorners, plan as bypassPlan } from './bypass';
export { aslFieldPromotionModule } from './fieldPromotion';
export { aslFireModule, BLAZE_ESCAPE_DECISION, FIRE_EXT, FIRE_PROC, blazeAt, blazeLocations, burnable, clearanceDrm, clearers, directlyAttached, escapeDestinations, extinguishIllegal, fireAt, fireLocations, fireNumbers, fireState, fireView, flamesAt, forfeitControl, isAblaze, kindleIllegal, kindlers, kindlingDrm, laborTag, parseLabor, placeBlaze, placeFlame, removeFlames, spreadDrm, spreadTargets, type BlazeRecord, type FireLoc, type FireSource, type FlameRecord, type KindleAction, type KindleAttempt, type TryFlameFn, type TryFlameOpts } from './fire';
export { aslRubbleModule, RUBBLE_EXT, fallingRubble, isBuildingLoc, isRubbled, rubbleAt, rubbleLocation, rubbleState, rubbleView, rubbledHeights, type RubbleRecord } from './rubble';
export { aslWindModule, EC_DRM, EC_EXT, EC_NAME, WIND_EXT, WIND_NAME, applyChange, downwind, ecDrm, ecForDr, ecMonthDrm, ecState, gustDir, gustSmoke, hexsideForDr, windDirectionDrm, windOf, windOffset, type EcState, type WindState, type WindForce as AslWindForce } from './wind';
export { aslFortifiedModule, BREACH_SIDE_DECISION, breachIllegal, breachedToward, breaches, fortifiedEntryBarred, fortifiedView, heldBySquad, lofSides, type Breach } from './fortified';
export { FORTIFICATIONS_MODULE, FORT_EXT, concealmentTerrainAt, counterTerrainIllegal, defaultFortPlacement, entrenchmentAt, fortArea, fortCounters, fortHiddenAt, fortKindName, fortLocationsKnownTo, fortPlaceIllegal, fortPools, fortSetupIllegal, fortState, fortificationView, fortificationsAt, fortificationsModule, fortificationsParams, hipIllegal, isPillboxLoc, minefieldAt, pillboxAt, pillboxCaHexsides, pillboxKnownTo, pillboxLoc, removeFortification, revealFortification, roadblockExtension, roadblocks, seenByEnemy, shownCounter, wireAt, type FortKind, type FortPlaceAction, type FortPlacement, type FortRecord, type FortState, type FortificationsParams, type MineFactors, type PillboxFactors } from './fortifications';
export { aslLeaderCreationModule } from './leaderCreation';
export { aslLevelsModule, interiorBuildingHex } from './levels';
export { aslLocationsModule } from './locations';
export { aslLosModule } from './los';
export { aslRandomSelectionModule } from './randomSelection';
export { aslSnapShotModule, snapCorners, snapSide, SNAP } from './snapShot';
export { aslSwRepairModule } from './swRepair';
export { aslTerrainModule } from './terrain';
export { aslTpbfModule } from './tpbf';

/**
 * Full ASL (the ASL Rulebook, Chapter A first) on top of the Starter Kit modules.
 *
 * Both rulesets live on one code base. The SK rules are a less detailed version of the same rules,
 * so a full ASL game installs every SK module and then these, which extend, suppress or replace
 * the SK contributions: `r.contribute` adds a DRM, MF or FP term, `r.suppress` switches an SK
 * contribution off by id, a `ReplacementDef` replaces an event, and new procedures and actions are
 * added the same way. Nothing is duplicated.
 *
 * A fix that applies to both rulebooks (the SK text agrees with ASL or is silent) goes into the
 * shared SK module, citing both (`// SK4 5.3; ASLRB A18.11`). Only where the SK text explicitly
 * differs does the ASL reading go into a module here. Where SK legality is hard-coded, the step
 * that needs to change it first turns that spot into a query whose default is the SK answer.
 *
 * One module per topic; `packages/rules/docs/asl-chapter-a.md` tracks which rule is where.
 */
export const aslCoreModules: RuleModule[] = [aslLocationsModule, aslLevelsModule, aslLosModule, aslRandomSelectionModule, aslFieldPromotionModule, aslLeaderCreationModule, aslSwRepairModule, aslTerrainModule, aslBypassModule, aslSnapShotModule, aslTpbfModule, aslFortifiedModule, aslWindModule, aslFireModule, aslRubbleModule];
