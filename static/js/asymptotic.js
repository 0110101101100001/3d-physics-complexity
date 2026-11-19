// --- asymptotic.js — Gráfico assintótico: constantes, curvas teóricas e medições ---
// O gráfico "Crescimento por número de cubos" mostra, em log-log, o número de operações
// (testes de par + inserções) que cada teorema da "Prova de complexidade" limita, com as
// constantes declaradas abaixo. As constantes vêm das hipóteses e das cenas, nunca de um
// ajuste a tempos medidos. Os pontos são contagens feitas nas mesmas estruturas da
// simulação (broadphase.js). Sem DOM: roda no worker e nos testes.
import {
  plainCube, mulberry32, createBoxScene, intersectAABB,
  SpatialGrid, OctreeSimulator, SweepAndPrune,
} from './broadphase.js';
import { octreeBuildWork, gridQueryWork } from './theorem-checks.js';

const LOG2 = Math.log(2);
const LOG8 = Math.log(8);

// ====================== CONSTANTES DECLARADAS ======================
// Grade: célula c = 2 e cubos de lado s = 1 (c ≥ s_max). Um cubo toca no máximo
// m = (⌈s/c⌉ + 1)³ = 8 células, e a cena tem no máximo K = 8 cubos por célula (H_K).
// Operações ≤ m·n inserções + m·n·(K − 1)/2 testes ≤ m·K·n, então c_g = m·K.
// Octree: K = 4 cubos por folha. Sob H_B, Σ n_v = n(log₈(n/K) + 1) e os testes são
// n(K − 1)/2; a soma fica abaixo de 2·n·log₈ n para n ≥ 64, então c_o = 2.
// Com profundidade fixa D (H_D), a montagem é Σ n_v ≤ n(D + 1) ≤ c_o·n·D.
// Sweep and Prune: k = α·n (hipótese de densidade no eixo X), α = 2. A ordenação faz no
// máximo ~n·log₂ n comparações e a varredura k testes: c_s = 1. Sob H2 a ordenação por
// inserção faz n − 1 + I comparações, com I ≈ 0 na cena (passo de 0,05 por frame).
export const CONSTANTS = {
  cell: 2, side: 1, m: 8, K: 8, cg: 64,
  octreeK: 4, co: 2, D: 6,
  alpha: 2, cs: 1,
};
const C = CONSTANTS;

export const N_MIN = 10;
export const N_MAX = 1e7;

// Curvas teóricas: operações em função de n
export const THEORY = [
  { id: 'brute', mode: 'brute', label: 'n(n−1)/2', f: n => (n * (n - 1)) / 2 },
  { id: 'grid', mode: 'grid', label: `c_g·n`, f: n => C.cg * n },
  { id: 'octree', mode: 'octree', label: 'c_o·n·log₈ n (H_B)', f: n => C.co * n * Math.log(n) / LOG8 },
  { id: 'octreeD', mode: 'octree', light: true, label: `c_o·n·D (H_D, D = ${C.D})`, f: n => C.co * n * C.D },
  { id: 'sap', mode: 'sap', label: 'c_s·(n log₂ n + k)', f: n => C.cs * (n * Math.log(n) / LOG2 + C.alpha * n) },
  { id: 'sapH2', mode: 'sap', light: true, label: 'c_s·(n + k), sob H2', f: n => C.cs * (n + C.alpha * n) },
];

// Cruzamentos entre curvas teóricas em [N_MIN, N_MAX]: troca de sinal de
// log f − log g numa malha em log n, refinada por bisseção.
export function theoryCrossings(curves = THEORY) {
  const out = [];
  const steps = 600;
  const lo = Math.log(N_MIN), hi = Math.log(N_MAX);
  for (let a = 0; a < curves.length; a++) {
    for (let b = a + 1; b < curves.length; b++) {
      const d = x => Math.log(curves[a].f(Math.exp(x))) - Math.log(curves[b].f(Math.exp(x)));
      let x0 = lo, d0 = d(x0);
      for (let s = 1; s <= steps; s++) {
        const x1 = lo + ((hi - lo) * s) / steps;
        const d1 = d(x1);
        if (d0 === 0 || d0 * d1 < 0) {
          let l = x0, r = x1;
          for (let it = 0; it < 60; it++) {
            const mid = (l + r) / 2;
            if (d(l) * d(mid) <= 0) r = mid; else l = mid;
          }
          const n = Math.exp((l + r) / 2);
          out.push({ a: curves[a].id, b: curves[b].id, n, y: curves[a].f(n) });
        }
        x0 = x1; d0 = d1;
      }
    }
  }
  return out.sort((p, q) => p.n - q.n);
}

// ====================== CENAS ======================

// Grade: cubos de lado 1 nos pontos de uma rede de espaçamento 2 (os cantos das
// células). Cada cubo toca 8 células e cada célula tem até 8 cubos: m = K = 8.
export function gridCornerScene(n) {
  const q = Math.ceil(Math.cbrt(n));
  return Array.from({ length: n }, (_, t) =>
    plainCube(t, C.side, 2 * (t % q), 2 * (Math.floor(t / q) % q), 2 * Math.floor(t / (q * q))));
}

// Octree: cubos minúsculos (quase pontos) uniformes na raiz [0, 64]³. Sem cruzar planos,
// a ocupação fica limitada (H_K) e a divisão é aproximadamente balanceada (H_B).
const OCT_L = 64;
export function octreePointScene(n, rand) {
  return Array.from({ length: n }, (_, i) =>
    plainCube(i, 1e-6, rand() * OCT_L, rand() * OCT_L, rand() * OCT_L));
}

// Sweep and Prune: lado 1 a cada 0,4 em X, em ordem embaralhada. Só vizinhos a até 2
// posições se sobrepõem em X: k = 2n − 3 ≤ α·n.
export function sapLineScene(n, rand) {
  const list = Array.from({ length: n }, (_, i) => plainCube(i, 1, 0.4 * i, rand() * 40, rand() * 40));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ====================== CONTAGEM DE OPERAÇÕES ======================
// Operações = inserções (ou comparações da ordenação) + testes de par.

function countBrute(cubes) {
  let tests = 0;
  for (let i = 0; i < cubes.length; i++) {
    for (let j = i + 1; j < cubes.length; j++) { intersectAABB(cubes[i], cubes[j]); tests++; }
  }
  return tests;
}

function countGrid(cubes) {
  const grid = new SpatialGrid(C.cell);
  for (const c of cubes) grid.insert(c);
  let inserts = 0;
  for (const cell of grid.grid.values()) inserts += cell.items.length;
  return inserts + gridQueryWork(grid).q;
}

function countOctree(cubes, maxDepth) {
  const tree = new OctreeSimulator(
    { min: { x: 0, y: 0, z: 0 }, max: { x: OCT_L, y: OCT_L, z: OCT_L } }, maxDepth, C.octreeK);
  for (const c of cubes) tree.insert(c);
  let tests = 0;
  tree.forEachCandidatePair(() => tests++);
  return octreeBuildWork(tree) + tests;
}

// Primeiro frame: ordena do zero (contando as comparações) e varre.
// Frame seguinte, sob H2: cada cubo anda até 0,05 em X e a ordenação por inserção
// custa n − 1 + I comparações.
function countSap(cubes, rand) {
  let comparisons = 0;
  const sorted = cubes.slice().sort((a, b) => { comparisons++; return a.aabb.min.x - b.aabb.min.x; });
  const sap = new SweepAndPrune();
  sap.build(sorted);
  let k = 0;
  sap.forEachCandidatePair(() => k++);
  const first = comparisons + k;
  for (const c of cubes) {
    c.mesh.position.x += (rand() - 0.5) * 0.1;
    c.aabb.min.x = c.mesh.position.x - c.size / 2;
    c.aabb.max.x = c.mesh.position.x + c.size / 2;
  }
  sap.build(sorted);
  let k2 = 0;
  sap.forEachCandidatePair(() => k2++);
  return { first, coherent: cubes.length - 1 + sap.swaps + k2 };
}

export const MEASURE_SIZES = [10, 100, 1000, 10000, 100000];

// Contagens em cenas que respeitam as hipóteses: { brute: [{n, ops}], grid, octree, sap, sapH2 }
export function measureAsymptotic({ onProgress } = {}) {
  const sizes = MEASURE_SIZES;
  const out = { brute: [], grid: [], octree: [], sap: [], sapH2: [] };
  sizes.forEach((n, index) => {
    onProgress?.({ n, index, total: sizes.length });
    const rand = mulberry32(n * 31);
    if (n <= 10000) out.brute.push({ n, ops: countBrute(createBoxScene(n, 40 * Math.cbrt(n / 150), rand)) });
    out.grid.push({ n, ops: countGrid(gridCornerScene(n)) });
    out.octree.push({ n, ops: countOctree(octreePointScene(n, rand), 40) });
    const { first, coherent } = countSap(sapLineScene(n, rand), rand);
    out.sap.push({ n, ops: first });
    out.sapH2.push({ n, ops: coherent });
  });
  return out;
}
