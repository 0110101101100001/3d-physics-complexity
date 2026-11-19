// Testes do gráfico assintótico (asymptotic.js): curvas, cruzamentos e medições.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTANTS, THEORY, theoryCrossings, measureAsymptotic, gridCornerScene,
} from '../static/js/asymptotic.js';
import { SpatialGrid } from '../static/js/broadphase.js';
import { gridQueryWork } from '../static/js/theorem-checks.js';

const theory = Object.fromEntries(THEORY.map(t => [t.id, t.f]));
const ok = measureAsymptotic();
const bad = measureAsymptotic({ violate: true });

test('c_g = m·K e a cena da grade respeita m = 8 e K = 8', () => {
  assert.equal(CONSTANTS.cg, CONSTANTS.m * CONSTANTS.K);
  const grid = new SpatialGrid(CONSTANTS.cell);
  for (const c of gridCornerScene(1000)) grid.insert(c);
  assert.ok(gridQueryWork(grid).kmax <= CONSTANTS.K);
  for (const cell of grid.grid.values()) assert.ok(cell.items.length <= CONSTANTS.K);
});

test('cruzamentos: as duas curvas têm o mesmo valor no n do cruzamento', () => {
  const crossings = theoryCrossings();
  assert.ok(crossings.length > 0);
  for (const c of crossings) {
    assert.ok(c.n >= 10 && c.n <= 1e7);
    const ratio = theory[c.a](c.n) / theory[c.b](c.n);
    assert.ok(Math.abs(ratio - 1) < 1e-6, `${c.a} × ${c.b}`);
  }
  const bruteGrid = crossings.find(c => c.a === 'brute' && c.b === 'grid');
  assert.ok(Math.abs(bruteGrid.n - 129) < 1e-6);   // n(n−1)/2 = 64n ⇔ n = 129
});

test('com as hipóteses, as medições ficam abaixo da curva do teorema', () => {
  for (const p of ok.brute) assert.equal(p.ops, theory.brute(p.n));
  for (const key of ['grid', 'sap', 'sapH2']) {
    for (const p of ok[key]) assert.ok(p.ops <= theory[key](p.n), `${key} n=${p.n}`);
  }
  // c_o = 2 só vale a partir de n = 64
  for (const p of ok.octree.filter(q => q.n >= 64)) assert.ok(p.ops <= theory.octree(p.n), `octree n=${p.n}`);
});

test('violando as hipóteses, as medições sobem para n(n−1)/2', () => {
  for (const key of ['brute', 'grid', 'octree', 'sap']) {
    for (const p of bad[key].filter(q => q.n >= 100)) {
      const r = p.ops / theory.brute(p.n);
      assert.ok(r >= 1 && r < 1.2, `${key} n=${p.n}: ${r}`);
    }
  }
});
