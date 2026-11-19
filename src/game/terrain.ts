import { MAP_HALF, MEDALS, UNIT_CLASSES } from './constants';
import type { SquadState, TerrainType } from './types';

export interface TerrainSample {
  height: number;
  type: TerrainType;
  passable: boolean;
  speedMultiplier: number;
  visionMultiplier: number;
  combatBonus: number;
}

export interface LandmarkCoord {
  x: number;
  z: number;
  radius: number;
  height: number;
}

// Two iconic Mandelbulb-inspired fractal monoliths anchoring high ground ridges
export const FRACTAL_MONOLITHS: LandmarkCoord[] = [
  { x: -24, z: -6, radius: 3.4, height: 9.5 },
  { x: 25, z: 7, radius: 3.4, height: 9.5 },
];

export const BRIDGE_CROSSINGS = [-14, 0, 15] as const;

// Tactical hills (high ground granting LoS & combat advantage)
export const TACTICAL_HILLS = [
  { x: -22, z: -5, rx: 14, rz: 12, h: 4.4 },
  { x: 23, z: 6, rx: 14, rz: 12, h: 4.4 },
  { x: -5, z: 18, rx: 11, rz: 9, h: 3.2 },
  { x: 6, z: -18, rx: 11, rz: 9, h: 3.2 },
];

// Low valleys (reduce LoS)
const VALLEYS = [
  { x: -16, z: 22, rx: 11, rz: 9, depth: 1.5 },
  { x: 17, z: -22, rx: 11, rz: 9, depth: 1.5 },
];

// Outer mountain peaks framing the battlefield perimeter (natural boundary)
const MOUNTAIN_PEAKS = [
  { x: -49, z: -44, r: 12, h: 10.5 },
  { x: -52, z: 8, r: 11, h: 9.2 },
  { x: -47, z: 46, r: 12, h: 10.0 },
  { x: 49, z: -45, r: 12, h: 10.2 },
  { x: 52, z: -6, r: 11, h: 9.0 },
  { x: 48, z: 46, r: 12, h: 10.6 },
  { x: 0, z: -52, r: 14, h: 8.8 },
  { x: 0, z: 52, r: 14, h: 8.8 },
];

// River centerline z = riverCenterZ(x)
export function getRiverCenterZ(x: number): number {
  return Math.sin(x * 0.065) * 9.5 - x * 0.14;
}

export function isBridgeFordAt(x: number, z: number): boolean {
  const rz = getRiverCenterZ(x);
  if (Math.abs(z - rz) > 4.4) return false;
  // Two wide tactical fords/bridges at x = -14 and x = +15, plus center shallows at x = 0
  return (
    Math.abs(x + 14) < 5.5 ||
    Math.abs(x - 15) < 5.5 ||
    Math.abs(x) < 4.5
  );
}

// 3D Mandelbulb-inspired spherical harmonic field used to sculpt crystalline mountain ridges
export function mandelbulbFieldHarmonic(x: number, z: number): number {
  const nx = x * 0.09;
  const nz = z * 0.09;
  let zx = nx;
  let zy = 0.35;
  let zz = nz;
  let dr = 1.0;
  let r = 0.0;
  const power = 4.0;
  for (let i = 0; i < 3; i++) {
    r = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (r > 2.2) break;
    const safeR = Math.max(r, 0.0001);
    const theta = Math.acos(Math.max(-1, Math.min(1, zy / safeR)));
    const phi = Math.atan2(zz, zx);
    dr = Math.pow(safeR, power - 1.0) * power * dr + 1.0;
    const zr = Math.pow(safeR, power);
    const t2 = theta * power;
    const p2 = phi * power;
    zx = zr * Math.sin(t2) * Math.cos(p2) + nx;
    zy = zr * Math.cos(t2) + 0.35;
    zz = zr * Math.sin(t2) * Math.sin(p2) + nz;
  }
  const distEst = (0.5 * Math.log(Math.max(r, 1.001)) * r) / Math.max(dr, 1.0);
  return Math.max(0, Math.min(1, 1 - distEst * 1.4));
}

export function getElevationAt(x: number, z: number): number {
  // Subtle rolling base plains
  let h =
    Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.35 +
    Math.sin(x * 0.19 + z * 0.13) * 0.14;

  // Tactical hills
  for (const hill of TACTICAL_HILLS) {
    const dx = (x - hill.x) / hill.rx;
    const dz = (z - hill.z) / hill.rz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1.0) {
      const falloff = Math.pow(1 - d2, 1.8);
      h += hill.h * falloff;
    }
  }

  // Valleys
  for (const v of VALLEYS) {
    const dx = (x - v.x) / v.rx;
    const dz = (z - v.z) / v.rz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1.0) {
      h -= v.depth * Math.pow(1 - d2, 1.5);
    }
  }

  // Outer mountain ridges modulated by Mandelbulb harmonic
  for (const pk of MOUNTAIN_PEAKS) {
    const dist = Math.hypot(x - pk.x, z - pk.z);
    if (dist < pk.r) {
      const t = 1 - dist / pk.r;
      const harmonic = 0.72 + 0.28 * mandelbulbFieldHarmonic(x * 0.6, z * 0.6);
      h += pk.h * Math.pow(t, 1.45) * harmonic;
    }
  }

  // River bed carving (uniformly deep so water sits cleanly below bridges and banks)
  const riverZ = getRiverCenterZ(x);
  const riverDist = Math.abs(z - riverZ);
  if (riverDist < 5.2) {
    const riverDepth = 2.15;
    const t = Math.cos((riverDist / 5.2) * (Math.PI * 0.5));
    h -= riverDepth * t * t;
  }

  return h;
}

export function getTerrainAt(x: number, z: number): TerrainSample {
  const height = getElevationAt(x, z);
  const riverZ = getRiverCenterZ(x);
  const inRiverChannel = Math.abs(z - riverZ) < 3.4;

  // Check monolith obstacle collision
  for (const m of FRACTAL_MONOLITHS) {
    if (Math.hypot(x - m.x, z - m.z) < m.radius * 0.78) {
      return {
        height,
        type: 'mountain',
        passable: false,
        speedMultiplier: 0.1,
        visionMultiplier: 1.4,
        combatBonus: 0.25,
      };
    }
  }

  if (height >= 5.2 || Math.abs(x) > MAP_HALF - 3 || Math.abs(z) > MAP_HALF - 3) {
    return {
      height,
      type: 'mountain',
      passable: false,
      speedMultiplier: 0.15,
      visionMultiplier: 1.45,
      combatBonus: 0.3,
    };
  }

  if (inRiverChannel && !isBridgeFordAt(x, z)) {
    return {
      height,
      type: 'river',
      passable: true, // Fordable slowly with penalty
      speedMultiplier: 0.55,
      visionMultiplier: 0.85,
      combatBonus: -0.12,
    };
  }

  if (height >= 1.85) {
    return {
      height,
      type: 'hill',
      passable: true,
      speedMultiplier: 0.9,
      visionMultiplier: 1.38, // +38% LoS on high ground
      combatBonus: 0.25, // +25% high ground combat bonus
    };
  }

  if (height <= -0.65) {
    return {
      height,
      type: 'valley',
      passable: true,
      speedMultiplier: 0.95,
      visionMultiplier: 0.76, // -24% LoS in low valleys
      combatBonus: -0.08,
    };
  }

  return {
    height,
    type: 'plains',
    passable: true,
    speedMultiplier: 1.0,
    visionMultiplier: 1.0,
    combatBonus: 0,
  };
}

export function computeEffectiveVision(squad: SquadState): {
  visionRadius: number;
  terrain: TerrainSample;
  onHighGround: boolean;
} {
  const def = UNIT_CLASSES[squad.unitClass];
  const terrain = getTerrainAt(squad.x, squad.z);
  let medalVisionBonus = 0;
  for (const medalId of squad.medals) {
    medalVisionBonus += MEDALS[medalId].visionBonus;
  }

  // Elevation dynamically scales LoS radius (+bonus on hills, -penalty in valleys)
  const elevationFactor = Math.max(0.7, Math.min(1.55, terrain.visionMultiplier + Math.max(0, terrain.height * 0.05)));
  const visionRadius = def.visionRadius * elevationFactor * (1 + medalVisionBonus);
  return {
    visionRadius,
    terrain,
    onHighGround: terrain.type === 'hill' || terrain.height >= 1.85,
  };
}

export function clampToPlayableBounds(x: number, z: number): { x: number; z: number } {
  const margin = 5.5;
  const cx = Math.max(-MAP_HALF + margin, Math.min(MAP_HALF - margin, x));
  const cz = Math.max(-MAP_HALF + margin, Math.min(MAP_HALF - margin, z));

  // Push outside fractal monolith radii if inside
  let fx = cx;
  let fz = cz;
  for (const m of FRACTAL_MONOLITHS) {
    const dx = fx - m.x;
    const dz = fz - m.z;
    const dist = Math.hypot(dx, dz);
    const minR = m.radius * 0.88;
    if (dist < minR) {
      const nx = dist > 0.001 ? dx / dist : 1;
      const nz = dist > 0.001 ? dz / dist : 0;
      fx = m.x + nx * minR;
      fz = m.z + nz * minR;
    }
  }
  return { x: fx, z: fz };
}
