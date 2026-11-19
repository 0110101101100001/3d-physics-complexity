// Testes das estratégias de broad-phase. Rodar com `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES, createStructures, runBroadPhase, buildBroadPhase, queryBroadPhase,
  intersectAABB, pairKey, updateAABB, plainCube, createSyntheticCubes, mulberry32,
  SpatialGrid, OctreeSimulator, SweepAndPrune, fitPowerLaw, growthExperiment,
} from '../static/js/broadphase.js';

// Pares candidatos e pares em colisão de uma estratégia, como chaves ordenadas
function collect(mode, cubes, structures) {
  const candidates = [];
  const hits = [];
  runBroadPhase(mode, cubes, (a, b) => {
    candidates.push(pairKey(a, b));
    if (intersectAABB(a, b)) hits.push(pairKey(a, b));
  }, structures);
  return { candidates, hits: hits.sort((x, y) => x - y) };
}

const SCENES = [
  { n: 2, seed: 1 }, { n: 8, seed: 2 }, { n: 40, seed: 3 },
  { n: 80, seed: 4 }, { n: 150, seed: 5 }, { n: 150, seed: 6 },
];

for (const mode of MODES.filter(m => m !== 'brute')) {
  test(`${mode}: acha as mesmas colisões que a força bruta`, () => {
    for (const { n, seed } of SCENES) {
      const cubes = createSyntheticCubes(n, mulberry32(seed));
      for (const cellSize of [1, 2, 5]) {
        for (const octreeDepth of [1, 4, 8]) {
          const structures = createStructures({ cellSize, octreeDepth });
          const expected = collect('brute', cubes, structures).hits;
          const got = collect(mode, cubes, structures).hits;
          assert.deepEqual(got, expected, `n=${n} seed=${seed} célula=${cellSize} prof=${octreeDepth}`);
        }
      }
    }
  });

  test(`${mode}: não repete pares candidatos`, () => {
    for (const { n, seed } of SCENES) {
      const cubes = createSyntheticCubes(n, mulberry32(seed));
      const { candidates } = collect(mode, cubes, createStructures());
      assert.equal(new Set(candidates).size, candidates.length, `n=${n} seed=${seed}`);
      for (const k of candidates) assert.notEqual(Math.floor(k / 1e6), k % 1e6, 'par de um cubo com ele mesmo');
    }
  });

  test(`${mode}: testa no máximo N(N-1)/2 pares`, () => {
    const cubes = createSyntheticCubes(150, mulberry32(7));
    const { candidates } = collect(mode, cubes, createStructures());
    assert.ok(candidates.length <= (150 * 149) / 2);
  });
}

test('força bruta testa exatamente N(N-1)/2 pares', () => {
  const cubes = createSyntheticCubes(30, mulberry32(9));
  assert.equal(collect('brute', cubes, createStructures()).candidates.length, (30 * 29) / 2);
});

test('estruturas reaproveitadas entre frames continuam corretas', () => {
  // Simula vários frames: os cubos andam e as mesmas estruturas são remontadas.
  const rand = mulberry32(11);
  const cubes = createSyntheticCubes(120, rand);
  const vel = cubes.map(() => ({ x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5 }));
  const structures = createStructures({ cellSize: 3, octreeDepth: 6 });
  for (let frame = 0; frame < 60; frame++) {
    cubes.forEach((c, i) => {
      const p = c.mesh.position;
      p.x += vel[i].x; p.y += vel[i].y; p.z += vel[i].z;
      updateAABB(c);
    });
    // a cada 10 frames um cubo sai da detecção (como um cubo arrastado)
    const active = frame % 10 === 5 ? cubes.slice(1) : cubes;
    const expected = collect('brute', active, structures).hits;
    for (const mode of ['grid', 'octree', 'sap']) {
      assert.deepEqual(collect(mode, active, structures).hits, expected, `${mode}, frame ${frame}`);
    }
  }
});

test('grade: cubo que cruza várias células entra em todas', () => {
  const grid = new SpatialGrid(2);
  grid.insert(plainCube(0, 3, 0, 0, 0)); // de -1.5 a 1.5: células -1 e 0 em cada eixo
  assert.equal(grid.grid.size, 8);
});

test('grade: par que partilha várias células é reportado uma vez', () => {
  const grid = new SpatialGrid(1);
  const a = plainCube(0, 4, 0, 0, 0);
  const b = plainCube(1, 4, 0.5, 0.5, 0.5);
  grid.insert(a); grid.insert(b);
  let count = 0;
  grid.forEachCandidatePair(() => count++);
  assert.equal(count, 1);
});

test('octree: objeto que atravessa o centro fica na raiz', () => {
  const tree = new OctreeSimulator(60, 6, 1);
  const straddler = plainCube(0, 4, 0, 0, 0);
  tree.insert(plainCube(1, 2, 10, 10, 10));
  tree.insert(plainCube(2, 2, -10, -10, -10));
  tree.insert(straddler);
  assert.ok(tree.root.children, 'raiz subdividida');
  assert.ok(tree.root.objects.includes(straddler));
});

test('octree: raiz apoiada no chão, sem cubos da arena na metade de cima', () => {
  const tree = new OctreeSimulator(undefined, 6, 1);
  buildBroadPhase('octree', createSyntheticCubes(60, mulberry32(29)), { octree: tree });
  const { min, max } = tree.root.bounds;
  assert.deepEqual([min.x, min.y, min.z, max.x, max.y, max.z], [-20, 0, -20, 20, 40, 20]);
  // o corte em y = 20 é o teto da arena: nenhum cubo fica na raiz por cruzá-lo
  for (const o of tree.root.objects) assert.ok(o.aabb.min.x < 0 && o.aabb.max.x > 0 || o.aabb.min.z < 0 && o.aabb.max.z > 0);
  for (const i of [2, 3, 6, 7]) assert.equal(tree.root.children[i].objects.length, 0);
});

test('octree: objeto fora da raiz fica na raiz', () => {
  const tree = new OctreeSimulator(undefined, 6, 1);
  const outside = plainCube(0, 2, 30, 5, 0);
  tree.insert(plainCube(1, 2, 10, 5, 10));
  tree.insert(plainCube(2, 2, -10, 5, -10));
  tree.insert(outside);
  assert.ok(tree.root.objects.includes(outside));
});

test('octree: respeita a profundidade máxima', () => {
  const tree = new OctreeSimulator(60, 2, 1);
  const cubes = createSyntheticCubes(100, mulberry32(13));
  buildBroadPhase('octree', cubes, { octree: tree });
  let deepest = 0;
  tree.forEachNode(node => { deepest = Math.max(deepest, node.depth); });
  assert.ok(deepest <= 2);
});

test('sweep and prune: lista fica ordenada pelo início em X', () => {
  const sap = new SweepAndPrune();
  const cubes = createSyntheticCubes(80, mulberry32(17));
  sap.build(cubes);
  for (let i = 1; i < sap.list.length; i++) {
    assert.ok(sap.list[i - 1].aabb.min.x <= sap.list[i].aabb.min.x);
  }
});

test('sweep and prune: sem movimento, a reordenação não troca nada', () => {
  const sap = new SweepAndPrune();
  const cubes = createSyntheticCubes(80, mulberry32(19));
  sap.build(cubes);
  sap.build(cubes);
  assert.equal(sap.swaps, 0);
});

test('sweep and prune: só visita pares que se sobrepõem em X', () => {
  const sap = new SweepAndPrune();
  const cubes = createSyntheticCubes(100, mulberry32(23));
  sap.build(cubes);
  queryBroadPhase('sap', cubes, (a, b) => {
    assert.ok(a.aabb.min.x < b.aabb.max.x && b.aabb.min.x < a.aabb.max.x);
  }, { sap });
});

test('fitPowerLaw recupera o expoente de t = a·n^k', () => {
  const pts = [10, 20, 40, 80, 160].map(n => ({ n, t: 0.003 * n ** 2 }));
  const fit = fitPowerLaw(pts);
  assert.ok(Math.abs(fit.k - 2) < 1e-9);
  assert.ok(Math.abs(fit.a - 0.003) < 1e-9);
  assert.ok(fit.r2 > 0.999999);
  assert.equal(fitPowerLaw(pts.slice(0, 2)), null);
});

// O experimento da aba "Prova de complexidade": expoentes dos pares candidatos
test('crescimento com densidade constante: grade ~n, Octree e SAP entre n e n²', () => {
  const { fits } = growthExperiment({ regime: 'constante', sizes: [100, 200, 400, 800], seeds: 2 });
  assert.ok(Math.abs(fits.brute.k - 2) < 0.01, `força bruta ${fits.brute.k}`);
  assert.ok(fits.grid.k > 0.85 && fits.grid.k < 1.15, `grade ${fits.grid.k}`);
  assert.ok(fits.octree.k > 1.2 && fits.octree.k < 1.8, `octree ${fits.octree.k}`);
  assert.ok(fits.sap.k > 1.45 && fits.sap.k < 1.85, `sap ${fits.sap.k}`);
});

test('crescimento na arena fixa: todas ~n²', () => {
  const { fits } = growthExperiment({ regime: 'fixa', sizes: [100, 200, 400, 800], seeds: 2 });
  for (const m of ['grid', 'octree', 'sap']) assert.ok(Math.abs(fits[m].k - 2) < 0.15, `${m} ${fits[m].k}`);
});
