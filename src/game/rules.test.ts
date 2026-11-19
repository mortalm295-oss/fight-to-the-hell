import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTacticalCommand } from './commandParser';
import { ARMY_BUDGET, FOG_GRID_RES, MAX_COMMANDER_MEDALS, ROUT_MORALE_THRESHOLD } from './constants';
import {
  applyMoraleDelta,
  awardMedalToSquad,
  calculateRosterCost,
  checkBattleOutcome,
  computeAttackDamage,
  createSquad,
  getUnitCounterMultiplier,
  isValidRoster,
  splitSquad,
  updateFogOfWar,
} from './rules';
import { computeEffectiveVision, getTerrainAt } from './terrain';

test('Command parser recognizes all required tactical keywords', () => {
  assert.equal(parseTacticalCommand('Advance 20m').action, 'advance');
  assert.equal(parseTacticalCommand('Move north').action, 'move');
  assert.equal(parseTacticalCommand('Raise shields!').action, 'shield_wall');
  assert.equal(parseTacticalCommand('Shield wall').action, 'shield_wall');
  assert.equal(parseTacticalCommand('Line formation').action, 'line');
  assert.equal(parseTacticalCommand('Spread out').action, 'dispersed');
  assert.equal(parseTacticalCommand('Disperse').action, 'dispersed');
  assert.equal(parseTacticalCommand('Split squad').action, 'split');
  assert.equal(parseTacticalCommand('Divide').action, 'split');
});

test('Army roster budget validation enforces 1000pt cap', () => {
  const valid = [
    { id: '1', unitClass: 'heavy_infantry' as const },
    { id: '2', unitClass: 'scouts' as const },
  ];
  assert.equal(calculateRosterCost(valid), 270);
  assert.equal(isValidRoster(valid, ARMY_BUDGET), true);

  const overBudget = Array.from({ length: 6 }, (_, i) => ({
    id: `${i}`,
    unitClass: 'heavy_cavalry' as const,
  }));
  assert.equal(calculateRosterCost(overBudget), 1380);
  assert.equal(isValidRoster(overBudget, ARMY_BUDGET), false);
});

test('Terrain elevation dynamically scales squad Line of Sight', () => {
  // Southern tactical hill at (-5, 18) vs Valley at (-16, 22)
  const hillSquad = createSquad({
    id: 'hill-scout',
    name: 'Scouts',
    commanderName: 'Cmdr. A',
    faction: 'allied',
    unitClass: 'scouts',
    x: -5,
    z: 18,
    facing: 0,
  });
  const valleySquad = createSquad({
    id: 'valley-scout',
    name: 'Scouts',
    commanderName: 'Cmdr. B',
    faction: 'allied',
    unitClass: 'scouts',
    x: -16,
    z: 22,
    facing: 0,
  });

  const hillVision = computeEffectiveVision(hillSquad);
  const valleyVision = computeEffectiveVision(valleySquad);

  assert.equal(getTerrainAt(-5, 18).type, 'hill');
  assert.equal(getTerrainAt(-16, 22).type, 'valley');
  assert.equal(hillVision.onHighGround, true);
  assert.ok(hillVision.visionRadius > valleyVision.visionRadius * 1.5);
});

test('Fog of War starts unexplored and reveals around friendly squads only', () => {
  const fogGrid = new Uint8Array(FOG_GRID_RES * FOG_GRID_RES);
  const ally = createSquad({
    id: 'ally-1',
    name: 'Scouts 1',
    commanderName: 'Cmdr. A',
    faction: 'allied',
    unitClass: 'scouts',
    x: 0,
    z: 0,
    facing: 0,
  });
  const enemy = createSquad({
    id: 'enemy-1',
    name: 'Enemy 1',
    commanderName: 'Warlord 1',
    faction: 'enemy',
    unitClass: 'heavy_infantry',
    x: 45,
    z: -45,
    facing: 0,
  });

  const result = updateFogOfWar(fogGrid, [ally, enemy]);
  assert.ok(result.exploredPercent > 10 && result.exploredPercent < 65);
  assert.ok(result.newlyExploredCells > 0);
});

test('Splitting a squad divides soldiers into two independent half-squads', () => {
  const squad = createSquad({
    id: 'ally-1',
    name: 'Heavy Infantry 1',
    commanderName: 'Cmdr. Aldric',
    faction: 'allied',
    unitClass: 'heavy_infantry',
    x: 0,
    z: 20,
    facing: Math.PI,
  });
  awardMedalToSquad(squad, 'first_blood');

  const split = splitSquad(squad, 'ally-1-split');
  assert.ok(split !== null);
  assert.equal(split.first.soldiers.length, 6);
  assert.equal(split.second.soldiers.length, 6);
  assert.equal(split.second.id, 'ally-1-split');
  assert.deepEqual(split.second.medals, ['first_blood']);
});

test('Unit counters, shield wall vs arrows, morale routing (<25%), and 4-medal cap', () => {
  assert.ok(getUnitCounterMultiplier('heavy_cavalry', 'heavy_archers') > 1.5);

  const archers = createSquad({
    id: 'arch-1',
    name: 'Archers',
    commanderName: 'Warlord',
    faction: 'enemy',
    unitClass: 'heavy_archers',
    x: 0,
    z: -10,
    facing: 0,
  });
  const shieldInfantry = createSquad({
    id: 'inf-1',
    name: 'Heavy Inf',
    commanderName: 'Cmdr. Aldric',
    faction: 'allied',
    unitClass: 'heavy_infantry',
    x: 0,
    z: 10,
    facing: Math.PI,
  });

  const normalHit = computeAttackDamage({
    attacker: archers,
    defender: shieldInfantry,
    isRangedHit: true,
    difficulty: 'medium',
  });
  shieldInfantry.formation = 'shield_wall';
  const shieldWallHit = computeAttackDamage({
    attacker: archers,
    defender: shieldInfantry,
    isRangedHit: true,
    difficulty: 'medium',
  });
  assert.ok(shieldWallHit.damage < normalHit.damage);
  assert.ok(shieldWallHit.blocked > 0);

  // Morale drops below 25% -> squad routes
  const newlyRouted = applyMoraleDelta(shieldInfantry, -(100 - (ROUT_MORALE_THRESHOLD - 5)));
  assert.equal(newlyRouted, true);
  assert.equal(shieldInfantry.routing, true);

  // Max 4 medals per commander
  assert.equal(awardMedalToSquad(shieldInfantry, 'first_blood'), true);
  assert.equal(awardMedalToSquad(shieldInfantry, 'high_ground_master'), true);
  assert.equal(awardMedalToSquad(shieldInfantry, 'map_explorer'), true);
  assert.equal(awardMedalToSquad(shieldInfantry, 'shield_bastion'), true);
  assert.equal(awardMedalToSquad(shieldInfantry, 'flanking_victory'), false);
  assert.equal(shieldInfantry.medals.length, MAX_COMMANDER_MEDALS);
});

test('Total annihilation or routing all enemies triggers victory', () => {
  const ally = createSquad({
    id: 'a1',
    name: 'Allies',
    commanderName: 'Cmdr',
    faction: 'allied',
    unitClass: 'heavy_infantry',
    x: 0,
    z: 10,
    facing: Math.PI,
  });
  const enemy = createSquad({
    id: 'e1',
    name: 'Enemies',
    commanderName: 'Warlord',
    faction: 'enemy',
    unitClass: 'light_infantry',
    x: 0,
    z: -10,
    facing: 0,
  });

  assert.equal(checkBattleOutcome([ally, enemy]), null);
  enemy.routing = true;
  assert.equal(checkBattleOutcome([ally, enemy]), 'victory');
});

test('Tactical AI differentiates Easy, Medium, Hard, and Tactician behavior', async () => {
  const { evaluateAiSquadDecision, findNearestBridgeCrossing } = await import('./ai');

  // 1. River crossing pathfinding routes through nearest bridge instead of wading
  const bridgeRoute = findNearestBridgeCrossing(14, -22, 16, 22);
  assert.equal(bridgeRoute.viaBridge, true);
  assert.ok(Math.abs(bridgeRoute.x - 15) < 1.5);

  const allyInf = createSquad({
    id: 'a-inf',
    name: 'Allied Inf',
    commanderName: 'Cmdr',
    faction: 'allied',
    unitClass: 'heavy_infantry',
    x: 0,
    z: 20,
    facing: Math.PI,
  });
  const allyArch = createSquad({
    id: 'a-arch',
    name: 'Allied Arch',
    commanderName: 'Cmdr',
    faction: 'allied',
    unitClass: 'heavy_archers',
    x: 12,
    z: 25,
    facing: Math.PI,
  });

  // 2. Easy cavalry charges directly nearest ally in standard formation; Hard cavalry targets archers & flanks
  const aiCav = createSquad({
    id: 'e-cav',
    name: 'Enemy Cav',
    commanderName: 'Warlord',
    faction: 'enemy',
    unitClass: 'heavy_cavalry',
    x: 0,
    z: -15,
    facing: 0,
  });
  const easyCav = evaluateAiSquadDecision({
    squad: aiCav,
    squadIndex: 0,
    allies: [allyInf, allyArch],
    friendlySquads: [aiCav],
    difficulty: 'easy',
    elapsedSeconds: 5,
    canSplitMore: false,
  });
  assert.equal(easyCav.targetSquadId, allyInf.id);
  assert.equal(easyCav.formation, 'standard');

  const hardCav = evaluateAiSquadDecision({
    squad: aiCav,
    squadIndex: 0,
    allies: [allyInf, allyArch],
    friendlySquads: [aiCav],
    difficulty: 'hard',
    elapsedSeconds: 5,
    canSplitMore: false,
  });
  assert.equal(hardCav.formation, 'dispersed');
  assert.equal(hardCav.targetSquadId, null); // Navigating bridge/flank waypoint first

  // 3. Tactician withdraws shaken cavalry (<38% morale) instead of letting it break (<25%)
  aiCav.morale = 32;
  aiCav.x = 0;
  aiCav.z = 12;
  const tactRetreat = evaluateAiSquadDecision({
    squad: aiCav,
    squadIndex: 0,
    allies: [allyInf, allyArch],
    friendlySquads: [aiCav],
    difficulty: 'tactician',
    elapsedSeconds: 10,
    canSplitMore: false,
  });
  assert.ok(tactRetreat.targetZ < aiCav.z);
  assert.equal(tactRetreat.formation, 'dispersed');

  // 4. Tactician splits healthy Heavy Infantry when outnumbered in squad count
  const aiHeavy = createSquad({
    id: 'e-hi',
    name: 'Enemy Heavy Inf',
    commanderName: 'Warlord',
    faction: 'enemy',
    unitClass: 'heavy_infantry',
    x: 0,
    z: -20,
    facing: 0,
  });
  const tactSplit = evaluateAiSquadDecision({
    squad: aiHeavy,
    squadIndex: 0,
    allies: [allyInf, allyArch],
    friendlySquads: [aiHeavy],
    difficulty: 'tactician',
    elapsedSeconds: 8,
    canSplitMore: true,
  });
  assert.equal(tactSplit.shouldSplit, true);

  // 5. Heavy Infantry raises shield_wall under recent fire
  aiHeavy.lastAttackedAt = 7;
  const heavyUnderFire = evaluateAiSquadDecision({
    squad: aiHeavy,
    squadIndex: 0,
    allies: [allyInf, allyArch],
    friendlySquads: [aiHeavy],
    difficulty: 'hard',
    elapsedSeconds: 8,
    canSplitMore: false,
  });
  assert.equal(heavyUnderFire.formation, 'shield_wall');

  // 6. Medium/Hard archers kite backward when melee closes inside threshold
  const aiArch = createSquad({
    id: 'e-arch',
    name: 'Enemy Arch',
    commanderName: 'Warlord',
    faction: 'enemy',
    unitClass: 'light_archers',
    x: 0,
    z: 11,
    facing: 0,
  });
  const archKite = evaluateAiSquadDecision({
    squad: aiArch,
    squadIndex: 0,
    allies: [allyInf],
    friendlySquads: [aiArch, aiHeavy],
    difficulty: 'hard',
    elapsedSeconds: 8,
    canSplitMore: false,
  });
  assert.ok(archKite.targetZ < aiArch.z);
});

