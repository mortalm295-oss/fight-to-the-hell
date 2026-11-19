import { MAP_HALF, UNIT_CLASSES } from './constants';
import { getUnitCounterMultiplier } from './rules';
import {
  BRIDGE_CROSSINGS,
  clampToPlayableBounds,
  getRiverCenterZ,
  isBridgeFordAt,
  TACTICAL_HILLS,
} from './terrain';
import type { DifficultyLevel, FormationType, SquadState } from './types';

export interface AiSquadAction {
  targetX: number;
  targetZ: number;
  targetSquadId: string | null;
  formation: FormationType;
  isHoldPosition: boolean;
  shouldSplit?: boolean;
}

/**
 * Checks whether moving directly from (sx, sz) to (tx, tz) crosses the river away from a bridge.
 * If so, routes the squad through the nearest tactical bridge crossing first.
 */
export function findNearestBridgeCrossing(
  sx: number,
  sz: number,
  tx: number,
  tz: number,
): { x: number; z: number; viaBridge: boolean } {
  const sRiverZ = getRiverCenterZ(sx);
  const tRiverZ = getRiverCenterZ(tx);
  const startNorth = sz < sRiverZ - 2.0;
  const startSouth = sz > sRiverZ + 2.0;
  const endNorth = tz < tRiverZ - 2.0;
  const endSouth = tz > tRiverZ + 2.0;

  const needsRiverCrossing = (startNorth && endSouth) || (startSouth && endNorth);
  if (!needsRiverCrossing || isBridgeFordAt(sx, sz)) {
    return { x: tx, z: tz, viaBridge: false };
  }

  let bestBx: number = BRIDGE_CROSSINGS[1];
  let bestScore = Infinity;
  for (const bx of BRIDGE_CROSSINGS) {
    const bz = getRiverCenterZ(bx);
    const totalDist = Math.hypot(bx - sx, bz - sz) + Math.hypot(tx - bx, tz - bz);
    if (totalDist < bestScore) {
      bestScore = totalDist;
      bestBx = bx;
    }
  }

  const bridgeZ = getRiverCenterZ(bestBx);
  // Aim slightly past the bridge deck so the squad clears the river smoothly
  const exitOffsetZ = startNorth ? 4.8 : -4.8;
  const clamped = clampToPlayableBounds(bestBx, bridgeZ + exitOffsetZ);
  return { x: clamped.x, z: clamped.z, viaBridge: true };
}

/**
 * Picks the highest-value tactical hill within range for archers or scouts.
 */
export function findBestHighGroundHill(
  squad: SquadState,
  allies: SquadState[],
): { x: number; z: number } | null {
  if (allies.length === 0) return null;

  let bestHill: { x: number; z: number } | null = null;
  let bestScore = -Infinity;

  for (const hill of TACTICAL_HILLS) {
    // Keep slightly off any monolith center on the (-22,-5) and (23,6) hills
    const safeX = hill.x < -15 ? hill.x + 4.5 : hill.x > 15 ? hill.x - 4.5 : hill.x;
    const safeZ = hill.z;

    let minEnemyDist = Infinity;
    for (const a of allies) {
      const d = Math.hypot(a.x - safeX, a.z - safeZ);
      if (d < minEnemyDist) minEnemyDist = d;
    }

    const travelDist = Math.hypot(safeX - squad.x, safeZ - squad.z);
    // Ideal hill is close to archer range (16-28m from enemies), high elevation, and not too far behind
    const rangeFit = minEnemyDist >= 11 && minEnemyDist <= 30 ? 25 : -Math.abs(minEnemyDist - 20);
    const score = hill.h * 8 + rangeFit - travelDist * 0.45;
    if (score > bestScore) {
      bestScore = score;
      bestHill = clampToPlayableBounds(safeX, safeZ);
    }
  }
  return bestHill;
}

/**
 * Scores allied targets based on unit counter matchups, low morale/HP focus fire, and distance.
 */
export function selectPriorityTarget(
  squad: SquadState,
  allies: SquadState[],
  difficulty: DifficultyLevel,
): SquadState {
  if (difficulty === 'easy') {
    // Easy simply picks nearest alive ally
    let nearest = allies[0];
    let bestD = Infinity;
    for (const a of allies) {
      const d = Math.hypot(a.x - squad.x, a.z - squad.z);
      if (d < bestD) {
        bestD = d;
        nearest = a;
      }
    }
    return nearest;
  }

  let best = allies[0];
  let bestScore = -Infinity;

  for (const a of allies) {
    const d = Math.hypot(a.x - squad.x, a.z - squad.z);
    const counter = getUnitCounterMultiplier(squad.unitClass, a.unitClass);
    const counterBonus = (counter - 1) * 45;
    const archerBonus =
      UNIT_CLASSES[squad.unitClass].category === 'cavalry' && UNIT_CLASSES[a.unitClass].isRanged
        ? 26
        : 0;

    // Hard & Tactician focus-fire low-morale or weakened squads to force <25% routs
    const lowMoraleBonus =
      difficulty === 'hard' || difficulty === 'tactician'
        ? (100 - a.morale) * 0.42 + (a.routing ? -40 : 0)
        : 0;

    const score = counterBonus + archerBonus + lowMoraleBonus - d * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best;
}

/**
 * Computes a flanking waypoint to the left or right flank of a target squad's facing vector.
 */
export function computeFlankWaypoint(
  squad: SquadState,
  target: SquadState,
  wingSign: 1 | -1,
): { x: number; z: number } {
  const flankAngle = target.facing + wingSign * (Math.PI * 0.58);
  const offsetDist = 11.5;
  const rawX = target.x + Math.sin(flankAngle) * offsetDist;
  const rawZ = target.z + Math.cos(flankAngle) * offsetDist;
  const distToFlank = Math.hypot(rawX - squad.x, rawZ - squad.z);
  const distToTarget = Math.hypot(target.x - squad.x, target.z - squad.z);

  // Once within strike distance of the flank pocket, commit directly into the enemy flank
  if (distToFlank < 5.5 || distToTarget < 7.5) {
    return { x: target.x, z: target.z };
  }
  return clampToPlayableBounds(rawX, rawZ);
}

/**
 * Evaluates tactical decision for a single AI squad based on difficulty doctrine.
 */
export function evaluateAiSquadDecision(params: {
  squad: SquadState;
  squadIndex: number;
  allies: SquadState[];
  friendlySquads: SquadState[];
  difficulty: DifficultyLevel;
  elapsedSeconds: number;
  canSplitMore: boolean;
}): AiSquadAction {
  const { squad, squadIndex, allies, friendlySquads, difficulty, elapsedSeconds, canSplitMore } =
    params;
  const def = UNIT_CLASSES[squad.unitClass];

  // Nearest allied threat for spacing & kiting checks
  let nearestAlly = allies[0];
  let nearestDist = Infinity;
  let alliedRangedCount = 0;
  for (const a of allies) {
    const d = Math.hypot(a.x - squad.x, a.z - squad.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearestAlly = a;
    }
    if (UNIT_CLASSES[a.unitClass].isRanged && d < 46) {
      alliedRangedCount++;
    }
  }

  const priorityTarget = selectPriorityTarget(squad, allies, difficulty);
  const underRecentFire = elapsedSeconds - squad.lastAttackedAt < 3.0;

  // EASY: Basic direct advance, no bridge pathing, no flanking, no tactical formations
  if (difficulty === 'easy') {
    if (def.isRanged && nearestDist < def.range * 0.85) {
      return {
        targetX: squad.x,
        targetZ: squad.z,
        targetSquadId: null,
        formation: 'standard',
        isHoldPosition: true,
      };
    }
    return {
      targetX: priorityTarget.x,
      targetZ: priorityTarget.z,
      targetSquadId: priorityTarget.id,
      formation: 'standard',
      isHoldPosition: false,
    };
  }

  // TACTICIAN MORALE PRESERVATION: Pull back critically shaken non-shield squads before <25% rout
  if (
    difficulty === 'tactician' &&
    squad.morale < 38 &&
    squad.morale >= 25 &&
    nearestDist < 12 &&
    def.category !== 'infantry'
  ) {
    const retreatTarget = clampToPlayableBounds(
      squad.x,
      Math.max(-MAP_HALF + 8, squad.z - 16),
    );
    return {
      targetX: retreatTarget.x,
      targetZ: retreatTarget.z,
      targetSquadId: null,
      formation: 'dispersed',
      isHoldPosition: false,
    };
  }

  // SCOUTS (Medium+): Push ahead to central high ground hills to spot crossings
  if (def.category === 'scouts') {
    const hill = findBestHighGroundHill(squad, allies);
    const dest = hill ?? { x: priorityTarget.x, z: Math.max(-18, priorityTarget.z - 14) };
    const routed = findNearestBridgeCrossing(squad.x, squad.z, dest.x, dest.z);
    return {
      targetX: routed.x,
      targetZ: routed.z,
      targetSquadId: null,
      formation: 'dispersed',
      isHoldPosition: Math.hypot(routed.x - squad.x, routed.z - squad.z) < 2.2,
    };
  }

  // ARCHERS (Medium / Hard / Tactician): Capture high ground hills & kite charging melee
  if (def.isRanged) {
    const kiteThreshold = difficulty === 'medium' ? 8.5 : 12.0;
    if (nearestDist < kiteThreshold) {
      // Kite away from nearest threat toward home ridge / friendly infantry
      const guardInfantry = friendlySquads.find(
        (f) => f.id !== squad.id && UNIT_CLASSES[f.unitClass].category === 'infantry' && !f.routing,
      );
      const dx = squad.x - nearestAlly.x;
      const dz = squad.z - nearestAlly.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      const desiredX = guardInfantry ? (squad.x + guardInfantry.x) * 0.5 : squad.x + (dx / len) * 12;
      const desiredZ = guardInfantry
        ? Math.min(guardInfantry.z - 6, squad.z - 6)
        : squad.z + (dz / len) * 12;
      const clamped = clampToPlayableBounds(desiredX, desiredZ);
      return {
        targetX: clamped.x,
        targetZ: clamped.z,
        targetSquadId: null,
        formation: difficulty === 'tactician' ? 'dispersed' : 'line',
        isHoldPosition: false,
      };
    }

    // Hold high ground if nearby enemy is within firing range
    const hill = findBestHighGroundHill(squad, allies);
    if (hill && (difficulty === 'hard' || difficulty === 'tactician') && nearestDist > def.range * 0.95) {
      const routed = findNearestBridgeCrossing(squad.x, squad.z, hill.x, hill.z);
      return {
        targetX: routed.x,
        targetZ: routed.z,
        targetSquadId: null,
        formation: 'line',
        isHoldPosition: false,
      };
    }

    if (nearestDist <= def.range + 2) {
      return {
        targetX: squad.x,
        targetZ: squad.z,
        targetSquadId: null,
        formation: 'line',
        isHoldPosition: true,
      };
    }

    const routed = findNearestBridgeCrossing(squad.x, squad.z, priorityTarget.x, priorityTarget.z);
    return {
      targetX: routed.x,
      targetZ: routed.z,
      targetSquadId: null,
      formation: 'line',
      isHoldPosition: false,
    };
  }

  // CAVALRY (Medium / Hard / Tactician): Hunt archers & execute flank maneuvers
  if (def.category === 'cavalry') {
    const wingSign: 1 | -1 = squadIndex % 2 === 0 ? 1 : -1;
    const shouldFlank = difficulty === 'hard' || difficulty === 'tactician';
    const flankGoal = shouldFlank
      ? computeFlankWaypoint(squad, priorityTarget, wingSign)
      : { x: priorityTarget.x, z: priorityTarget.z };

    const routed = findNearestBridgeCrossing(squad.x, squad.z, flankGoal.x, flankGoal.z);
    const form: FormationType =
      (difficulty === 'hard' || difficulty === 'tactician') && alliedRangedCount > 0 && nearestDist > 9
        ? 'dispersed'
        : 'standard';

    return {
      targetX: routed.x,
      targetZ: routed.z,
      targetSquadId: routed.viaBridge || (shouldFlank && nearestDist > 11) ? null : priorityTarget.id,
      formation: form,
      isHoldPosition: false,
    };
  }

  // INFANTRY (Heavy & Light): Bridge control, Shield Wall under volley, Split on Tactician
  let formation: FormationType = 'standard';
  if (def.canShieldWall && underRecentFire && nearestDist > 5.5) {
    formation = 'shield_wall';
  } else if (isBridgeFordAt(squad.x, squad.z) && (difficulty === 'hard' || difficulty === 'tactician')) {
    formation = 'line';
  } else if (!def.canShieldWall && underRecentFire && nearestDist > 8 && difficulty !== 'medium') {
    formation = 'dispersed';
  }

  // Tactician splits large healthy Heavy Infantry to guard multiple crossings when outnumbered in squad count
  const aliveCount = squad.soldiers.filter((s) => s.alive).length;
  const shouldSplit =
    difficulty === 'tactician' &&
    canSplitMore &&
    squad.unitClass === 'heavy_infantry' &&
    aliveCount >= 10 &&
    allies.length >= friendlySquads.length;

  const targetGoal =
    !def.canShieldWall && (difficulty === 'hard' || difficulty === 'tactician')
      ? computeFlankWaypoint(squad, priorityTarget, squadIndex % 2 === 0 ? 1 : -1)
      : { x: priorityTarget.x, z: priorityTarget.z };

  const routed = findNearestBridgeCrossing(squad.x, squad.z, targetGoal.x, targetGoal.z);

  return {
    targetX: routed.x,
    targetZ: routed.z,
    targetSquadId: routed.viaBridge ? null : priorityTarget.id,
    formation,
    isHoldPosition: false,
    shouldSplit,
  };
}
