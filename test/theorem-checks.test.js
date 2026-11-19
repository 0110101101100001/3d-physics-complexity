// Testes dos cenários da aba Verificação da "Prova de complexidade" (theorem-checks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEOREM_CHECKS, theoremExperiment, OCTREE_K, octreeFor, octreeBuildWork, octreeHeight,
  gridQueryWork, gridLatticeScene, octreeLatticeScene, octreePathScene, octreePathWork,
  sapSpreadScene, sapColumnScene, sapPairs, stackedScene,
} from '../static/js/theorem-checks.js';
import {
  SpatialGrid, SweepAndPrune, intersectAABB, pairKey, runBroadPhase, createStructures, mulberry32,
} from '../static/js/broadphase.js';

test('cada cenário dá a contagem da fórmula (exata) ou fica abaixo do limite', () => {
  for (const check of theoremExperiment()) {
    for (const s of check.scenarios) {
      for (const p of s.points) {
        const where = `${check.theorem}, ${s.label}, n=${p.n}`;
        if (s.bound) assert.ok(p.measured <= p.theory, `${where}: ${p.measured} > ${p.theory}`);
        else assert.ok(Math.abs(p.measured - p.theory) < 1e-9 * Math.max(1, p.theory), `${where}: ${p.measured} ≠ ${p.theory}`);
      }
    }
  }
});

test('todo teorema tem um cenário que respeita e um que viola as hipóteses', () => {
  for (const check of THEOREM_CHECKS) {
    assert.deepEqual(check.scenarios.map(s => s.kind), ['ok', 'bad'], check.theorem);
  }
});

test('os contraexemplos crescem como n² e os cenários válidos não', () => {
  // expoente entre os dois maiores n
  const slope = pts => {
    const [a, b] = pts.slice(-2);
    return Math.log(b.measured / a.measured) / Math.log(b.n / a.n);
  };
  for (const check of theoremExperiment()) {
    const [ok, bad] = check.scenarios;
    assert.ok(Math.abs(slope(bad.points) - 2) < 0.05, `${check.theorem} viola: ${slope(bad.points)}`);
    if (check.id !== 't1') assert.ok(slope(ok.points) < 1.4, `${check.theorem} respeita: ${slope(ok.points)}`);
  }
});

test('grade: a rede respeita H_K com K = 4 em toda célula; empilhados, uma célula com n', () => {
  for (const n of [100, 800]) {
    const grid = new SpatialGrid(2);
    for (const c of gridLatticeScene(n)) grid.insert(c);
    assert.equal(gridQueryWork(grid).kmax, 4);
    for (const cell of grid.grid.values()) assert.equal(cell.items.length, 4);
  }
  const grid = new SpatialGrid(2);
  for (const c of stackedScene(50)) grid.insert(c);
  assert.equal(grid.grid.size, 1);
  assert.equal(gridQueryWork(grid).kmax, 50);
});

test('octree: rede balanceada tem altura log₈(n/K) + 1 e folhas com K cubos', () => {
  for (const j of [1, 2, 3]) {
    const tree = octreeFor(64, 12);
    for (const c of octreeLatticeScene(j)) tree.insert(c);
    assert.equal(octreeHeight(tree), j + 1);
    tree.forEachNode(v => {
      if (v.children) assert.equal(v.objects.length, 0, 'nó interno vazio');
      else assert.ok(v.objects.length === 0 || v.objects.length === OCTREE_K);
    });
  }
});

test('octree: o caminho tem altura n − K + 1 sem H_D e D + 1 com H_D', () => {
  const n = 60;
  const free = octreeFor(64, 1e9);
  for (const c of octreePathScene(n)) free.insert(c);
  assert.equal(octreeHeight(free), n - OCTREE_K + 1);
  const capped = octreeFor(64, 6);
  for (const c of octreePathScene(n)) capped.insert(c);
  assert.equal(octreeHeight(capped), 7);
  assert.equal(octreeBuildWork(capped), octreePathWork(n, 6));
  assert.ok(octreeBuildWork(capped) <= n * 7);
});

test('sweep and prune: mesmo x dá k = n(n−1)/2 sem colisões', () => {
  const sap = new SweepAndPrune();
  sap.build(sapColumnScene(40));
  assert.deepEqual(sapPairs(sap), { k: 780, hits: 0 });
});

test('as estratégias acham as colisões da força bruta nas cenas dos teoremas', () => {
  const scenes = [
    gridLatticeScene(200), octreeLatticeScene(2, 40), octreePathScene(40, 40),
    sapSpreadScene(200, mulberry32(3)), sapColumnScene(50), stackedScene(30),
  ];
  for (const cubes of scenes) {
    const structures = createStructures();
    const hits = mode => {
      const list = [];
      runBroadPhase(mode, cubes, (a, b) => { if (intersectAABB(a, b)) list.push(pairKey(a, b)); }, structures);
      return list.sort((x, y) => x - y);
    };
    const expected = hits('brute');
    for (const mode of ['grid', 'octree', 'sap']) assert.deepEqual(hits(mode), expected, mode);
  }
});
