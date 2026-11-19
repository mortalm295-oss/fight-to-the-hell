import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { evaluateAiSquadDecision } from './ai';
import { tacticalAudio } from './audio';
import { parseTacticalCommand } from './commandParser';
import {
  DIFFICULTY_CONFIG,
  FOG_GRID_RES,
  MAP_HALF,
  MAP_SIZE,
  MEDALS,
  UNIT_CLASSES,
} from './constants';
import {
  applyMoraleDelta,
  checkBattleOutcome,
  computeAttackDamage,
  computeFormationOffsets,
  evaluateMedals,
  generateInitialArmies,
  getSquadMedalBonuses,
  isPointVisibleInFog,
  splitSquad,
  updateFogOfWar,
} from './rules';
import {
  clampToPlayableBounds,
  computeEffectiveVision,
  FRACTAL_MONOLITHS,
  getElevationAt,
  getRiverCenterZ,
  getTerrainAt,
  isBridgeFordAt,
} from './terrain';
import type {
  ArmyRosterEntry,
  BattleSnapshot,
  DifficultyLevel,
  GamePhase,
  MedalNotification,
  ProjectileState,
  SquadState,
} from './types';
import {
  createAssetBank,
  buildSoldierPrototype,
  createMandelbulbMonolithGroup,
  type AssetBank,
} from './unitModels';

// Pre-allocated scratch math objects (Zero-GC in render loop)
const _dummyObj = new THREE.Object3D();
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _colorScratch = new THREE.Color();

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  colorHex: number;
}

interface SquadVisual {
  squadId: string;
  group: THREE.Group;
  soldierGroups: Map<string, THREE.Group>;
  bannerGroup: THREE.Group;
  bannerMat: THREE.MeshBasicMaterial;
  bannerCanvas: HTMLCanvasElement;
  bannerTex: THREE.CanvasTexture;
  hitCylinder: THREE.Mesh;
  lastBannerHash: string;
}

export interface MinimapDrawData {
  fogGrid: Uint8Array;
  gridRes: number;
  squads: Array<{
    id: string;
    x: number;
    z: number;
    faction: 'allied' | 'enemy';
    selected: boolean;
    routing: boolean;
  }>;
  cameraX: number;
  cameraZ: number;
}

export class BattleEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private assetBank: AssetBank;

  private frameId = 0;
  private lastTime = performance.now();
  private disposed = false;

  // Simulation state
  public phase: GamePhase = 'title';
  private outcome: 'victory' | 'defeat' | null = null;
  private difficulty: DifficultyLevel = 'medium';
  private roster: ArmyRosterEntry[] = [];
  private squads: SquadState[] = [];
  private fogGrid = new Uint8Array(FOG_GRID_RES * FOG_GRID_RES);
  private exploredPercent = 0;
  private elapsedSeconds = 0;
  private selectedSquadId: string | null = null;
  private splitCounter = 1;
  private firstBloodAwarded = { value: false };
  private notifications: MedalNotification[] = [];
  private medalsAwardedCount = 0;
  private commandFeedback: string | null = null;
  private aiTimer = 0;
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private snapshotTimer = 0;

  // Camera rig state
  private camTargetX = 0;
  private camTargetZ = 22;
  private camDesiredX = 0;
  private camDesiredZ = 22;
  private camZoom = 46;
  private camDesiredZoom = 46;
  private camAzimuth = 0;
  private camDesiredAzimuth = 0;
  private titleTourTime = 0;

  // Input state
  private keysHeld = new Set<string>();
  private isDraggingPan = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  // Scene visuals
  private terrainMesh!: THREE.Mesh;
  private waterMaterial: THREE.MeshStandardMaterial | null = null;
  private fogMesh!: THREE.Mesh;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTexture!: THREE.CanvasTexture;
  private selectionRing!: THREE.Mesh;
  private visionRing!: THREE.Mesh;
  private waypointMarker!: THREE.Group;
  private squadVisuals = new Map<string, SquadVisual>();
  private clickTargets: THREE.Object3D[] = [];
  private monoliths: THREE.Group[] = [];

  // Pooled projectiles & particles
  private projectiles: ProjectileState[] = [];
  private arrowInstanced!: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleInstanced!: THREE.InstancedMesh;

  // Callbacks
  private onSnapshot: (snap: BattleSnapshot) => void;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    onSnapshot: (snap: BattleSnapshot) => void,
    initialRoster: ArmyRosterEntry[],
    initialDifficulty: DifficultyLevel,
  ) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    this.roster = initialRoster;
    this.difficulty = initialDifficulty;

    // 1. Software WebGL probe
    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') || probe.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    // 2. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const rect = this.container.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(240, rect.height || window.innerHeight);
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // 3. Scene, Camera, Environment, Lighting
    this.scene = new THREE.Scene();
    const skyBg = new THREE.Color(0x131d29);
    this.scene.background = skyBg;
    this.scene.fog = new THREE.FogExp2(0x131d29, 0.0062);

    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.5, 280);
    this.camera.position.set(0, 38, 52);
    this.camera.lookAt(0, 0, 10);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemiLight = new THREE.HemisphereLight(0x9bc4ec, 0x2f382a, 0.78);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff0d4, 1.85);
    sunLight.position.set(42, 68, 38);
    if (!this.isSoftwareGl) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.width = 1024;
      sunLight.shadow.mapSize.height = 1024;
      const d = 62;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.camera.near = 10;
      sunLight.shadow.camera.far = 165;
      sunLight.shadow.bias = -0.0005;
      sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x5a8cc4, 0.55);
    rimLight.position.set(-45, 32, -45);
    this.scene.add(rimLight);

    this.assetBank = createAssetBank();

    // 4. Build world environment, Fog of War layer, indicators, and pools
    this.buildWorldTerrain();
    this.buildFogOfWarOverlay();
    this.buildTacticalIndicators();
    this.buildPools();

    // 5. Spawn initial preview armies for title flyover
    this.resetSimulation(initialRoster, initialDifficulty, 'title');

    // 6. Bind DOM listeners & ResizeObserver
    this.bindInputListeners();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.lastTime = performance.now();
    this.scheduleNextTick();
  }

  private buildWorldTerrain() {
    // Procedural Canvas ground detail + bump texture for crisp tactical surface readability
    const detailCanvas = document.createElement('canvas');
    detailCanvas.width = 512;
    detailCanvas.height = 512;
    const dCtx = detailCanvas.getContext('2d')!;
    dCtx.fillStyle = '#dcdcdc';
    dCtx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 3600; i++) {
      const gx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const gy = (Math.sin(i * 78.233) * 24634.6345) % 1;
      const x = Math.abs(gx) * 512;
      const y = Math.abs(gy) * 512;
      dCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(20,30,18,0.14)';
      dCtx.fillRect(x, y, 2 + (i % 3), 2 + (i % 2));
    }
    // Subtle tactical grid hairlines
    dCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    dCtx.lineWidth = 1;
    for (let g = 0; g <= 512; g += 64) {
      dCtx.beginPath();
      dCtx.moveTo(g, 0);
      dCtx.lineTo(g, 512);
      dCtx.stroke();
      dCtx.beginPath();
      dCtx.moveTo(0, g);
      dCtx.lineTo(512, g);
      dCtx.stroke();
    }
    const detailTex = new THREE.CanvasTexture(detailCanvas);
    detailTex.colorSpace = THREE.SRGBColorSpace;
    detailTex.wrapS = THREE.RepeatWrapping;
    detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.repeat.set(16, 16);
    detailTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 256;
    bumpCanvas.height = 256;
    const bCtx = bumpCanvas.getContext('2d')!;
    const imgData = bCtx.createImageData(256, 256);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = 110 + ((Math.sin(i * 0.37) * 43758.5453) % 1) * 42;
      imgData.data[i] = v;
      imgData.data[i + 1] = v;
      imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
    bCtx.putImageData(imgData, 0, 0);
    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.repeat.set(18, 18);
    bumpTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // Extended terrain slightly beyond playable bounds so no floating edge void
    const totalSize = MAP_SIZE + 28;
    const segs = 96;
    const terrainGeo = new THREE.PlaneGeometry(totalSize, totalSize, segs, segs);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cPlains = new THREE.Color(0x527342);
    const cValley = new THREE.Color(0x3b5435);
    const cHill = new THREE.Color(0x787e4d);
    const cRock = new THREE.Color(0x585e68);
    const cSnow = new THREE.Color(0xa7b2be);
    const cSand = new THREE.Color(0x88795b);
    const tmpCol = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const y = getElevationAt(vx, vz);
      pos.setY(i, y);

      const t = getTerrainAt(vx, vz);
      if (t.type === 'river') {
        tmpCol.copy(cSand);
      } else if (y > 6.8) {
        tmpCol.copy(cRock).lerp(cSnow, Math.min(1, (y - 6.8) / 3.5));
      } else if (y > 3.6) {
        tmpCol.copy(cHill).lerp(cRock, Math.min(1, (y - 3.6) / 2.6));
      } else if (t.type === 'hill') {
        tmpCol.copy(cPlains).lerp(cHill, Math.min(1, (y - 1.2) / 2.2));
      } else if (t.type === 'valley') {
        tmpCol.copy(cValley);
      } else {
        tmpCol.copy(cPlains);
      }
      const jitter = (Math.sin(vx * 0.45 + vz * 0.37) * 0.5 + 0.5) * 0.05 - 0.025;
      colors[i * 3] = Math.max(0, Math.min(1, tmpCol.r + jitter));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, tmpCol.g + jitter));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, tmpCol.b + jitter));
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: detailTex,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.04,
      bumpMap: bumpTex,
      bumpScale: 0.25,
    });
    this.terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // Animated River Plane spanning across X
    const waterGeo = new THREE.PlaneGeometry(totalSize, 10.5, 48, 8);
    waterGeo.rotateX(-Math.PI / 2);
    const wPos = waterGeo.attributes.position;
    for (let i = 0; i < wPos.count; i++) {
      const wx = wPos.getX(i);
      const wz = wPos.getZ(i);
      wPos.setZ(i, wz + getRiverCenterZ(wx));
    }
    waterGeo.computeVertexNormals();

    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x245d78,
      roughness: 0.16,
      metalness: 0.35,
      transparent: true,
      opacity: 0.86,
    });
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.waterMaterial!.userData.shader = shader;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        transformed.y += sin(position.x * 0.7 + uTime * 2.1) * 0.055 + cos(position.z * 1.1 + uTime * 1.7) * 0.04;
        `,
      );
    };
    const waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
    waterMesh.position.y = -0.82;
    waterMesh.receiveShadow = true;
    this.scene.add(waterMesh);

    // Timber & Stone Tactical Bridges at the 3 crossings (-14, 0, +15)
    const bridgeXs = [-14, 0, 15];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6c737d, roughness: 0.85 });
    for (const bx of bridgeXs) {
      const rz = getRiverCenterZ(bx);
      const bridgeGroup = new THREE.Group();
      bridgeGroup.position.set(bx, 0.24, rz);

      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(8.2, 0.36, 9.6),
        this.assetBank.matWood,
      );
      deck.receiveShadow = true;
      deck.castShadow = true;
      bridgeGroup.add(deck);

      // Stone support piers anchored into riverbed
      const pierGeo = new THREE.BoxGeometry(7.6, 2.2, 1.2);
      const pN = new THREE.Mesh(pierGeo, stoneMat);
      pN.position.set(0, -1.1, -3.4);
      bridgeGroup.add(pN);
      const pS = new THREE.Mesh(pierGeo, stoneMat);
      pS.position.set(0, -1.1, 3.4);
      bridgeGroup.add(pS);

      // Stone bridge parapets
      const railGeo = new THREE.BoxGeometry(0.48, 0.72, 9.6);
      const rL = new THREE.Mesh(railGeo, stoneMat);
      rL.position.set(-3.9, 0.44, 0);
      bridgeGroup.add(rL);
      const rR = new THREE.Mesh(railGeo, stoneMat);
      rR.position.set(3.9, 0.44, 0);
      bridgeGroup.add(rR);

      this.scene.add(bridgeGroup);
    }

    // Two Mandelbulb Fractal Monoliths on High Ground Peaks
    for (const m of FRACTAL_MONOLITHS) {
      const monolith = createMandelbulbMonolithGroup(m.x, m.z, this.assetBank);
      this.scene.add(monolith);
      this.monoliths.push(monolith);
    }

    // Instanced Pine Trees & Rocks on mountain flanks and perimeter (never blocking main roads)
    const treePositions: Array<{ x: number; z: number; scale: number; tint: number }> = [];
    for (let i = 0; i < 110; i++) {
      const angle = i * 2.39996;
      const dist = 36 + (i % 7) * 4.2;
      const tx = Math.cos(angle) * dist * 1.15;
      const tz = Math.sin(angle) * dist * 1.1;
      if (Math.abs(tx) > MAP_HALF + 8 || Math.abs(tz) > MAP_HALF + 8) continue;
      if (Math.abs(tz - getRiverCenterZ(tx)) < 6) continue;
      if (isBridgeFordAt(tx, tz)) continue;
      const t = getTerrainAt(tx, tz);
      if (t.height > 4.9 || t.type === 'river') continue;
      treePositions.push({
        x: tx,
        z: tz,
        scale: 0.85 + ((i * 17) % 30) / 100,
        tint: 0.88 + ((i * 23) % 24) / 100,
      });
    }

    if (treePositions.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.25, 1.3, 6);
      trunkGeo.translate(0, 0.65, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4f3622, roughness: 0.9 });
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);

      const crownGeo = new THREE.ConeGeometry(1.15, 2.8, 7);
      crownGeo.translate(0, 2.3, 0);
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x2d4d32, roughness: 0.85 });
      const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, treePositions.length);
      crownInst.castShadow = !this.isSoftwareGl;

      treePositions.forEach((tp, idx) => {
        const y = getElevationAt(tp.x, tp.z);
        _dummyObj.position.set(tp.x, y, tp.z);
        _dummyObj.rotation.set(0, idx * 1.1, 0);
        _dummyObj.scale.setScalar(tp.scale);
        _dummyObj.updateMatrix();
        trunkInst.setMatrixAt(idx, _dummyObj.matrix);
        crownInst.setMatrixAt(idx, _dummyObj.matrix);
        _colorScratch.setRGB(0.22 * tp.tint, 0.36 * tp.tint, 0.23 * tp.tint);
        crownInst.setColorAt(idx, _colorScratch);
      });
      trunkInst.computeBoundingSphere();
      crownInst.computeBoundingSphere();
      this.scene.add(trunkInst, crownInst);
    }
  }

  private buildFogOfWarOverlay() {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = FOG_GRID_RES;
    this.fogCanvas.height = FOG_GRID_RES;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    this.fogTexture = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTexture.colorSpace = THREE.SRGBColorSpace;
    this.fogTexture.minFilter = THREE.LinearFilter;
    this.fogTexture.magFilter = THREE.LinearFilter;

    // Terrain-conforming shroud plane floating +0.28m above terrain
    const segs = 64;
    const fogGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segs, segs);
    fogGeo.rotateX(-Math.PI / 2);
    const pos = fogGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const fx = pos.getX(i);
      const fz = pos.getZ(i);
      pos.setY(i, getElevationAt(fx, fz) + 0.28);
    }

    const fogMat = new THREE.MeshBasicMaterial({
      map: this.fogTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.fogMesh = new THREE.Mesh(fogGeo, fogMat);
    this.fogMesh.renderOrder = 10;
    this.scene.add(this.fogMesh);
  }

  private refreshFogTexture() {
    const img = this.fogCtx.createImageData(FOG_GRID_RES, FOG_GRID_RES);
    const data = img.data;
    for (let i = 0; i < this.fogGrid.length; i++) {
      const val = this.fogGrid[i];
      const o = i * 4;
      if (val === 2) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
      } else if (val === 1) {
        data[o] = 13;
        data[o + 1] = 19;
        data[o + 2] = 29;
        data[o + 3] = 140;
      } else {
        data[o] = 9;
        data[o + 1] = 13;
        data[o + 2] = 21;
        data[o + 3] = 235;
      }
    }
    this.fogCtx.putImageData(img, 0, 0);
    this.fogTexture.needsUpdate = true;
  }

  private buildTacticalIndicators() {
    const selGeo = new THREE.RingGeometry(2.7, 3.15, 36);
    selGeo.rotateX(-Math.PI / 2);
    const selMat = new THREE.MeshBasicMaterial({
      color: 0xe6b84c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.selectionRing = new THREE.Mesh(selGeo, selMat);
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 12;
    this.scene.add(this.selectionRing);

    const visGeo = new THREE.RingGeometry(0.985, 1.0, 56);
    visGeo.rotateX(-Math.PI / 2);
    const visMat = new THREE.MeshBasicMaterial({
      color: 0x67b8e8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.visionRing = new THREE.Mesh(visGeo, visMat);
    this.visionRing.visible = false;
    this.visionRing.renderOrder = 11;
    this.scene.add(this.visionRing);

    this.waypointMarker = new THREE.Group();
    const wpRing = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.88, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x52d681,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    const wpPillar = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: 0x52d681, transparent: true, opacity: 0.85 }),
    );
    wpPillar.rotation.x = Math.PI;
    wpPillar.position.y = 0.85;
    this.waypointMarker.add(wpRing, wpPillar);
    this.waypointMarker.visible = false;
    this.waypointMarker.renderOrder = 12;
    this.scene.add(this.waypointMarker);
  }

  private buildPools() {
    // Pooled Arrow Mesh (160 slots)
    const arrowGeo = new THREE.CylinderGeometry(0.03, 0.04, 1.05, 5);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xf4dca4 });
    this.arrowInstanced = new THREE.InstancedMesh(arrowGeo, arrowMat, 160);
    this.arrowInstanced.frustumCulled = false;
    this.arrowInstanced.count = 0;
    this.scene.add(this.arrowInstanced);

    for (let i = 0; i < 160; i++) {
      this.projectiles.push({
        id: `p-${i}`,
        faction: 'allied',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        damage: 0,
        targetSquadId: '',
        sourceSquadId: '',
        life: 0,
        maxLife: 1,
        active: false,
      });
    }

    // Pooled Particle Burst Mesh (240 slots)
    const partGeo = new THREE.OctahedronGeometry(0.16, 0);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstanced = new THREE.InstancedMesh(partGeo, partMat, 240);
    this.particleInstanced.frustumCulled = false;
    this.particleInstanced.count = 0;
    this.scene.add(this.particleInstanced);

    for (let i = 0; i < 240; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        scale: 1,
        colorHex: 0xffd078,
      });
    }
  }

  private spawnParticles(x: number, y: number, z: number, count: number, colorHex: number, spread = 4.2) {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const a = Math.random() * Math.PI * 2;
        const s = (0.4 + Math.random() * 0.8) * spread;
        p.vx = Math.cos(a) * s;
        p.vy = 1.6 + Math.random() * 3.4;
        p.vz = Math.sin(a) * s;
        p.life = 0;
        p.maxLife = 0.28 + Math.random() * 0.25;
        p.scale = 0.7 + Math.random() * 0.9;
        p.colorHex = colorHex;
        spawned++;
      }
    }
  }

  private clearSquadVisuals() {
    for (const vis of this.squadVisuals.values()) {
      this.scene.remove(vis.group);
      vis.bannerTex.dispose();
      vis.bannerMat.dispose();
    }
    this.squadVisuals.clear();
    this.clickTargets = [];
  }

  private ensureSquadVisual(sq: SquadState): SquadVisual {
    const existing = this.squadVisuals.get(sq.id);
    if (existing) return existing;

    const group = new THREE.Group();
    const soldierGroups = new Map<string, THREE.Group>();

    for (const s of sq.soldiers) {
      const sMesh = buildSoldierPrototype(sq.unitClass, sq.faction, this.assetBank);
      const sy = getElevationAt(s.x, s.z);
      sMesh.position.set(s.x, sy, s.z);
      sMesh.rotation.y = sq.facing;
      group.add(sMesh);
      soldierGroups.set(s.id, sMesh);
    }

    // Overhead Morale & HP Banner Billboard
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 192;
    bannerCanvas.height = 64;
    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    bannerTex.colorSpace = THREE.SRGBColorSpace;
    const bannerMat = new THREE.MeshBasicMaterial({
      map: bannerTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const bannerPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.26), bannerMat);
    const bannerGroup = new THREE.Group();
    bannerGroup.add(bannerPlane);
    bannerGroup.position.set(sq.x, getElevationAt(sq.x, sq.z) + 3.6, sq.z);
    group.add(bannerGroup);

    // Simplified click proxy cylinder for reliable fast raycasting
    const hitGeo = new THREE.CylinderGeometry(3.2, 3.2, 3.4, 10);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitCylinder = new THREE.Mesh(hitGeo, hitMat);
    hitCylinder.userData.squadId = sq.id;
    hitCylinder.position.set(sq.x, getElevationAt(sq.x, sq.z) + 1.4, sq.z);
    group.add(hitCylinder);
    this.clickTargets.push(hitCylinder);

    this.scene.add(group);
    const vis: SquadVisual = {
      squadId: sq.id,
      group,
      soldierGroups,
      bannerGroup,
      bannerMat,
      bannerCanvas,
      bannerTex,
      hitCylinder,
      lastBannerHash: '',
    };
    this.squadVisuals.set(sq.id, vis);
    this.updateSquadBanner(sq, vis);
    return vis;
  }

  private updateSquadBanner(sq: SquadState, vis: SquadVisual) {
    const alive = sq.soldiers.filter((s) => s.alive).length;
    const total = sq.soldiers.length;
    const moraleInt = Math.round(sq.morale);
    const isSelected = sq.id === this.selectedSquadId;
    const hash = `${alive}/${total}|${moraleInt}|${sq.routing}|${sq.formation}|${isSelected}|${sq.medals.length}`;
    if (hash === vis.lastBannerHash) return;
    vis.lastBannerHash = hash;

    const ctx = vis.bannerCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 192, 64);

    // Backdrop plaque
    ctx.fillStyle = isSelected ? 'rgba(18, 26, 38, 0.94)' : 'rgba(13, 18, 27, 0.84)';
    ctx.fillRect(8, 8, 176, 48);
    ctx.strokeStyle = isSelected
      ? '#e6b84c'
      : sq.faction === 'allied'
        ? '#4e8ed4'
        : '#cf4e49';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(8, 8, 176, 48);

    // Label
    ctx.fillStyle = sq.routing ? '#f6b95c' : '#efeae0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    const label = sq.routing
      ? 'ROUTING!'
      : `${UNIT_CLASSES[sq.unitClass].name.split(' ').map((w) => w[0]).join('')} · ${alive}/${total}`;
    ctx.fillText(label, 16, 26);

    // Medal pips (up to 4)
    for (let m = 0; m < sq.medals.length; m++) {
      ctx.fillStyle = MEDALS[sq.medals[m]].accentColor;
      ctx.beginPath();
      ctx.arc(166 - m * 12, 20, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // HP Bar
    const hpRatio = total > 0 ? alive / total : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(16, 33, 160, 6);
    ctx.fillStyle = sq.faction === 'allied' ? '#49b675' : '#e0534e';
    ctx.fillRect(16, 33, 160 * hpRatio, 6);

    // Morale Bar (0-100%, amber below 25% threshold)
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(16, 43, 160, 6);
    ctx.fillStyle = sq.morale < 25 ? '#e67e22' : '#e6c15a';
    ctx.fillRect(16, 43, 160 * (sq.morale / sq.maxMorale), 6);

    vis.bannerTex.needsUpdate = true;
  }

  public resetSimulation(
    roster: ArmyRosterEntry[],
    difficulty: DifficultyLevel,
    nextPhase: GamePhase,
  ) {
    this.roster = roster;
    this.difficulty = difficulty;
    this.phase = nextPhase;
    this.outcome = null;
    this.elapsedSeconds = 0;
    this.aiTimer = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;
    this.splitCounter = 1;
    this.firstBloodAwarded = { value: false };
    this.notifications = [];
    this.medalsAwardedCount = 0;
    this.commandFeedback = null;
    this.fogGrid.fill(0);

    for (const p of this.projectiles) p.active = false;
    for (const p of this.particles) p.active = false;
    this.arrowInstanced.count = 0;
    this.particleInstanced.count = 0;

    this.clearSquadVisuals();
    this.squads = generateInitialArmies(roster, difficulty);
    for (const sq of this.squads) {
      this.ensureSquadVisual(sq);
    }

    const firstAlly = this.squads.find((s) => s.faction === 'allied');
    this.selectedSquadId = firstAlly ? firstAlly.id : null;

    const fogRes = updateFogOfWar(this.fogGrid, this.squads, FOG_GRID_RES, false);
    this.exploredPercent = fogRes.exploredPercent;
    this.refreshFogTexture();
    this.fogMesh.visible = nextPhase !== 'title' && nextPhase !== 'setup';

    if (nextPhase === 'playing') {
      this.camDesiredX = 0;
      this.camDesiredZ = 18;
      this.camTargetX = 0;
      this.camTargetZ = 18;
      this.camDesiredZoom = 48;
      this.camZoom = 48;
      this.camDesiredAzimuth = 0;
      this.camAzimuth = 0;
    }

    this.emitSnapshot(true);
  }

  public setPhase(nextPhase: GamePhase) {
    this.phase = nextPhase;
    this.fogMesh.visible = nextPhase !== 'title' && nextPhase !== 'setup';
    if (nextPhase === 'playing') {
      this.camDesiredX = 0;
      this.camDesiredZ = 18;
      this.camDesiredZoom = 48;
      this.camDesiredAzimuth = 0;
    }
    this.emitSnapshot(true);
  }

  public selectSquadById(id: string | null) {
    const found = this.squads.find((s) => s.id === id && s.faction === 'allied' && !s.eliminated);
    this.selectedSquadId = found ? found.id : null;
    this.emitSnapshot(true);
  }

  public panToWorld(x: number, z: number) {
    this.camDesiredX = Math.max(-MAP_HALF + 8, Math.min(MAP_HALF - 8, x));
    this.camDesiredZ = Math.max(-MAP_HALF + 8, Math.min(MAP_HALF - 8, z));
  }

  public resetCamera() {
    this.camDesiredX = 0;
    this.camDesiredZ = 22;
    this.camDesiredZoom = 46;
    this.camDesiredAzimuth = 0;
  }

  public issueTextCommand(rawText: string): { ok: boolean; feedback: string } {
    const sq = this.squads.find(
      (s) => s.id === this.selectedSquadId && s.faction === 'allied' && !s.eliminated,
    );
    if (!sq) {
      const msg = 'Select a friendly squad first to issue tactical orders.';
      this.commandFeedback = msg;
      this.emitSnapshot(true);
      return { ok: false, feedback: msg };
    }
    if (sq.routing) {
      const msg = `${sq.name} has broken morale and is routing!`;
      this.commandFeedback = msg;
      this.emitSnapshot(true);
      return { ok: false, feedback: msg };
    }

    const parsed = parseTacticalCommand(rawText);
    if (parsed.action === 'unknown') {
      this.commandFeedback = parsed.feedback;
      this.emitSnapshot(true);
      return { ok: false, feedback: parsed.feedback };
    }

    tacticalAudio.playOrderDrum();

    if (parsed.action === 'split') {
      const newId = `${sq.id}-div-${this.splitCounter++}`;
      const result = splitSquad(sq, newId);
      if (!result) {
        const msg = `${sq.name} is too small to split further.`;
        this.commandFeedback = msg;
        this.emitSnapshot(true);
        return { ok: false, feedback: msg };
      }

      // Remove old visual and replace with 2 fresh visuals
      const oldVis = this.squadVisuals.get(sq.id);
      if (oldVis) {
        this.scene.remove(oldVis.group);
        oldVis.bannerTex.dispose();
        oldVis.bannerMat.dispose();
        this.squadVisuals.delete(sq.id);
        this.clickTargets = this.clickTargets.filter((t) => t.userData.squadId !== sq.id);
      }

      const idx = this.squads.findIndex((s) => s.id === sq.id);
      if (idx >= 0) {
        this.squads.splice(idx, 1, result.first, result.second);
      }
      this.ensureSquadVisual(result.first);
      this.ensureSquadVisual(result.second);
      this.selectedSquadId = result.first.id;

      const msg = `${result.first.name} & ${result.second.name} formed!`;
      this.commandFeedback = msg;
      this.emitSnapshot(true);
      return { ok: true, feedback: msg };
    }

    if (parsed.action === 'shield_wall') {
      if (!UNIT_CLASSES[sq.unitClass].canShieldWall) {
        sq.formation = 'standard';
        const msg = `${sq.name} braces ranks (only Heavy Infantry carry tower shields).`;
        this.commandFeedback = msg;
        this.emitSnapshot(true);
        return { ok: true, feedback: msg };
      }
      sq.formation = 'shield_wall';
      sq.isHoldPosition = false;
    } else if (parsed.action === 'line') {
      sq.formation = 'line';
    } else if (parsed.action === 'dispersed') {
      sq.formation = 'dispersed';
    } else if (parsed.action === 'standard') {
      sq.formation = 'standard';
    } else if (parsed.action === 'hold') {
      sq.targetX = sq.x;
      sq.targetZ = sq.z;
      sq.isHoldPosition = true;
    } else if (parsed.action === 'retreat') {
      const dist = parsed.distance ?? 16;
      const dest = clampToPlayableBounds(sq.x, sq.z + dist);
      sq.targetX = dest.x;
      sq.targetZ = dest.z;
      sq.targetSquadId = null;
      sq.isHoldPosition = false;
    } else if (parsed.action === 'flank') {
      const dist = parsed.distance ?? 18;
      const angle = sq.facing + (parsed.angleOffset ?? Math.PI * 0.42);
      const dest = clampToPlayableBounds(
        sq.x + Math.sin(angle) * dist,
        sq.z + Math.cos(angle) * dist,
      );
      sq.targetX = dest.x;
      sq.targetZ = dest.z;
      sq.isHoldPosition = false;
    } else if (parsed.action === 'advance' || parsed.action === 'move') {
      const dist = parsed.distance ?? 15;
      let dx = Math.sin(sq.facing);
      let dz = Math.cos(sq.facing);
      if (parsed.directionVector) {
        dx = parsed.directionVector.dx;
        dz = parsed.directionVector.dz;
      }
      const dest = clampToPlayableBounds(sq.x + dx * dist, sq.z + dz * dist);
      sq.targetX = dest.x;
      sq.targetZ = dest.z;
      sq.isHoldPosition = false;
      sq.targetSquadId = null;
    }

    this.commandFeedback = `${sq.name}: ${parsed.feedback}`;
    this.emitSnapshot(true);
    return { ok: true, feedback: this.commandFeedback };
  }

  public getMinimapData(): MinimapDrawData {
    return {
      fogGrid: this.fogGrid,
      gridRes: FOG_GRID_RES,
      squads: this.squads
        .filter((s) => !s.eliminated)
        .filter(
          (s) => s.faction === 'allied' || isPointVisibleInFog(this.fogGrid, s.x, s.z),
        )
        .map((s) => ({
          id: s.id,
          x: s.x,
          z: s.z,
          faction: s.faction,
          selected: s.id === this.selectedSquadId,
          routing: s.routing,
        })),
      cameraX: this.camTargetX,
      cameraZ: this.camTargetZ,
    };
  }

  private bindInputListeners() {
    const canvas = this.renderer.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal keys when typing in the command input bar
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      this.keysHeld.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keysHeld.delete(e.code);
    };
    const onBlur = () => {
      this.keysHeld.clear();
      this.isDraggingPan = false;
    };

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (this.phase !== 'playing') return;
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        this.isDraggingPan = true;
        this.dragMoved = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        return;
      }

      updateNdc(e.clientX, e.clientY);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);

      // Right-click = Move / Attack Order
      if (e.button === 2) {
        e.preventDefault();
        this.handleOrderClick();
        return;
      }

      // Left-click: Select friendly squad, or if clicking visible enemy while friendly selected -> attack
      if (e.button === 0) {
        const hits = this.raycaster.intersectObjects(this.clickTargets, false);
        if (hits.length > 0) {
          const hitId = hits[0].object.userData.squadId as string;
          const clickedSq = this.squads.find((s) => s.id === hitId && !s.eliminated);
          if (clickedSq) {
            if (clickedSq.faction === 'allied') {
              this.selectSquadById(clickedSq.id);
              tacticalAudio.playOrderDrum();
              return;
            }
            // Clicked a visible enemy squad -> attack if we have a selected friendly squad
            if (
              clickedSq.faction === 'enemy' &&
              isPointVisibleInFog(this.fogGrid, clickedSq.x, clickedSq.z) &&
              this.selectedSquadId
            ) {
              this.issueAttackTarget(clickedSq);
              return;
            }
          }
        }
        // Start potential drag-pan if clicked empty ground
        this.isDraggingPan = true;
        this.dragMoved = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isDraggingPan || this.phase !== 'playing') return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.hypot(dx, dy) > 4) this.dragMoved = true;
      if (this.dragMoved) {
        const panScale = this.camZoom * 0.0022;
        const cosA = Math.cos(this.camAzimuth);
        const sinA = Math.sin(this.camAzimuth);
        this.camDesiredX = Math.max(
          -MAP_HALF + 8,
          Math.min(MAP_HALF - 8, this.camDesiredX - (dx * cosA + dy * sinA) * panScale),
        );
        this.camDesiredZ = Math.max(
          -MAP_HALF + 8,
          Math.min(MAP_HALF - 8, this.camDesiredZ - (-dx * sinA + dy * cosA) * panScale),
        );
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      }
    };

    const onPointerUp = () => {
      this.isDraggingPan = false;
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (this.phase !== 'playing') return;
      updateNdc(e.clientX, e.clientY);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      this.handleOrderClick();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onWheel = (e: WheelEvent) => {
      if (this.phase !== 'playing') return;
      e.preventDefault();
      this.camDesiredZoom = Math.max(24, Math.min(76, this.camDesiredZoom + e.deltaY * 0.035));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    this.cleanupListeners = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
    };
  }

  private cleanupListeners: () => void = () => {};

  private issueAttackTarget(enemy: SquadState) {
    const sq = this.squads.find(
      (s) => s.id === this.selectedSquadId && s.faction === 'allied' && !s.eliminated && !s.routing,
    );
    if (!sq) return;
    sq.targetSquadId = enemy.id;
    sq.targetX = enemy.x;
    sq.targetZ = enemy.z;
    sq.isHoldPosition = false;
    tacticalAudio.playOrderDrum();
    this.commandFeedback = `${sq.name}: Engaging ${enemy.name}!`;
    this.emitSnapshot(true);
  }

  private handleOrderClick() {
    const sq = this.squads.find(
      (s) => s.id === this.selectedSquadId && s.faction === 'allied' && !s.eliminated && !s.routing,
    );
    if (!sq) return;

    // First check enemy squad hit
    const unitHits = this.raycaster.intersectObjects(this.clickTargets, false);
    if (unitHits.length > 0) {
      const hitId = unitHits[0].object.userData.squadId as string;
      const enemy = this.squads.find(
        (s) =>
          s.id === hitId &&
          s.faction === 'enemy' &&
          !s.eliminated &&
          isPointVisibleInFog(this.fogGrid, s.x, s.z),
      );
      if (enemy) {
        this.issueAttackTarget(enemy);
        return;
      }
    }

    // Otherwise intersect terrain
    const terrainHits = this.raycaster.intersectObject(this.terrainMesh, false);
    if (terrainHits.length > 0) {
      const pt = terrainHits[0].point;
      const dest = clampToPlayableBounds(pt.x, pt.z);
      sq.targetX = dest.x;
      sq.targetZ = dest.z;
      sq.targetSquadId = null;
      sq.isHoldPosition = false;
      tacticalAudio.playOrderDrum();
      this.commandFeedback = `${sq.name}: Moving to (${Math.round(dest.x)}, ${Math.round(dest.z)}).`;
      this.emitSnapshot(true);
    }
  }

  private handleResize() {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(240, rect.height || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private scheduleNextTick() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick() {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    // Animate water shader
    if (this.waterMaterial?.userData.shader) {
      this.waterMaterial.userData.shader.uniforms.uTime.value += dt;
    }

    // Subtle rotation on Mandelbulb fractal cores
    for (const m of this.monoliths) {
      const core = m.children[3];
      if (core) core.rotation.y += dt * 0.28;
    }

    if (this.phase === 'title' || this.phase === 'setup') {
      this.updateTitleCamera(dt);
    } else if (this.phase === 'playing') {
      this.updateCameraControls(dt);
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= dt;
      } else {
        this.stepSimulation(dt);
      }
      this.updateParticlesAndArrows(dt);
    }

    this.syncVisuals(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.phase === 'playing') {
      this.snapshotTimer += dt;
      if (this.snapshotTimer >= 0.14) {
        this.snapshotTimer = 0;
        this.emitSnapshot(false);
      }
    }

    this.scheduleNextTick();
  }

  private updateTitleCamera(dt: number) {
    this.titleTourTime += dt * 0.16;
    const r = 46;
    const cx = Math.sin(this.titleTourTime) * r * 0.72;
    const cz = Math.cos(this.titleTourTime) * r * 0.72;
    this.camera.position.set(cx, 25 + Math.sin(this.titleTourTime * 1.4) * 3.5, cz);
    this.camera.lookAt(-6, 3.2, -2);
  }

  private updateCameraControls(dt: number) {
    const panSpeed = 34 * dt;
    const cosA = Math.cos(this.camAzimuth);
    const sinA = Math.sin(this.camAzimuth);
    let forward = 0;
    let strafe = 0;

    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) forward += 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) forward -= 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) strafe -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) strafe += 1;
    if (this.keysHeld.has('KeyQ')) this.camDesiredAzimuth -= 1.2 * dt;
    if (this.keysHeld.has('KeyE')) this.camDesiredAzimuth += 1.2 * dt;

    if (forward !== 0 || strafe !== 0) {
      this.camDesiredX = Math.max(
        -MAP_HALF + 8,
        Math.min(MAP_HALF - 8, this.camDesiredX + (strafe * cosA - forward * sinA) * panSpeed),
      );
      this.camDesiredZ = Math.max(
        -MAP_HALF + 8,
        Math.min(MAP_HALF - 8, this.camDesiredZ + (-strafe * sinA - forward * cosA) * panSpeed),
      );
    }

    const damp = 1 - Math.exp(-10 * dt);
    this.camTargetX += (this.camDesiredX - this.camTargetX) * damp;
    this.camTargetZ += (this.camDesiredZ - this.camTargetZ) * damp;
    this.camZoom += (this.camDesiredZoom - this.camZoom) * damp;
    this.camAzimuth += (this.camDesiredAzimuth - this.camAzimuth) * damp;

    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);
    const shake = this.cameraTrauma * this.cameraTrauma * 0.65;
    const sx = (Math.random() * 2 - 1) * shake;
    const sz = (Math.random() * 2 - 1) * shake;

    const camY = this.camZoom * 0.78;
    const camBack = this.camZoom * 0.66;
    this.camera.position.set(
      this.camTargetX + Math.sin(this.camAzimuth) * camBack + sx,
      camY,
      this.camTargetZ + Math.cos(this.camAzimuth) * camBack + sz,
    );
    this.camera.lookAt(this.camTargetX, 0.8, this.camTargetZ);
  }

  private stepSimulation(dt: number) {
    this.elapsedSeconds += dt;

    // 1. Enemy AI Commander decisions
    const diffCfg = DIFFICULTY_CONFIG[this.difficulty];
    this.aiTimer += dt;
    if (this.aiTimer >= diffCfg.aiReactionSec) {
      this.aiTimer = 0;
      this.runEnemyAi();
    }

    // 2. Move squads & soldiers, evaluate high ground & combat
    for (const sq of this.squads) {
      if (sq.eliminated) continue;

      const aliveSoldiers = sq.soldiers.filter((s) => s.alive);
      if (aliveSoldiers.length === 0) {
        sq.eliminated = true;
        continue;
      }

      const def = UNIT_CLASSES[sq.unitClass];
      const bonuses = getSquadMedalBonuses(sq);
      const terrain = getTerrainAt(sq.x, sq.z);
      sq.lastTerrain = terrain.type;
      sq.onHighGround = terrain.type === 'hill' || terrain.height >= 1.85;

      if (sq.onHighGround && this.elapsedSeconds - sq.lastAttackedAt < 8) {
        sq.highGroundTime += dt;
      }

      // Routing squads flee toward their home edge
      if (sq.routing) {
        sq.targetX = sq.x;
        sq.targetZ = sq.faction === 'allied' ? MAP_HALF - 4 : -MAP_HALF + 4;
        sq.targetSquadId = null;
        if (Math.abs(sq.z) > MAP_HALF - 7) {
          sq.eliminated = true;
          continue;
        }
      }

      // Follow chased target squad if assigned
      if (sq.targetSquadId) {
        const tgt = this.squads.find((t) => t.id === sq.targetSquadId && !t.eliminated);
        if (!tgt) {
          sq.targetSquadId = null;
        } else {
          const distToTgt = Math.hypot(tgt.x - sq.x, tgt.z - sq.z);
          if (distToTgt > def.range * 0.85) {
            sq.targetX = tgt.x;
            sq.targetZ = tgt.z;
          } else {
            sq.targetX = sq.x;
            sq.targetZ = sq.z;
          }
        }
      }

      // Move squad center toward target
      const dx = sq.targetX - sq.x;
      const dz = sq.targetZ - sq.z;
      const dist = Math.hypot(dx, dz);

      let formSpeedMult = 1.0;
      if (sq.formation === 'shield_wall') formSpeedMult = 0.52;
      else if (sq.formation === 'line') formSpeedMult = 0.82;
      else if (sq.routing) formSpeedMult = 1.25;

      const moveSpeed = def.speed * terrain.speedMultiplier * bonuses.speedMult * formSpeedMult;
      if (dist > 0.35 && !sq.isHoldPosition) {
        const step = Math.min(dist, moveSpeed * dt);
        const nx = sq.x + (dx / dist) * step;
        const nz = sq.z + (dz / dist) * step;
        const clamped = clampToPlayableBounds(nx, nz);
        sq.x = clamped.x;
        sq.z = clamped.z;
        sq.facing = Math.atan2(dx, dz);
      }

      // Update formation offsets & individual soldier smoothing
      const offsets = computeFormationOffsets(sq.formation, aliveSoldiers.length, sq.facing);
      aliveSoldiers.forEach((s, idx) => {
        s.offsetX = offsets[idx].ox;
        s.offsetZ = offsets[idx].oz;
        const goalX = sq.x + s.offsetX;
        const goalZ = sq.z + s.offsetZ;
        const sdx = goalX - s.x;
        const sdz = goalZ - s.z;
        const sDist = Math.hypot(sdx, sdz);
        const sStep = Math.min(sDist, moveSpeed * 1.45 * dt);
        if (sDist > 0.04) {
          s.x += (sdx / sDist) * sStep;
          s.z += (sdz / sDist) * sStep;
          s.walkPhase += sStep * 3.4;
        }
        if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);
        if (s.attackAnim > 0) s.attackAnim = Math.max(0, s.attackAnim - dt);
      });

      // KO fade timers for fallen soldiers
      for (const s of sq.soldiers) {
        if (!s.alive && s.koTimer < 1) {
          s.koTimer = Math.min(1, s.koTimer + dt * 2.5);
        }
      }

      // Combat engagement
      if (!sq.routing) {
        sq.attackTimer -= dt;
        const rangeBonus = def.isRanged && sq.onHighGround ? 4.5 : 0;
        const effectiveRange = def.range + rangeBonus;

        // Find closest non-eliminated enemy within range
        let bestEnemy: SquadState | null = null;
        let bestDist = Infinity;
        for (const other of this.squads) {
          if (other.faction === sq.faction || other.eliminated) continue;
          // Allied ranged squads require enemy to be visible in Fog of War
          if (
            sq.faction === 'allied' &&
            !isPointVisibleInFog(this.fogGrid, other.x, other.z)
          ) {
            continue;
          }
          const d = Math.hypot(other.x - sq.x, other.z - sq.z);
          if (d <= effectiveRange + 1.8 && d < bestDist) {
            bestDist = d;
            bestEnemy = other;
          }
        }

        if (bestEnemy) {
          // Face enemy when fighting
          sq.facing = Math.atan2(bestEnemy.x - sq.x, bestEnemy.z - sq.z);
          sq.lastAttackedAt = this.elapsedSeconds;

          if (sq.attackTimer <= 0) {
            sq.attackTimer = def.attackCooldown;
            if (def.isRanged) {
              this.fireVolley(sq, bestEnemy);
            } else {
              this.executeMeleeStrike(sq, bestEnemy);
            }
          }
        } else if (this.elapsedSeconds - sq.lastAttackedAt > 5.0) {
          // Gradual morale recovery out of combat
          sq.morale = Math.min(sq.maxMorale, sq.morale + dt * 2.5);
        }
      }
    }

    // 3. Update Fog of War
    const fogRes = updateFogOfWar(this.fogGrid, this.squads);
    this.exploredPercent = fogRes.exploredPercent;
    this.refreshFogTexture();

    // 4. Evaluate Commander Medals
    const newMedals = evaluateMedals(this.squads, this.firstBloodAwarded);
    for (const item of newMedals) {
      const medalDef = MEDALS[item.medalId];
      this.medalsAwardedCount++;
      this.notifications.unshift({
        id: `${item.squad.id}-${item.medalId}-${Date.now()}`,
        squadName: item.squad.name,
        commanderName: item.squad.commanderName,
        medal: medalDef,
        timestamp: this.elapsedSeconds,
      });
      if (this.notifications.length > 4) this.notifications.pop();
      tacticalAudio.playMedalFanfare();
    }

    // 5. Check Total Annihilation / All Routed Victory Condition
    const outcome = checkBattleOutcome(this.squads);
    if (outcome) {
      this.outcome = outcome;
      this.phase = 'gameover';
      tacticalAudio.playVictoryChord(outcome === 'victory');
      this.emitSnapshot(true);
    }
  }

  private fireVolley(attacker: SquadState, target: SquadState) {
    const aliveAttackers = attacker.soldiers.filter((s) => s.alive);
    const shots = Math.min(aliveAttackers.length, 4);
    tacticalAudio.playBowRelease();

    for (let i = 0; i < shots; i++) {
      const shooter = aliveAttackers[Math.floor(Math.random() * aliveAttackers.length)];
      shooter.attackAnim = 0.25;
      const slot = this.projectiles.find((p) => !p.active);
      if (!slot) break;

      const startY = getElevationAt(shooter.x, shooter.z) + 1.3;
      const tgtX = target.x + (Math.random() - 0.5) * 3.0;
      const tgtZ = target.z + (Math.random() - 0.5) * 3.0;
      const tgtY = getElevationAt(tgtX, tgtZ) + 0.8;
      const dist = Math.hypot(tgtX - shooter.x, tgtZ - shooter.z);
      const flightTime = Math.max(0.32, Math.min(1.15, dist / 28));

      slot.active = true;
      slot.faction = attacker.faction;
      slot.x = shooter.x;
      slot.y = startY;
      slot.z = shooter.z;
      slot.vx = (tgtX - shooter.x) / flightTime;
      slot.vz = (tgtZ - shooter.z) / flightTime;
      slot.vy = (tgtY - startY + 0.5 * 14 * flightTime * flightTime) / flightTime;
      slot.damage = computeAttackDamage({
        attacker,
        defender: target,
        isRangedHit: true,
        difficulty: this.difficulty,
      }).damage * 0.72;
      slot.targetSquadId = target.id;
      slot.sourceSquadId = attacker.id;
      slot.life = 0;
      slot.maxLife = flightTime;
    }
  }

  private executeMeleeStrike(attacker: SquadState, defender: SquadState) {
    const aliveAtt = attacker.soldiers.filter((s) => s.alive);
    const aliveDef = defender.soldiers.filter((s) => s.alive);
    if (aliveAtt.length === 0 || aliveDef.length === 0) return;

    const strikes = Math.max(1, Math.min(4, Math.ceil(aliveAtt.length / 3)));
    let killedAny = false;

    for (let i = 0; i < strikes; i++) {
      const swing = aliveAtt[i % aliveAtt.length];
      swing.attackAnim = 0.28;

      const victim = aliveDef[Math.floor(Math.random() * aliveDef.length)];
      if (!victim.alive) continue;

      const res = computeAttackDamage({
        attacker,
        defender,
        isRangedHit: false,
        difficulty: this.difficulty,
      });

      defender.damageBlocked += res.blocked;
      if (res.flanked) attacker.flankHits += 1;

      victim.hp -= res.damage;
      victim.hitFlash = 0.14;
      defender.lastAttackedAt = this.elapsedSeconds;

      const vy = getElevationAt(victim.x, victim.z) + 1.0;
      this.spawnParticles(victim.x, vy, victim.z, 5, 0xffd27a, 3.6);

      if (victim.hp <= 0) {
        victim.alive = false;
        victim.hp = 0;
        attacker.kills += 1;
        killedAny = true;
        this.spawnParticles(victim.x, vy, victim.z, 12, 0xe05248, 5.2);

        const moraleHit = res.flanked ? -11.5 : -7.5;
        const routed = applyMoraleDelta(defender, moraleHit);
        if (routed) {
          this.onSquadRouted(defender);
        }
      } else if (res.flanked) {
        const routed = applyMoraleDelta(defender, -3.2);
        if (routed) this.onSquadRouted(defender);
      }
    }

    tacticalAudio.playMeleeClash(killedAny);
    if (killedAny) {
      this.hitstopTimer = 0.032;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.28);
    }
  }

  private onSquadRouted(routedSquad: SquadState) {
    tacticalAudio.playRoutHorn();
    this.commandFeedback = `${routedSquad.name} morale shattered (<25%) — ROUTING!`;
    // Shockwave morale drop to nearby allied squads of the same faction
    for (const sq of this.squads) {
      if (sq.faction === routedSquad.faction && sq.id !== routedSquad.id && !sq.eliminated) {
        const d = Math.hypot(sq.x - routedSquad.x, sq.z - routedSquad.z);
        if (d < 22) {
          applyMoraleDelta(sq, -14);
        }
      }
    }
  }

  private updateParticlesAndArrows(dt: number) {
    // Update Arrows
    let activeArrowCount = 0;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 14 * dt; // gravity

      if (p.life >= p.maxLife) {
        p.active = false;
        const target = this.squads.find((s) => s.id === p.targetSquadId && !s.eliminated);
        const source = this.squads.find((s) => s.id === p.sourceSquadId);
        if (target && source) {
          const aliveDef = target.soldiers.filter((s) => s.alive);
          if (aliveDef.length > 0) {
            const victim = aliveDef[Math.floor(Math.random() * aliveDef.length)];
            const res = computeAttackDamage({
              attacker: source,
              defender: target,
              isRangedHit: true,
              difficulty: this.difficulty,
            });
            target.damageBlocked += res.blocked;
            if (res.flanked) source.flankHits += 1;
            victim.hp -= res.damage;
            victim.hitFlash = 0.12;
            target.lastAttackedAt = this.elapsedSeconds;

            const hy = getElevationAt(victim.x, victim.z) + 0.9;
            this.spawnParticles(
              victim.x,
              hy,
              victim.z,
              target.formation === 'shield_wall' ? 4 : 7,
              target.formation === 'shield_wall' ? 0x8cc8ff : 0xf4b956,
              3.2,
            );

            if (victim.hp <= 0) {
              victim.alive = false;
              victim.hp = 0;
              source.kills += 1;
              const routed = applyMoraleDelta(target, -8.5);
              if (routed) this.onSquadRouted(target);
            } else {
              const routed = applyMoraleDelta(target, -1.6);
              if (routed) this.onSquadRouted(target);
            }
          }
        }
        continue;
      }

      _dummyObj.position.set(p.x, p.y, p.z);
      _vec3A.set(p.x + p.vx * 0.05, p.y + p.vy * 0.05, p.z + p.vz * 0.05);
      _dummyObj.lookAt(_vec3A);
      _dummyObj.scale.set(1, 1, 1);
      _dummyObj.updateMatrix();
      this.arrowInstanced.setMatrixAt(activeArrowCount++, _dummyObj.matrix);
    }
    this.arrowInstanced.count = activeArrowCount;
    this.arrowInstanced.instanceMatrix.needsUpdate = true;

    // Update Particle Ring Buffer
    let activePartCount = 0;
    for (const pt of this.particles) {
      if (!pt.active) continue;
      pt.life += dt;
      if (pt.life >= pt.maxLife) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.vy -= 9.8 * dt;
      const t = 1 - pt.life / pt.maxLife;

      _dummyObj.position.set(pt.x, pt.y, pt.z);
      _dummyObj.rotation.set(pt.life * 4, pt.life * 3, 0);
      _dummyObj.scale.setScalar(pt.scale * t);
      _dummyObj.updateMatrix();
      this.particleInstanced.setMatrixAt(activePartCount, _dummyObj.matrix);
      _colorScratch.setHex(pt.colorHex);
      this.particleInstanced.setColorAt(activePartCount, _colorScratch);
      activePartCount++;
    }
    this.particleInstanced.count = activePartCount;
    this.particleInstanced.instanceMatrix.needsUpdate = true;
    if (this.particleInstanced.instanceColor) {
      this.particleInstanced.instanceColor.needsUpdate = true;
    }
  }

  private runEnemyAi() {
    const allies = this.squads.filter((s) => s.faction === 'allied' && !s.eliminated);
    if (allies.length === 0) return;

    const enemyActive = this.squads.filter(
      (s) => s.faction === 'enemy' && !s.eliminated && !s.routing,
    );
    let splitsRemaining = enemyActive.length < 10 ? 1 : 0;

    for (let i = 0; i < enemyActive.length; i++) {
      const enemy = enemyActive[i];
      const action = evaluateAiSquadDecision({
        squad: enemy,
        squadIndex: i,
        allies,
        friendlySquads: enemyActive,
        difficulty: this.difficulty,
        elapsedSeconds: this.elapsedSeconds,
        canSplitMore: splitsRemaining > 0,
      });

      if (action.shouldSplit && splitsRemaining > 0) {
        const newId = `${enemy.id}-div-${this.splitCounter++}`;
        const splitRes = splitSquad(enemy, newId);
        if (splitRes) {
          splitsRemaining--;
          const oldVis = this.squadVisuals.get(enemy.id);
          if (oldVis) {
            this.scene.remove(oldVis.group);
            oldVis.bannerTex.dispose();
            oldVis.bannerMat.dispose();
            this.squadVisuals.delete(enemy.id);
            this.clickTargets = this.clickTargets.filter((t) => t.userData.squadId !== enemy.id);
          }
          const idx = this.squads.findIndex((s) => s.id === enemy.id);
          if (idx >= 0) {
            this.squads.splice(idx, 1, splitRes.first, splitRes.second);
          }
          this.ensureSquadVisual(splitRes.first);
          this.ensureSquadVisual(splitRes.second);
          splitRes.first.targetX = action.targetX;
          splitRes.first.targetZ = action.targetZ;
          splitRes.first.formation = 'line';
          splitRes.second.targetX = -action.targetX;
          splitRes.second.targetZ = action.targetZ;
          splitRes.second.formation = 'shield_wall';
          continue;
        }
      }

      enemy.targetX = action.targetX;
      enemy.targetZ = action.targetZ;
      enemy.targetSquadId = action.targetSquadId;
      enemy.formation = action.formation;
      enemy.isHoldPosition = action.isHoldPosition;
    }
  }

  private syncVisuals(dt: number) {
    // Update each squad & its soldiers
    for (const sq of this.squads) {
      const vis = this.squadVisuals.get(sq.id);
      if (!vis) continue;

      if (sq.eliminated) {
        vis.group.visible = false;
        continue;
      }

      // Enemy squads are hidden inside Fog of War until inside friendly active LoS!
      const isVisibleToPlayer =
        sq.faction === 'allied' ||
        this.phase === 'title' ||
        this.phase === 'setup' ||
        isPointVisibleInFog(this.fogGrid, sq.x, sq.z);

      vis.group.visible = isVisibleToPlayer;
      if (!isVisibleToPlayer) continue;

      for (const s of sq.soldiers) {
        const mesh = vis.soldierGroups.get(s.id);
        if (!mesh) continue;
        if (!s.alive) {
          // KO topple transition before disappearing
          if (s.koTimer < 1) {
            mesh.visible = true;
            mesh.rotation.x = (s.koTimer * Math.PI) / 2;
            mesh.position.y = getElevationAt(s.x, s.z) + 0.1;
          } else {
            mesh.visible = false;
          }
          continue;
        }

        mesh.visible = true;
        const groundY = getElevationAt(s.x, s.z);
        const bob = Math.abs(Math.sin(s.walkPhase)) * 0.09;
        const lunge = s.attackAnim > 0 ? Math.sin((s.attackAnim / 0.28) * Math.PI) * 0.35 : 0;

        mesh.position.set(
          s.x + Math.sin(sq.facing) * lunge,
          groundY + bob,
          s.z + Math.cos(sq.facing) * lunge,
        );
        mesh.rotation.x = 0;
        mesh.rotation.y = sq.facing;
        const squash = s.hitFlash > 0 ? 1.12 : 1.0;
        mesh.scale.set(squash, s.hitFlash > 0 ? 0.9 : 1.0, squash);
      }

      // Update Banner & Hit Proxy
      const cy = getElevationAt(sq.x, sq.z);
      vis.bannerGroup.position.set(sq.x, cy + 3.65, sq.z);
      vis.bannerGroup.quaternion.copy(this.camera.quaternion);
      vis.hitCylinder.position.set(sq.x, cy + 1.4, sq.z);
      this.updateSquadBanner(sq, vis);
    }

    // Selection Ring, LoS Vision Ring, and Target Waypoint
    const selected = this.squads.find(
      (s) => s.id === this.selectedSquadId && s.faction === 'allied' && !s.eliminated,
    );
    if (selected && this.phase === 'playing') {
      const sy = getElevationAt(selected.x, selected.z) + 0.28;
      this.selectionRing.visible = true;
      this.selectionRing.position.set(selected.x, sy, selected.z);
      this.selectionRing.rotation.z += dt * 0.7;

      const visR = computeEffectiveVision(selected).visionRadius;
      this.visionRing.visible = true;
      this.visionRing.position.set(selected.x, sy + 0.04, selected.z);
      this.visionRing.scale.set(visR, 1, visR);

      const moveDist = Math.hypot(selected.targetX - selected.x, selected.targetZ - selected.z);
      if (moveDist > 1.5 && !selected.isHoldPosition) {
        this.waypointMarker.visible = true;
        this.waypointMarker.position.set(
          selected.targetX,
          getElevationAt(selected.targetX, selected.targetZ) + 0.25,
          selected.targetZ,
        );
        this.waypointMarker.rotation.y += dt * 1.8;
      } else {
        this.waypointMarker.visible = false;
      }
    } else {
      this.selectionRing.visible = false;
      this.visionRing.visible = false;
      this.waypointMarker.visible = false;
    }
  }

  private emitSnapshot(force: boolean) {
    if (!force && this.disposed) return;

    const alliedSquads = this.squads.filter((s) => s.faction === 'allied');
    const enemySquads = this.squads.filter((s) => s.faction === 'enemy');
    const alliedAlive = alliedSquads.filter((s) => !s.eliminated && !s.routing);
    const enemyAlive = enemySquads.filter((s) => !s.eliminated && !s.routing);

    const visibleEnemies = enemySquads.filter(
      (s) => !s.eliminated && isPointVisibleInFog(this.fogGrid, s.x, s.z),
    );

    const alliedSoldiersAlive = alliedSquads.reduce(
      (sum, s) => sum + s.soldiers.filter((u) => u.alive).length,
      0,
    );
    const enemySoldiersAlive = enemySquads.reduce(
      (sum, s) => sum + s.soldiers.filter((u) => u.alive).length,
      0,
    );

    const selectedRaw = alliedSquads.find((s) => s.id === this.selectedSquadId) ?? null;

    this.onSnapshot({
      phase: this.phase,
      outcome: this.outcome,
      elapsedSeconds: this.elapsedSeconds,
      exploredPercent: this.exploredPercent,
      alliedSquadsAlive: alliedAlive.length,
      alliedSquadsTotal: alliedSquads.length,
      enemySquadsAlive: enemyAlive.length,
      enemySquadsTotal: enemySquads.length,
      alliedSoldiersAlive,
      enemySoldiersAlive,
      medalsAwardedCount: this.medalsAwardedCount,
      selectedSquad: selectedRaw ? { ...selectedRaw, soldiers: [...selectedRaw.soldiers], medals: [...selectedRaw.medals] } : null,
      alliedSquads: alliedSquads.map((s) => ({ ...s, soldiers: [...s.soldiers], medals: [...s.medals] })),
      visibleEnemySquads: visibleEnemies,
      commandFeedback: this.commandFeedback,
      recentNotifications: [...this.notifications],
      difficulty: this.difficulty,
    });
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.cleanupListeners();
    this.clearSquadVisuals();
    this.assetBank.dispose();
    this.fogTexture.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
