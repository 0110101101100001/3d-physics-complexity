// --- theorem-checks.js — Cenários dos teoremas da "Prova de complexidade" ---
// Para cada teorema, uma cena que respeita as hipóteses e uma que as viola (o
// contraexemplo). As cenas rodam nas mesmas estruturas da simulação (broadphase.js) e a
// contagem medida é comparada com a fórmula da prova. Tudo é determinístico, sem DOM:
// roda no worker do benchmark e nos testes do Node.
import {
  plainCube, intersectAABB, mulberry32, createBoxScene, countPairs,
  SpatialGrid, OctreeSimulator, SweepAndPrune,
} from './broadphase.js';

export const OCTREE_K = 4;   // K da Octree do simulador (maxObjectsPerNode)
const LOG8 = Math.log(8);
const pairsOf = n => (n * (n - 1)) / 2;

// ====================== GRANDEZAS MEDIDAS ======================

// Montagem da Octree no modelo da prova: M(n) = Σ_v n_v, o número de classificações
// (um teste de octante por objeto em cada nó que ele atravessa). Um objeto guardado na
// profundidade d atravessa d + 1 nós.
export function octreeBuildWork(tree) {
  let work = 0;
  tree.forEachNode(v => { work += v.objects.length * (v.depth + 1); });
  return work;
}

export function octreeHeight(tree) {
  let h = 0;
  tree.forEachNode(v => { h = Math.max(h, v.depth + 1); });
  return h;
}

// Consulta da grade: Q(n) = Σ_c k_c(k_c − 1)/2 iterações (inclusive as que o teste da
// célula dona descarta) e a maior ocupação de célula.
export function gridQueryWork(grid) {
  let q = 0, kmax = 0;
  for (const cell of grid.grid.values()) {
    const k = cell.items.length;
    q += (k * (k - 1)) / 2;
    if (k > kmax) kmax = k;
  }
  return { q, kmax };
}

// ====================== CENAS ======================

// n cubos de lado `size` com o mesmo centro
export function stackedScene(n, size = 1, at = 0.5) {
  return Array.from({ length: n }, (_, i) => plainCube(i, size, at, at, at));
}

// Grade (célula 2): 4 cubos de lado 0,5 dentro de cada célula, sem tocar as bordas.
// Cada cubo ocupa uma célula só e cada célula tem exatamente K = 4 cubos, então
// Q(n) = (n/4)·C(4, 2) = n(K−1)/2 exatamente (n múltiplo de 4).
export const GRID_K = 4;
export function gridLatticeScene(n) {
  const q = Math.ceil(Math.cbrt(n / GRID_K));
  const offsets = [[0.5, 0.5, 0.5], [1.5, 0.5, 0.5], [0.5, 1.5, 0.5], [0.5, 0.5, 1.5]];
  return Array.from({ length: n }, (_, t) => {
    const cell = Math.floor(t / GRID_K);
    const [ox, oy, oz] = offsets[t % GRID_K];
    return plainCube(
      t, 0.5,
      2 * (cell % q) + ox,
      2 * (Math.floor(cell / q) % q) + oy,
      2 * Math.floor(cell / (q * q)) + oz,
    );
  });
}

// Octree: raiz [0, L]³
export function octreeFor(L, maxDepth) {
  return new OctreeSimulator({ min: { x: 0, y: 0, z: 0 }, max: { x: L, y: L, z: L } }, maxDepth, OCTREE_K);
}

// 4 cubos minúsculos em cada célula de uma rede 2^j × 2^j × 2^j, n = 4·8^j. Com
// corner = 0 a rede ocupa a raiz e cada filho recebe exatamente n/8 (H_B). Com
// corner = t ela é encolhida para o canto da raiz: nos t primeiros níveis tudo vai para
// um filho só (H_B falha), e a altura fica t + j + 1 níveis.
export function octreeLatticeScene(j, L = 64, corner = 0) {
  const q = 2 ** j;
  const w = L / 2 ** corner / q;
  const offsets = [[0.25, 0.25, 0.25], [0.75, 0.25, 0.25], [0.25, 0.75, 0.25], [0.25, 0.25, 0.75]];
  const list = [];
  for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) for (let c = 0; c < q; c++) {
    for (const [ox, oy, oz] of offsets) {
      list.push(plainCube(list.length, w / 10, (a + ox) * w, (b + oy) * w, (c + oz) * w));
    }
  }
  return list;
}

export const latticeLevels = n => Math.round(Math.log(n / OCTREE_K) / LOG8);

// Caminho na diagonal: o cubo i fica em 0,75·L·2^(−i). Cada divisão separa um único
// cubo do resto, então sem H_D a altura é n − K + 1 níveis e a montagem é Θ(n²).
export function octreePathScene(n, L = 64) {
  return Array.from({ length: n }, (_, i) => {
    const x = 0.75 * L * 2 ** -i;
    return plainCube(i, 0.1 * L * 2 ** -i, x, x, x);
  });
}

// Σ_v n_v exato do caminho: com s = min(n − K, D) divisões, o cubo i < s fica na
// profundidade i + 1 e os n − s restantes, na profundidade s.
export function octreePathWork(n, maxDepth, K = OCTREE_K) {
  if (n <= K) return n;
  const s = Math.min(n - K, maxDepth);
  return (s * (s - 1)) / 2 + 2 * s + (n - s) * (s + 1);
}

// Sweep and Prune: lado 1, centros em X a cada 0,4. Dois cubos a d posições distam 0,4d
// e se sobrepõem em X se 0,4d < 1, ou seja, d ≤ 2: k = (n − 1) + (n − 2) = 2n − 3 exato.
// y e z espalhados.
export function sapSpreadScene(n, rand) {
  return Array.from({ length: n }, (_, i) => plainCube(i, 1, 0.4 * i, rand() * 40, rand() * 40));
}

// Todos com o mesmo intervalo em X, separados em y e z: k = n(n−1)/2 e nenhuma colisão
export function sapColumnScene(n) {
  const q = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, t) => plainCube(t, 1, 0, 2 * (t % q), 2 * Math.floor(t / q)));
}

function buildOctree(tree, cubes) {
  for (const c of cubes) tree.insert(c);
  return tree;
}

export function sapPairs(sap) {
  let k = 0, hits = 0;
  sap.forEachCandidatePair((a, b) => { k++; if (intersectAABB(a, b)) hits++; });
  return { k, hits };
}

function sapBuilt(cubes) {
  const sap = new SweepAndPrune();
  sap.build(cubes);
  return sap;
}

// ====================== TEOREMAS ======================
// theory(n) é a fórmula da prova: exata, ou limite superior quando bound = true.
const SMALL = [50, 100, 200, 400, 800];
const LINEAR = [100, 200, 400, 800, 1600];
const LATTICE = [32, 256, 2048, 16384];
const PATH = [25, 50, 100, 200, 400];

export const THEOREM_CHECKS = [
  {
    id: 't1', mode: 'brute', theorem: 'Teorema 1', metric: 'C(n), pares testados',
    scenarios: [
      {
        kind: 'ok', label: 'cena aleatória da arena', theoryLabel: 'n(n−1)/2', sizes: SMALL,
        run: n => countPairs('brute', createBoxScene(n, 40, mulberry32(n)), {}).candidates,
        theory: pairsOf,
      },
      {
        kind: 'bad', label: 'todos no mesmo ponto (não há hipótese a violar)', theoryLabel: 'n(n−1)/2', sizes: SMALL,
        run: n => countPairs('brute', stackedScene(n), {}).candidates,
        theory: pairsOf,
      },
    ],
  },
  {
    id: 't2', mode: 'grid', theorem: 'Teorema 2', metric: 'Q(n), iterações da consulta',
    scenarios: [
      {
        kind: 'ok', label: '4 cubos por célula (H_K com K = 4)', theoryLabel: 'n(K−1)/2 = 1,5n', sizes: LINEAR,
        run: n => {
          const grid = new SpatialGrid(2);
          for (const c of gridLatticeScene(n)) grid.insert(c);
          return gridQueryWork(grid).q;
        },
        theory: n => (n * (GRID_K - 1)) / 2,
      },
      {
        kind: 'bad', label: 'todos numa célula (viola H_K)', theoryLabel: 'n(n−1)/2', sizes: SMALL,
        run: n => {
          const grid = new SpatialGrid(2);
          for (const c of stackedScene(n)) grid.insert(c);
          return gridQueryWork(grid).q;
        },
        theory: pairsOf,
      },
    ],
  },
  {
    id: 't3', mode: 'octree', theorem: 'Teorema 3', metric: 'M(n) = Σ n_v, classificações na montagem',
    scenarios: [
      {
        kind: 'ok', label: 'rede balanceada, n = 4·8^j (H_B, H_K)', theoryLabel: 'n(log₈(n/K) + 1)', sizes: LATTICE,
        run: n => octreeBuildWork(buildOctree(octreeFor(64, 12), octreeLatticeScene(latticeLevels(n)))),
        theory: n => n * (Math.log(n / OCTREE_K) / LOG8 + 1),
      },
      {
        kind: 'bad', label: 'caminho na diagonal (viola H_B; D ilimitado)', theoryLabel: 's(s−1)/2 + 2s + K(s+1), s = n−K', sizes: PATH,
        run: n => octreeBuildWork(buildOctree(octreeFor(64, 1e9), octreePathScene(n))),
        theory: n => octreePathWork(n, Infinity),
      },
    ],
  },
  {
    id: 't4', mode: 'sap', theorem: 'Teorema 4', metric: 'C(n) = k, pares sobrepostos em X',
    scenarios: [
      {
        kind: 'ok', label: 'espalhados em X a cada 0,4', theoryLabel: 'k = 2n − 3', sizes: LINEAR,
        run: n => sapPairs(sapBuilt(sapSpreadScene(n, mulberry32(n)))).k,
        theory: n => 2 * n - 3,
      },
      {
        kind: 'bad', label: 'todos com o mesmo x, nenhuma colisão', theoryLabel: 'n(n−1)/2', sizes: SMALL,
        run: n => sapPairs(sapBuilt(sapColumnScene(n))).k,
        theory: pairsOf,
      },
    ],
  },
];

// Roda todos os cenários e devolve só dados (vai do worker para a página).
export function theoremExperiment({ onProgress } = {}) {
  return THEOREM_CHECKS.map((check, index) => {
    onProgress?.({ id: check.id, theorem: check.theorem, index, total: THEOREM_CHECKS.length });
    return {
      id: check.id, mode: check.mode, theorem: check.theorem, metric: check.metric,
      scenarios: check.scenarios.map(s => ({
        kind: s.kind, label: s.label, theoryLabel: s.theoryLabel, bound: !!s.bound,
        points: s.sizes.map(n => ({ n, measured: s.run(n), theory: s.theory(n) })),
      })),
    };
  });
}
