// --- physics.js — Lógica de física, deteção de colisão e estado da simulação ---
// Sem dependências de UI. A UI (ui.js) chama as funções e trata o DOM.
// Three.js é carregado globalmente via CDN (window.THREE) pelo index.html.

const THREE = window.THREE;
import * as setup from './three-setup.js';
import { fragmentMesh, spawnFragments, updateFragments, clearFragments } from './fragments.js';

// Limites da caixa de confinamento (ver cageMesh em three-setup.js)
export const ARENA_HALF_XZ = 20;
export const ARENA_HEIGHT = 20;

// Limites aceitos pelos controles (espelham os atributos min/max do index.html)
export const LIMITS = {
  cubes: { min: 2, max: 150 },
  cellSize: { min: 1, max: 10 },
  octreeDepth: { min: 1, max: 10 },
};

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ====================== ESTADO DA SIMULAÇÃO (partilhado) ======================
// Objeto mutável único: permite leitura e escrita tanto em physics.js quanto em ui.js
// sem violar a regra de strict mode / bindings readonly dos imports ES modules.
export const state = {
  cubes: [],
  nextId: 0,
  draggedCube: null,
  hoveredCube: null,
  simPaused: false,
  simSpeed: 0.8,
  collisionCount: 0,
  activeCollisions: 0,
  currentCollidingPairs: new Set(),
  soundEnabled: true,
  audioContext: null,
  wireframeEnabled: false,
  isPhysicsEnabled: false,
  lastComparisonCount: 0,
  lastExecutionTime: 0,
  spatialGrid: null,
  octreeSimulator: null,
  currentBroadPhase: 'brute',
  raceMode: false, // corrida: as três estratégias rodam no mesmo frame, uma por coluna
  cellSize: 2,
  octreeDepth: 6,
};

export const CONTEXT_CONFIG = {
  brute: {
    algorithm: "AABB — Axis-Aligned Bounding Box",
    worstCase: "O(n²) — verificação por força bruta",
    op: "Sobreposição nos eixos X, Y e Z"
  },
  grid: {
    algorithm: "Grade Espacial Uniforme 3D",
    worstCase: "O(n²) no pior caso / O(n) no caso médio",
    op: "Hashing espacial e teste entre células vizinhas"
  },
  octree: {
    algorithm: "Octree 3D — Subdivisão Recursiva",
    worstCase: "O(n²) no pior caso / O(n log n) no caso médio",
    op: "Travessia de 8 octantes e teste de nós com entidades"
  }
};

export function updateContextPanel(mode) {
  const config = CONTEXT_CONFIG[mode] ?? CONTEXT_CONFIG.brute;
  document.getElementById('context-algorithm').textContent = config.algorithm;
  document.getElementById('context-worstcase').textContent = config.worstCase;
  document.getElementById('context-op').textContent = config.op;
}

// Atualiza a AABB (THREE.Box3) armazenada no cubo a partir da posição atual
function updateAABB(cube) {
  const h = cube.size / 2;
  const p = cube.mesh.position;
  cube.aabb.min.set(p.x - h, p.y - h, p.z - h);
  cube.aabb.max.set(p.x + h, p.y + h, p.z + h);
}

// Chave numérica única por par (evita concatenação e parsing de strings)
function pairKey(a, b) {
  return a.id < b.id ? a.id * 1e6 + b.id : b.id * 1e6 + a.id;
}

// ====================== GRADE ESPACIAL O(n) ======================
// Chaves de célula numéricas: índices deslocados para valores positivos e empacotados.
const CELL_OFFSET = 512;
const CELL_RANGE = 1024;

export class SpatialGrid {
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this._seenPairs = new Set();
  }

  static cellKey(x, y, z) {
    return ((x + CELL_OFFSET) * CELL_RANGE + (y + CELL_OFFSET)) * CELL_RANGE + (z + CELL_OFFSET);
  }

  static decodeKey(key) {
    const z = (key % CELL_RANGE) - CELL_OFFSET;
    const rest = Math.floor(key / CELL_RANGE);
    const y = (rest % CELL_RANGE) - CELL_OFFSET;
    const x = Math.floor(rest / CELL_RANGE) - CELL_OFFSET;
    return [x, y, z];
  }

  clear() { this.grid.clear(); }

  insert(obj) {
    const cs = this.cellSize;
    const { min, max } = obj.aabb;
    const minX = Math.floor(min.x / cs), maxX = Math.floor(max.x / cs);
    const minY = Math.floor(min.y / cs), maxY = Math.floor(max.y / cs);
    const minZ = Math.floor(min.z / cs), maxZ = Math.floor(max.z / cs);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = SpatialGrid.cellKey(x, y, z);
          let cell = this.grid.get(key);
          if (!cell) { cell = []; this.grid.set(key, cell); }
          cell.push(obj);
        }
      }
    }
  }

  // Visita cada par que partilha pelo menos uma célula exatamente uma vez.
  forEachCandidatePair(onPair) {
    const seen = this._seenPairs;
    seen.clear();
    for (const cell of this.grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i];
        for (let j = i + 1; j < cell.length; j++) {
          const b = cell[j];
          const key = pairKey(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          onPair(a, b);
        }
      }
    }
  }
}

// ====================== OCTREE O(n log n) ======================
// Cada objeto fica no nó mais profundo que o contém por inteiro; objetos que
// atravessam um plano divisor (straddling) permanecem no nó pai.
export class OctreeSimulator {
  constructor(boundsSize = 60, maxDepth = 6, maxObjectsPerNode = 4) {
    this.boundsSize = boundsSize;
    this.maxDepth = maxDepth;
    this.maxObjects = maxObjectsPerNode;
    this.clear();
  }

  _createNode(min, max, depth) {
    const bounds = new THREE.Box3(min, max);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    return { bounds, center, depth, children: null, objects: [] };
  }

  clear() {
    const h = this.boundsSize / 2;
    this.root = this._createNode(new THREE.Vector3(-h, -h, -h), new THREE.Vector3(h, h, h), 0);
  }

  // Índice do filho: bit0 = metade alta em X, bit1 = Y, bit2 = Z
  _subdivide(node) {
    const { min, max } = node.bounds;
    const c = node.center;
    const d = node.depth + 1;
    node.children = new Array(8);
    for (let i = 0; i < 8; i++) {
      const lo = new THREE.Vector3(i & 1 ? c.x : min.x, i & 2 ? c.y : min.y, i & 4 ? c.z : min.z);
      const hi = new THREE.Vector3(i & 1 ? max.x : c.x, i & 2 ? max.y : c.y, i & 4 ? max.z : c.z);
      node.children[i] = this._createNode(lo, hi, d);
    }
  }

  // Filho que contém a caixa por inteiro, ou null se ela atravessa o centro.
  _childContaining(node, box) {
    const c = node.center;
    let idx = 0;
    if (box.min.x >= c.x) idx |= 1; else if (box.max.x > c.x) return null;
    if (box.min.y >= c.y) idx |= 2; else if (box.max.y > c.y) return null;
    if (box.min.z >= c.z) idx |= 4; else if (box.max.z > c.z) return null;
    return node.children[idx];
  }

  insert(obj) { this._insertNode(this.root, obj); }

  _insertNode(node, obj) {
    if (node.children) {
      const child = this._childContaining(node, obj.aabb);
      if (child) { this._insertNode(child, obj); return; }
      node.objects.push(obj);
      return;
    }
    node.objects.push(obj);
    if (node.objects.length > this.maxObjects && node.depth < this.maxDepth) {
      this._subdivide(node);
      const kept = [];
      for (const o of node.objects) {
        const child = this._childContaining(node, o.aabb);
        if (child) this._insertNode(child, o);
        else kept.push(o);
      }
      node.objects = kept;
    }
  }

  // Visita cada par candidato uma única vez: objetos do mesmo nó entre si e
  // objetos de ancestrais contra os do nó, só quando a AABB do ancestral
  // intersecta os limites do nó.
  forEachCandidatePair(onPair) {
    this._collectPairs(this.root, [], onPair);
  }

  _collectPairs(node, inherited, onPair) {
    const objs = node.objects;
    for (let i = 0; i < objs.length; i++) {
      const a = objs[i];
      for (let j = i + 1; j < objs.length; j++) onPair(a, objs[j]);
      for (let k = 0; k < inherited.length; k++) onPair(inherited[k], a);
    }
    if (!node.children) return;
    const carry = objs.length ? inherited.concat(objs) : inherited;
    for (let i = 0; i < 8; i++) {
      const child = node.children[i];
      if (!child.children && child.objects.length === 0) continue;
      const pass = [];
      for (let k = 0; k < carry.length; k++) {
        if (carry[k].aabb.intersectsBox(child.bounds)) pass.push(carry[k]);
      }
      this._collectPairs(child, pass, onPair);
    }
  }
}

// ====================== AABB ======================
export function intersectAABB(a, b) {
  const s = (a.size + b.size) / 2;
  const pa = a.mesh.position, pb = b.mesh.position;
  return Math.abs(pa.x - pb.x) < s &&
         Math.abs(pa.y - pb.y) < s &&
         Math.abs(pa.z - pb.z) < s;
}

// ====================== BROAD-PHASE ======================
// Duas fases, medidas em separado:
//   1. montar    — limpa e preenche a estrutura espacial (a força bruta não tem esta fase)
//   2. consultar — percorre a estrutura e chama onPair(a, b) para cada par candidato
// Simulação, corrida e benchmark usam estas mesmas funções, para medirem o mesmo trabalho.
export function buildBroadPhase(mode, cubes, structures = {}) {
  if (mode === 'grid') {
    const grid = structures.grid;
    grid.clear();
    for (let i = 0; i < cubes.length; i++) grid.insert(cubes[i]);
  } else if (mode === 'octree') {
    const octree = structures.octree;
    octree.clear();
    for (let i = 0; i < cubes.length; i++) octree.insert(cubes[i]);
  }
}

export function queryBroadPhase(mode, cubes, onPair, structures = {}) {
  if (mode === 'grid') {
    structures.grid.forEachCandidatePair(onPair);
  } else if (mode === 'octree') {
    structures.octree.forEachCandidatePair(onPair);
  } else {
    for (let i = 0; i < cubes.length; i++) {
      const a = cubes[i];
      for (let j = i + 1; j < cubes.length; j++) onPair(a, cubes[j]);
    }
  }
}

// Monta e consulta, devolvendo o tempo de cada fase em ms.
export function runBroadPhase(mode, cubes, onPair, structures = {}) {
  const t0 = performance.now();
  let t1 = t0;
  if (mode !== 'brute') {
    buildBroadPhase(mode, cubes, structures);
    t1 = performance.now();
  }
  queryBroadPhase(mode, cubes, onPair, structures);
  const t2 = performance.now();
  return { buildMs: t1 - t0, queryMs: t2 - t1, totalMs: t2 - t0 };
}

// Garante que as estruturas dos modos pedidos existem e refletem os parâmetros do estado
function ensureStructures(modes) {
  if (modes.includes('grid')) {
    if (!state.spatialGrid) state.spatialGrid = new SpatialGrid(state.cellSize);
    state.spatialGrid.cellSize = state.cellSize;
  }
  if (modes.includes('octree')) {
    if (!state.octreeSimulator) state.octreeSimulator = new OctreeSimulator(60, state.octreeDepth);
    state.octreeSimulator.maxDepth = state.octreeDepth;
  }
}

// Estratégias na ordem das colunas da corrida
export const RACE_MODES = ['brute', 'grid', 'octree'];

// Resultado do último frame por estratégia. `ran` diz se ela rodou neste frame:
// fora da corrida só a estratégia ativa roda.
const newFrameStats = () => ({
  ran: false, comparisons: 0, buildMs: 0, queryMs: 0, timeMs: 0, tested: [], hits: [],
});
export const frameStats = { brute: newFrameStats(), grid: newFrameStats(), octree: newFrameStats() };

function modesThisFrame() {
  return state.raceMode ? RACE_MODES : [state.currentBroadPhase];
}

// ====================== RESOLUÇÃO DE COLISÃO AABB ======================
const _impactPos = new THREE.Vector3();
const _relVel = new THREE.Vector3();

// Velocidade relativa a partir da qual a colisão solta estilhaços, e a que conta como impacto máximo
const FRAGMENT_MIN_IMPACT = 0.55;
const FULL_IMPACT = 1.0;

export function resolveCollision(cubeA, cubeB) {
  const sum = (cubeA.size + cubeB.size) / 2;
  const pa = cubeA.mesh.position, pb = cubeB.mesh.position;
  const va = cubeA.velocity, vb = cubeB.velocity;

  const dx = pa.x - pb.x, dy = pa.y - pb.y, dz = pa.z - pb.z;
  const overlapX = sum - Math.abs(dx);
  const overlapY = sum - Math.abs(dy);
  const overlapZ = sum - Math.abs(dz);

  // Separa ao longo do eixo de menor penetração e reflete as velocidades nesse eixo
  let axis;
  if (overlapX <= overlapY && overlapX <= overlapZ) axis = 'x';
  else if (overlapY <= overlapZ) axis = 'y';
  else axis = 'z';
  const d = axis === 'x' ? dx : axis === 'y' ? dy : dz;
  const overlap = axis === 'x' ? overlapX : axis === 'y' ? overlapY : overlapZ;
  const sign = d >= 0 ? 1 : -1;
  pa[axis] += sign * overlap / 2;
  pb[axis] -= sign * overlap / 2;
  va[axis] = Math.abs(va[axis]) * sign;
  vb[axis] = -Math.abs(vb[axis]) * sign;

  const relVel = _relVel.subVectors(va, vb).length();
  _impactPos.addVectors(pa, pb).multiplyScalar(0.5);

  setup.impactParticles.spawn(_impactPos);
  setup.triggerImpactLight(_impactPos);
  const strength = Math.min(relVel / FULL_IMPACT, 1);
  setup.triggerShockwave(_impactPos, strength);
  if (relVel > FRAGMENT_MIN_IMPACT) spawnFragments(_impactPos, cubeA.baseColor, cubeB.baseColor, strength);
  playSound(relVel);
}

// ====================== ÁUDIO ======================
// Os navegadores só liberam áudio depois de uma interação do usuário. Um AudioContext
// criado antes disso (na primeira colisão, ao carregar) nasce suspenso. Por isso o
// contexto é criado e retomado em unlockAudio(), chamada pela UI no primeiro clique,
// toque ou tecla; até lá playSound não faz nada.
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!state.audioContext) state.audioContext = new AC();
  if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
}

export function playSound(impactVelocity = 1.0) {
  if (!state.soundEnabled) return;
  const ctx = state.audioContext;
  // sem contexto = ainda não houve interação; um contexto suspenso aqui já está sendo
  // retomado por unlockAudio, e o som agendado toca assim que ele libera
  if (!ctx || ctx.state === 'closed') return;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const now = ctx.currentTime;
  const baseFreq = THREE.MathUtils.clamp(220 + impactVelocity * 140, 180, 1200);
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(baseFreq, now);
  gainNode.gain.setValueAtTime(0.0, now);
  gainNode.gain.linearRampToValueAtTime(0.25, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.13);
}

// ====================== CRIAÇÃO DE CUBOS ======================
export function createCube(spawnIndex = 0) {
  const size = Math.random() * 4 + 2;
  const half = size / 2;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const palette = setup.CUBE_PALETTES[state.currentBroadPhase] || setup.CUBE_PALETTES.brute;
  const paletteIndex = Math.floor(Math.random() * palette.length);
  const baseCol = palette[paletteIndex];
  const solidMaterial = new THREE.MeshStandardMaterial({
    color: baseCol.clone(), roughness: 0.9, flatShading: true
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: baseCol.clone(), wireframe: true
  });
  const mesh = new THREE.Mesh(geometry, state.wireframeEnabled ? wireframeMaterial : solidMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Nasce sempre dentro da caixa de confinamento
  const spanXZ = 2 * (ARENA_HALF_XZ - half);
  mesh.position.set(
    (Math.random() - 0.5) * spanXZ,
    half + Math.random() * (ARENA_HEIGHT - size),
    (Math.random() - 0.5) * spanXZ
  );
  const speed = state.simSpeed;
  const velocity = new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);
  const arrowHelper = new THREE.ArrowHelper(
    velocity.clone().normalize(), mesh.position, 3, 0xffdd44, 0.8, 0.5
  );
  setup.scene.add(arrowHelper);

  const cubeData = {
    mesh, arrow: arrowHelper, id: state.nextId++, size, velocity,
    aabb: new THREE.Box3(),
    dragging: false, colliding: false, baseColor: baseCol.clone(), paletteIndex,
    geometry, solidMaterial, wireframeMaterial,
    spawnScale: -Math.min(spawnIndex * 0.08, 1.5), spawnDone: false
  };
  updateAABB(cubeData);
  mesh.userData = cubeData;
  mesh.scale.setScalar(0.001);
  state.cubes.push(cubeData);
  setup.scene.add(mesh);
}

// Cubos sem malha, com a mesma distribuição de createCube (tamanho 2 a 6, dentro da
// arena). Servem ao ajuste empírico da curva, que mede cenas de vários N sem tocar
// na cena visível. `rand` é um gerador em [0, 1) (com semente, para repetir a cena).
export function createSyntheticCubes(n, rand) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const size = rand() * 4 + 2;
    const half = size / 2;
    const spanXZ = 2 * (ARENA_HALF_XZ - half);
    const position = new THREE.Vector3(
      (rand() - 0.5) * spanXZ,
      half + rand() * (ARENA_HEIGHT - size),
      (rand() - 0.5) * spanXZ
    );
    const cube = { id: i, size, mesh: { position }, aabb: new THREE.Box3() };
    updateAABB(cube);
    list.push(cube);
  }
  return list;
}

function disposeCube(c) {
  if (c.arrow) {
    setup.scene.remove(c.arrow);
    c.arrow.line.material.dispose();
    c.arrow.cone.material.dispose();
  }
  setup.scene.remove(c.mesh);
  c.geometry.dispose();
  c.solidMaterial.dispose();
  c.wireframeMaterial.dispose();
}

export function initCubes() {
  state.cubes.forEach(disposeCube);
  state.cubes = [];
  state.nextId = 0;
  state.collisionCount = 0;
  state.activeCollisions = 0;
  state.currentCollidingPairs.clear();
  state.draggedCube = null;
  state.hoveredCube = null;
  clearFragments();

  state.spatialGrid = null;
  state.octreeSimulator = null;
  ensureStructures(modesThisFrame());

  const input = document.getElementById('cubeCountInput');
  const count = input
    ? Math.round(clampNumber(input.value, LIMITS.cubes.min, Number(input.max) || LIMITS.cubes.max, 8))
    : 8;
  for (let i = 0; i < count; i++) createCube(i);
}

// ====================== TROCA DE ESTRATÉGIA SEM RECRIAR A CENA ======================
// Os cubos continuam onde estão; só as estruturas e a contagem recomeçam. A paleta
// nova chega em onda, do centro da arena para fora.
const WAVE_SPREAD = 0.45; // segundos até a onda alcançar o cubo mais distante
const WAVE_FADE = 0.18;   // duração da troca de cor em cada cubo
const _arenaCenter = new THREE.Vector3(0, ARENA_HEIGHT / 2, 0);

export function switchStrategy(mode) {
  state.currentBroadPhase = mode;
  state.collisionCount = 0; // pares que já estavam em colisão não contam de novo
  state.spatialGrid = null;
  state.octreeSimulator = null;
  ensureStructures(modesThisFrame());

  const palette = setup.CUBE_PALETTES[mode] || setup.CUBE_PALETTES.brute;
  let maxDist = 1;
  for (const c of state.cubes) maxDist = Math.max(maxDist, c.mesh.position.distanceTo(_arenaCenter));
  for (const c of state.cubes) {
    c.wave = {
      from: c.baseColor.clone(),
      to: palette[c.paletteIndex],
      delay: (c.mesh.position.distanceTo(_arenaCenter) / maxDist) * WAVE_SPREAD,
      time: 0,
      arrived: false,
    };
  }
}

function updatePaletteWave(delta) {
  for (const c of state.cubes) {
    const w = c.wave;
    if (!w) continue;
    w.time += delta;
    const k = THREE.MathUtils.clamp((w.time - w.delay) / WAVE_FADE, 0, 1);
    if (k > 0 && !w.arrived) {
      w.arrived = true;
      if (c.spawnDone && !c.dragging) c.mesh.scale.setScalar(1.22); // pulso quando a onda chega
    }
    c.baseColor.copy(w.from).lerp(w.to, k);
    if (k >= 1) c.wave = null;
  }
}

// Estilhaços: param junto com a simulação
export function updateDebris(delta) {
  if (!state.simPaused) updateFragments(delta, ARENA_HALF_XZ);
}

export function toggleWireframe() {
  state.cubes.forEach(cube => {
    const target = state.wireframeEnabled ? cube.wireframeMaterial : cube.solidMaterial;
    target.color.copy(cube.mesh.material.color);
    cube.mesh.material = target;
  });
}

// ====================== FÍSICA (atualização de posições) ======================
const _arrowDir = new THREE.Vector3();

export function updatePhysics(delta = 0) {
  updatePaletteWave(delta); // a troca de paleta termina mesmo com a simulação pausada
  const speed = state.simSpeed;
  const limitXZ = ARENA_HALF_XZ;
  for (const c of state.cubes) {
    if (!c.spawnDone) {
      if (state.simPaused) continue;
      c.spawnScale = Math.min(c.spawnScale + 0.08, 1);
      c.mesh.scale.setScalar(Math.max(c.spawnScale, 0.001));
      if (c.spawnScale >= 1) c.spawnDone = true;
      continue;
    }

    if (!c.dragging && !state.simPaused) {
      const p = c.mesh.position;
      const v = c.velocity;
      const half = c.size / 2;
      p.addScaledVector(v, speed);
      if (Math.abs(p.x) > limitXZ - half) { v.x *= -0.95; p.x = Math.sign(p.x) * (limitXZ - half); }
      if (p.y > ARENA_HEIGHT - half) { v.y *= -0.95; p.y = ARENA_HEIGHT - half; }
      else if (p.y < half) { v.y *= -0.95; p.y = half; }
      if (Math.abs(p.z) > limitXZ - half) { v.z *= -0.95; p.z = Math.sign(p.z) * (limitXZ - half); }
    }

    if (c.arrow) {
      c.arrow.visible = !c.dragging;
      if (!c.dragging) {
        c.arrow.position.copy(c.mesh.position);
        const lenSq = c.velocity.lengthSq();
        if (lenSq > 0.00001) c.arrow.setDirection(_arrowDir.copy(c.velocity).normalize());
        c.arrow.setLength(Math.min(Math.sqrt(lenSq) * 2, 5));
      }
    }
  }
}

// ====================== DETEÇÃO DE COLISÕES ======================
const WHITE = new THREE.Color(0xffffff);
const _activeCubes = [];
let _badgeTextEl = null, _economyBadgeEl = null, _econValEl = null;

export function detectCollisions() {
  const active = state.currentBroadPhase;
  const modes = modesThisFrame();
  ensureStructures(modes);

  // Cubos arrastados ficam fora da deteção em todos os modos
  _activeCubes.length = 0;
  for (const c of state.cubes) {
    updateAABB(c);
    if (!c.dragging) _activeCubes.push(c);
  }
  const structures = { grid: state.spatialGrid, octree: state.octreeSimulator };

  for (const mode of RACE_MODES) frameStats[mode].ran = false;

  // Na corrida as três estratégias rodam sobre as mesmas posições, antes de qualquer
  // resposta física, e cada uma faz o mesmo trabalho por par (registrar e testar).
  for (const mode of modes) {
    const fs = frameStats[mode];
    const tested = fs.tested, hits = fs.hits;
    tested.length = 0;
    hits.length = 0;
    let comparisons = 0;
    const onPair = (a, b) => {
      comparisons++;
      tested.push(a, b);
      if (intersectAABB(a, b)) hits.push(a, b);
    };

    // Região medida: construção da estrutura + broad-phase + narrow-phase.
    // Visualização, resposta física, som e partículas ficam fora da medição.
    const t = runBroadPhase(mode, _activeCubes, onPair, structures);
    fs.ran = true;
    fs.comparisons = comparisons;
    fs.buildMs = t.buildMs;
    fs.queryMs = t.queryMs;
    fs.timeMs = t.totalMs;
  }

  const activeStats = frameStats[active];
  const _hits = activeStats.hits; // as três estratégias acham as mesmas colisões
  const comparisons = activeStats.comparisons;
  const pureComputeTime = activeStats.timeMs;

  state.activeCollisions = _hits.length / 2;
  state.lastComparisonCount = comparisons;
  state.lastExecutionTime = pureComputeTime;

  // Linhas de teste (visualização Big-O). Na corrida são preenchidas por coluna,
  // em prepareRaceView.
  if (!state.raceMode) fillPairLines(activeStats.tested);

  renderGridDebug(frameStats.grid.ran ? state.spatialGrid : null);
  renderOctreeDebug(frameStats.octree.ran ? state.octreeSimulator : null);

  // Cores e escala base (realce de hover aplicado aqui para não ser sobrescrito)
  for (const c of state.cubes) {
    c.colliding = false;
    if (c.dragging) continue;
    c.mesh.material.color.copy(c.baseColor);
    if (c === state.hoveredCube) c.mesh.material.color.lerp(WHITE, 0.3);
    if (c.spawnDone) c.mesh.scale.lerp(setup.UNIT_SCALE, 0.1);
  }

  const newPairs = new Set();
  let newCollisions = 0;
  for (let i = 0; i < _hits.length; i += 2) {
    const a = _hits[i], b = _hits[i + 1];
    const key = pairKey(a, b);
    newPairs.add(key);
    for (const c of [a, b]) {
      c.colliding = true;
      if (!c.dragging) {
        c.mesh.material.color.copy(setup.COLLISION_COLOR);
        if (c.spawnDone) c.mesh.scale.set(1.15, 0.85, 1.15);
      }
    }
    if (!state.currentCollidingPairs.has(key)) {
      newCollisions++;
      // com a física ligada quem solta a onda é resolveCollision, com a força do impacto
      if (!state.isPhysicsEnabled) {
        _impactPos.addVectors(a.mesh.position, b.mesh.position).multiplyScalar(0.5);
        setup.triggerShockwave(_impactPos, 0.3);
      }
    }
    if (state.isPhysicsEnabled) resolveCollision(a, b);
  }

  if (newCollisions > 0) {
    state.collisionCount += newCollisions;
    if (!state.isPhysicsEnabled) playSound(1.5);
    _badgeTextEl ??= document.getElementById('badgeText');
    if (_badgeTextEl) {
      _badgeTextEl.classList.remove('collision-bump');
      void _badgeTextEl.offsetWidth;
      _badgeTextEl.classList.add('collision-bump');
    }
  }
  state.currentCollidingPairs = newPairs;

  // Métrica de economia: testes evitados em relação a N(N-1)/2
  _economyBadgeEl ??= document.querySelector('.economy-badge');
  _econValEl ??= document.getElementById('econVal');
  if (_economyBadgeEl && _econValEl) {
    const n = _activeCubes.length;
    const baseComps = (n * (n - 1)) / 2;
    if (state.currentBroadPhase === 'brute' || baseComps <= 0) {
      _econValEl.textContent = '0%';
      _economyBadgeEl.classList.add('disabled');
    } else {
      const saved = Math.max(0, Math.min(100, Math.round(((baseComps - comparisons) / baseComps) * 100)));
      _econValEl.textContent = `${saved}%`;
      _economyBadgeEl.classList.remove('disabled');
    }
  }

  applyXray();
  return { comparisons, pureComputeTime };
}

// ====================== GIZMOS DE DEPURAÇÃO ======================
// Objetos reaproveitados entre frames (antes eram recriados a cada frame).
const _unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const GRID_CELL_OPACITY = 0.45;
const octreeOpacity = depth => Math.max(0.15, 0.4 - depth * 0.04);
const _gridCellMat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: GRID_CELL_OPACITY });
const _octreeDepthColors = [0xa855f7, 0x9b4dca, 0x7b2cbf, 0x9370db, 0x8a2be2, 0x9370db, 0x8a2be2];
const _octreeMats = [];
function octreeMaterial(depth) {
  if (!_octreeMats[depth]) {
    _octreeMats[depth] = new THREE.LineBasicMaterial({
      color: _octreeDepthColors[depth] ?? 0x6b21a8,
      transparent: true,
      opacity: octreeOpacity(depth),
    });
  }
  return _octreeMats[depth];
}

// Usa os filhos do grupo como pool: reaproveita, cria se faltar, esconde o excedente.
function poolItem(group, index, material) {
  let item = group.children[index];
  if (!item) {
    item = new THREE.LineSegments(_unitEdges, material);
    group.add(item);
  }
  item.material = material;
  item.visible = true;
  return item;
}
function hidePoolFrom(group, index) {
  for (let i = index; i < group.children.length; i++) group.children[i].visible = false;
}

export function clearDebugGizmos() {
  hidePoolFrom(setup.gridDebugGroup, 0);
  hidePoolFrom(setup.octreeDebugGroup, 0);
}

// --- Mapa de calor do raio-X ---
// Cada célula da grade (ou nó da Octree) com testes ganha uma caixa translúcida; quanto
// mais pares ela testa, mais clara e opaca. Cada caixa do pool tem o próprio material:
// userData.heat guarda a opacidade cheia, e applyGizmoOpacity a escala pelo raio-X e
// pelo passe de brilho.
const _unitBox = new THREE.BoxGeometry(1, 1, 1);
const HEAT_COLD = { grid: new THREE.Color(0x00ddff), octree: new THREE.Color(0xa855f7) };
function heatItem(group, index, base, t, heat) {
  let item = group.children[index];
  if (!item) {
    item = new THREE.Mesh(_unitBox, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    group.add(item);
  }
  item.material.color.copy(base).lerp(WHITE, t * 0.55);
  item.userData.heat = heat;
  item.visible = true;
  return item;
}

// Células ativas da Grade Espacial (null esconde o gizmo)
export function renderGridDebug(grid) {
  const group = setup.gridDebugGroup;
  const heat = setup.gridHeatGroup;
  if (!grid) { hidePoolFrom(group, 0); hidePoolFrom(heat, 0); return; }
  const cs = grid.cellSize;
  const xrayOn = setup.xray.level > 0;
  let i = 0, h = 0;
  for (const [key, cubes] of grid.grid) {
    const [cx, cy, cz] = SpatialGrid.decodeKey(key);
    const cell = poolItem(group, i++, _gridCellMat);
    cell.position.set((cx + 0.5) * cs, (cy + 0.5) * cs, (cz + 0.5) * cs);
    cell.scale.setScalar(cs);
    const k = cubes.length;
    if (!xrayOn || k < 2) continue; // célula com um cubo só não testa nada
    const t = Math.min(1, Math.log2(k * (k - 1) / 2) / 5); // 1 par -> 0, 32+ pares -> 1
    const box = heatItem(heat, h++, HEAT_COLD.grid, t, 0.07 + 0.2 * t);
    box.position.copy(cell.position);
    box.scale.setScalar(cs * 0.94);
  }
  hidePoolFrom(group, i);
  hidePoolFrom(heat, h);
}

// Nós da Octree (bounding boxes de cada nó da árvore; null esconde o gizmo)
export function renderOctreeDebug(octree) {
  const group = setup.octreeDebugGroup;
  const heat = setup.octreeHeatGroup;
  if (!octree) { hidePoolFrom(group, 0); hidePoolFrom(heat, 0); return; }
  const xrayOn = setup.xray.level > 0;
  let i = 0, h = 0;
  const traverse = (node) => {
    const item = poolItem(group, i++, octreeMaterial(node.depth));
    item.position.copy(node.center);
    node.bounds.getSize(item.scale);
    // nó com objetos: os de cima (que cruzam planos) quase não aparecem para não cobrir a
    // cena inteira; os fundos, pequenos, acendem mais
    const k = node.objects.length;
    if (xrayOn && k > 0 && node.depth > 0) {
      const t = Math.min(1, (k - 1) / 4);
      // a raiz é maior que a caixa: preenchida, tingiria a tela inteira
      const depthWeight = node.depth === 0 ? 0 : Math.min(1, 0.1 + (node.depth - 1) * 0.35);
      const box = heatItem(heat, h++, HEAT_COLD.octree, t, (0.05 + 0.16 * t) * depthWeight);
      box.position.copy(node.center);
      node.bounds.getSize(box.scale).multiplyScalar(0.96);
    }
    if (node.children) for (let k = 0; k < 8; k++) traverse(node.children[k]);
  };
  traverse(octree.root);
  hidePoolFrom(group, i);
  hidePoolFrom(heat, h);
}

// ====================== LINHAS DE TESTE E VISTAS DA CORRIDA ======================
function fillPairLines(tested) {
  setup.clearPairLines();
  for (let i = 0; i < tested.length; i += 2) {
    setup.addPairLine(tested[i].mesh.position, tested[i + 1].mesh.position);
  }
  setup.updatePairLinesBuffer();
}

const MODE_LINE_HEX = { brute: 0xff7139, grid: 0x00ddff, octree: 0xa855f7 };

// Antes de desenhar a coluna de uma estratégia na corrida: a cena é a mesma, mudam
// as linhas dos pares que ela testou, o gizmo da estrutura e a paleta dos cubos.
export function prepareRaceView(mode) {
  fillPairLines(frameStats[mode].tested);
  setup.pairLinesMat.color.setHex(MODE_LINE_HEX[mode]);
  setup.gridDebugGroup.visible = setup.gridHeatGroup.visible = mode === 'grid';
  setup.octreeDebugGroup.visible = setup.octreeHeatGroup.visible = mode === 'octree';

  const palette = setup.CUBE_PALETTES[mode];
  for (const c of state.cubes) {
    if (c.dragging) continue; // mantém a cor de arraste
    const color = c.mesh.material.color;
    if (c.colliding) { color.copy(setup.COLLISION_COLOR); continue; }
    color.copy(palette[c.paletteIndex]);
    if (c === state.hoveredCube) color.lerp(WHITE, 0.3);
  }
}

// Depois da última coluna: devolve os gizmos ao controle normal (visibilidade por item)
export function finishRaceViews() {
  setup.gridDebugGroup.visible = setup.gridHeatGroup.visible = true;
  setup.octreeDebugGroup.visible = setup.octreeHeatGroup.visible = true;
}

// ====================== PASSE DE BRILHO ======================
// No passe de brilho (ver renderView em three-setup.js) só os cubos em colisão emitem
// luz. Os outros ficam pretos para continuar tapando o que está atrás deles; em
// wireframe eles somem, porque uma malha de arame não tapa nada.
const _hitColor = setup.COLLISION_COLOR.clone().multiplyScalar(0.32);
const GLOW_OFF_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
const GLOW_HIT_MAT = new THREE.MeshBasicMaterial({ color: _hitColor, fog: false });
const GLOW_HIT_WIRE_MAT = new THREE.MeshBasicMaterial({ color: _hitColor, fog: false, wireframe: true });

// Os gizmos da grade e da Octree são centenas de linhas sobrepostas: com o brilho
// inteiro eles apagariam a cena, então emitem só uma fração.
const GIZMO_GLOW = 0.18;
const PAIR_LINE_OPACITY = setup.pairLinesMat.opacity;
let _glowFactor = 1;
function scaleGizmoGlow(factor) {
  _glowFactor = factor;
  applyGizmoOpacity();
}

// Opacidade dos gizmos, das linhas e do mapa de calor: base * raio-X * passe de brilho.
// No raio-X as arestas da Octree acendem mais nos níveis de cima e menos nos fundos.
function applyGizmoOpacity() {
  const x = setup.xray.level;
  const f = _glowFactor;
  _gridCellMat.opacity = Math.min(1, GRID_CELL_OPACITY + 0.4 * x) * f;
  for (let depth = 0; depth < _octreeMats.length; depth++) {
    if (!_octreeMats[depth]) continue;
    const boost = x * Math.max(0.1, 0.42 - depth * 0.07);
    _octreeMats[depth].opacity = Math.min(1, octreeOpacity(depth) + boost) * f;
  }
  setup.pairLinesMat.opacity = PAIR_LINE_OPACITY + 0.15 * x;
  for (const group of [setup.gridHeatGroup, setup.octreeHeatGroup]) {
    for (const box of group.children) if (box.visible) box.material.opacity = box.userData.heat * x * f;
  }
}

// --- Raio-X nos cubos ---
// Os cubos ficam translúcidos (os em colisão menos, para continuarem visíveis) e param de
// escrever profundidade, para a estrutura atrás deles aparecer.
let _xrayApplied = 0;
function applyXray() {
  const x = setup.xray.level;
  if (x === 0 && _xrayApplied === 0) return;
  _xrayApplied = x;
  const ghost = x > 0;
  for (const c of state.cubes) {
    const opacity = 1 - (c.colliding || c.dragging ? 0.45 : 0.86) * x;
    for (const m of [c.solidMaterial, c.wireframeMaterial]) {
      m.transparent = ghost;
      m.opacity = opacity;
      m.depthWrite = x < 0.35;
    }
    c.mesh.castShadow = !ghost;
  }
  applyGizmoOpacity();
}

export const glowHooks = {
  begin() {
    fragmentMesh.visible = false;
    scaleGizmoGlow(GIZMO_GLOW);
    const wire = state.wireframeEnabled;
    for (const c of state.cubes) {
      if (c.arrow) c.arrow.visible = false;
      if (c.dragging) continue; // o cubo arrastado brilha com a própria cor
      if (c.colliding) c.mesh.material = wire ? GLOW_HIT_WIRE_MAT : GLOW_HIT_MAT;
      else if (wire || setup.xray.level > 0.3) c.mesh.visible = false; // no raio-X não tapa a estrutura
      else c.mesh.material = GLOW_OFF_MAT;
    }
  },
  end() {
    fragmentMesh.visible = true;
    scaleGizmoGlow(1);
    const wire = state.wireframeEnabled;
    for (const c of state.cubes) {
      if (c.arrow) c.arrow.visible = !c.dragging;
      c.mesh.visible = true;
      if (!c.dragging) c.mesh.material = wire ? c.wireframeMaterial : c.solidMaterial;
    }
  },
};
