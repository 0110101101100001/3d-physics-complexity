// --- physics.js — Lógica de física, deteção de colisão e estado da simulação ---
// Sem dependências de UI. A UI (ui.js) chama as funções e trata o DOM.
// Os algoritmos de broad-phase ficam em broadphase.js (sem Three.js, testáveis no Node).

import * as THREE from 'three';
import * as setup from './three-setup.js';
import { fragmentMesh, spawnFragments, updateFragments, clearFragments } from './fragments.js';
import {
  ARENA_HALF_XZ, ARENA_HEIGHT, ARENA_BOUNDS, MODES, SpatialGrid, OctreeSimulator, SweepAndPrune,
  intersectAABB, pairKey, updateAABB, runBroadPhase,
} from './broadphase.js';
import { STRATEGY, strategyOf } from './strategies.js';

// Limites da caixa de confinamento (ver cageMesh em three-setup.js)
export { ARENA_HALF_XZ, ARENA_HEIGHT };

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
  sweepAndPrune: null,
  currentBroadPhase: 'brute',
  raceMode: false, // corrida: todas as estratégias rodam no mesmo frame, uma por coluna
  cellSize: 2,
  octreeDepth: 6,
};

export function updateContextPanel(mode) {
  const config = strategyOf(mode).context;
  document.getElementById('context-algorithm').textContent = config.algorithm;
  document.getElementById('context-worstcase').textContent = config.worstCase;
  document.getElementById('context-op').textContent = config.op;
}

// Garante que as estruturas dos modos pedidos existem e refletem os parâmetros do estado
function ensureStructures(modes) {
  if (modes.includes('grid')) {
    if (!state.spatialGrid) state.spatialGrid = new SpatialGrid(state.cellSize);
    state.spatialGrid.cellSize = state.cellSize;
  }
  if (modes.includes('octree')) {
    if (!state.octreeSimulator) state.octreeSimulator = new OctreeSimulator(undefined, state.octreeDepth);
    state.octreeSimulator.maxDepth = state.octreeDepth;
  }
  if (modes.includes('sap') && !state.sweepAndPrune) state.sweepAndPrune = new SweepAndPrune();
}

// Estratégias na ordem das colunas da corrida
export const RACE_MODES = MODES;

// Resultado do último frame por estratégia. `ran` diz se ela rodou neste frame:
// fora da corrida só a estratégia ativa roda.
const newFrameStats = () => ({
  ran: false, comparisons: 0, buildMs: 0, queryMs: 0, timeMs: 0, tested: [], hits: [],
});
export const frameStats = Object.fromEntries(MODES.map(mode => [mode, newFrameStats()]));

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
  // Wireframe: a malha continua na cena (para o arraste acertar o cubo) com um material
  // que não desenha nada, e as 12 arestas aparecem por cima. O material invisível guarda
  // a cor do cubo; syncEdgeColors a copia para as arestas.
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: baseCol.clone(), colorWrite: false, depthWrite: false
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: baseCol.clone(), transparent: true });
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.visible = state.wireframeEnabled;
  edges.raycast = () => {}; // o raio acerta a malha, não as arestas
  const mesh = new THREE.Mesh(geometry, state.wireframeEnabled ? wireframeMaterial : solidMaterial);
  mesh.add(edges);
  mesh.castShadow = !state.wireframeEnabled;
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
    geometry, solidMaterial, wireframeMaterial, edges, edgeGeometry, edgeMaterial,
    spawnScale: -Math.min(spawnIndex * 0.08, 1.5), spawnDone: false
  };
  updateAABB(cubeData);
  mesh.userData = cubeData;
  mesh.scale.setScalar(0.001);
  state.cubes.push(cubeData);
  setup.scene.add(mesh);
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
  c.edgeGeometry.dispose();
  c.edgeMaterial.dispose();
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
  state.sweepAndPrune = null;
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
  state.sweepAndPrune = null;
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
  const wire = state.wireframeEnabled;
  state.cubes.forEach(cube => {
    const target = wire ? cube.wireframeMaterial : cube.solidMaterial;
    target.color.copy(cube.mesh.material.color);
    cube.mesh.material = target;
    cube.edges.visible = wire;
    cube.mesh.castShadow = !wire && setup.xray.level === 0;
  });
  syncEdgeColors();
}

// No wireframe a cor do cubo vive no material invisível da malha: as arestas a copiam
function syncEdgeColors() {
  if (!state.wireframeEnabled) return;
  for (const c of state.cubes) c.edgeMaterial.color.copy(c.mesh.material.color);
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
  const structures = { grid: state.spatialGrid, octree: state.octreeSimulator, sap: state.sweepAndPrune };

  for (const mode of RACE_MODES) frameStats[mode].ran = false;

  // Na corrida todas as estratégias rodam sobre as mesmas posições, antes de qualquer
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
  const _hits = activeStats.hits; // todas as estratégias acham as mesmas colisões
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
  renderSapDebug(frameStats.sap.ran ? state.sweepAndPrune : null);

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

  syncEdgeColors();
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
  setup.sapDebugLines.geometry.setDrawRange(0, 0);
  setup.sapSweepMesh.visible = false;
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
  for (const c of grid.grid.values()) {
    const cell = poolItem(group, i++, _gridCellMat);
    cell.position.set((c.x + 0.5) * cs, (c.y + 0.5) * cs, (c.z + 0.5) * cs);
    cell.scale.setScalar(cs);
    const k = c.items.length;
    if (!xrayOn || k < 2) continue; // célula com um cubo só não testa nada
    const t = Math.min(1, Math.log2(k * (k - 1) / 2) / 5); // 1 par -> 0, 32+ pares -> 1
    const box = heatItem(heat, h++, HEAT_COLD.grid, t, 0.07 + 0.2 * t);
    box.position.copy(cell.position);
    box.scale.setScalar(cs * 0.94);
  }
  hidePoolFrom(group, i);
  hidePoolFrom(heat, h);
}

// Nós da Octree (bounding boxes de cada nó da árvore; null esconde o gizmo).
// A raiz é um cubo mais alto que a arena (ver OctreeSimulator): cada caixa é desenhada
// recortada pela arena, e a que fica inteira fora dela não aparece.
const ARENA_MIN = ARENA_BOUNDS.min, ARENA_MAX = ARENA_BOUNDS.max;
export function renderOctreeDebug(octree) {
  const group = setup.octreeDebugGroup;
  const heat = setup.octreeHeatGroup;
  if (!octree) { hidePoolFrom(group, 0); hidePoolFrom(heat, 0); return; }
  const xrayOn = setup.xray.level > 0;
  let i = 0, h = 0;
  octree.forEachNode(node => {
    const { min, max } = node.bounds;
    const x0 = Math.max(min.x, ARENA_MIN.x), x1 = Math.min(max.x, ARENA_MAX.x);
    const y0 = Math.max(min.y, ARENA_MIN.y), y1 = Math.min(max.y, ARENA_MAX.y);
    const z0 = Math.max(min.z, ARENA_MIN.z), z1 = Math.min(max.z, ARENA_MAX.z);
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const item = poolItem(group, i++, octreeMaterial(node.depth));
    item.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    item.scale.set(x1 - x0, y1 - y0, z1 - z0);
    // nó com objetos: os de cima (que cruzam planos) quase não aparecem para não cobrir a
    // cena inteira; os fundos, pequenos, acendem mais
    const k = node.objects.length;
    if (xrayOn && k > 0 && node.depth > 0) {
      const t = Math.min(1, (k - 1) / 4);
      // a raiz é maior que a caixa: preenchida, tingiria a tela inteira
      const depthWeight = node.depth === 0 ? 0 : Math.min(1, 0.1 + (node.depth - 1) * 0.35);
      const box = heatItem(heat, h++, HEAT_COLD.octree, t, (0.05 + 0.16 * t) * depthWeight);
      box.position.copy(item.position);
      box.scale.copy(item.scale).multiplyScalar(0.96);
    }
  });
  hidePoolFrom(group, i);
  hidePoolFrom(heat, h);
}

// Régua do Sweep and Prune: na frente da arena, cada cubo vira o intervalo [min.x,
// max.x] que ele ocupa no eixo de varredura, com traços nas pontas. Intervalos que se
// sobrepõem vão para fileiras diferentes (a primeira fileira livre), então os empilhados
// são justamente os pares que a varredura visita. Passadas SAP_MAX_ROWS fileiras, o
// intervalo entra na fileira que termina antes, para a régua não sair do piso.
//
// Uma linha de varredura corre pelo eixo X: os intervalos que ela cruza (a "lista
// ativa" do algoritmo) acendem. O cubo sob o ponteiro aparece em branco na régua, e
// apontar um intervalo da régua destaca o cubo (pickSapInterval).
const SAP_RULER_Z = ARENA_HALF_XZ + 1.4;
const SAP_ROW_GAP = 0.45;
const SAP_MAX_ROWS = 8;
const SAP_TICK = 0.3;
const SAP_Y = 0.08;
const SAP_SWEEP_PERIOD = 3.2; // segundos para a varredura cruzar a arena
const SAP_BASE = new THREE.Color(0xa3e635).multiplyScalar(0.5);
const SAP_ACTIVE = new THREE.Color(0xd9f99d);
const SAP_AXIS = new THREE.Color(0xa3e635).multiplyScalar(0.3);
const _sapRowEnds = [];
const _sapLayout = [];   // { cube, z, min, max } do último frame, para apontar com o ponteiro

export function renderSapDebug(sap) {
  const lines = setup.sapDebugLines;
  if (!sap) {
    lines.geometry.setDrawRange(0, 0);
    setup.sapSweepMesh.visible = false;
    _sapLayout.length = 0;
    return;
  }
  const pos = lines.geometry.attributes.position;
  const col = lines.geometry.attributes.color;
  const arr = pos.array, carr = col.array;
  const maxSegs = arr.length / 6;
  let seg = 0;
  const push = (x1, z1, x2, z2, color) => {
    if (seg >= maxSegs) return;
    const o = seg++ * 6;
    arr[o] = x1; arr[o + 1] = SAP_Y; arr[o + 2] = z1;
    arr[o + 3] = x2; arr[o + 4] = SAP_Y; arr[o + 5] = z2;
    carr[o] = carr[o + 3] = color.r;
    carr[o + 1] = carr[o + 4] = color.g;
    carr[o + 2] = carr[o + 5] = color.b;
  };

  // Posição da varredura (parada com movimento reduzido)
  const sweeping = !setup.prefersReducedMotion();
  const phaseT = (performance.now() / 1000 / SAP_SWEEP_PERIOD) % 1;
  const sweepX = -ARENA_HALF_XZ + phaseT * 2 * ARENA_HALF_XZ;

  _sapRowEnds.length = 0;
  _sapLayout.length = 0;
  let rows = 0;
  for (const c of sap.list) {
    const { min, max } = c.aabb;
    let row = _sapRowEnds.findIndex(end => end <= min.x);
    if (row < 0) {
      if (_sapRowEnds.length < SAP_MAX_ROWS) { row = _sapRowEnds.length; _sapRowEnds.push(0); }
      else { row = 0; for (let r = 1; r < _sapRowEnds.length; r++) if (_sapRowEnds[r] < _sapRowEnds[row]) row = r; }
    }
    _sapRowEnds[row] = Math.max(_sapRowEnds[row], max.x);
    rows = Math.max(rows, row + 1);
    const z = SAP_RULER_Z + row * SAP_ROW_GAP;
    _sapLayout.push({ cube: c, z, min: min.x, max: max.x });
    const color = c === state.hoveredCube ? WHITE
      : sweeping && min.x <= sweepX && sweepX < max.x ? SAP_ACTIVE : SAP_BASE;
    push(min.x, z, max.x, z, color);
    push(min.x, z - SAP_TICK / 2, min.x, z + SAP_TICK / 2, color);
    push(max.x, z - SAP_TICK / 2, max.x, z + SAP_TICK / 2, color);
  }
  // eixo de varredura sob as fileiras
  const zAxis = SAP_RULER_Z - SAP_ROW_GAP;
  push(-ARENA_HALF_XZ, zAxis, ARENA_HALF_XZ, zAxis, SAP_AXIS);
  const zEnd = SAP_RULER_Z + Math.max(rows - 1, 0) * SAP_ROW_GAP;
  if (sweeping) push(sweepX, zAxis, sweepX, zEnd + SAP_TICK, SAP_ACTIVE);

  lines.geometry.setDrawRange(0, seg * 2);
  for (const attr of [pos, col]) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, seg * 6);
    attr.needsUpdate = true;
  }

  // Plano translúcido da varredura, atravessando a arena até a régua
  const sweep = setup.sapSweepMesh;
  sweep.visible = sweeping;
  if (sweeping) {
    const zFrom = -ARENA_HALF_XZ, zTo = zEnd + SAP_TICK;
    sweep.position.set(sweepX, ARENA_HEIGHT / 2, (zFrom + zTo) / 2);
    sweep.scale.set(zTo - zFrom, ARENA_HEIGHT, 1);
  }
}

// Intervalo da régua sob um ponto do piso (x, z), ou null
export function pickSapInterval(x, z) {
  for (const it of _sapLayout) {
    if (Math.abs(z - it.z) <= SAP_ROW_GAP / 2 && x >= it.min - 0.2 && x <= it.max + 0.2) return it.cube;
  }
  return null;
}

// ====================== LINHAS DE TESTE E VISTAS DA CORRIDA ======================
function fillPairLines(tested) {
  setup.clearPairLines();
  for (let i = 0; i < tested.length; i += 2) {
    setup.addPairLine(tested[i].mesh.position, tested[i + 1].mesh.position);
  }
  setup.updatePairLinesBuffer();
}


// Antes de desenhar a coluna de uma estratégia na corrida: a cena é a mesma, mudam
// as linhas dos pares que ela testou, o gizmo da estrutura e a paleta dos cubos.
export function prepareRaceView(mode) {
  fillPairLines(frameStats[mode].tested);
  setup.pairLinesMat.color.setStyle(STRATEGY[mode].color);
  setup.gridDebugGroup.visible = setup.gridHeatGroup.visible = mode === 'grid';
  setup.octreeDebugGroup.visible = setup.octreeHeatGroup.visible = mode === 'octree';
  setup.sapDebugGroup.visible = mode === 'sap';

  const palette = setup.CUBE_PALETTES[mode];
  for (const c of state.cubes) {
    if (c.dragging) continue; // mantém a cor de arraste
    const color = c.mesh.material.color;
    if (c.colliding) { color.copy(setup.COLLISION_COLOR); continue; }
    color.copy(palette[c.paletteIndex]);
    if (c === state.hoveredCube) color.lerp(WHITE, 0.3);
  }
  syncEdgeColors();
}

// Depois da última coluna: devolve os gizmos ao controle normal (visibilidade por item)
export function finishRaceViews() {
  setup.gridDebugGroup.visible = setup.gridHeatGroup.visible = true;
  setup.octreeDebugGroup.visible = setup.octreeHeatGroup.visible = true;
  setup.sapDebugGroup.visible = true;
}

// ====================== PASSE DE BRILHO ======================
// No passe de brilho (ver renderView em three-setup.js) só os cubos em colisão emitem
// luz. Os outros ficam pretos para continuar tapando o que está atrás deles; em
// wireframe eles somem, porque uma malha de arame não tapa nada.
const _hitColor = setup.COLLISION_COLOR.clone().multiplyScalar(0.32);
const GLOW_OFF_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
const GLOW_HIT_MAT = new THREE.MeshBasicMaterial({ color: _hitColor, fog: false });
const GLOW_HIT_EDGE_MAT = new THREE.LineBasicMaterial({ color: _hitColor, fog: false });

// Os gizmos da grade e da Octree são centenas de linhas sobrepostas: com o brilho
// inteiro eles apagariam a cena, então emitem só uma fração.
const GIZMO_GLOW = 0.18;
const PAIR_LINE_OPACITY = setup.pairLinesMat.opacity;
const SAP_OPACITY = setup.sapDebugMat.opacity;
const SAP_SWEEP_OPACITY = setup.sapSweepMat.opacity;
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
  setup.sapDebugMat.opacity = Math.min(1, SAP_OPACITY + 0.3 * x) * f;
  setup.sapSweepMat.opacity = SAP_SWEEP_OPACITY * (1 + x) * f;
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
    const m = c.solidMaterial;
    m.transparent = ghost;
    m.opacity = opacity;
    m.depthWrite = x < 0.35;
    c.edgeMaterial.opacity = Math.max(opacity, 0.5);
    c.mesh.castShadow = !ghost && !state.wireframeEnabled;
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
      if (c.colliding) {
        if (wire) c.edges.material = GLOW_HIT_EDGE_MAT; // a malha já não desenha nada
        else c.mesh.material = GLOW_HIT_MAT;
      } else if (wire || setup.xray.level > 0.3) c.mesh.visible = false; // no raio-X não tapa a estrutura
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
      c.edges.material = c.edgeMaterial;
      if (!c.dragging) c.mesh.material = wire ? c.wireframeMaterial : c.solidMaterial;
    }
  },
};
