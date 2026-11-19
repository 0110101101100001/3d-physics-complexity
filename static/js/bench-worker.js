// --- bench-worker.js — Benchmark e ajuste da curva fora da thread principal ---
// As medições levam algumas centenas de milissegundos. Na thread principal elas
// travariam a animação; aqui a cena continua rodando enquanto o worker mede.
//
// Mensagem recebida: { cubes: [{ id, size, x, y, z }], cellSize, octreeDepth }
// Mensagens enviadas, em ordem:
//   { type: 'scene', results }            medição da cena atual
//   { type: 'fit-progress', n, index, total }
//   { type: 'fit-done', series, fits }
//
// Ou { type: 'growth', cellSize, octreeDepth }: o experimento de crescimento da aba
// "Prova de complexidade" (pares contados nos dois regimes de densidade). Envia
//   { type: 'growth-progress', regime, n, index, total } e { type: 'growth-done', results }
//
// Ou { type: 'asymptotic' }: as contagens de operações do gráfico assintótico
// (asymptotic.js). Envia { type: 'asymptotic-progress', ... } e { type: 'asymptotic-done', ok }
//
// Ou { type: 'theorems' }: os cenários de cada teorema (theorem-checks.js), com e sem as
// hipóteses. Envia { type: 'theorems-progress', theorem, index, total } e
// { type: 'theorems-done', results }

import {
  MODES, createStructures, plainCube, createSyntheticCubes, mulberry32,
  measureTotal, measurePhases, fitPowerLaw, growthExperiment,
} from './broadphase.js';
import { theoremExperiment } from './theorem-checks.js';
import { measureAsymptotic } from './asymptotic.js';

// Ajuste empírico: mede cada estratégia em cenas sintéticas de vários N e ajusta
// t = a·n^k por mínimos quadrados em escala log-log.
const FIT_SIZES = [10, 15, 22, 33, 50, 75, 110, 150];
const FIT_LAYOUTS = 2;   // cenas diferentes por N, para o acaso de uma cena não pesar
const FIT_MIN_MS = 5;    // tempo mínimo somado por medição
const FIT_REPEATS = 3;   // cada medição é repetida e fica a menor (descarta interferência, ex.: coletor de lixo)

function measureScene(cubes, params) {
  // Mesmos parâmetros e mesmo código de broad-phase da simulação ao vivo;
  // o tempo inclui a construção da estrutura, como em detectCollisions.
  const structures = createStructures(params);
  return MODES.map(key => {
    const time = measureTotal(key, cubes, structures, 15, 20);
    const { buildShare, comparisons, hits } = measurePhases(key, cubes, structures, 30);
    return { key, time, buildShare, buildMs: time * buildShare, queryMs: time * (1 - buildShare), comparisons, hits };
  });
}

function curveFit(params) {
  const structures = createStructures(params);
  const series = Object.fromEntries(MODES.map(key => [key, []]));
  FIT_SIZES.forEach((n, index) => {
    postMessage({ type: 'fit-progress', n, index, total: FIT_SIZES.length, sizes: FIT_SIZES });
    const sums = Object.fromEntries(MODES.map(key => [key, 0]));
    for (let layout = 0; layout < FIT_LAYOUTS; layout++) {
      const cubes = createSyntheticCubes(n, mulberry32(n * 1009 + layout));
      for (const key of MODES) {
        let best = Infinity;
        for (let r = 0; r < FIT_REPEATS; r++) best = Math.min(best, measureTotal(key, cubes, structures, FIT_MIN_MS, 3));
        sums[key] += best;
      }
    }
    for (const key of MODES) series[key].push({ n, t: sums[key] / FIT_LAYOUTS });
  });
  const fits = Object.fromEntries(MODES.map(key => [key, fitPowerLaw(series[key])]));
  return { series, fits, sizes: FIT_SIZES };
}

self.onmessage = ({ data }) => {
  if (data.type === 'asymptotic') {
    const onProgress = p => postMessage({ type: 'asymptotic-progress', ...p });
    postMessage({ type: 'asymptotic-done', ok: measureAsymptotic({ onProgress }) });
    return;
  }
  if (data.type === 'theorems') {
    const results = theoremExperiment({ onProgress: p => postMessage({ type: 'theorems-progress', ...p }) });
    postMessage({ type: 'theorems-done', results });
    return;
  }
  const params = { cellSize: data.cellSize, octreeDepth: data.octreeDepth };
  if (data.type === 'growth') {
    const onProgress = p => postMessage({ type: 'growth-progress', ...p });
    const results = ['constante', 'fixa'].map(regime => growthExperiment({ regime, ...params, onProgress }));
    postMessage({ type: 'growth-done', results });
    return;
  }
  const cubes = data.cubes.map(c => plainCube(c.id, c.size, c.x, c.y, c.z));
  postMessage({ type: 'scene', results: measureScene(cubes, params), n: cubes.length });
  postMessage({ type: 'fit-done', ...curveFit(params) });
};
