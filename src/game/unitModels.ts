import * as THREE from 'three';
import { getElevationAt, mandelbulbFieldHarmonic } from './terrain';
import type { Faction, UnitClass } from './types';

export interface AssetBank {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  matAlliedCloth: THREE.MeshStandardMaterial;
  matEnemyCloth: THREE.MeshStandardMaterial;
  matAlliedTrim: THREE.MeshStandardMaterial;
  matEnemyTrim: THREE.MeshStandardMaterial;
  matSteel: THREE.MeshStandardMaterial;
  matDarkIron: THREE.MeshStandardMaterial;
  matBrass: THREE.MeshStandardMaterial;
  matWood: THREE.MeshStandardMaterial;
  matLeather: THREE.MeshStandardMaterial;
  matSkin: THREE.MeshStandardMaterial;
  matHorseBrown: THREE.MeshStandardMaterial;
  matHorseDark: THREE.MeshStandardMaterial;
  matHorseWhite: THREE.MeshStandardMaterial;
  matFeather: THREE.MeshStandardMaterial;
  matHitFlash: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export function createAssetBank(): AssetBank {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  return {
    geometries,
    materials,
    matAlliedCloth: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x265c96, roughness: 0.78, metalness: 0.08 }),
    ),
    matEnemyCloth: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x9e2a2b, roughness: 0.78, metalness: 0.08 }),
    ),
    matAlliedTrim: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x5ca4e6, roughness: 0.48, metalness: 0.25 }),
    ),
    matEnemyTrim: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe26d5c, roughness: 0.48, metalness: 0.25 }),
    ),
    matSteel: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xbac4cf, roughness: 0.24, metalness: 0.85 }),
    ),
    matDarkIron: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x454d59, roughness: 0.36, metalness: 0.78 }),
    ),
    matBrass: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd4a84f, roughness: 0.26, metalness: 0.88 }),
    ),
    matWood: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x6b472b, roughness: 0.84, metalness: 0.04 }),
    ),
    matLeather: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x543824, roughness: 0.74, metalness: 0.08 }),
    ),
    matSkin: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd9b392, roughness: 0.72, metalness: 0.02 }),
    ),
    matHorseBrown: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x6e4328, roughness: 0.68, metalness: 0.05 }),
    ),
    matHorseDark: trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2d2420, roughness: 0.66, metalness: 0.06 }),
    ),
    matHorseWhite: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd6d1c7, roughness: 0.65, metalness: 0.05 }),
    ),
    matFeather: trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf1ebd8, roughness: 0.82, metalness: 0.02 }),
    ),
    matHitFlash: trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffd28a,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
    ),
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

function makeGeom<T extends THREE.BufferGeometry>(bank: AssetBank, g: T): T {
  bank.geometries.push(g);
  return g;
}

export function buildSoldierPrototype(
  unitClass: UnitClass,
  faction: Faction,
  bank: AssetBank,
): THREE.Group {
  const root = new THREE.Group();
  const cloth = faction === 'allied' ? bank.matAlliedCloth : bank.matEnemyCloth;
  const trim = faction === 'allied' ? bank.matAlliedTrim : bank.matEnemyTrim;
  const isCavalry = unitClass === 'heavy_cavalry' || unitClass === 'light_cavalry';

  // Shared silhouette geometries cached via closure? Build clean low-poly composite parts (5-11 parts each)
  if (isCavalry) {
    const isHeavy = unitClass === 'heavy_cavalry';
    const horseMat = isHeavy
      ? faction === 'allied'
        ? bank.matHorseWhite
        : bank.matHorseDark
      : bank.matHorseBrown;

    // 1. Horse Torso
    const horseBody = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.54, 0.48, 1.18)),
      horseMat,
    );
    horseBody.position.set(0, 0.72, 0);
    horseBody.castShadow = true;
    root.add(horseBody);

    // 2. Horse Caparison / Saddle Cloth
    const saddle = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.6, 0.28, 0.78)),
      isHeavy ? bank.matSteel : cloth,
    );
    saddle.position.set(0, 0.82, 0.02);
    root.add(saddle);

    // 3. Horse Neck & Head
    const neck = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.28, 0.52, 0.32)),
      horseMat,
    );
    neck.position.set(0, 1.05, 0.48);
    neck.rotation.x = 0.45;
    root.add(neck);

    const head = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.22, 0.22, 0.44)),
      isHeavy ? bank.matSteel : horseMat,
    );
    head.position.set(0, 1.24, 0.68);
    head.rotation.x = 0.35;
    root.add(head);

    // 4. Four legs
    const legGeo = makeGeom(bank, new THREE.CylinderGeometry(0.065, 0.05, 0.54, 6));
    const legOffsets = [
      [-0.18, 0.27, 0.38],
      [0.18, 0.27, 0.38],
      [-0.18, 0.27, -0.42],
      [0.18, 0.27, -0.42],
    ];
    for (const [lx, ly, lz] of legOffsets) {
      const leg = new THREE.Mesh(legGeo, horseMat);
      leg.position.set(lx, ly, lz);
      root.add(leg);
    }

    // 5. Rider Torso
    const riderBody = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.22, 0.25, 0.58, 7)),
      isHeavy ? bank.matSteel : cloth,
    );
    riderBody.position.set(0, 1.26, -0.02);
    riderBody.castShadow = true;
    root.add(riderBody);

    // 6. Rider Head & Helmet
    const riderHead = new THREE.Mesh(
      makeGeom(bank, new THREE.SphereGeometry(0.16, 8, 6)),
      isHeavy ? bank.matSteel : bank.matLeather,
    );
    riderHead.position.set(0, 1.66, 0.02);
    root.add(riderHead);

    // 7. Helmet Plume / Crest
    const plume = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.08, 0.22, 0.28)),
      trim,
    );
    plume.position.set(0, 1.84, -0.04);
    root.add(plume);

    // 8. Weapon: Heavy Lance or Light Curved Saber + Kite Shield
    if (isHeavy) {
      const lance = new THREE.Mesh(
        makeGeom(bank, new THREE.CylinderGeometry(0.035, 0.045, 2.2, 6)),
        bank.matWood,
      );
      lance.position.set(0.32, 1.45, 0.52);
      lance.rotation.x = Math.PI * 0.36;
      root.add(lance);

      const lanceTip = new THREE.Mesh(
        makeGeom(bank, new THREE.ConeGeometry(0.08, 0.32, 6)),
        bank.matSteel,
      );
      lanceTip.position.set(0.32, 1.88, 1.48);
      lanceTip.rotation.x = Math.PI * 0.36;
      root.add(lanceTip);

      const shield = new THREE.Mesh(
        makeGeom(bank, new THREE.BoxGeometry(0.08, 0.58, 0.42)),
        cloth,
      );
      shield.position.set(-0.32, 1.26, 0.14);
      root.add(shield);
    } else {
      const saber = new THREE.Mesh(
        makeGeom(bank, new THREE.BoxGeometry(0.05, 0.85, 0.12)),
        bank.matSteel,
      );
      saber.position.set(0.32, 1.56, 0.24);
      saber.rotation.x = 0.55;
      root.add(saber);
    }

    return root;
  }

  // Foot Soldiers (Infantry, Archers, Scouts)
  const isHeavyInf = unitClass === 'heavy_infantry';
  const isLightInf = unitClass === 'light_infantry';
  const isHeavyArch = unitClass === 'heavy_archers';
  const isLightArch = unitClass === 'light_archers';
  const isScout = unitClass === 'scouts';

  // 1. Boots / Lower Greaves
  const leftLeg = new THREE.Mesh(
    makeGeom(bank, new THREE.CylinderGeometry(0.08, 0.07, 0.48, 6)),
    isHeavyInf ? bank.matDarkIron : bank.matLeather,
  );
  leftLeg.position.set(-0.11, 0.24, 0);
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(
    makeGeom(bank, new THREE.CylinderGeometry(0.08, 0.07, 0.48, 6)),
    isHeavyInf ? bank.matDarkIron : bank.matLeather,
  );
  rightLeg.position.set(0.11, 0.24, 0);
  root.add(rightLeg);

  // 2. Torso / Cuirass
  const torsoMat = isHeavyInf ? bank.matSteel : isHeavyArch ? bank.matDarkIron : cloth;
  const torsoW = isHeavyInf ? 0.28 : 0.23;
  const torso = new THREE.Mesh(
    makeGeom(bank, new THREE.CylinderGeometry(torsoW, torsoW * 0.9, 0.62, 8)),
    torsoMat,
  );
  torso.position.set(0, 0.76, 0);
  torso.castShadow = true;
  root.add(torso);

  // Tabard / Sash accent
  const sash = new THREE.Mesh(
    makeGeom(bank, new THREE.BoxGeometry(torsoW * 1.5, 0.42, 0.08)),
    cloth,
  );
  sash.position.set(0, 0.66, torsoW * 0.85);
  root.add(sash);

  // 3. Pauldrons (Heavy classes)
  if (isHeavyInf || isHeavyArch) {
    const pauldronGeo = makeGeom(bank, new THREE.SphereGeometry(0.14, 7, 5));
    const pL = new THREE.Mesh(pauldronGeo, bank.matSteel);
    pL.position.set(-0.29, 0.98, 0);
    root.add(pL);
    const pR = new THREE.Mesh(pauldronGeo, bank.matSteel);
    pR.position.set(0.29, 0.98, 0);
    root.add(pR);
  }

  // 4. Head
  const head = new THREE.Mesh(
    makeGeom(bank, new THREE.SphereGeometry(0.16, 8, 7)),
    bank.matSkin,
  );
  head.position.set(0, 1.22, 0);
  root.add(head);

  // 5. Distinct Helmet / Hood Silhouette per Class
  if (isHeavyInf) {
    // Crested Iron Greathelm
    const helm = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.18, 0.19, 0.26, 8)),
      bank.matSteel,
    );
    helm.position.set(0, 1.28, 0);
    root.add(helm);

    const crest = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.08, 0.22, 0.28)),
      trim,
    );
    crest.position.set(0, 1.47, 0);
    root.add(crest);
  } else if (isLightInf) {
    // Open Iron Cap
    const cap = new THREE.Mesh(
      makeGeom(bank, new THREE.SphereGeometry(0.175, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      bank.matDarkIron,
    );
    cap.position.set(0, 1.24, 0);
    root.add(cap);
  } else if (isHeavyArch) {
    // Broad Kettle Helmet
    const brim = new THREE.Mesh(
      makeGeom(bank, new THREE.ConeGeometry(0.27, 0.18, 8)),
      bank.matSteel,
    );
    brim.position.set(0, 1.33, 0);
    root.add(brim);
  } else if (isLightArch || isScout) {
    // Hooded Cloak + Feather
    const hood = new THREE.Mesh(
      makeGeom(bank, new THREE.ConeGeometry(0.22, 0.34, 7)),
      isScout ? trim : bank.matLeather,
    );
    hood.position.set(0, 1.32, -0.02);
    hood.rotation.x = -0.18;
    root.add(hood);

    const cloak = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.42, 0.68, 0.1)),
      cloth,
    );
    cloak.position.set(0, 0.78, -0.18);
    cloak.rotation.x = 0.12;
    root.add(cloak);

    const feather = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.04, 0.26, 0.08)),
      bank.matFeather,
    );
    feather.position.set(0.14, 1.44, -0.04);
    feather.rotation.z = -0.3;
    root.add(feather);
  }

  // 6. Distinct Weapons & Shields
  if (isHeavyInf) {
    // Large Tower Shield + Brass Boss
    const shield = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.46, 0.84, 0.08)),
      cloth,
    );
    shield.position.set(-0.22, 0.76, 0.28);
    shield.rotation.y = 0.25;
    shield.castShadow = true;
    root.add(shield);

    const boss = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.09, 0.11, 0.11, 8)),
      bank.matBrass,
    );
    boss.rotation.x = Math.PI * 0.5;
    boss.position.set(-0.22, 0.78, 0.32);
    root.add(boss);

    // Tall Spear
    const spear = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.03, 0.035, 1.9, 6)),
      bank.matWood,
    );
    spear.position.set(0.28, 1.05, 0.14);
    spear.rotation.x = 0.22;
    root.add(spear);

    const spearTip = new THREE.Mesh(
      makeGeom(bank, new THREE.ConeGeometry(0.065, 0.26, 6)),
      bank.matSteel,
    );
    spearTip.position.set(0.28, 2.02, 0.35);
    spearTip.rotation.x = 0.22;
    root.add(spearTip);
  } else if (isLightInf) {
    // Round Buckler + Sword
    const buckler = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10)),
      bank.matBrass,
    );
    buckler.rotation.x = Math.PI * 0.5;
    buckler.rotation.z = 0.35;
    buckler.position.set(-0.26, 0.78, 0.22);
    root.add(buckler);

    const blade = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.05, 0.72, 0.1)),
      bank.matSteel,
    );
    blade.position.set(0.28, 1.04, 0.24);
    blade.rotation.x = 0.55;
    root.add(blade);
  } else if (isHeavyArch || isLightArch) {
    // Bow Arc + Quiver
    const bowH = isHeavyArch ? 1.3 : 0.96;
    const bow = new THREE.Mesh(
      makeGeom(bank, new THREE.TorusGeometry(bowH * 0.48, 0.035, 6, 12, Math.PI)),
      bank.matWood,
    );
    bow.position.set(0.22, 0.96, 0.24);
    bow.rotation.y = Math.PI * 0.5;
    bow.rotation.z = -Math.PI * 0.5;
    root.add(bow);

    const quiver = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.08, 0.07, 0.45, 6)),
      bank.matLeather,
    );
    quiver.position.set(-0.14, 0.88, -0.22);
    quiver.rotation.z = 0.28;
    root.add(quiver);
  } else if (isScout) {
    // Scout Signal Pennant Staff + Spyglass
    const staff = new THREE.Mesh(
      makeGeom(bank, new THREE.CylinderGeometry(0.03, 0.03, 2.0, 6)),
      bank.matWood,
    );
    staff.position.set(0.26, 1.0, 0.12);
    root.add(staff);

    const pennant = new THREE.Mesh(
      makeGeom(bank, new THREE.BoxGeometry(0.03, 0.32, 0.54)),
      trim,
    );
    pennant.position.set(0.26, 1.78, -0.14);
    root.add(pennant);
  }

  return root;
}

/**
 * Procedural Mandelbulb-inspired fractal monolith landmark
 * Built with recursive power-4 spherical crystal lobes + stepped basalt pedestal
 */
export function createMandelbulbMonolithGroup(
  x: number,
  z: number,
  bank: AssetBank,
): THREE.Group {
  const group = new THREE.Group();
  const baseY = getElevationAt(x, z);
  group.position.set(x, baseY, z);

  const matBasalt = new THREE.MeshStandardMaterial({
    color: 0x262d38,
    roughness: 0.72,
    metalness: 0.25,
  });
  const matCrystal = new THREE.MeshStandardMaterial({
    color: 0x3b7a8c,
    emissive: 0x163945,
    emissiveIntensity: 0.65,
    roughness: 0.2,
    metalness: 0.7,
  });
  const matGoldRune = new THREE.MeshStandardMaterial({
    color: 0xd4a84f,
    emissive: 0x5c4212,
    emissiveIntensity: 0.5,
    roughness: 0.25,
    metalness: 0.88,
  });
  bank.materials.push(matBasalt, matCrystal, matGoldRune);

  // Stepped Stone Plinth
  const plinth1 = new THREE.Mesh(
    makeGeom(bank, new THREE.CylinderGeometry(2.6, 3.1, 0.9, 8)),
    matBasalt,
  );
  plinth1.position.y = 0.45;
  plinth1.castShadow = true;
  plinth1.receiveShadow = true;
  group.add(plinth1);

  const plinth2 = new THREE.Mesh(
    makeGeom(bank, new THREE.CylinderGeometry(1.9, 2.3, 0.7, 8)),
    matBasalt,
  );
  plinth2.position.y = 1.25;
  group.add(plinth2);

  // Brass inlay ring
  const runeRing = new THREE.Mesh(
    makeGeom(bank, new THREE.TorusGeometry(2.05, 0.08, 6, 16)),
    matGoldRune,
  );
  runeRing.rotation.x = Math.PI * 0.5;
  runeRing.position.y = 1.6;
  group.add(runeRing);

  // Central Mandelbulb Spire Core
  const core = new THREE.Mesh(
    makeGeom(bank, new THREE.OctahedronGeometry(1.45, 2)),
    matCrystal,
  );
  core.scale.set(1, 2.35, 1);
  core.position.y = 4.6;
  core.castShadow = true;
  group.add(core);

  // Recursive fractal satellite lobes arranged on golden-angle rings
  const lobeGeo = makeGeom(bank, new THREE.IcosahedronGeometry(0.62, 1));
  const subLobeGeo = makeGeom(bank, new THREE.OctahedronGeometry(0.34, 0));

  for (let i = 0; i < 8; i++) {
    const angle = i * 2.399963; // golden angle
    const tierY = 2.6 + (i / 8) * 3.8;
    const radius = 1.45 - Math.abs(i - 3.5) * 0.14;
    const harmonic = mandelbulbFieldHarmonic(x + Math.cos(angle) * 4, z + Math.sin(angle) * 4);
    const lx = Math.cos(angle) * radius;
    const lz = Math.sin(angle) * radius;

    const lobe = new THREE.Mesh(lobeGeo, i % 2 === 0 ? matCrystal : matBasalt);
    lobe.position.set(lx, tierY, lz);
    const s = 0.75 + harmonic * 0.45;
    lobe.scale.set(s, s * 1.2, s);
    lobe.rotation.set(angle, angle * 0.5, 0);
    lobe.castShadow = true;
    group.add(lobe);

    // Secondary fractal bud
    const bud = new THREE.Mesh(subLobeGeo, matGoldRune);
    bud.position.set(lx * 1.28, tierY + 0.35, lz * 1.28);
    bud.rotation.y = angle;
    group.add(bud);
  }

  return group;
}
