// --- physics.js — Lógica de física, deteção de colisão e estado da simulação ---
// Sem dependências de UI. A UI (ui.js) chama as funções e trata o DOM.
// Three.js é carregado globalmente via CDN (window.THREE) pelo index.html.

const THREE = window.THREE;
import * as setup from './three-setup.js';

// ====================== ESTADO DA SIMULAÇÃO (partilhado) ======================
// Objeto mutável único: permite leitura e escrita tanto em physics.js quanto em ui.js
// sem violar a regra de strict mode / bindings readonly dos imports ES modules.
export const state = {
  cubes: [],
  nextId: 0,
  draggedCube: null,
  simPaused: false,
  simSpeed: 0.8,
  collisionCount: 0,
  activeCollisions: 0,
  currentCollidingPairs: new Set(),
  soundEnabled: true,
  audioContext: null,
  wireframeEnabled: false,
  isPhysicsEnabled: false,
  isHeatmapEnabled: false,
  typingInterval: null,
  lastComparisonCount: 0,
  spatialGrid: null,
  octreeSimulator: null,
  currentBroadPhase: 'brute',
  cellSize: 2,
  octreeDepth: 6,
};

// Aliases de leitura direta (conveniência, sem reatribuição)
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
  const algEl = document.getElementById('context-algorithm');
  const worstEl = document.getElementById('context-worstcase');
  const opEl = document.getElementById('context-op');
  algEl.textContent = config.algorithm;
  worstEl.textContent = config.worstCase;
  opEl.textContent = config.op;
}

// ====================== GRADE ESPACIAL O(n) ======================
export class SpatialGrid {
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  getCellKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  clear() { this.grid.clear(); }

  insert(obj) {
    const half = obj.size / 2;
    const pos = obj.mesh.position;
    const minX = Math.floor((pos.x - half) / this.cellSize);
    const maxX = Math.floor((pos.x + half) / this.cellSize);
    const minY = Math.floor((pos.y - half) / this.cellSize);
    const maxY = Math.floor((pos.y + half) / this.cellSize);
    const minZ = Math.floor((pos.z - half) / this.cellSize);
    const maxZ = Math.floor((pos.z + half) / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = this.getCellKey(x, y, z);
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(obj);
        }
      }
    }
  }

  getPotentialCollisions(obj) {
    const half = obj.size / 2;
    const pos = obj.mesh.position;
    const minX = Math.floor((pos.x - half) / this.cellSize);
    const maxX = Math.floor((pos.x + half) / this.cellSize);
    const minY = Math.floor((pos.y - half) / this.cellSize);
    const maxY = Math.floor((pos.y + half) / this.cellSize);
    const minZ = Math.floor((pos.z - half) / this.cellSize);
    const maxZ = Math.floor((pos.z + half) / this.cellSize);

    const potentialSet = new Set();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const cell = this.grid.get(this.getCellKey(x, y, z));
          if (cell) {
            for (let i = 0; i < cell.length; i++) {
              if (cell[i].id !== obj.id) potentialSet.add(cell[i]);
            }
          }
        }
      }
    }
    return Array.from(potentialSet);
  }
}

// ====================== OCTREE O(n log n) ======================
export class OctreeSimulator {
  constructor(boundsSize = 60, maxDepth = 6, maxObjectsPerNode = 4) {
    this.boundsSize = boundsSize;
    this.maxDepth = maxDepth;
    this.maxObjects = maxObjectsPerNode;
    const h = boundsSize / 2;
    this.root = this._createNode(
      new THREE.Box3(new THREE.Vector3(-h, -h, -h), new THREE.Vector3(h, h, h)),
      0
    );
  }

  _createNode(box3, depth) {
    return { bounds: box3, depth, children: null, objects: [] };
  }

  _getBox3(obj) {
    const h = obj.size / 2;
    const p = obj.mesh.position;
    return new THREE.Box3(
      new THREE.Vector3(p.x - h, p.y - h, p.z - h),
      new THREE.Vector3(p.x + h, p.y + h, p.z + h)
    );
  }

  _subdivide(node) {
    const { min, max } = node.bounds;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    node.children = [
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(cx, cy, cz)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx, min.y, min.z), new THREE.Vector3(max.x, cy, cz)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, cy, min.z), new THREE.Vector3(cx, max.y, cz)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx, cy, min.z), new THREE.Vector3(max.x, max.y, cz)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, cz), new THREE.Vector3(cx, cy, max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx, min.y, cz), new THREE.Vector3(max.x, cy, max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, cy, cz), new THREE.Vector3(cx, max.y, max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(max.x, max.y, max.z)), node.depth + 1),
    ];
  }

  insert(obj) { this._insertNode(this.root, obj, this._getBox3(obj)); }

  _insertNode(node, obj, objBox) {
    if (node.depth < this.maxDepth && node.objects.length >= this.maxObjects) {
      if (!node.children) this._subdivide(node);
    }
    if (node.children) {
      let inserted = false;
      for (let i = 0; i < 8; i++) {
        if (node.children[i].bounds.intersectsBox(objBox)) {
          this._insertNode(node.children[i], obj, objBox);
          inserted = true;
        }
      }
      if (inserted) return;
    }
    node.objects.push(obj);
  }

  getPotentialCollisions(obj) {
    const objBox = this._getBox3(obj);
    const potential = [];
    this._queryNode(this.root, obj, objBox, potential);
    return potential;
  }

  _queryNode(node, obj, objBox, potential) {
    for (const other of node.objects) {
      if (other.id !== obj.id) potential.push(other);
    }
    if (node.children) {
      for (let i = 0; i < 8; i++) {
        if (node.children[i].bounds.intersectsBox(objBox)) {
          this._queryNode(node.children[i], obj, objBox, potential);
        }
      }
    }
  }

  clear() {
    const h = this.boundsSize / 2;
    this.root = this._createNode(
      new THREE.Box3(new THREE.Vector3(-h, -h, -h), new THREE.Vector3(h, h, h)),
      0
    );
  }
}

// ====================== AABB ======================
export function intersectAABB(a, b) {
  const hA = a.size / 2, hB = b.size / 2;
  return Math.abs(a.mesh.position.x - b.mesh.position.x) < (hA + hB) &&
         Math.abs(a.mesh.position.y - b.mesh.position.y) < (hA + hB) &&
         Math.abs(a.mesh.position.z - b.mesh.position.z) < (hA + hB);
}

// ====================== RESOLUÇÃO DE COLISÃO AABB ======================
export function resolveCollision(cubeA, cubeB) {
  const hA = cubeA.size / 2;
  const hB = cubeB.size / 2;
  const sum = hA + hB;

  const dx = cubeA.mesh.position.x - cubeB.mesh.position.x;
  const dy = cubeA.mesh.position.y - cubeB.mesh.position.y;
  const dz = cubeA.mesh.position.z - cubeB.mesh.position.z;

  const overlapX = sum - Math.abs(dx);
  const overlapY = sum - Math.abs(dy);
  const overlapZ = sum - Math.abs(dz);

  if (overlapX <= overlapY && overlapX <= overlapZ) {
    const sign = dx >= 0 ? 1 : -1;
    const correction = overlapX / 2;
    cubeA.mesh.position.x += sign * correction;
    cubeB.mesh.position.x -= sign * correction;
    cubeA.velocity.x = Math.abs(cubeA.velocity.x) * sign;
    cubeB.velocity.x = -Math.abs(cubeB.velocity.x) * sign;
  } else if (overlapY <= overlapX && overlapY <= overlapZ) {
    const sign = dy >= 0 ? 1 : -1;
    const correction = overlapY / 2;
    cubeA.mesh.position.y += sign * correction;
    cubeB.mesh.position.y -= sign * correction;
    cubeA.velocity.y = Math.abs(cubeA.velocity.y) * sign;
    cubeB.velocity.y = -Math.abs(cubeB.velocity.y) * sign;
  } else {
    const sign = dz >= 0 ? 1 : -1;
    const correction = overlapZ / 2;
    cubeA.mesh.position.z += sign * correction;
    cubeB.mesh.position.z -= sign * correction;
    cubeA.velocity.z = Math.abs(cubeA.velocity.z) * sign;
    cubeB.velocity.z = -Math.abs(cubeB.velocity.z) * sign;
  }

  const relVel = cubeA.velocity.clone().sub(cubeB.velocity).length();
  const impactPos = new THREE.Vector3()
    .addVectors(cubeA.mesh.position, cubeB.mesh.position)
    .multiplyScalar(0.5);

  setup.impactParticles?.spawn(impactPos);
  setup.triggerImpactLight?.(impactPos);
  setup.triggerShockwave?.(impactPos);
  if (typeof playSound === 'function') playSound(relVel);
}

// ====================== HEATMAP ======================
const HEATMAP_COLORS = [
  new THREE.Color(0xffee44),
  new THREE.Color(0xff8800),
  new THREE.Color(0xff2a2a),
  new THREE.Color(0xff00cc),
];

export function updateCubeHeatmap(cube) {
  cube.collisionCount++;
  const count = cube.collisionCount;
  let heatColor;
  if (count <= 2) heatColor = HEATMAP_COLORS[0];
  else if (count <= 4) heatColor = HEATMAP_COLORS[1];
  else if (count <= 7) heatColor = HEATMAP_COLORS[2];
  else heatColor = HEATMAP_COLORS[3];
  if (!cube.dragging) cube.mesh.material.color.copy(heatColor);
}

export function resetHeatmap() {
  state.cubes.forEach(cube => {
    cube.collisionCount = 0;
    if (!cube.dragging) cube.mesh.material.color.copy(cube.baseColor);
  });
}

// ====================== ÁUDIO ======================
export function playSound(impactVelocity = 1.0) {
  if (!state.soundEnabled) return;
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }
  const oscillator = state.audioContext.createOscillator();
  const gainNode = state.audioContext.createGain();
  const baseFreq = THREE.MathUtils.clamp(220 + impactVelocity * 140, 180, 1200);
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(baseFreq, state.audioContext.currentTime);
  gainNode.gain.setValueAtTime(0.0, state.audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.25, state.audioContext.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + 0.12);
  oscillator.connect(gainNode);
  gainNode.connect(state.audioContext.destination);
  oscillator.start();
  oscillator.stop(state.audioContext.currentTime + 0.13);
}

// ====================== CRIAÇÃO DE CUBOS ======================
export function createCube(spawnIndex = 0) {
  const size = Math.random() * 4 + 2;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const palette = setup.CUBE_PALETTES[state.currentBroadPhase] || setup.CUBE_PALETTES.brute;
  const baseCol = palette[Math.floor(Math.random() * palette.length)];
  const solidMaterial = new THREE.MeshStandardMaterial({
    color: baseCol.clone(), roughness: 0.9, flatShading: true
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: baseCol.clone(), wireframe: true
  });
  const mesh = new THREE.Mesh(geometry, solidMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set((Math.random() - 0.5) * 40, (Math.random() * 15) + size, (Math.random() - 0.5) * 40);
  const speed = state.simSpeed;
  const velocity = new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);
  const arrowHelper = new THREE.ArrowHelper(
    velocity.clone().normalize(), mesh.position, 3, 0xffdd44, 0.8, 0.5
  );
  setup.scene.add(arrowHelper);

  const cubeData = {
    mesh, arrow: arrowHelper, id: state.nextId++, size, velocity,
    dragging: false, colliding: false, baseColor: baseCol.clone(),
    geometry, solidMaterial, wireframeMaterial, collisionCount: 0,
    spawnScale: -Math.min(spawnIndex * 0.08, 1.5), spawnDone: false
  };
  mesh.userData = cubeData;
  state.cubes.push(cubeData);
  setup.scene.add(mesh);
  mesh.scale.set(0.01, 0.01, 0.01);

  if (state.currentBroadPhase === 'grid' && state.spatialGrid) {
    state.spatialGrid.insert(cubeData);
  } else if (state.currentBroadPhase === 'octree' && state.octreeSimulator) {
    state.octreeSimulator.insert(cubeData);
  }
}

export function initCubes() {
  state.cubes.forEach(c => {
    if (c.arrow) setup.scene.remove(c.arrow);
    setup.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh.material.dispose();
    if (c.solidMaterial) c.solidMaterial.dispose();
    if (c.wireframeMaterial) c.wireframeMaterial.dispose();
  });
  state.cubes = [];
  state.nextId = 0;
  state.collisionCount = 0;
  state.activeCollisions = 0;
  state.currentCollidingPairs.clear();

  if (state.currentBroadPhase === 'grid') {
    state.spatialGrid = new SpatialGrid(state.cellSize);
    state.octreeSimulator = null;
  } else if (state.currentBroadPhase === 'octree') {
    state.octreeSimulator = new OctreeSimulator(60, state.octreeDepth);
    state.spatialGrid = null;
  } else {
    state.spatialGrid = null;
    state.octreeSimulator = null;
  }

  const count = (typeof document !== 'undefined' && document.getElementById('cubeCountInput'))
    ? parseInt(document.getElementById('cubeCountInput').value, 10) : 8;
  for (let i = 0; i < count; i++) createCube(i);
}

export function toggleWireframe() {
  state.cubes.forEach(cube => {
    cube.mesh.material = state.wireframeEnabled ? cube.wireframeMaterial : cube.solidMaterial;
  });
}

// ====================== FÍSICA (atualização de posições) ======================
export function updatePhysics() {
  if (state.simPaused) return;
  const speed = state.simSpeed;
  state.cubes.forEach(c => {
    if (!c.spawnDone) {
      c.spawnScale = Math.min(c.spawnScale + 0.08, 1);
      const visibleScale = Math.max(c.spawnScale, 0);
      if (!c.colliding && !c.dragging) {
        c.mesh.scale.setScalar(visibleScale < 0.01 ? 0.001 : visibleScale);
      }
      if (c.spawnScale >= 1) c.spawnDone = true;
      return;
    }
    if (c.dragging) return;
    c.mesh.position.addScaledVector(c.velocity, speed);
    const half = c.size / 2;
    if (Math.abs(c.mesh.position.x) > 20 - half) { c.velocity.x *= -0.95; c.mesh.position.x = Math.sign(c.mesh.position.x) * (20 - half); }
    if (c.mesh.position.y > 20 - half) { c.velocity.y *= -0.95; c.mesh.position.y = 20 - half; }
    else if (c.mesh.position.y < half) { c.velocity.y *= -0.95; c.mesh.position.y = half; }
    if (Math.abs(c.mesh.position.z) > 20 - half) { c.velocity.z *= -0.95; c.mesh.position.z = Math.sign(c.mesh.position.z) * (20 - half); }

    if (c.arrow) {
      c.arrow.position.copy(c.mesh.position);
      if (c.velocity.lengthSq() > 0.00001) {
        c.arrow.setDirection(c.velocity.clone().normalize());
      }
      c.arrow.setLength(Math.min(c.velocity.length() * 2, 5));
      c.arrow.visible = !c.dragging;
    }
  });
}

// ====================== DETEÇÃO DE COLISÕES ======================
export function detectCollisions() {
  setup.clearPairLines?.();

  state.cubes.forEach(c => {
    c.colliding = false;
    if (!c.dragging) {
      c.mesh.material.color.copy(c.baseColor);
      c.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }
  });

  const newPairs = new Set();
  let localActiveCollisions = 0;
  let comparisons = 0;
  const start = performance.now();

  if (state.currentBroadPhase === 'grid' && state.spatialGrid) {
    state.spatialGrid.clear();
    state.cubes.forEach(cube => state.spatialGrid.insert(cube));
    if (typeof renderGridDebug === 'function') renderGridDebug();

    state.cubes.forEach(cube => {
      if (cube.dragging) return;
      const potentialCollisions = state.spatialGrid.getPotentialCollisions(cube);
      potentialCollisions.forEach(other => {
        if (other.id <= cube.id) return;
        comparisons++;
        setup.addPairLine?.(cube.mesh.position, other.mesh.position);
        if (intersectAABB(cube, other)) {
          localActiveCollisions++;
          newPairs.add(`${cube.id}-${other.id}`);
          if (state.isPhysicsEnabled) resolveCollision(cube, other);
        }
      });
    });
  } else if (state.currentBroadPhase === 'octree' && state.octreeSimulator) {
    state.octreeSimulator.clear();
    state.cubes.forEach(cube => state.octreeSimulator.insert(cube));
    renderOctreeDebug();
    const testedPairs = new Set();
    state.cubes.forEach(cube => {
      if (cube.dragging) return;
      const potentialCollisions = state.octreeSimulator.getPotentialCollisions(cube);
      potentialCollisions.forEach(other => {
        const pairKey = cube.id < other.id ? `${cube.id}-${other.id}` : `${other.id}-${cube.id}`;
        if (testedPairs.has(pairKey)) return;
        testedPairs.add(pairKey);
        comparisons++;
        setup.addPairLine?.(cube.mesh.position, other.mesh.position);
        if (intersectAABB(cube, other)) {
          localActiveCollisions++;
          newPairs.add(pairKey);
          if (state.isPhysicsEnabled) resolveCollision(cube, other);
        }
      });
    });
  } else {
    for (let i = 0; i < state.cubes.length; i++) {
      if (state.cubes[i].dragging) continue;
      for (let j = i + 1; j < state.cubes.length; j++) {
        if (state.cubes[j].dragging) continue;
        comparisons++;
        setup.addPairLine(state.cubes[i].mesh.position, state.cubes[j].mesh.position);
        if (intersectAABB(state.cubes[i], state.cubes[j])) {
          localActiveCollisions++;
          newPairs.add(`${state.cubes[i].id}-${state.cubes[j].id}`);
          if (state.isPhysicsEnabled) resolveCollision(state.cubes[i], state.cubes[j]);
        }
      }
    }
  }

  setup.updatePairLinesBuffer?.();
  const end = performance.now();
  const pureComputeTime = end - start;

  state.activeCollisions = localActiveCollisions;
  state.lastComparisonCount = comparisons;

  newPairs.forEach(key => {
    const [id1, id2] = key.split('-');
    const c1 = state.cubes.find(c => c.id == parseInt(id1));
    const c2 = state.cubes.find(c => c.id == parseInt(id2));
    [c1, c2].forEach(c => {
      if (!c) return;
      c.colliding = true;
      if (!c.dragging) {
        c.mesh.material.color.copy(setup.COLLISION_COLOR);
        c.mesh.scale.set(1.15, 0.85, 1.15);
      }
    });
    if (!state.currentCollidingPairs.has(key)) {
      state.collisionCount++;
      if (!state.isPhysicsEnabled) playSound(1.5);
      const badgeTextEl = document.getElementById('badgeText');
      badgeTextEl.classList.remove('collision-bump');
      void badgeTextEl.offsetWidth;
      badgeTextEl.classList.add('collision-bump');
    }
  });

  state.currentCollidingPairs = newPairs;

  // Atualização da Métrica de Economia
  const badgeEl = document.querySelector('.economy-badge');
  const econValEl = document.getElementById('econVal');

  if (badgeEl && econValEl) {
    const totalN = state.cubes.length;
    const baseComps = (totalN * (totalN - 1)) / 2;

    if (state.currentBroadPhase === 'brute' || baseComps <= 0) {
      econValEl.textContent = '0%';
      badgeEl.classList.add('disabled');
    } else {
      const saved = Math.max(0, Math.min(100, Math.round(((baseComps - comparisons) / baseComps) * 100)));
      econValEl.textContent = `${saved}%`;
      badgeEl.classList.remove('disabled');
    }
  }

  setup.composer.render();

  return { comparisons, pureComputeTime };
}

// Render gizmos de células da Grade Espacial
export function renderGridDebug() {
  while (setup.gridDebugGroup.children.length > 0) {
    const child = setup.gridDebugGroup.children.pop();
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  if (state.currentBroadPhase !== 'grid' || !state.spatialGrid) return;
  const cellGeo = new THREE.BoxGeometry(state.spatialGrid.cellSize, state.spatialGrid.cellSize, state.spatialGrid.cellSize);
  const edgesGeo = new THREE.EdgesGeometry(cellGeo);
  const cellMat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.45 });

  for (const key of state.spatialGrid.grid.keys()) {
    const [cx, cy, cz] = key.split(',').map(Number);
    const wireframe = new THREE.LineSegments(edgesGeo, cellMat);
    wireframe.position.set(
      (cx + 0.5) * state.spatialGrid.cellSize,
      (cy + 0.5) * state.spatialGrid.cellSize,
      (cz + 0.5) * state.spatialGrid.cellSize
    );
    setup.gridDebugGroup.add(wireframe);
  }
}

// Render nós da Octree (bounding boxes de cada nó da árvore)
export function renderOctreeDebug() {
  while (setup.octreeDebugGroup.children.length > 0) {
    const child = setup.octreeDebugGroup.children.pop();
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  if (state.currentBroadPhase !== 'octree' || !state.octreeSimulator) return;

  const octree = state.octreeSimulator;
  const colorByDepth = {
    0: new THREE.Color(0xa855f7),
    1: new THREE.Color(0x9b4dca),
    2: new THREE.Color(0x7b2cbf),
    3: new THREE.Color(0x9370db),
    4: new THREE.Color(0x8a2be2),
    5: new THREE.Color(0x9370db),
    6: new THREE.Color(0x8a2be2)
  };

  const nodeGeo = new THREE.BoxGeometry(1, 1, 1);
  const edgesGeo = new THREE.EdgesGeometry(nodeGeo);

  function traverse(node) {
    const { min, max } = node.bounds;
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    const depthColor = colorByDepth[node.depth] ?? new THREE.Color(0x6b21a8);
    const opacity = Math.max(0.15, 0.4 - node.depth * 0.04);
    const mat = new THREE.LineBasicMaterial({ color: depthColor, transparent: true, opacity });

    const wireframe = new THREE.LineSegments(edgesGeo, mat);
    wireframe.position.copy(center);
    wireframe.scale.copy(size);
    setup.octreeDebugGroup.add(wireframe);

    if (node.children) {
      for (let i = 0; i < 8; i++) {
        traverse(node.children[i]);
      }
    }
  }

  traverse(octree.root);
}
