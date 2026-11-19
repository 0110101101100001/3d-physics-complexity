// --- proof.js — Janela "Prova de complexidade" ---
// O texto das provas está em simulador.html, com fórmulas em TeX. O KaTeX só é baixado
// na primeira vez que a janela abre. A aba Verificação roda no worker os cenários de cada
// teorema (com e sem as hipóteses, theorem-checks.js), mede a cena atual e mostra o
// último benchmark.
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

// ====================== 1. TEOREMAS: COM E SEM AS HIPÓTESES ======================
const theoremsBox = document.getElementById('proofTheorems');
const theoremsStatus = document.getElementById('proofTheoremsStatus');
const theoremsBtn = document.getElementById('proofTheoremsBtn');
const SVG_NS = 'http://www.w3.org/2000/svg';
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const pow10 = e => '10' + String(e).split('').map(ch => SUP[ch]).join('');
const fmtRatio = r => r.toFixed(r >= 0.995 && r <= 1.005 ? 2 : 3).replace('.', ',');

function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// Gráfico log-log: pontos medidos e a curva da prova (tracejada) de cada cenário
function theoremChart(check) {
  const W = 560, H = 230, ml = 46, mr = 14, mt = 12, mb = 30;
  const pts = check.scenarios.flatMap(s => s.points.flatMap(p => [
    { n: p.n, y: p.measured }, { n: p.n, y: p.theory },
  ])).filter(p => p.y > 0);
  const lx = pts.map(p => Math.log10(p.n)), ly = pts.map(p => Math.log10(p.y));
  const x0 = Math.floor(Math.min(...lx) * 2) / 2, x1 = Math.ceil(Math.max(...lx) * 2) / 2;
  const y0 = Math.floor(Math.min(...ly)), y1 = Math.ceil(Math.max(...ly));
  const X = n => ml + ((Math.log10(n) - x0) / (x1 - x0)) * (W - ml - mr);
  const Y = v => mt + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - mt - mb);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'proof-chart', role: 'img',
    'aria-label': `${check.theorem}: ${check.metric}, medido contra a curva da prova, em escala log-log`,
  });
  for (let e = y0; e <= y1; e++) {
    svg.append(svgEl('line', { x1: ml, x2: W - mr, y1: Y(10 ** e), y2: Y(10 ** e), class: 'proof-chart__grid' }));
    svg.append(svgEl('text', { x: ml - 8, y: Y(10 ** e) + 4, 'text-anchor': 'end', class: 'proof-chart__tick' }, pow10(e)));
  }
  for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
    svg.append(svgEl('line', { x1: X(10 ** e), x2: X(10 ** e), y1: mt, y2: H - mb, class: 'proof-chart__grid' }));
    svg.append(svgEl('text', { x: X(10 ** e), y: H - mb + 18, 'text-anchor': 'middle', class: 'proof-chart__tick' }, pow10(e)));
  }
  svg.append(svgEl('text', { x: W - mr, y: H - 4, 'text-anchor': 'end', class: 'proof-chart__tick' }, 'n'));
  for (const s of check.scenarios) {
    const cls = `proof-chart__${s.kind}`;
    const line = s.points.filter(p => p.theory > 0)
      .map(p => `${X(p.n).toFixed(1)},${Y(p.theory).toFixed(1)}`).join(' ');
    svg.append(svgEl('polyline', { points: line, class: `${cls} proof-chart__theory` }));
    for (const p of s.points) {
      if (p.measured <= 0) continue;
      svg.append(svgEl('circle', { cx: X(p.n), cy: Y(p.measured), r: 4, class: `${cls} proof-chart__dot` }));
    }
  }
  return svg;
}

// Resumo de um cenário: a contagem bate com a fórmula (exata) ou fica abaixo do limite
function verdict(s) {
  const ratios = s.points.map(p => p.measured / p.theory);
  const lo = Math.min(...ratios), hi = Math.max(...ratios);
  if (!s.bound) {
    const exact = s.points.every(p => Math.abs(p.measured - p.theory) <= 1e-9 * Math.max(1, p.theory));
    return exact ? 'Medido = fórmula em todos os n ✓' : `Medido/fórmula de ${fmtRatio(lo)} a ${fmtRatio(hi)} ✗`;
  }
  const ok = s.points.every(p => p.measured <= p.theory);
  return `${ok ? 'Medido ≤ limite' : 'Acima do limite'} em todos os n, razão de ${fmtRatio(lo)} a ${fmtRatio(hi)} ${ok ? '✓' : '✗'}`;
}

function theoremBlock(check) {
  const block = document.createElement('article');
  block.className = 'proof-check';
  block.dataset.mode = check.mode;

  const title = document.createElement('p');
  title.className = 'proof-check__title';
  const key = document.createElement('span');
  key.className = 'proof-key';
  key.textContent = check.theorem;
  title.append(key, ` · ${check.metric}`);

  const legend = document.createElement('ul');
  legend.className = 'proof-check__legend';
  for (const s of check.scenarios) {
    const li = document.createElement('li');
    li.className = `proof-check__${s.kind}`;
    const head = document.createElement('strong');
    head.textContent = s.kind === 'ok' ? 'Respeita: ' : 'Viola: ';
    li.append(head, `${s.label}. Curva ${s.bound ? '(limite)' : '(exata)'}: ${s.theoryLabel}. ${verdict(s)}`);
    legend.appendChild(li);
  }

  const details = document.createElement('details');
  details.className = 'proof-check__numbers';
  const summary = document.createElement('summary');
  summary.textContent = 'ver os números';
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table proof-table';
  const head = table.createTHead().insertRow();
  for (const h of ['Cenário', 'n', 'medido', 'curva', 'medido/curva']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const s of check.scenarios) {
    for (const p of s.points) {
      tbody.appendChild(row([
        s.kind === 'ok' ? 'respeita' : 'viola', fmt(p.n), fmt(p.measured), fmt(p.theory), fmtRatio(p.measured / p.theory),
      ]));
    }
  }
  wrap.appendChild(table);
  details.append(summary, wrap);

  block.append(title, theoremChart(check), legend, details);
  return block;
}

let theoremsWorker = null;

theoremsBtn.addEventListener('click', () => {
  theoremsWorker?.terminate();
  theoremsWorker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
  theoremsBtn.disabled = true;
  theoremsStatus.textContent = 'começando';
  theoremsWorker.onmessage = ({ data }) => {
    if (data.type === 'theorems-progress') {
      theoremsStatus.textContent = `${data.theorem} (${data.index + 1} de ${data.total})`;
    } else if (data.type === 'theorems-done') {
      theoremsBox.replaceChildren(...data.results.map(theoremBlock));
      theoremsStatus.textContent = 'medido agora, nas estruturas da simulação';
      theoremsBtn.disabled = false;
      theoremsWorker.terminate();
      theoremsWorker = null;
    }
  };
  theoremsWorker.onerror = e => {
    theoremsStatus.textContent = 'os cenários falharam; veja o console';
    console.error(e.message);
    theoremsBtn.disabled = false;
  };
  theoremsWorker.postMessage({ type: 'theorems' });
});

// ====================== 2. CENA ATUAL ======================
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
    fact(`Octree: ${S} cubos ficaram na raiz por cruzarem os planos centrais (previsto 2n·s̄/L ≈ ${predS.toFixed(0)}). Só entre eles são ${fmt(S * (S - 1) / 2)} pares.`),
    fact(`Sweep and Prune: k = ${fmt(results.sap.candidates)} pares se sobrepõem em X (previsto C(n,2)·2s̄/L ≈ ${fmt(predK)}).`),
    fact(`Grade: ${fmt(results.grid.candidates)} pares candidatos, ${(100 * results.grid.candidates / pairsAll).toFixed(1).replace('.', ',')}% dos da força bruta.`),
  );
  sceneStatus.textContent = 'medido agora';
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
