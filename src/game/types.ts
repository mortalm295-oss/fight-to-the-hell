export type GamePhase = 'title' | 'setup' | 'playing' | 'paused' | 'gameover';

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'tactician';

export type Faction = 'allied' | 'enemy';

export type UnitCategory = 'infantry' | 'archers' | 'cavalry' | 'scouts';

export type UnitClass =
  | 'heavy_infantry'
  | 'light_infantry'
  | 'heavy_archers'
  | 'light_archers'
  | 'heavy_cavalry'
  | 'light_cavalry'
  | 'scouts';

export type FormationType = 'standard' | 'shield_wall' | 'line' | 'dispersed';

export type TerrainType = 'plains' | 'hill' | 'mountain' | 'river' | 'valley';

export type MedalId =
  | 'first_blood'
  | 'high_ground_master'
  | 'map_explorer'
  | 'flanking_victory'
  | 'shield_bastion'
  | 'thunder_charge';

export interface MedalDef {
  id: MedalId;
  name: string;
  shortLabel: string;
  description: string;
  buffSummary: string;
  accentColor: string;
  attackBonus: number;
  defenseBonus: number;
  visionBonus: number;
  speedBonus: number;
}

export interface UnitClassDef {
  id: UnitClass;
  name: string;
  category: UnitCategory;
  cost: number;
  squadSize: number;
  hpPerSoldier: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  attackCooldown: number;
  visionRadius: number;
  moraleBase: number;
  roleSummary: string;
  isRanged: boolean;
  canShieldWall: boolean;
}

export interface ArmyRosterEntry {
  id: string;
  unitClass: UnitClass;
}

export interface SoldierState {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  offsetX: number;
  offsetZ: number;
  hitFlash: number;
  attackAnim: number;
  walkPhase: number;
  koTimer: number;
}

export interface SquadState {
  id: string;
  name: string;
  commanderName: string;
  faction: Faction;
  unitClass: UnitClass;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  facing: number;
  formation: FormationType;
  morale: number;
  maxMorale: number;
  routing: boolean;
  eliminated: boolean;
  soldiers: SoldierState[];
  medals: MedalId[];
  attackTimer: number;
  lastTerrain: TerrainType;
  effectiveVision: number;
  onHighGround: boolean;
  highGroundTime: number;
  kills: number;
  damageBlocked: number;
  flankHits: number;
  distanceExplored: number;
  targetSquadId: string | null;
  lastAttackedAt: number;
  isHoldPosition: boolean;
  hitFlashTimer: number;
}

export interface ProjectileState {
  id: string;
  faction: Faction;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  targetSquadId: string;
  sourceSquadId: string;
  life: number;
  maxLife: number;
  active: boolean;
}

export type CommandAction =
  | 'advance'
  | 'move'
  | 'shield_wall'
  | 'line'
  | 'dispersed'
  | 'standard'
  | 'split'
  | 'hold'
  | 'retreat'
  | 'flank'
  | 'unknown';

export interface ParsedCommand {
  action: CommandAction;
  raw: string;
  label: string;
  feedback: string;
  distance?: number;
  angleOffset?: number;
  directionVector?: { dx: number; dz: number };
}

export interface MedalNotification {
  id: string;
  squadName: string;
  commanderName: string;
  medal: MedalDef;
  timestamp: number;
}

export interface BattleSnapshot {
  phase: GamePhase;
  outcome: 'victory' | 'defeat' | null;
  elapsedSeconds: number;
  exploredPercent: number;
  alliedSquadsAlive: number;
  alliedSquadsTotal: number;
  enemySquadsAlive: number;
  enemySquadsTotal: number;
  alliedSoldiersAlive: number;
  enemySoldiersAlive: number;
  medalsAwardedCount: number;
  selectedSquad: SquadState | null;
  alliedSquads: SquadState[];
  visibleEnemySquads: SquadState[];
  commandFeedback: string | null;
  recentNotifications: MedalNotification[];
  difficulty: DifficultyLevel;
}
