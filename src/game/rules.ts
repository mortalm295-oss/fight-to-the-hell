import {
  ARMY_BUDGET,
  COMMANDER_NAMES,
  DIFFICULTY_CONFIG,
  FOG_GRID_RES,
  MAP_HALF,
  MAP_SIZE,
  MAX_COMMANDER_MEDALS,
  MEDALS,
  ROUT_MORALE_THRESHOLD,
  UNIT_CLASSES,
} from './constants';
import { clampToPlayableBounds, computeEffectiveVision, getTerrainAt } from './terrain';
import type {
  ArmyRosterEntry,
  DifficultyLevel,
  Faction,
  FormationType,
  MedalId,
  SoldierState,
  SquadState,
  UnitClass,
} from './types';

export function calculateRosterCost(roster: ArmyRosterEntry[]): number {
  return roster.reduce((sum, entry) => sum + UNIT_CLASSES[entry.unitClass].cost, 0);
}

export function isValidRoster(roster: ArmyRosterEntry[], budget = ARMY_BUDGET): boolean {
  return roster.length > 0 && calculateRosterCost(roster) <= budget;
}

export function computeFormationOffsets(
  formation: FormationType,
  count: number,
  facing: number,
): Array<{ ox: number; oz: number }> {
  const offsets: Array<{ ox: number; oz: number }> = [];
  if (count <= 0) return offsets;

  // Local coordinates: +Z is forward along facing, +X is right flank
  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);

  let cols = Math.ceil(Math.sqrt(count * 1.5));
  let spacingX = 1.35;
  let spacingZ = 1.35;

  if (formation === 'line') {
    cols = count; // Single straight tactical line
    spacingX = 1.3;
    spacingZ = 1.0;
  } else if (formation === 'shield_wall') {
    cols = Math.min(count, Math.max(4, Math.ceil(count / 2)));
    spacingX = 0.92; // Tight locked shield shoulder-to-shoulder
    spacingZ = 1.05;
  } else if (formation === 'dispersed') {
    cols = Math.ceil(Math.sqrt(count * 1.4));
    spacingX = 2.65; // Spread out to mitigate volley/splash damage
    spacingZ = 2.5;
  }

  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const rowItems = row === rows - 1 ? count - row * cols : cols;
    const lx = (col - (rowItems - 1) * 0.5) * spacingX;
    const lz = ((rows - 1) * 0.5 - row) * spacingZ;

    // Rotate local (lx, lz) by facing where facing=0 means +Z
    const wx = lx * cosF + lz * sinF;
    const wz = -lx * sinF + lz * cosF;
    offsets.push({ ox: wx, oz: wz });
  }
  return offsets;
}

export function createSquad(params: {
  id: string;
  name: string;
  commanderName: string;
  faction: Faction;
  unitClass: UnitClass;
  x: number;
  z: number;
  facing: number;
  soldierCount?: number;
  medals?: MedalId[];
  morale?: number;
}): SquadState {
  const def = UNIT_CLASSES[params.unitClass];
  const count = params.soldierCount ?? def.squadSize;
  const formation: FormationType = 'standard';
  const offsets = computeFormationOffsets(formation, count, params.facing);

  const soldiers: SoldierState[] = offsets.map((off, idx) => ({
    id: `${params.id}-s-${idx}`,
    x: params.x + off.ox,
    z: params.z + off.oz,
    vx: 0,
    vz: 0,
    hp: def.hpPerSoldier,
    maxHp: def.hpPerSoldier,
    alive: true,
    offsetX: off.ox,
    offsetZ: off.oz,
    hitFlash: 0,
    attackAnim: 0,
    walkPhase: idx * 0.7,
    koTimer: 0,
  }));

  const squad: SquadState = {
    id: params.id,
    name: params.name,
    commanderName: params.commanderName,
    faction: params.faction,
    unitClass: params.unitClass,
    x: params.x,
    z: params.z,
    targetX: params.x,
    targetZ: params.z,
    facing: params.facing,
    formation,
    morale: params.morale ?? def.moraleBase,
    maxMorale: def.moraleBase,
    routing: false,
    eliminated: false,
    soldiers,
    medals: params.medals ? [...params.medals] : [],
    attackTimer: 0,
    lastTerrain: getTerrainAt(params.x, params.z).type,
    effectiveVision: def.visionRadius,
    onHighGround: false,
    highGroundTime: 0,
    kills: 0,
    damageBlocked: 0,
    flankHits: 0,
    distanceExplored: 0,
    targetSquadId: null,
    lastAttackedAt: -999,
    isHoldPosition: false,
    hitFlashTimer: 0,
  };

  const vision = computeEffectiveVision(squad);
  squad.effectiveVision = vision.visionRadius;
  squad.onHighGround = vision.onHighGround;
  return squad;
}

export function splitSquad(
  squad: SquadState,
  newId: string,
): { first: SquadState; second: SquadState } | null {
  const aliveSoldiers = squad.soldiers.filter((s) => s.alive);
  if (aliveSoldiers.length < 2 || squad.eliminated || squad.routing) {
    return null;
  }

  const half = Math.ceil(aliveSoldiers.length / 2);
  const firstPool = aliveSoldiers.slice(0, half);
  const secondPool = aliveSoldiers.slice(half);

  // Lateral offset perpendicular to facing
  const perpX = Math.cos(squad.facing) * 3.8;
  const perpZ = -Math.sin(squad.facing) * 3.8;

  const posA = clampToPlayableBounds(squad.x - perpX, squad.z - perpZ);
  const posB = clampToPlayableBounds(squad.x + perpX, squad.z + perpZ);

  const offsetsA = computeFormationOffsets(squad.formation, firstPool.length, squad.facing);
  const offsetsB = computeFormationOffsets(squad.formation, secondPool.length, squad.facing);

  const first: SquadState = {
    ...squad,
    x: posA.x,
    z: posA.z,
    targetX: posA.x,
    targetZ: posA.z,
    name: squad.name.endsWith(' A') || squad.name.endsWith(' B') ? squad.name : `${squad.name} A`,
    soldiers: firstPool.map((s, idx) => ({
      ...s,
      id: `${squad.id}-a-${idx}`,
      offsetX: offsetsA[idx].ox,
      offsetZ: offsetsA[idx].oz,
      x: posA.x + offsetsA[idx].ox,
      z: posA.z + offsetsA[idx].oz,
    })),
    medals: [...squad.medals],
  };

  const second: SquadState = {
    ...squad,
    id: newId,
    name: `${squad.name.replace(/ [AB]$/, '')} B`,
    commanderName: `${squad.commanderName} II`,
    x: posB.x,
    z: posB.z,
    targetX: posB.x,
    targetZ: posB.z,
    soldiers: secondPool.map((s, idx) => ({
      ...s,
      id: `${newId}-b-${idx}`,
      offsetX: offsetsB[idx].ox,
      offsetZ: offsetsB[idx].oz,
      x: posB.x + offsetsB[idx].ox,
      z: posB.z + offsetsB[idx].oz,
    })),
    medals: [...squad.medals],
  };

  return { first, second };
}

export function buildEnemyRosterForDifficulty(difficulty: DifficultyLevel): UnitClass[] {
  if (difficulty === 'easy') {
    return ['light_infantry', 'light_archers', 'heavy_infantry', 'light_cavalry', 'scouts']; // 760
  }
  if (difficulty === 'medium') {
    return [
      'heavy_infantry',
      'light_infantry',
      'heavy_archers',
      'light_archers',
      'light_cavalry',
      'heavy_cavalry',
    ]; // 980
  }
  if (difficulty === 'hard') {
    return [
      'heavy_infantry',
      'heavy_infantry',
      'heavy_archers',
      'light_archers',
      'heavy_cavalry',
      'light_cavalry',
      'scouts',
    ]; // 1160
  }
  // Tactician
  return [
    'heavy_infantry',
    'heavy_infantry',
    'heavy_archers',
    'heavy_archers',
    'heavy_cavalry',
    'light_cavalry',
    'light_infantry',
    'scouts',
  ]; // 1340 combined-arms
}

export function generateInitialArmies(
  alliedRoster: ArmyRosterEntry[],
  difficulty: DifficultyLevel,
): SquadState[] {
  const squads: SquadState[] = [];
  const enemyClasses = buildEnemyRosterForDifficulty(difficulty);

  // Allied army spawns on the South flank (z = +27 to +32) facing North (facing = Math.PI)
  const alliedCount = alliedRoster.length;
  alliedRoster.forEach((entry, idx) => {
    const spread = Math.min(60, alliedCount * 10);
    const x = alliedCount === 1 ? 0 : -spread / 2 + (idx / (alliedCount - 1)) * spread;
    const z = 27 + (idx % 2) * 4.5;
    const def = UNIT_CLASSES[entry.unitClass];
    const pos = clampToPlayableBounds(x, z);
    squads.push(
      createSquad({
        id: `ally-${idx + 1}`,
        name: `${def.name} ${idx + 1}`,
        commanderName: COMMANDER_NAMES[idx % COMMANDER_NAMES.length],
        faction: 'allied',
        unitClass: entry.unitClass,
        x: pos.x,
        z: pos.z,
        facing: Math.PI, // Facing North (-Z)
      }),
    );
  });

  // Enemy army spawns on the North flank (z = -27 to -32) facing South (facing = 0)
  const enemyCount = enemyClasses.length;
  enemyClasses.forEach((uClass, idx) => {
    const spread = Math.min(64, enemyCount * 10);
    const x = enemyCount === 1 ? 0 : -spread / 2 + (idx / (enemyCount - 1)) * spread;
    const z = -27 - (idx % 2) * 4.5;
    const def = UNIT_CLASSES[uClass];
    const pos = clampToPlayableBounds(x, z);
    squads.push(
      createSquad({
        id: `enemy-${idx + 1}`,
        name: `Vanguard ${def.name} ${idx + 1}`,
        commanderName: `Warlord ${idx + 1}`,
        faction: 'enemy',
        unitClass: uClass,
        x: pos.x,
        z: pos.z,
        facing: 0, // Facing South (+Z)
      }),
    );
  });

  return squads;
}

/**
 * Fog of War Grid values:
 * 0 = Unexplored (opaque shroud)
 * 1 = Previously explored (dimmed terrain, enemies hidden)
 * 2 = Currently visible inside an allied squad's LoS
 */
export function updateFogOfWar(
  fogGrid: Uint8Array,
  squads: SquadState[],
  gridRes = FOG_GRID_RES,
  trackExploration = true,
): { exploredPercent: number; newlyExploredCells: number } {
  // Downgrade active visibility (2) -> remembered (1)
  for (let i = 0; i < fogGrid.length; i++) {
    if (fogGrid[i] === 2) fogGrid[i] = 1;
  }

  let newlyExploredCells = 0;
  const cellSize = MAP_SIZE / gridRes;
  const alliedActive = squads.filter((s) => s.faction === 'allied' && !s.eliminated);

  for (const sq of alliedActive) {
    const { visionRadius, terrain, onHighGround } = computeEffectiveVision(sq);
    sq.effectiveVision = visionRadius;
    sq.onHighGround = onHighGround;
    sq.lastTerrain = terrain.type;

    const rSq = visionRadius * visionRadius;
    const minGX = Math.max(0, Math.floor((sq.x - visionRadius + MAP_HALF) / cellSize));
    const maxGX = Math.min(gridRes - 1, Math.floor((sq.x + visionRadius + MAP_HALF) / cellSize));
    const minGZ = Math.max(0, Math.floor((sq.z - visionRadius + MAP_HALF) / cellSize));
    const maxGZ = Math.min(gridRes - 1, Math.floor((sq.z + visionRadius + MAP_HALF) / cellSize));

    for (let gz = minGZ; gz <= maxGZ; gz++) {
      const worldZ = -MAP_HALF + (gz + 0.5) * cellSize;
      const dz = worldZ - sq.z;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const worldX = -MAP_HALF + (gx + 0.5) * cellSize;
        const dx = worldX - sq.x;
        if (dx * dx + dz * dz <= rSq) {
          const idx = gz * gridRes + gx;
          if (fogGrid[idx] === 0) {
            newlyExploredCells++;
            if (trackExploration) {
              sq.distanceExplored += 1;
            }
          }
          fogGrid[idx] = 2;
        }
      }
    }
  }

  let explored = 0;
  for (let i = 0; i < fogGrid.length; i++) {
    if (fogGrid[i] > 0) explored++;
  }
  const exploredPercent = Math.round((explored / fogGrid.length) * 100);
  return { exploredPercent, newlyExploredCells };
}

export function isPointVisibleInFog(
  fogGrid: Uint8Array,
  x: number,
  z: number,
  gridRes = FOG_GRID_RES,
): boolean {
  const cellSize = MAP_SIZE / gridRes;
  const gx = Math.max(0, Math.min(gridRes - 1, Math.floor((x + MAP_HALF) / cellSize)));
  const gz = Math.max(0, Math.min(gridRes - 1, Math.floor((z + MAP_HALF) / cellSize)));
  return fogGrid[gz * gridRes + gx] === 2;
}

export function getUnitCounterMultiplier(attacker: UnitClass, defender: UnitClass): number {
  const attCat = UNIT_CLASSES[attacker].category;
  const defCat = UNIT_CLASSES[defender].category;

  if (attCat === 'cavalry' && defCat === 'archers') return 1.65; // Cavalry crushes archers
  if (attCat === 'cavalry' && defCat === 'scouts') return 1.35;
  if (attacker === 'heavy_infantry' && defCat === 'cavalry') return 1.35; // Spear wall braces cavalry
  if (attCat === 'archers' && defender === 'light_infantry') return 1.35;
  if (attCat === 'archers' && defCat === 'scouts') return 1.25;
  if (defender === 'heavy_infantry' && attCat === 'archers') return 0.72;
  return 1.0;
}

export function isFlankingAttack(attacker: SquadState, defender: SquadState): boolean {
  const dx = attacker.x - defender.x;
  const dz = attacker.z - defender.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return false;
  // Defender's forward vector: (sin(facing), cos(facing))
  const fx = Math.sin(defender.facing);
  const fz = Math.cos(defender.facing);
  const dot = (dx / len) * fx + (dz / len) * fz;
  // dot < 0.2 means attack comes from side (>78 deg) or rear
  return dot < 0.2;
}

export function getSquadMedalBonuses(squad: SquadState): {
  attackMult: number;
  defenseMult: number;
  visionMult: number;
  speedMult: number;
} {
  let attackBonus = 0;
  let defenseBonus = 0;
  let visionBonus = 0;
  let speedBonus = 0;
  for (const id of squad.medals) {
    const m = MEDALS[id];
    attackBonus += m.attackBonus;
    defenseBonus += m.defenseBonus;
    visionBonus += m.visionBonus;
    speedBonus += m.speedBonus;
  }
  return {
    attackMult: 1 + attackBonus,
    defenseMult: 1 + defenseBonus,
    visionMult: 1 + visionBonus,
    speedMult: 1 + speedBonus,
  };
}

export function computeAttackDamage(params: {
  attacker: SquadState;
  defender: SquadState;
  isRangedHit: boolean;
  difficulty: DifficultyLevel;
}): { damage: number; blocked: number; flanked: boolean } {
  const { attacker, defender, isRangedHit, difficulty } = params;
  const attDef = UNIT_CLASSES[attacker.unitClass];
  const defDef = UNIT_CLASSES[defender.unitClass];

  const attTerrain = getTerrainAt(attacker.x, attacker.z);
  const defTerrain = getTerrainAt(defender.x, defender.z);
  const attMedals = getSquadMedalBonuses(attacker);
  const defMedals = getSquadMedalBonuses(defender);

  const counter = getUnitCounterMultiplier(attacker.unitClass, defender.unitClass);
  const flanked = isFlankingAttack(attacker, defender);
  const flankMult = flanked ? 1.38 : 1.0;

  // High ground advantage
  const heightAdvantage =
    attTerrain.height > defTerrain.height + 1.0
      ? 1 + attTerrain.combatBonus
      : defTerrain.height > attTerrain.height + 1.0
        ? 0.86
        : 1.0;

  const diffScale =
    attacker.faction === 'enemy' ? DIFFICULTY_CONFIG[difficulty].enemyDamageScale : 1.0;

  let rawDamage =
    attDef.attack * attMedals.attackMult * counter * flankMult * heightAdvantage * diffScale;

  // Shield Wall blocks 55% of ranged arrows and +45% melee armor
  let defensePower = defDef.defense * defMedals.defenseMult;
  let blocked = 0;
  if (defender.formation === 'shield_wall') {
    defensePower *= 1.55;
    if (isRangedHit) {
      const reduced = rawDamage * 0.55;
      blocked += reduced;
      rawDamage -= reduced;
    }
  } else if (defender.formation === 'dispersed' && isRangedHit) {
    // Dispersed formation mitigates ranged volley spread by 30%
    const reduced = rawDamage * 0.3;
    blocked += reduced;
    rawDamage -= reduced;
  }

  const finalDamage = Math.max(3, rawDamage - defensePower * 0.35);
  return { damage: finalDamage, blocked, flanked };
}

export function applyMoraleDelta(squad: SquadState, delta: number): boolean {
  if (squad.eliminated) return false;
  squad.morale = Math.max(0, Math.min(squad.maxMorale, squad.morale + delta));
  if (squad.morale < ROUT_MORALE_THRESHOLD && !squad.routing) {
    squad.routing = true;
    squad.formation = 'dispersed';
    return true; // Newly routed
  }
  return false;
}

export function awardMedalToSquad(squad: SquadState, medalId: MedalId): boolean {
  if (squad.medals.includes(medalId)) return false;
  if (squad.medals.length >= MAX_COMMANDER_MEDALS) return false;
  squad.medals.push(medalId);
  return true;
}

export function evaluateMedals(
  squads: SquadState[],
  firstBloodAwarded: { value: boolean },
): Array<{ squad: SquadState; medalId: MedalId }> {
  const newlyAwarded: Array<{ squad: SquadState; medalId: MedalId }> = [];

  for (const sq of squads) {
    if (sq.faction !== 'allied' || sq.eliminated || sq.routing) continue;

    if (!firstBloodAwarded.value && sq.kills >= 1) {
      if (awardMedalToSquad(sq, 'first_blood')) {
        firstBloodAwarded.value = true;
        newlyAwarded.push({ squad: sq, medalId: 'first_blood' });
      }
    }

    if (sq.highGroundTime >= 6.0 && sq.kills >= 1) {
      if (awardMedalToSquad(sq, 'high_ground_master')) {
        newlyAwarded.push({ squad: sq, medalId: 'high_ground_master' });
      }
    }

    if (sq.distanceExplored >= 130) {
      if (awardMedalToSquad(sq, 'map_explorer')) {
        newlyAwarded.push({ squad: sq, medalId: 'map_explorer' });
      }
    }

    if (sq.flankHits >= 5) {
      if (awardMedalToSquad(sq, 'flanking_victory')) {
        newlyAwarded.push({ squad: sq, medalId: 'flanking_victory' });
      }
    }

    if (sq.damageBlocked >= 110) {
      if (awardMedalToSquad(sq, 'shield_bastion')) {
        newlyAwarded.push({ squad: sq, medalId: 'shield_bastion' });
      }
    }

    if (sq.kills >= 6) {
      if (awardMedalToSquad(sq, 'thunder_charge')) {
        newlyAwarded.push({ squad: sq, medalId: 'thunder_charge' });
      }
    }
  }

  return newlyAwarded;
}

export function checkBattleOutcome(squads: SquadState[]): 'victory' | 'defeat' | null {
  const alliedActive = squads.some(
    (s) => s.faction === 'allied' && !s.eliminated && !s.routing && s.soldiers.some((u) => u.alive),
  );
  const enemyActive = squads.some(
    (s) => s.faction === 'enemy' && !s.eliminated && !s.routing && s.soldiers.some((u) => u.alive),
  );

  if (!enemyActive && alliedActive) return 'victory';
  if (!alliedActive) return 'defeat';
  return null;
}
