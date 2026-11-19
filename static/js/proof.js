// --- proof.js — Janela "Prova de complexidade" ---
// O texto das provas está em simulador.html, com fórmulas em TeX. O KaTeX só é baixado
// na primeira vez que a janela abre. A aba Verificação roda as estratégias sobre a cena
// atual, dispara o experimento de crescimento no worker e mostra o último benchmark.
import { state, playSound } from './physics.js';
import { MODES, createStructures, countPairs, ARENA_HALF_XZ } from './broadphase.js';
import { STRATEGY } from './strategies.js';
import { getLastFit } from './benchmark.js';

const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';

const modal = document.getElementById('proofModal');
const body = modal.querySelector('.proof-body');
const tabs = [...modal.querySelectorAll('[role="tab"]')];
const fmt = n => Math.round(n).toLocaleString('pt-BR');
const fmtK = k => k.toFixed(2).replace('.', ',');

// ====================== ABRIR, FECHAR, ABAS ======================
function openProof() {
  modal.classList.remove('hidden');
  loadMath();
  refreshBench();
  playSound();
  tabs.find(t => t.getAttribute('aria-selected') === 'true')?.focus();
}

document.getElementById('proofBtn').addEventListener('click', openProof);
document.getElementById('closeProofBtn').addEventListener('click', () => { modal.classList.add('hidden'); playSound(); });

function selectTab(tab, focus = true) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  body.scrollTop = 0;
  if (focus) tab.focus();
  if (tab.id === 'proofTab-verificacao') refreshBench();
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', e => {
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    selectTab(tabs[(to + tabs.length) % tabs.length]);
  });
});

// ====================== KATEX ======================
let mathPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    el.onload = resolve;
    el.onerror = reject;
    document.head.appendChild(el);
  });
}

function loadMath() {
  mathPromise ??= (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = KATEX + 'katex.min.css';
    document.head.appendChild(css);
    await loadScript(KATEX + 'katex.min.js');
    await loadScript(KATEX + 'contrib/auto-render.min.js');
    window.renderMathInElement(modal, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
    modal.classList.add('math-ready');
  })().catch(err => {
    // sem rede: o TeX fica legível como texto
    console.warn('KaTeX não carregou; as fórmulas aparecem em TeX.', err);
  });
  return mathPromise;
}

// ====================== 1. CENA ATUAL ======================
const sceneTable = document.getElementById('proofSceneTable');
const sceneFacts = document.getElementById('proofSceneFacts');
const sceneStatus = document.getElementById('proofSceneStatus');

function row(cells, mode) {
  const tr = document.createElement('tr');
  if (mode) tr.dataset.mode = mode;
  cells.forEach((c, i) => {
    const td = document.createElement('td');
    if (i === 0 && mode) {
      const key = document.createElement('span');
      key.className = 'proof-key';
      key.textContent = c;
      td.appendChild(key);
    } else {
      td.textContent = c;
    }
    tr.appendChild(td);
  });
  return tr;
}

function fact(text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

document.getElementById('proofSceneBtn').addEventListener('click', () => {
  const cubes = state.cubes.filter(c => !c.dragging);
  const n = cubes.length;
  if (n < 2) { sceneStatus.textContent = 'a cena precisa de ao menos 2 cubos'; return; }

  const structures = createStructures({ cellSize: state.cellSize, octreeDepth: state.octreeDepth });
  const results = Object.fromEntries(MODES.map(m => [m, countPairs(m, cubes, structures)]));
  const pairsAll = (n * (n - 1)) / 2;
  const hitsRef = results.brute.hits;

  const tbody = sceneTable.tBodies[0];
  tbody.replaceChildren(...MODES.map(m => {
    const r = results[m];
    let check;
    if (m === 'brute') check = r.candidates === pairsAll ? `= n(n−1)/2 = ${fmt(pairsAll)} ✓` : `≠ n(n−1)/2 ✗`;
    else check = r.hits === hitsRef ? `mesmas colisões ✓ · ${(100 * r.candidates / pairsAll).toFixed(1).replace('.', ',')}% dos pares` : 'colisões diferentes ✗';
    return row([STRATEGY[m].short, fmt(r.candidates), fmt(r.hits), check], m);
  }));
  sceneTable.hidden = false;

  // Fatos das provas, com os números desta cena
  const sMean = cubes.reduce((acc, c) => acc + c.size, 0) / n;
  const L = 2 * ARENA_HALF_XZ;
  const S = structures.octree.root.objects.length;
  const predS = (2 * n * sMean) / L;
  const predK = pairsAll * (2 * sMean) / L;
  sceneFacts.replaceChildren(
    fact(`n = ${n}, lado médio dos cubos s̄ = ${sMean.toFixed(2).replace('.', ',')}, célula ${state.cellSize}, profundidade ${state.octreeDepth}.`),
    fact(`Octree: ${S} cubos ficaram na raiz por cruzarem os planos centrais (previsto 2n·s̄/L ≈ ${predS.toFixed(0)}). Só entre eles são ${fmt(S * (S - 1) / 2)} pares, a parcela que dá o Ω(n^(4/3)).`),
    fact(`Sweep and Prune: k = ${fmt(results.sap.candidates)} pares se sobrepõem em X (previsto C(n,2)·2s̄/L ≈ ${fmt(predK)}).`),
    fact(`Grade: ${fmt(results.grid.candidates)} pares candidatos, ${(100 * results.grid.candidates / pairsAll).toFixed(1).replace('.', ',')}% dos da força bruta.`),
  );
  sceneStatus.textContent = 'medido agora';
});

// ====================== 2. EXPERIMENTO DE CRESCIMENTO ======================
const growthTable = document.getElementById('proofGrowthTable');
const growthStatus = document.getElementById('proofGrowthStatus');
const growthBtn = document.getElementById('proofGrowthBtn');
const PREDICTED = {
  brute: ['2', '2'],
  grid: ['1', '2'],
  octree: ['≥ 4/3', '2'],
  sap: ['5/3 ≈ 1,67', '2'],
};
let growthWorker = null;

growthBtn.addEventListener('click', () => {
  growthWorker?.terminate();
  growthWorker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
  growthBtn.disabled = true;
  growthStatus.textContent = 'começando';
  growthWorker.onmessage = ({ data }) => {
    if (data.type === 'growth-progress') {
      const regime = data.regime === 'constante' ? 'densidade constante' : 'arena fixa';
      growthStatus.textContent = `${regime}: n = ${data.n} (${data.index + 1} de ${data.total})`;
    } else if (data.type === 'growth-done') {
      const [constant, fixed] = data.results;
      growthTable.tBodies[0].replaceChildren(...MODES.map(m => row([
        STRATEGY[m].short,
        fmtK(constant.fits[m].k), PREDICTED[m][0],
        fmtK(fixed.fits[m].k), PREDICTED[m][1],
      ], m)));
      growthTable.hidden = false;
      growthStatus.textContent = `n de ${constant.sizes[0]} a ${constant.sizes[constant.sizes.length - 1]} · célula ${state.cellSize} · profundidade ${state.octreeDepth}`;
      growthBtn.disabled = false;
      growthWorker.terminate();
      growthWorker = null;
    }
  };
  growthWorker.onerror = e => {
    growthStatus.textContent = 'o experimento falhou; veja o console';
    console.error(e.message);
    growthBtn.disabled = false;
  };
  growthWorker.postMessage({ type: 'growth', cellSize: state.cellSize, octreeDepth: state.octreeDepth });
});

// ====================== 3. BENCHMARK ======================
const benchTable = document.getElementById('proofBenchTable');
const benchText = document.getElementById('proofBenchText');

function refreshBench() {
  const fit = getLastFit();
  if (!fit) return;
  benchTable.tBodies[0].replaceChildren(...MODES.map(m => {
    const f = fit.fits[m];
    return row([STRATEGY[m].short, f ? fmtK(f.k) : '—', f ? f.r2.toFixed(3).replace('.', ',') : '—'], m);
  }));
  benchTable.hidden = false;
  benchText.textContent = `Último benchmark: tempo de n = ${fit.sizes[0]} a ${fit.sizes[fit.sizes.length - 1]} na arena fixa ` +
    `(célula ${fit.cellSize}, profundidade ${fit.octreeDepth}), ajustado a t = a·n^k. Na arena fixa os pares de todas as ` +
    'estratégias são Θ(n²); expoentes menores que 2 vêm dos termos lineares (montagem, laço) que ainda pesam com n ≤ 150.';
}
