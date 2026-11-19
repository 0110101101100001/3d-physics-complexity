// --- broadphase.js — Estratégias de broad-phase, sem Three.js e sem DOM ---
// Este módulo roda em três lugares: na página (simulação e corrida), no Web Worker do
// benchmark (bench-worker.js) e nos testes do Node (test/broadphase.test.js). Por isso
// não importa nada: os objetos só precisam ter a forma abaixo.
//
//   cubo = { id, size, mesh: { position: {x, y, z} }, aabb: { min: {x, y, z}, max: {x, y, z} } }
//
// Na página, aabb é um THREE.Box3 e position um THREE.Vector3; aqui só se leem x, y e z.

// Arena do simulador: x e z de -20 a 20, y de 0 a 20 (ver cageMesh em three-setup.js)
export const ARENA_HALF_XZ = 20;
export const ARENA_HEIGHT = 20;
export const ARENA_BOUNDS = {
  min: { x: -ARENA_HALF_XZ, y: 0, z: -ARENA_HALF_XZ },
  max: { x: ARENA_HALF_XZ, y: ARENA_HEIGHT, z: ARENA_HALF_XZ },
};

// Raiz da Octree: cubo de 40 apoiado no chão (ver OctreeSimulator)
export const OCTREE_ROOT = {
  min: { x: -ARENA_HALF_XZ, y: 0, z: -ARENA_HALF_XZ },
  max: { x: ARENA_HALF_XZ, y: 2 * ARENA_HALF_XZ, z: ARENA_HALF_XZ },
};

// ====================== AABB ======================
// Cubos alinhados aos eixos: há sobreposição quando a distância entre os centros é
// menor que a soma das metades em cada eixo.
export function intersectAABB(a, b) {
  const s = (a.size + b.size) / 2;
  const pa = a.mesh.position, pb = b.mesh.position;
  return Math.abs(pa.x - pb.x) < s &&
         Math.abs(pa.y - pb.y) < s &&
         Math.abs(pa.z - pb.z) < s;
}

// Recalcula a AABB a partir do centro e do tamanho
export function updateAABB(cube) {
  const h = cube.size / 2;
  const p = cube.mesh.position;
  const { min, max } = cube.aabb;
  min.x = p.x - h; min.y = p.y - h; min.z = p.z - h;
  max.x = p.x + h; max.y = p.y + h; max.z = p.z + h;
}

// Chave numérica única por par (evita concatenação e parsing de strings)
export function pairKey(a, b) {
  return a.id < b.id ? a.id * 1e6 + b.id : b.id * 1e6 + a.id;
}

function boxesOverlap(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x &&
         a.min.y <= b.max.y && a.max.y >= b.min.y &&
         a.min.z <= b.max.z && a.max.z >= b.min.z;
}

// ====================== GRADE ESPACIAL O(n) ======================
// Chaves de célula numéricas: índices deslocados para valores positivos e empacotados.
const CELL_OFFSET = 512;
const CELL_RANGE = 1024;

export class SpatialGrid {
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    this.grid = new Map();   // chave -> célula { x, y, z, items }
    this._pool = [];         // células reaproveitadas entre frames
    this._used = 0;
  }

  static cellKey(x, y, z) {
    return ((x + CELL_OFFSET) * CELL_RANGE + (y + CELL_OFFSET)) * CELL_RANGE + (z + CELL_OFFSET);
  }

  clear() {
    this.grid.clear();
    this._used = 0;
  }

  _cell(x, y, z) {
    const key = SpatialGrid.cellKey(x, y, z);
    let cell = this.grid.get(key);
    if (cell) return cell;
    cell = this._pool[this._used];
    if (!cell) { cell = { x: 0, y: 0, z: 0, items: [] }; this._pool.push(cell); }
    this._used++;
    cell.x = x; cell.y = y; cell.z = z;
    cell.items.length = 0;
    this.grid.set(key, cell);
    return cell;
  }

  insert(obj) {
    const cs = this.cellSize;
    const { min, max } = obj.aabb;
    const minX = Math.floor(min.x / cs), maxX = Math.floor(max.x / cs);
    const minY = Math.floor(min.y / cs), maxY = Math.floor(max.y / cs);
    const minZ = Math.floor(min.z / cs), maxZ = Math.floor(max.z / cs);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) this._cell(x, y, z).items.push(obj);
      }
    }
  }

  // Visita cada par que partilha pelo menos uma célula exatamente uma vez.
  // Um par pode partilhar várias células; ele só é reportado na "célula dona": a do
  // canto mínimo da interseção das duas faixas de células. Essa célula é única e
  // pertence às duas, então não é preciso guardar os pares já vistos num Set.
  forEachCandidatePair(onPair) {
    const cs = this.cellSize;
    for (const cell of this.grid.values()) {
      const items = cell.items;
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const amin = a.aabb.min;
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          const bmin = b.aabb.min;
          if (Math.floor(Math.max(amin.x, bmin.x) / cs) !== cell.x) continue;
          if (Math.floor(Math.max(amin.y, bmin.y) / cs) !== cell.y) continue;
          if (Math.floor(Math.max(amin.z, bmin.z) / cs) !== cell.z) continue;
          onPair(a, b);
        }
      }
    }
  }
}

// ====================== OCTREE O(n log n) ======================
// Cada objeto fica no nó mais profundo que o contém por inteiro; objetos que
// atravessam um plano divisor (straddling) permanecem no nó pai.
//
// A raiz é um cubo de 40 apoiado no chão da arena (y de 0 a 40). O primeiro corte em y
// cai no teto da arena, então nenhum cubo fica preso na raiz por ele e os octantes
// continuam cúbicos. Medido em cenas de 150 cubos: ~17% menos pares que a raiz antiga
// (cubo de 60 na origem) e menos que uma raiz do tamanho exato da arena, cujos octantes
// achatados (20 x 10 x 20) deixam mais cubos cruzando planos.
//
// Um objeto só desce para um filho se couber inteiro no nó. Assim um objeto fora da
// raiz fica nela e continua sendo testado contra todos que toca.
//
// A árvore é refeita a cada frame. Os nós vêm de um pool e a travessia usa uma pilha
// única, para a montagem e a consulta não alocarem memória: o coletor de lixo do
// navegador entraria no tempo medido.
export class OctreeSimulator {
  // bounds: { min, max }, ou um número (lado de um cubo centrado na origem)
  constructor(bounds = OCTREE_ROOT, maxDepth = 6, maxObjectsPerNode = 4) {
    if (typeof bounds === 'number') {
      const h = bounds / 2;
      bounds = { min: { x: -h, y: -h, z: -h }, max: { x: h, y: h, z: h } };
    }
    this.bounds = bounds;
    this.maxDepth = maxDepth;
    this.maxObjects = maxObjectsPerNode;
    this._pool = [];
    this._used = 0;
    this._stack = [];   // objetos herdados dos ancestrais durante a consulta
    this.root = null;
    this.clear();
  }

  _node(minX, minY, minZ, maxX, maxY, maxZ, depth) {
    let node = this._pool[this._used];
    if (!node) {
      node = {
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
        center: { x: 0, y: 0, z: 0 },
        depth: 0, children: null, objects: [], _kids: null,
      };
      this._pool.push(node);
    }
    this._used++;
    const { min, max } = node.bounds;
    min.x = minX; min.y = minY; min.z = minZ;
    max.x = maxX; max.y = maxY; max.z = maxZ;
    node.center.x = (minX + maxX) / 2;
    node.center.y = (minY + maxY) / 2;
    node.center.z = (minZ + maxZ) / 2;
    node.depth = depth;
    node.children = null;
    node.objects.length = 0;
    return node;
  }

  clear() {
    this._used = 0;
    const { min, max } = this.bounds;
    this.root = this._node(min.x, min.y, min.z, max.x, max.y, max.z, 0);
  }

  // Índice do filho: bit0 = metade alta em X, bit1 = Y, bit2 = Z
  _subdivide(node) {
    const { min, max } = node.bounds;
    const c = node.center;
    const d = node.depth + 1;
    const kids = node._kids ?? (node._kids = new Array(8));
    for (let i = 0; i < 8; i++) {
      kids[i] = this._node(
        i & 1 ? c.x : min.x, i & 2 ? c.y : min.y, i & 4 ? c.z : min.z,
        i & 1 ? max.x : c.x, i & 2 ? max.y : c.y, i & 4 ? max.z : c.z,
        d,
      );
    }
    node.children = kids;
  }

  // Filho que contém a caixa por inteiro, ou null se ela atravessa o centro ou sai do nó.
  _childContaining(node, box) {
    const nb = node.bounds;
    if (box.min.x < nb.min.x || box.min.y < nb.min.y || box.min.z < nb.min.z ||
        box.max.x > nb.max.x || box.max.y > nb.max.y || box.max.z > nb.max.z) return null;
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
      if (child) this._insertNode(child, obj);
      else node.objects.push(obj);
      return;
    }
    node.objects.push(obj);
    if (node.objects.length > this.maxObjects && node.depth < this.maxDepth) {
      this._subdivide(node);
      const objs = node.objects;
      let kept = 0;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const child = this._childContaining(node, o.aabb);
        if (child) this._insertNode(child, o);
        else objs[kept++] = o;
      }
      objs.length = kept;
    }
  }

  // Visita cada par candidato uma única vez: objetos do mesmo nó entre si e
  // objetos de ancestrais contra os do nó, só quando a AABB do ancestral
  // intersecta os limites do nó.
  forEachCandidatePair(onPair) {
    this._stack.length = 0;
    this._collectPairs(this.root, 0, 0, onPair);
  }

  // Os herdados deste nó estão em stack[from, to). Cada filho recebe, logo acima na
  // pilha, os herdados e os objetos deste nó que tocam a região dele.
  _collectPairs(node, from, to, onPair) {
    const stack = this._stack;
    const objs = node.objects;
    for (let i = 0; i < objs.length; i++) {
      const a = objs[i];
      for (let j = i + 1; j < objs.length; j++) onPair(a, objs[j]);
      for (let k = from; k < to; k++) onPair(stack[k], a);
    }
    if (!node.children) return;
    for (let i = 0; i < 8; i++) {
      const child = node.children[i];
      if (!child.children && child.objects.length === 0) continue;
      let top = to;
      for (let k = from; k < to; k++) {
        if (boxesOverlap(stack[k].aabb, child.bounds)) stack[top++] = stack[k];
      }
      for (let k = 0; k < objs.length; k++) {
        if (boxesOverlap(objs[k].aabb, child.bounds)) stack[top++] = objs[k];
      }
      this._collectPairs(child, to, top, onPair);
    }
  }

  // Percorre os nós em uso (para os gizmos de depuração)
  forEachNode(visit) {
    const walk = node => {
      visit(node);
      if (node.children) for (let i = 0; i < 8; i++) walk(node.children[i]);
    };
    walk(this.root);
  }
}

// ====================== SWEEP AND PRUNE O(n + k) ======================
// Projeta as AABBs no eixo X e mantém a lista ordenada pelo início do intervalo. A
// varredura só testa um objeto contra os seguintes cujo intervalo começa antes de o
// dele terminar: pares que não se sobrepõem em X nunca são visitados.
//
// A lista sobrevive entre frames. Como os cubos andam pouco de um frame para o
// outro, ela já chega quase ordenada e a ordenação por inserção custa O(n + s), sendo
// s o número de trocas (coerência temporal). A varredura custa O(n + k), sendo k o
// número de pares que se sobrepõem em X.
let _sapInstances = 0;

export class SweepAndPrune {
  constructor() {
    this.list = [];
    this.swaps = 0;   // trocas da última ordenação (mede a coerência temporal)
    this._mark = Symbol(`sap${_sapInstances++}`);
    this._frame = 0;
  }

  clear() { this.list.length = 0; }

  // Sincroniza a lista com os objetos do frame e reordena.
  build(objects) {
    const mark = this._mark;
    const frame = ++this._frame;
    for (let i = 0; i < objects.length; i++) objects[i][mark] = frame;

    let list = this.list;
    let same = list.length === objects.length;
    for (let i = 0; same && i < list.length; i++) same = list[i][mark] === frame;

    this.swaps = 0;
    if (!same) {
      // conjunto mudou (cubo novo, arrastado, cena reiniciada): reordena do zero
      list = this.list = objects.slice();
      list.sort((a, b) => a.aabb.min.x - b.aabb.min.x);
      return;
    }
    // Ordenação por inserção: quase linear numa lista quase ordenada
    for (let i = 1; i < list.length; i++) {
      const o = list[i];
      const key = o.aabb.min.x;
      let j = i - 1;
      while (j >= 0 && list[j].aabb.min.x > key) {
        list[j + 1] = list[j];
        j--;
      }
      if (j !== i - 1) { list[j + 1] = o; this.swaps += i - 1 - j; }
    }
  }

  forEachCandidatePair(onPair) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const end = a.aabb.max.x;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.aabb.min.x >= end) break; // lista ordenada: nenhum seguinte toca a em X
        onPair(a, b);
      }
    }
  }
}

// ====================== BROAD-PHASE ======================
// Duas fases, medidas em separado:
//   1. montar    — limpa e preenche a estrutura espacial (a força bruta não tem esta fase)
//   2. consultar — percorre a estrutura e chama onPair(a, b) para cada par candidato
// Simulação, corrida e benchmark usam estas mesmas funções, para medirem o mesmo trabalho.
export const MODES = ['brute', 'grid', 'octree', 'sap'];

export function createStructures({ cellSize = 2, octreeDepth = 6 } = {}) {
  return {
    grid: new SpatialGrid(cellSize),
    octree: new OctreeSimulator(OCTREE_ROOT, octreeDepth),
    sap: new SweepAndPrune(),
  };
}

export function buildBroadPhase(mode, cubes, structures) {
  if (mode === 'grid') {
    const grid = structures.grid;
    grid.clear();
    for (let i = 0; i < cubes.length; i++) grid.insert(cubes[i]);
  } else if (mode === 'octree') {
    const octree = structures.octree;
    octree.clear();
    for (let i = 0; i < cubes.length; i++) octree.insert(cubes[i]);
  } else if (mode === 'sap') {
    structures.sap.build(cubes);
  }
}

export function queryBroadPhase(mode, cubes, onPair, structures) {
  if (mode === 'grid') {
    structures.grid.forEachCandidatePair(onPair);
  } else if (mode === 'octree') {
    structures.octree.forEachCandidatePair(onPair);
  } else if (mode === 'sap') {
    structures.sap.forEachCandidatePair(onPair);
  } else {
    for (let i = 0; i < cubes.length; i++) {
      const a = cubes[i];
      for (let j = i + 1; j < cubes.length; j++) onPair(a, cubes[j]);
    }
  }
}

// Monta e consulta, devolvendo o tempo de cada fase em ms.
export function runBroadPhase(mode, cubes, onPair, structures) {
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

// ====================== CENAS SINTÉTICAS ======================

// Gerador pseudoaleatório com semente: as cenas sintéticas são sempre as mesmas
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cubo sem malha a partir de centro e tamanho
export function plainCube(id, size, x, y, z) {
  const cube = {
    id, size, mesh: { position: { x, y, z } },
    aabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
  };
  updateAABB(cube);
  return cube;
}

// Cubos com a mesma distribuição de createCube (tamanho 2 a 6, dentro da arena).
// `rand` é um gerador em [0, 1).
export function createSyntheticCubes(n, rand) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const size = rand() * 4 + 2;
    const half = size / 2;
    const spanXZ = 2 * (ARENA_HALF_XZ - half);
    list.push(plainCube(
      i, size,
      (rand() - 0.5) * spanXZ,
      half + rand() * (ARENA_HEIGHT - size),
      (rand() - 0.5) * spanXZ,
    ));
  }
  return list;
}

// ====================== MEDIÇÃO ======================
// Uma execução da detecção dura microssegundos, e o relógio do navegador é grosso
// (até 1 ms no Firefox). Por isso nada aqui cronometra uma execução isolada: o
// trabalho é repetido até somar tempo suficiente e o total é dividido pelo número
// de execuções.

// Tempo médio de uma execução completa (montar + consultar + testar os pares).
// Não há cronômetro dentro do laço, para o custo de ler o relógio não entrar na conta.
export function measureTotal(mode, cubes, structures, minMs, minRuns) {
  let hits = 0;
  const onPair = (a, b) => { if (intersectAABB(a, b)) hits++; };
  let runs = 0, batch = 1, elapsed = 0;
  const start = performance.now();
  do {
    for (let i = 0; i < batch; i++) {
      buildBroadPhase(mode, cubes, structures);
      queryBroadPhase(mode, cubes, onPair, structures);
    }
    runs += batch;
    batch *= 2;
    elapsed = performance.now() - start;
  } while (elapsed < minMs || runs < minRuns);
  return elapsed / runs;
}

// Fração do tempo gasta montando a estrutura, mais as contagens de uma execução.
export function measurePhases(mode, cubes, structures, minMs) {
  let comparisons = 0, hits = 0, buildMs = 0, queryMs = 0;
  const onPair = (a, b) => { comparisons++; if (intersectAABB(a, b)) hits++; };
  const start = performance.now();
  do {
    comparisons = 0;
    hits = 0;
    const t = runBroadPhase(mode, cubes, onPair, structures);
    buildMs += t.buildMs;
    queryMs += t.queryMs;
    // a força bruta não tem fase de montagem: basta uma execução para as contagens
  } while (mode !== 'brute' && performance.now() - start < minMs);
  const total = buildMs + queryMs;
  return { buildShare: total > 0 ? buildMs / total : 0, comparisons, hits };
}

// Ajusta t = a·n^k por mínimos quadrados em escala log-log: ln t = ln a + k·ln n.
// points: [{ n, t }]. Devolve { k, a, r2 } ou null se não houver pontos suficientes.
export function fitPowerLaw(points) {
  const pts = points.filter(p => p.t > 0 && p.n > 0);
  const m = pts.length;
  if (m < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const x = Math.log(p.n), y = Math.log(p.t);
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const den = m * sxx - sx * sx;
  if (den === 0) return null;
  const k = (m * sxy - sx * sy) / den;
  const lnA = (sy - k * sx) / m;
  let ssRes = 0;
  for (const p of pts) {
    const e = Math.log(p.t) - (lnA + k * Math.log(p.n));
    ssRes += e * e;
  }
  const ssTot = syy - (sy * sy) / m;
  return { k, a: Math.exp(lnA), r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

// ====================== EXPERIMENTO DE CRESCIMENTO ======================
// Conta pares candidatos (não tempo: a contagem não depende da máquina) em cenas de
// vários N, em dois regimes:
//   'fixa'      a arena do simulador (40 x 20 x 40): a densidade cresce com N
//   'constante' a caixa cresce com N (lado ∝ n^(1/3)): a densidade fica a da arena com
//               150 cubos, o regime em que as complexidades de caso médio são enunciadas
// e ajusta c(n) = a·n^k a cada estratégia (ver aba "Prova de complexidade").
export const GROWTH_SIZES = [100, 200, 400, 800, 1600];
const DENSITY_REF_N = 150;

// Lado da caixa (x e z; a altura é a metade, como a arena) para n cubos no regime dado
export function growthBoxSide(regime, n) {
  return regime === 'constante' ? 2 * ARENA_HALF_XZ * Math.cbrt(n / DENSITY_REF_N) : 2 * ARENA_HALF_XZ;
}

// Cubos de lado 2 a 6 numa caixa L x L/2 x L apoiada em y = 0
export function createBoxScene(n, L, rand) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const size = rand() * 4 + 2;
    const half = size / 2;
    list.push(plainCube(
      i, size,
      (rand() - 0.5) * (L - size),
      half + rand() * (L / 2 - size),
      (rand() - 0.5) * (L - size),
    ));
  }
  return list;
}

// Raiz da Octree para uma caixa de lado L: cubo de lado L apoiado no chão (como OCTREE_ROOT)
export function octreeRootFor(L) {
  return { min: { x: -L / 2, y: 0, z: -L / 2 }, max: { x: L / 2, y: L, z: L / 2 } };
}

// Pares candidatos e colisões de uma estratégia numa cena
export function countPairs(mode, cubes, structures) {
  let candidates = 0, hits = 0;
  runBroadPhase(mode, cubes, (a, b) => {
    candidates++;
    if (intersectAABB(a, b)) hits++;
  }, structures);
  return { candidates, hits };
}

export function growthExperiment({
  regime = 'constante', sizes = GROWTH_SIZES, seeds = 2, cellSize = 2, octreeDepth = 6, onProgress,
} = {}) {
  const series = Object.fromEntries(MODES.map(m => [m, []]));
  sizes.forEach((n, index) => {
    onProgress?.({ regime, n, index, total: sizes.length });
    const L = growthBoxSide(regime, n);
    const sums = Object.fromEntries(MODES.map(m => [m, 0]));
    for (let s = 0; s < seeds; s++) {
      const cubes = createBoxScene(n, L, mulberry32(n * 7919 + s + (regime === 'fixa' ? 0 : 104729)));
      const structures = {
        grid: new SpatialGrid(cellSize),
        octree: new OctreeSimulator(octreeRootFor(L), octreeDepth),
        sap: new SweepAndPrune(),
      };
      for (const m of MODES) {
        // a força bruta testa exatamente n(n-1)/2 pares: não precisa rodar
        sums[m] += m === 'brute' ? (n * (n - 1)) / 2 : countPairs(m, cubes, structures).candidates;
      }
    }
    for (const m of MODES) series[m].push({ n, t: sums[m] / seeds });
  });
  const fits = Object.fromEntries(MODES.map(m => [m, fitPowerLaw(series[m])]));
  return { regime, sizes, series, fits };
}
