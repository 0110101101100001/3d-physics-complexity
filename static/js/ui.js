// --- ui.js (parte 1) — Variáveis de UI, desempenho e gráfico assintótico ---
// Three.js é carregado globalmente via CDN (window.THREE) pelo index.html.

const THREE = window.THREE;
import {
  handleResize, camera, controls, scene, renderer, clock,
  lightTimer, impactLight, dropLineMesh, hoverBoxHelper,
  impactParticles, DRAG_COLOR, setPairLineColor,
  setViewColumns, renderColumns, renderView,
  floorGrid, setBloomEnabled, triggerGlitch, updateSceneEffects,
  setXray, updatePairTrail, setTrailEnabled, isTrailEnabled,
} from './three-setup.js';
import {
  state, LIMITS, clampNumber, ARENA_HALF_XZ, ARENA_HEIGHT,
  initCubes, detectCollisions, updatePhysics, toggleWireframe,
  playSound, unlockAudio, clearDebugGizmos, updateContextPanel,
  intersectAABB, runBroadPhase, buildBroadPhase, queryBroadPhase,
  SpatialGrid, OctreeSimulator, createSyntheticCubes,
  RACE_MODES, frameStats, prepareRaceView, finishRaceViews,
  switchStrategy, updateDebris, glowHooks,
} from './physics.js';

// ====================== ELEMENTOS DA UI ======================
const cubeCountInput = document.getElementById('cubeCount');
const cubeCountNumber = document.getElementById('cubeCountInput');
const speedSlider = document.getElementById('speed');
const cellSizeSlider = document.getElementById('cellSize');
const cellSizeNumber = document.getElementById('cellSizeInput');
const octreeDepthSlider = document.getElementById('octreeDepth');
const octreeDepthNumber = document.getElementById('octreeDepthInput');
const collisionBadge = document.getElementById('collisionBadge');
const minimizeBtn = document.getElementById('minimizeBtn');
const toggleChartBtn = document.getElementById('toggleChartBtn');
const controlPanel = document.getElementById('controlPanel');
const chartPanel = document.getElementById('chartPanel');
const theoryModal = document.getElementById('theoryModal');
const stressBtn = document.getElementById('stressBtn');
const soundBtn = document.getElementById('soundBtn');
const wireframeBtn = document.getElementById('wireframeBtn');
const captureBtn = document.getElementById('captureBtn');
const chartCanvas = document.getElementById('perfChart');
const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;

const statN = document.getElementById('statN');
const statAlgo = document.getElementById('statAlgo');
const statComp = document.getElementById('statComp');
const statTime = document.getElementById('statTime');

// ====================== DESEMPENHO ======================
// Janela deslizante de amostras por N, com média aparada (15% em cada ponta).
// A média fica em cache e só é recalculada quando chega uma amostra nova.
const PERF_WINDOW = 60;
const PERF_TRIM = 0.15;

function trimmedMean(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = sorted.length > 5 ? Math.floor(sorted.length * PERF_TRIM) : 0;
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

class PerfStore {
  constructor() { this.samples = new Map(); this.cache = new Map(); }
  record(n, timeMs) {
    let arr = this.samples.get(n);
    if (!arr) { arr = []; this.samples.set(n, arr); }
    arr.push(timeMs);
    if (arr.length > PERF_WINDOW) arr.shift();
    this.cache.delete(n);
  }
  average(n) {
    const arr = this.samples.get(n);
    if (!arr || arr.length === 0) return 0;
    let avg = this.cache.get(n);
    if (avg === undefined) { avg = trimmedMean(arr); this.cache.set(n, avg); }
    return avg;
  }
}

const perf = { brute: new PerfStore(), grid: new PerfStore(), octree: new PerfStore() };

// Custo por fase: média móvel do tempo de montar a estrutura e do tempo de consultar
// os pares, por estratégia. A janela é longa porque cada fase dura microssegundos e
// o relógio do navegador é grosso; só a média de muitos frames é confiável.
const PHASE_WINDOW = 180;

class PhaseStore {
  constructor() {
    this.build = new Float64Array(PHASE_WINDOW);
    this.query = new Float64Array(PHASE_WINDOW);
    this.reset();
  }
  reset() {
    this.build.fill(0);
    this.query.fill(0);
    this.index = 0;
    this.count = 0;
    this.sumBuild = 0;
    this.sumQuery = 0;
  }
  record(buildMs, queryMs) {
    const i = this.index;
    this.sumBuild += buildMs - this.build[i];
    this.sumQuery += queryMs - this.query[i];
    this.build[i] = buildMs;
    this.query[i] = queryMs;
    this.index = (i + 1) % PHASE_WINDOW;
    if (this.count < PHASE_WINDOW) this.count++;
  }
  get buildAvg() { return this.count ? Math.max(0, this.sumBuild / this.count) : 0; }
  get queryAvg() { return this.count ? Math.max(0, this.sumQuery / this.count) : 0; }
  // Fração do tempo gasta montando a estrutura (0 a 1)
  get buildShare() {
    const total = this.buildAvg + this.queryAvg;
    return total > 0 ? this.buildAvg / total : 0;
  }
}
const phase = { brute: new PhaseStore(), grid: new PhaseStore(), octree: new PhaseStore() };

const STRATEGIES = [
  { key: 'brute',  label: 'Força Bruta O(n²)',   short: 'Força bruta',    theory: 'n²',      color: '#ff7139' },
  { key: 'grid',   label: 'Grade Espacial O(n)', short: 'Grade espacial', theory: 'n',       color: '#00ddff' },
  { key: 'octree', label: 'Octree O(n log n)',   short: 'Octree',         theory: 'n log n', color: '#a855f7' },
];

// Leituras ao vivo ficam sempre em ms com 3 casas: o valor oscila de um frame para o
// outro, e mudar de formato no meio do caminho faz o número parecer saltar.
function fmtLiveMs(ms) {
  return `${(ms > 0 ? ms : 0).toFixed(3)} ms`;
}

// Resultados do benchmark: sempre em ms, para as três estratégias serem comparáveis de
// relance. Tempos muito pequenos ganham casas decimais em vez de virar "0.000 ms".
function fmtTime(ms) {
  if (!(ms > 0)) return '0.000 ms';
  if (ms < 0.001) return `${ms.toFixed(5)} ms`;
  if (ms < 0.01) return `${ms.toFixed(4)} ms`;
  return `${ms.toFixed(3)} ms`;
}

function getAlgoLabel(broadPhase) {
  switch (broadPhase) {
    case 'brute': return 'Força Bruta O(n²)';
    case 'grid': return 'Grade Espacial O(n)';
    case 'octree': return 'Octree O(n log n)';
    default: return 'Desconhecido';
  }
}

// ====================== GRÁFICO ASSINTÓTICO ======================
function drawChart() {
  if (!chartCtx) return;
  const w = chartCanvas.width;
  const h = chartCanvas.height;

  chartCtx.clearRect(0, 0, w, h);

  const padX = 40;
  const padY = 38;
  const chartW = w - padX - 10;
  const chartH = h - padY - 10;

  chartCtx.save();
  chartCtx.setLineDash([4, 2]);
  chartCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(padX, h - padY); chartCtx.lineTo(w - 10, h - padY);
  chartCtx.moveTo(padX, 10);       chartCtx.lineTo(padX, h - padY);
  chartCtx.stroke();
  chartCtx.restore();

  chartCtx.fillStyle = 'rgba(255,255,255,0.6)';
  chartCtx.font = '10px "IBM Plex Mono", monospace';
  chartCtx.textAlign = 'center';
  chartCtx.fillText("N Cubos", padX + chartW / 2, h - 5);
  chartCtx.save();
  chartCtx.translate(12, 10 + chartH / 2);
  chartCtx.rotate(-Math.PI / 2);
  chartCtx.fillText("Tempo (ms)", 0, 0);
  chartCtx.restore();

  // O gráfico mostra só as curvas teóricas: nenhuma linha medida é desenhada conforme
  // o número de cubos muda. Os tempos medidos ficam nas leituras, no benchmark e na corrida.
  const N = Math.max(state.cubes.length, 2);
  const maxN = Math.max(20, N);

  // Recorta tudo à área do gráfico para nada vazar sobre eixos e rótulos
  chartCtx.save();
  chartCtx.beginPath();
  chartCtx.rect(padX, 6, w - padX - 6, h - padY - 6 + 4);
  chartCtx.clip();

  // Curvas teóricas (tracejadas)
  function drawTheory(color, f) {
    const steps = 40;
    chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = color; chartCtx.lineWidth = 2; chartCtx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const nx = s / steps;
      const px = padX + nx * chartW;
      const py = (h - padY) - f(nx) * chartH;
      if (s === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
    }
    chartCtx.stroke(); chartCtx.restore();
  }
  drawTheory('#ff7139', nx => nx * nx * 0.95);
  drawTheory('#a855f7', nx => {
    const i = nx * maxN;
    return ((i * Math.log(i + 2)) / (maxN * Math.log(maxN + 2))) * 0.65;
  });
  drawTheory('#00ddff', nx => nx * 0.35);

  chartCtx.save();
  chartCtx.setLineDash([3, 3]);
  chartCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  chartCtx.lineWidth = 1;
  const curNx = padX + (N / maxN) * chartW;
  chartCtx.beginPath();
  chartCtx.moveTo(curNx, h - padY);
  chartCtx.lineTo(curNx, 10);
  chartCtx.stroke();

  chartCtx.setLineDash([]);
  chartCtx.restore();
  chartCtx.restore(); // fim do recorte da área do gráfico
}

// ====================== UPDATE UI ======================
const badgeTextEl = document.getElementById('badgeText');
const tbObjectsEl = document.getElementById('tbObjects');
const tbModeEl = document.getElementById('tbMode');
const badgeIndicator = document.getElementById('badgeIndicator');

// Só escreve no DOM quando o texto muda (evita relayout desnecessário a cada frame)
function setText(el, text) {
  const s = String(text);
  if (el && el.textContent !== s) el.textContent = s;
}

function currentAverageTime() {
  const store = perf[state.currentBroadPhase];
  return store ? store.average(state.cubes.length) : 0;
}

function updateUI() {
  const label = getAlgoLabel(state.currentBroadPhase);
  setText(badgeTextEl, state.collisionCount);
  setText(tbObjectsEl, state.cubes.length);
  setText(tbModeEl, label);

  const active = state.activeCollisions > 0;
  if (collisionBadge.classList.contains('has-collision') !== active) {
    collisionBadge.classList.toggle('has-collision', active);
    badgeIndicator.classList.toggle('is-live', active);
  }

  setText(statN, state.cubes.length);
  setText(statAlgo, label);
  setText(statComp, state.lastComparisonCount.toLocaleString('pt-BR'));
  setText(statTime, `${currentAverageTime().toFixed(3)} ms`);
}

// ====================== TOAST NOTIFICATIONS (HUD) ======================
function showToast(title, message = '', accentColor = '#00ddff') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Limita acúmulo: remove o mais antigo se houver 4 ou mais
  if (container.children.length >= 4) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.style.setProperty('--toast-accent', accentColor);

  toast.innerHTML = `
    <span class="toast-badge">${title}</span>
    <span class="toast-text">${message}</span>
  `;

  container.appendChild(toast);

  // Animação de entrada
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-dismiss após 2 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}

// ====================== BENCHMARK E CSV ======================
// Uma execução da detecção dura microssegundos, e o relógio do navegador é grosso
// (até 1 ms no Firefox). Por isso nada aqui cronometra uma execução isolada: o
// trabalho é repetido até somar tempo suficiente e o total é dividido pelo número
// de execuções.

// Tempo médio de uma execução completa (montar + consultar + testar os pares).
// Não há cronômetro dentro do laço, para o custo de ler o relógio não entrar na conta.
function measureTotal(mode, cubes, structures, minMs, minRuns) {
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
function measurePhases(mode, cubes, structures, minMs) {
  let comparisons = 0, hits = 0, runs = 0, buildMs = 0, queryMs = 0;
  const onPair = (a, b) => { comparisons++; if (intersectAABB(a, b)) hits++; };
  const start = performance.now();
  do {
    comparisons = 0;
    hits = 0;
    const t = runBroadPhase(mode, cubes, onPair, structures);
    buildMs += t.buildMs;
    queryMs += t.queryMs;
    runs++;
    // a força bruta não tem fase de montagem: basta uma execução para as contagens
  } while (mode !== 'brute' && performance.now() - start < minMs);
  const total = buildMs + queryMs;
  return { buildShare: total > 0 ? buildMs / total : 0, comparisons, hits };
}

function runBenchmark() {
  if (state.cubes.length === 0) return;

  const cubes = state.cubes.filter(c => !c.dragging);
  // Mesmos parâmetros e mesmo código de broad-phase da simulação ao vivo;
  // o tempo inclui a construção da estrutura, como em detectCollisions.
  const structures = {
    grid: new SpatialGrid(state.cellSize),
    octree: new OctreeSimulator(60, state.octreeDepth),
  };

  const results = STRATEGIES.map(st => {
    const time = measureTotal(st.key, cubes, structures, 15, 20);
    const { buildShare, comparisons, hits } = measurePhases(st.key, cubes, structures, 30);
    return {
      key: st.key, label: st.label, color: st.color,
      time, buildMs: time * buildShare, queryMs: time * (1 - buildShare), buildShare,
      comparisons, hits,
    };
  });

  const minTime = Math.min(...results.map(r => r.time));
  results.forEach(r => {
    r.ratio = minTime > 0 ? (r.time / minTime) : 1;
  });

  populateBenchWidget(results, cubes.length);
  runCurveFit();
  playSound();
  return results;
}

function populateBenchWidget(results, n) {
  const widget = document.getElementById('benchWidget');
  const nLabel = document.getElementById('benchWidgetN');
  const rowsEl = document.getElementById('benchWidgetRows');
  if (!widget || !rowsEl) return;

  if (nLabel) nLabel.textContent = `n = ${n}`;

  const maxTime = Math.max(...results.map(r => r.time || 0));

  rowsEl.innerHTML = '';

  results.forEach((r, i) => {
    const ratio     = typeof r.ratio === 'number' ? r.ratio : 1;
    const isFastest = ratio <= 1.05;
    const ratioStr  = ratio.toFixed(1) + '×';
    const timeStr   = typeof r.time === 'number' ? fmtTime(r.time) : '— ms';
    const compStr   = typeof r.comparisons === 'number'
      ? r.comparisons.toLocaleString('pt-BR')
      : '—';
    const phaseStr  = r.key === 'brute'
      ? 'sem estrutura para montar'
      : 'montar ' + fmtTime(r.buildMs) + ' · consultar ' + fmtTime(r.queryMs);
    const buildPct  = (Math.min(Math.max(r.buildShare || 0, 0), 1) * 100).toFixed(1);

    const row = document.createElement('div');
    row.className = 'bench-row';
    row.dataset.mode = r.key;
    row.innerHTML =
      '<div class="bench-row-label">' + r.label + '</div>' +
      '<div class="bench-row-time">' + timeStr + '</div>' +
      '<div class="bench-row-meta">' +
        '<span class="bench-row-ratio' + (isFastest ? ' fastest' : '') + '">' +
          (isFastest ? 'mais rápido' : ratioStr + ' mais lento') +
        '</span>' +
        '<span>' + compStr + ' pares</span>' +
      '</div>' +
      '<div class="bench-row-phase">' + phaseStr + '</div>' +
      '<div class="bench-bar-track"><div class="bench-bar-fill" id="benchFill_' + i + '">' +
        '<span class="phase-bar__build" style="flex-basis:' + buildPct + '%"></span>' +
        '<span class="phase-bar__query"></span>' +
      '</div></div>';

    rowsEl.appendChild(row);
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      results.forEach((r, i) => {
        const pct  = maxTime > 0 ? Math.min((r.time / maxTime) * 100, 100) : 0;
        const fill = document.getElementById('benchFill_' + i);
        if (fill) fill.style.transform = 'scaleX(' + (pct / 100).toFixed(3) + ')';
      });
    });
  });

  widget.classList.add('visible');
}

// ====================== AJUSTE EMPÍRICO DA CURVA ======================
// Mede cada estratégia em cenas sintéticas de vários N e ajusta t = a·n^k por mínimos
// quadrados em escala log-log: ln t = ln a + k·ln n, então k é a inclinação da reta.
// As cenas usam a arena e os tamanhos de cubo do simulador e os parâmetros atuais
// (célula da grade e profundidade da Octree).
const FIT_SIZES = [10, 15, 22, 33, 50, 75, 110, 150];
const FIT_LAYOUTS = 2;   // cenas diferentes por N, para o acaso de uma cena não pesar
const FIT_MIN_MS = 5;    // tempo mínimo somado por medição
const FIT_REPEATS = 3;   // cada medição é repetida e fica a menor (descarta interferência, ex.: coletor de lixo)

// Gerador pseudoaleatório com semente: as cenas do ajuste são sempre as mesmas
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// points: [{ n, t }]. Devolve { k, a, r2 } ou null se não houver pontos suficientes.
function fitPowerLaw(points) {
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

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
let fitRunId = 0;

async function runCurveFit() {
  const statusEl = document.getElementById('benchFitStatus');
  const runId = ++fitRunId; // um benchmark novo cancela o ajuste em andamento
  const structures = {
    grid: new SpatialGrid(state.cellSize),
    octree: new OctreeSimulator(60, state.octreeDepth),
  };
  const params = `célula ${state.cellSize} · profundidade ${state.octreeDepth}`;
  const series = { brute: [], grid: [], octree: [] };
  renderFit(series, {});

  for (let i = 0; i < FIT_SIZES.length; i++) {
    const n = FIT_SIZES[i];
    if (statusEl) statusEl.textContent = `medindo n = ${n} (${i + 1} de ${FIT_SIZES.length})`;
    await nextFrame(); // deixa a tela atualizar entre uma medição e outra
    if (runId !== fitRunId) return;

    const sums = { brute: 0, grid: 0, octree: 0 };
    for (let layout = 0; layout < FIT_LAYOUTS; layout++) {
      const cubes = createSyntheticCubes(n, mulberry32(n * 1009 + layout));
      for (const st of STRATEGIES) {
        let best = Infinity;
        for (let r = 0; r < FIT_REPEATS; r++) best = Math.min(best, measureTotal(st.key, cubes, structures, FIT_MIN_MS, 3));
        sums[st.key] += best;
      }
    }
    for (const st of STRATEGIES) series[st.key].push({ n, t: sums[st.key] / FIT_LAYOUTS });
  }

  const fits = {};
  for (const st of STRATEGIES) fits[st.key] = fitPowerLaw(series[st.key]);
  renderFit(series, fits);
  if (statusEl) statusEl.textContent = `n de ${FIT_SIZES[0]} a ${FIT_SIZES[FIT_SIZES.length - 1]} · ${params}`;
}

function renderFit(series, fits) {
  const listEl = document.getElementById('benchFitList');
  if (listEl) {
    listEl.innerHTML = STRATEGIES.map(st => {
      const f = fits[st.key];
      const measured = f ? `n<sup>${f.k.toFixed(2)}</sup>` : '—';
      const meta = `teórico ${st.theory}` + (f ? ` · R² ${f.r2.toFixed(3)}` : '');
      return `<li class="fit-item" data-mode="${st.key}">` +
        `<span class="fit-item__name">${st.short}</span>` +
        `<strong class="fit-item__k">${measured}</strong>` +
        `<span class="fit-item__meta">${meta}</span></li>`;
    }).join('');
  }
  drawFitChart(series, fits);
}

// Gráfico log-log em SVG: pontos medidos e a reta ajustada de cada estratégia
function drawFitChart(series, fits) {
  const svg = document.getElementById('fitChart');
  if (!svg) return;
  const W = 280, H = 140, padL = 56, padR = 10, padT = 10, padB = 24;
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;

  const parts = [
    `<path class="fit-axis" d="M${x0} ${y1}V${y0}H${x1}"/>`,
    `<text x="${(x0 + x1) / 2}" y="${H - 3}" text-anchor="middle">n (log)</text>`,
  ];

  const times = STRATEGIES.flatMap(st => series[st.key].map(p => p.t)).filter(t => t > 0);
  if (times.length >= 2) {
    const nMin = FIT_SIZES[0], nMax = FIT_SIZES[FIT_SIZES.length - 1];
    const lnN0 = Math.log(nMin), lnN1 = Math.log(nMax);
    let lnT0 = Math.log(Math.min(...times)), lnT1 = Math.log(Math.max(...times));
    if (lnT1 - lnT0 < 1e-9) { lnT0 -= 0.5; lnT1 += 0.5; }
    const px = n => x0 + ((Math.log(n) - lnN0) / (lnN1 - lnN0)) * (x1 - x0);
    const py = t => y0 - ((Math.log(t) - lnT0) / (lnT1 - lnT0)) * (y0 - y1);
    const clampY = y => Math.min(y0, Math.max(y1, y));

    [nMin, FIT_SIZES[Math.floor(FIT_SIZES.length / 2)], nMax].forEach(n => {
      parts.push(`<path class="fit-tick" d="M${px(n).toFixed(1)} ${y0}v3"/>`);
      parts.push(`<text x="${px(n).toFixed(1)}" y="${y0 + 11}" text-anchor="middle">${n}</text>`);
    });
    parts.push(`<text x="${x0 - 4}" y="${y1 + 7}" text-anchor="end">${fmtTime(Math.exp(lnT1)).replace(' ', '')}</text>`);
    parts.push(`<text x="${x0 - 4}" y="${y0}" text-anchor="end">${fmtTime(Math.exp(lnT0)).replace(' ', '')}</text>`);

    for (const st of STRATEGIES) {
      const f = fits[st.key];
      if (f) {
        const ya = clampY(py(f.a * Math.pow(nMin, f.k))), yb = clampY(py(f.a * Math.pow(nMax, f.k)));
        parts.push(`<path class="fit-line" data-mode="${st.key}" d="M${x0} ${ya.toFixed(1)}L${x1} ${yb.toFixed(1)}"/>`);
      }
      for (const p of series[st.key]) {
        if (!(p.t > 0)) continue;
        parts.push(`<circle class="fit-dot" data-mode="${st.key}" cx="${px(p.n).toFixed(1)}" cy="${py(p.t).toFixed(1)}" r="2.2"/>`);
      }
    }
  }
  svg.innerHTML = parts.join('');
}

// ====================== HISTÓRICO CSV (modal) ======================
let historyLog = [];
let sessionStartTime = Date.now();
let historyBreak = false; // força nova linha mesmo com mesmo N/algoritmo (ex.: reset)

// Toda reconfiguração da cena passa por aqui
function restartScene() {
  initCubes();
  RACE_MODES.forEach(mode => phase[mode].reset());
  sessionStartTime = Date.now();
  historyBreak = true;
  addOrUpdateHistoryEntry();
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Cria uma entrada nova quando N/algoritmo mudam; caso contrário atualiza a última.
// É chamada periodicamente pelo loop de animação, então tempo e colisões refletem
// a configuração atual (antes eram capturados logo após o reset, com valores do modo anterior).
function addOrUpdateHistoryEntry() {
  const avgMs = currentAverageTime();
  const currentMs = Number((avgMs > 0 ? avgMs : state.lastExecutionTime || 0).toFixed(4));
  const durationStr = formatDuration(Date.now() - sessionStartTime);

  const speedVal = `${parseFloat(state.simSpeed).toFixed(1)}x`;
  const cellSizeVal = state.currentBroadPhase === 'grid' ? state.cellSize : '-';
  const octreeDepthVal = state.currentBroadPhase === 'octree' ? state.octreeDepth : '-';

  const entry = {
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    n: state.cubes.length,
    algo: getAlgoLabel(state.currentBroadPhase),
    speed: speedVal,
    cellSize: cellSizeVal,
    octreeDepth: octreeDepthVal,
    collisions: state.collisionCount,
    timeMs: currentMs, // Captura o valor vivo e atualizado de state.lastExecutionTime
    duration: durationStr,
  };

  const last = historyLog[historyLog.length - 1];
  if (last && last.n === entry.n && last.algo === entry.algo && !historyBreak) {
    historyLog[historyLog.length - 1] = entry;
  } else {
    historyLog.push(entry);
  }
  historyBreak = false;

  if (historyLog.length > 50) historyLog.shift();
}

function renderHistoryTable() {
  const tbody = document.getElementById('historyTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  historyLog.forEach((entry, idx) => {
    const algoClass = entry.algo.includes('Bruta') ? 'algo-brute'
      : entry.algo.includes('Grade') ? 'algo-grid'
      : entry.algo.includes('Octree') ? 'algo-octree' : '';
    const tr = document.createElement('tr');
    const na = v => (v === '-' ? '—' : v);
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="num">${entry.n}</td>
      <td><span class="algo-cell ${algoClass}">${entry.algo}</span></td>
      <td class="num">${entry.speed}</td>
      <td class="num${entry.cellSize === '-' ? ' is-na' : ''}">${na(entry.cellSize)}</td>
      <td class="num${entry.octreeDepth === '-' ? ' is-na' : ''}">${na(entry.octreeDepth)}</td>
      <td class="num">${entry.collisions}</td>
      <td class="num">${entry.timeMs.toFixed(3)}</td>
      <td class="num">${entry.duration}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportCSV() {
  if (!historyLog || historyLog.length === 0) {
    alert('Nenhum registro no histórico para exportar.');
    return;
  }

  const headers = ['Timestamp', 'N_Cubos', 'Algoritmo', 'Velocidade', 'Tam_Celula', 'Profundidade_Octree', 'Colisoes', 'Tempo_Ms', 'Duracao_Sessao'];
  const csvLines = [
    headers.join(','),
    ...historyLog.map(row =>
      `"${row.timestamp}","${row.n}","${row.algo}","${row.speed}","${row.cellSize}","${row.octreeDepth}","${row.collisions}","${row.timeMs.toFixed(3)}","${row.duration}"`
    )
  ];

  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = `simulation_history_${new Date().toISOString().slice(0,10)}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ====================== INICIALIZAÇÃO ======================
function initDefaults() {
  cubeCountInput.value = 8;
  cubeCountNumber.value = 8;
  document.getElementById('speed').value = '0.8';
  state.simSpeed = parseFloat(speedSlider.value);
  document.getElementById('broadPhaseSelect').value = 'brute';
  document.getElementById('showGrid').checked = true;
  document.getElementById('bloomToggle').checked = true;
  cellSizeSlider.value = 2;
  cellSizeNumber.value = 2;
  octreeDepthSlider.value = 6;
  octreeDepthNumber.value = 6;

  // Aplica desativação dinâmica de sliders no modo padrão (Força Bruta)
  const cellSizeGroup = cellSizeSlider.closest('.control-group');
  const octreeDepthGroup = octreeDepthSlider.closest('.control-group');
  cellSizeGroup.classList.add('control-disabled');
  octreeDepthGroup.classList.add('control-disabled');
  syncDisabledControls();
}

// Um controle esmaecido também sai da navegação por teclado
function syncDisabledControls() {
  document.querySelectorAll('#controlPanel .control-group').forEach(group => {
    const off = group.classList.contains('control-disabled');
    group.querySelectorAll('input').forEach(input => { input.disabled = off; });
  });
}

export function startApp() {
  initDefaults();
  restartScene();
  startTyping(pseudoCodeBrute);
  updateContextPanel('brute');
  animate();
}

// pseudocódigos (mesmo conteúdo do monolítico)
const pseudoCodeBrute = `> FUNCAO intersectarAABB(A, B):
>   dx = abs(A.x - B.x)
>   dy = abs(A.y - B.y)
>   dz = abs(A.z - B.z)
>
>   SE dx < (A.size + B.size)/2
>    E dy < (A.size + B.size)/2
>    E dz < (A.size + B.size)/2:
>      RETORNAR VERDADEIRO
>   RETORNAR FALSO`;

const pseudoCodeSpatial = `> FUNCAO detectarColisoesComGrade():
>   grade.limpar()
>   PARA CADA c EM cubos grade.inserir(c)
>   PARA CADA c EM cubos
>     vizinhos = grade.obterVizinhos(c)
>     PARA CADA v EM vizinhos
>       SE v.id > c.id E intersectarAABB(c, v)
>         MARCAR colisao(c, v)
>   RETORNAR colisoes`;

const pseudoCodeOctree = `> FUNCAO inserir(no, obj, box):
>   SE box cabe em filho:
>     inserir(filho, obj, box)
>   SENÃO:           // straddling
>     no.objects.add(obj)

> FUNCAO candidatos(no, obj, box):
>   PARA CADA o EM no.objects:
>     candidatos.add(o)   // ancestrais sempre
>   PARA CADA filho:
>     SE filho.bounds.intersecta(box):
>       candidatos(filho, obj, box)
>   RETORNAR candidatos`;

let typingInterval = null;
export function startTyping(targetText) {
  if (typingInterval) clearInterval(typingInterval);
  const el = document.getElementById('pseudoCode');
  el.textContent = '';
  let charIndex = 0;
  typingInterval = setInterval(() => {
    if (charIndex < targetText.length) {
      el.textContent += targetText.charAt(charIndex);
      charIndex++;
    } else {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }, 15);
}

// ====================== EVENTOS E INTERATIVIDADE ======================
const MODE_THEMES = {
  brute:  { color: '#ff7139' },
  grid:   { color: '#00ddff' },
  octree: { color: '#a855f7' },
};

// As cores da interface vêm do CSS (body[data-mode]). Aqui só se marca o modo,
// a tecla pressionada e a cor das linhas de teste da cena.
function setModeTheme(mode) {
  const key = MODE_THEMES[mode] ? mode : 'brute';
  document.body.dataset.mode = key;
  setPairLineColor(MODE_THEMES[key].color);
  document.querySelectorAll('.mode-key').forEach(k =>
    k.setAttribute('aria-pressed', String(k.dataset.mode === key))
  );
}

let presentationMode = false;
let presentOrbitAngle = Math.atan2(0, 0); // atualizado após a câmera existir
const presentOrbitRadius = 68;
const presentOrbitY = 32;
let savedCameraPos = null;
let savedCameraTarget = null;

function updatePresentHud() {
  const modeEl  = document.getElementById('presentMode');
  const nEl     = document.getElementById('presentN');
  const compEl  = document.getElementById('presentComp');
  const collEl  = document.getElementById('presentCollisions');
  if (modeEl) modeEl.textContent = state.raceMode ? 'Corrida: três estratégias' : getAlgoLabel(state.currentBroadPhase);
  if (nEl)    nEl.textContent    = `n = ${state.cubes.length}`;
  if (compEl) compEl.textContent = `${state.lastComparisonCount.toLocaleString('pt-BR')} comp.`;
  if (collEl) collEl.textContent = `${state.collisionCount} colisões`;
}

function enterPresentation() {
  if (presentationMode) return;
  presentationMode = true;
  savedCameraPos = camera.position.clone();
  savedCameraTarget = controls.target.clone();
  presentOrbitAngle = Math.atan2(camera.position.x, camera.position.z);
  controls.enabled = false;
  document.body.classList.add('presentation-mode');
  const presentBtn = document.getElementById('presentBtn');
  presentBtn.title = 'Sair da apresentação (P)';
  presentBtn.setAttribute('aria-pressed', 'true');
  updatePresentHud();
  playSound();
}

function exitPresentation() {
  if (!presentationMode) return;
  presentationMode = false;
  if (savedCameraPos) {
    camera.position.copy(savedCameraPos);
    controls.target.copy(savedCameraTarget);
    camera.lookAt(savedCameraTarget);
  }
  if (state.raceMode) fitRaceCamera();
  controls.enabled = true;
  document.body.classList.remove('presentation-mode');
  const presentBtn = document.getElementById('presentBtn');
  presentBtn.title = 'Modo apresentação (P)';
  presentBtn.setAttribute('aria-pressed', 'false');
  playSound();
}

function togglePresentation() {
  presentationMode ? exitPresentation() : enterPresentation();
}

// ====================== CUSTO POR FASE (trilho de telemetria) ======================
const phaseBarEl = document.getElementById('phaseBar');
const phaseBuildFill = document.getElementById('phaseBuildFill');
const phaseBuildMs = document.getElementById('phaseBuildMs');
const phaseBuildPct = document.getElementById('phaseBuildPct');
const phaseQueryMs = document.getElementById('phaseQueryMs');
const phaseQueryPct = document.getElementById('phaseQueryPct');
const phaseNote = document.getElementById('phaseNote');

const PHASE_NOTES = {
  brute: 'A força bruta não monta estrutura: todo o tempo vai para os testes de pares.',
  grid: 'A grade é esvaziada e preenchida a cada frame. Células menores custam mais para montar e menos para consultar.',
  octree: 'A árvore é refeita a cada frame. Mais profundidade custa mais para montar e reduz os pares consultados.',
};

function updatePhaseUI() {
  if (!phaseBarEl) return;
  const store = phase[state.currentBroadPhase];
  const build = store.buildAvg, query = store.queryAvg;
  const hasData = build + query > 0;
  const buildPct = Math.round(store.buildShare * 100);

  phaseBarEl.classList.toggle('is-empty', !hasData);
  phaseBuildFill.style.flexBasis = `${(store.buildShare * 100).toFixed(1)}%`;
  setText(phaseBuildMs, fmtLiveMs(build));
  setText(phaseQueryMs, fmtLiveMs(query));
  setText(phaseBuildPct, hasData ? `${buildPct}%` : '—');
  setText(phaseQueryPct, hasData ? `${100 - buildPct}%` : '—');
  setText(phaseNote, PHASE_NOTES[state.currentBroadPhase]);
}

// ====================== CORRIDA LADO A LADO ======================
// A tela é dividida em três colunas, uma por estratégia. A simulação é uma só: as três
// estratégias rodam no mesmo frame, sobre os mesmos cubos, e cada coluna mostra os
// pares que a sua estratégia testou, a estrutura que ela montou e os tempos dela.
const raceBtn = document.getElementById('raceBtn');
const raceEls = {};
RACE_MODES.forEach(mode => {
  const col = document.querySelector(`.race-col[data-mode="${mode}"]`);
  if (!col) return;
  const part = name => col.querySelector(`[data-race="${name}"]`);
  raceEls[mode] = { pairs: part('pairs'), time: part('time'), rank: part('rank'), fill: part('fill'), build: part('build') };
});

function updateRaceHud() {
  // Média simples dos últimos frames (a mesma janela do custo por fase). A média aparada
  // da telemetria descarta os frames mais lentos; com o relógio grosso do navegador, quase
  // todo frame mede 0 e os poucos que medem algo são justamente os descartados, então o
  // valor despencava de vez em quando.
  const times = RACE_MODES.map(mode => phase[mode].buildAvg + phase[mode].queryAvg);
  const maxTime = Math.max(...times);
  const positive = times.filter(t => t > 0);
  const minTime = positive.length ? Math.min(...positive) : 0;

  RACE_MODES.forEach((mode, i) => {
    const els = raceEls[mode];
    if (!els) return;
    const t = times[i];
    setText(els.pairs, frameStats[mode].comparisons.toLocaleString('pt-BR'));
    setText(els.time, fmtLiveMs(t));

    const ratio = minTime > 0 && t > 0 ? t / minTime : 0;
    const fastest = ratio > 0 && ratio <= 1.05;
    setText(els.rank, ratio === 0 ? '—' : fastest ? 'mais rápido' : `${ratio.toFixed(1)}× mais lento`);
    els.rank.classList.toggle('is-first', fastest);

    els.fill.style.transform = `scaleX(${maxTime > 0 ? (t / maxTime).toFixed(3) : 0})`;
    els.build.style.flexBasis = `${(phase[mode].buildShare * 100).toFixed(1)}%`;
  });
}

// Cada coluna é estreita: a câmera abre o campo de visão e, se preciso, recua
// até a arena caber na largura de uma coluna.
const RACE_FOV = 58;
const ARENA_FIT_RADIUS = 27;
let fovBeforeRace = camera.fov;
let raceZoomFactor = 1;
let railsBeforeRace = null;

function raceFitDistance() {
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  return Math.min(controls.maxDistance, ARENA_FIT_RADIUS / Math.sin(Math.min(halfV, halfH)));
}

const _camOffset = new THREE.Vector3();
function scaleCameraDistance(factor, position = camera.position, target = controls.target) {
  _camOffset.subVectors(position, target).multiplyScalar(factor);
  const len = THREE.MathUtils.clamp(_camOffset.length(), controls.minDistance, controls.maxDistance);
  position.copy(target).add(_camOffset.setLength(len));
}

// Recua a câmera se a arena não couber na coluna. raceZoomFactor acumula o quanto
// ela recuou, para a saída da corrida desfazer exatamente isso.
function fitRaceCamera() {
  const dist = camera.position.distanceTo(controls.target);
  const needed = raceFitDistance();
  if (!(dist > 0) || dist >= needed) return;
  const factor = needed / dist;
  scaleCameraDistance(factor);
  raceZoomFactor *= factor;
}

function enterRace() {
  if (state.raceMode) return;
  state.raceMode = true;
  document.body.classList.add('race-mode');
  raceBtn.setAttribute('aria-pressed', 'true');

  // os trilhos cobririam as colunas das pontas: fecham ao entrar e voltam ao sair
  railsBeforeRace = {
    controls: !controlPanel.classList.contains('panel-hidden'),
    chart: !chartPanel.classList.contains('chart-hidden'),
  };
  controlPanel.classList.add('panel-hidden');
  chartPanel.classList.add('chart-hidden');
  syncPanelButtons();

  fovBeforeRace = camera.fov;
  camera.fov = RACE_FOV;
  setViewColumns(RACE_MODES.length);
  raceZoomFactor = 1;
  if (!presentationMode) fitRaceCamera(); // na apresentação a órbita define a distância

  RACE_MODES.forEach(mode => phase[mode].reset());
  updateRaceHud();
}

function exitRace() {
  if (!state.raceMode) return;
  state.raceMode = false;
  document.body.classList.remove('race-mode');
  raceBtn.setAttribute('aria-pressed', 'false');

  camera.fov = fovBeforeRace;
  setViewColumns(1);
  if (raceZoomFactor !== 1) {
    // na apresentação a câmera está em órbita: desfaz o recuo na posição guardada para a volta
    if (presentationMode && savedCameraPos) scaleCameraDistance(1 / raceZoomFactor, savedCameraPos, savedCameraTarget);
    else scaleCameraDistance(1 / raceZoomFactor);
  }
  raceZoomFactor = 1;

  if (railsBeforeRace) {
    controlPanel.classList.toggle('panel-hidden', !railsBeforeRace.controls);
    chartPanel.classList.toggle('chart-hidden', !railsBeforeRace.chart);
    syncPanelButtons();
  }
  setModeTheme(state.currentBroadPhase); // devolve a cor das linhas de teste ao modo ativo
}

function toggleRace() {
  const willEnter = !state.raceMode;
  willEnter ? enterRace() : exitRace();
  playSound();
  showToast(
    'CORRIDA',
    willEnter ? 'Três estratégias na mesma cena' : 'Vista única restaurada',
    willEnter ? '#10b981' : '#71717a'
  );
}

window.addEventListener('resize', handleResize);

// Libera o áudio na primeira interação (o navegador bloqueia som antes disso).
// Fase de captura: roda antes dos handlers dos botões, então o som do próprio clique já sai.
['pointerdown', 'keydown', 'touchstart'].forEach(type =>
  window.addEventListener(type, unlockAudio, { capture: true, passive: true })
);

// Valores digitados à mão são limitados ao intervalo válido (ex.: célula 0 travava o loop da grade)
function setCubeCount(raw) {
  const max = Number(cubeCountInput.max) || LIMITS.cubes.max;
  const n = Math.round(clampNumber(raw, LIMITS.cubes.min, max, 8));
  cubeCountInput.value = n;
  cubeCountNumber.value = n;
  const disp = document.getElementById('cubeCountDisplay');
  if (disp) disp.textContent = n;
  restartScene();
}
cubeCountInput.addEventListener('input', e => setCubeCount(e.target.value));
cubeCountNumber.addEventListener('change', e => setCubeCount(e.target.value));

speedSlider.addEventListener('input', e => {
  state.simSpeed = parseFloat(e.target.value);
  document.getElementById('speedValue').textContent = `${state.simSpeed.toFixed(1)}×`;
});

function togglePause() {
  state.simPaused = !state.simPaused;
  const btn = document.getElementById('toggleBtn');
  btn.classList.toggle('btn-active', state.simPaused);
  document.getElementById('toggleLabel').textContent = state.simPaused ? 'Retomar' : 'Pausar';
  document.body.classList.toggle('sim-paused', state.simPaused);
  chartPanel.classList.toggle('sim-paused', state.simPaused);
  document.getElementById('chartStats').classList.toggle('sim-paused', state.simPaused);
  playSound();
  showToast(
    state.simPaused ? 'PAUSADO' : 'EM EXECUÇÃO',
    state.simPaused ? 'Simulação interrompida' : 'Simulação retomada',
    state.simPaused ? '#f59e0b' : '#10b981'
  );
}
document.getElementById('toggleBtn').addEventListener('click', togglePause);

document.getElementById('resetBtn').addEventListener('click', () => {
  setStressMode(false);
  cubeCountInput.value = 8;
  cubeCountNumber.value = 8;
  restartScene();
  playSound();
  showToast('REINICIAR', 'Cena e objetos redefinidos', '#00ddff');
});

document.getElementById('showGrid').addEventListener('change', e => {
  floorGrid.visible = e.target.checked;
  showToast('GRADE DO CHÃO', e.target.checked ? 'Grade visível' : 'Grade oculta', '#71717a');
});

document.getElementById('bloomToggle').addEventListener('change', e => {
  setBloomEnabled(e.target.checked);
  showToast('BRILHO NEON', e.target.checked ? 'Brilho ligado' : 'Brilho desligado', '#71717a');
});

// A estrutura é reconstruída a cada frame a partir de state, então basta atualizar o estado
function setCellSize(raw) {
  const v = clampNumber(raw, LIMITS.cellSize.min, LIMITS.cellSize.max, 2);
  cellSizeSlider.value = v;
  cellSizeNumber.value = v;
  state.cellSize = v;
}
cellSizeSlider.addEventListener('input', e => setCellSize(e.target.value));
cellSizeNumber.addEventListener('change', e => setCellSize(e.target.value));

function setOctreeDepth(raw) {
  const v = Math.round(clampNumber(raw, LIMITS.octreeDepth.min, LIMITS.octreeDepth.max, 6));
  octreeDepthSlider.value = v;
  octreeDepthNumber.value = v;
  state.octreeDepth = v;
}
octreeDepthSlider.addEventListener('input', e => setOctreeDepth(e.target.value));
octreeDepthNumber.addEventListener('change', e => setOctreeDepth(e.target.value));

// Trilhos laterais: o botão da barra superior reflete o estado em aria-pressed.
// Em telas estreitas os dois trilhos disputam a mesma área, então abrir um fecha o outro.
const narrowScreen = window.matchMedia('(max-width: 900px)');
function syncPanelButtons() {
  minimizeBtn.setAttribute('aria-pressed', String(!controlPanel.classList.contains('panel-hidden')));
  toggleChartBtn.setAttribute('aria-pressed', String(!chartPanel.classList.contains('chart-hidden')));
}
minimizeBtn.addEventListener('click', () => {
  const opening = controlPanel.classList.contains('panel-hidden');
  controlPanel.classList.toggle('panel-hidden', !opening);
  if (opening && narrowScreen.matches) chartPanel.classList.add('chart-hidden');
  syncPanelButtons();
  playSound();
});
toggleChartBtn.addEventListener('click', () => {
  const opening = chartPanel.classList.contains('chart-hidden');
  chartPanel.classList.toggle('chart-hidden', !opening);
  if (opening && narrowScreen.matches) controlPanel.classList.add('panel-hidden');
  syncPanelButtons();
  playSound();
});
// Em telas largas os dois trilhos já abrem; nas menores a cena começa livre
if (window.innerWidth >= 1100) {
  controlPanel.classList.remove('panel-hidden');
  chartPanel.classList.remove('chart-hidden');
}
syncPanelButtons();

document.getElementById('theoryBtn').addEventListener('click', () => { theoryModal.classList.remove('hidden'); playSound(); });
document.getElementById('closeTheoryBtn').addEventListener('click', () => { theoryModal.classList.add('hidden'); playSound(); });
raceBtn.addEventListener('click', toggleRace);

const benchTopbarBtn = document.getElementById('benchTopbarBtn');
benchTopbarBtn.addEventListener('click', () => {
  if (runBenchmark()) showToast('BENCHMARK', 'Cena atual medida; ajustando a curva', '#ff7139');
});

const benchWidgetClose = document.getElementById('benchWidgetClose');
benchWidgetClose.addEventListener('click', () => {
  document.getElementById('benchWidget').classList.remove('visible');
  playSound();
});

const benchWidgetRerun = document.getElementById('benchWidgetRerun');
benchWidgetRerun.addEventListener('click', () => { runBenchmark(); });

document.getElementById('presentBtn').addEventListener('click', () => {
  const willEnter = !presentationMode;
  togglePresentation();
  showToast(
    'APRESENTAÇÃO',
    willEnter ? 'Câmera orbital e HUD limpo' : 'Modo de edição restaurado',
    willEnter ? '#ff7139' : '#71717a'
  );
});

// Aplica só o estado visual e os limites; quem chama decide quantos cubos e reinicia a cena
function setStressMode(isActive) {
  stressBtn.classList.toggle('btn-active', isActive);
  const max = isActive ? LIMITS.cubes.max : 20;
  cubeCountInput.max = max;
  cubeCountNumber.max = max;
  controlPanel.classList.toggle('stress-active', isActive);
  document.getElementById('stressBadge').classList.toggle('visible', isActive);
  document.body.classList.toggle('stress-mode', isActive);
}

stressBtn.addEventListener('click', () => {
  const isActive = !stressBtn.classList.contains('btn-active');
  setStressMode(isActive);
  const n = isActive ? LIMITS.cubes.max : 8;
  cubeCountInput.value = n;
  cubeCountNumber.value = n;

  const flicker = document.getElementById('stressFlicker');
  flicker.classList.remove('flash');
  void flicker.offsetWidth;
  flicker.classList.add('flash');

  restartScene();
  playSound();

  showToast(
    'STRESS TEST',
    isActive ? 'Modo de alta densidade (150 objetos)' : 'Modo padrão restaurado',
    isActive ? '#ff4e3e' : '#71717a'
  );
});

soundBtn.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  document.getElementById('soundIconOn').style.display  = state.soundEnabled ? '' : 'none';
  document.getElementById('soundIconOff').style.display = state.soundEnabled ? 'none' : '';
  document.getElementById('soundLabel').textContent = state.soundEnabled ? 'Som' : 'Sem som';
  soundBtn.setAttribute('aria-pressed', String(state.soundEnabled));
  playSound();

  showToast(
    'SOM',
    state.soundEnabled ? 'Efeitos sonoros ativados' : 'Áudio mutado',
    state.soundEnabled ? '#10b981' : '#71717a'
  );
});

document.getElementById('broadPhaseSelect').addEventListener('change', (e) => {
  // Os cubos ficam onde estão: a cena é a mesma para a estratégia nova. Só a contagem,
  // as médias e a linha do histórico recomeçam; a paleta troca em onda e a imagem falha
  // por meio segundo.
  switchStrategy(e.target.value);
  RACE_MODES.forEach(mode => phase[mode].reset());
  sessionStartTime = Date.now();
  historyBreak = true;
  addOrUpdateHistoryEntry();
  triggerGlitch();
  playSound();

  setModeTheme(state.currentBroadPhase);
  updateContextPanel(state.currentBroadPhase);
  clearDebugGizmos();

  controlPanel.classList.remove('mode-brute', 'mode-grid', 'mode-octree');
  controlPanel.classList.add('mode-' + state.currentBroadPhase);

  // Desativação dinâmica de sliders irrelevantes por modo
  const cellSizeGroup = cellSizeSlider.closest('.control-group');
  const octreeDepthGroup = octreeDepthSlider.closest('.control-group');

  if (state.currentBroadPhase === 'octree') {
    cellSizeGroup.classList.add('control-disabled');
    octreeDepthGroup.classList.remove('control-disabled');
  } else if (state.currentBroadPhase === 'grid') {
    cellSizeGroup.classList.remove('control-disabled');
    octreeDepthGroup.classList.add('control-disabled');
  } else {
    // Força Bruta: ambos os sliders ficam bloqueados/cinzentos
    cellSizeGroup.classList.add('control-disabled');
    octreeDepthGroup.classList.add('control-disabled');
  }
  syncDisabledControls();

  switch (state.currentBroadPhase) {
    case 'brute': startTyping(pseudoCodeBrute); break;
    case 'grid': startTyping(pseudoCodeSpatial); break;
    case 'octree': startTyping(pseudoCodeOctree); break;
  }

  const toastColors = { brute: '#ff7139', grid: '#00ddff', octree: '#a855f7' };
  showToast('ALGORITMO', getAlgoLabel(state.currentBroadPhase), toastColors[state.currentBroadPhase]);
});

// As teclas da barra superior escolhem a estratégia através do select (que guarda o valor)
document.querySelectorAll('.mode-key').forEach(key => {
  key.addEventListener('click', () => {
    const select = document.getElementById('broadPhaseSelect');
    if (select.value === key.dataset.mode) return;
    select.value = key.dataset.mode;
    select.dispatchEvent(new Event('change'));
  });
});

function toggleWireframeMode() {
  state.wireframeEnabled = !state.wireframeEnabled;
  wireframeBtn.classList.toggle('btn-active', state.wireframeEnabled);
  playSound();
  toggleWireframe();
  showToast(
    'WIREFRAME',
    state.wireframeEnabled ? 'Modo de malha ativado' : 'Modo sólido ativado',
    state.wireframeEnabled ? '#a855f7' : '#71717a'
  );
}
wireframeBtn.addEventListener('click', toggleWireframeMode);

document.getElementById('historyCsvBtn').addEventListener('click', () => {
  document.getElementById('historyCsvModal').classList.remove('hidden');
  addOrUpdateHistoryEntry();
  renderHistoryTable();
  playSound();

  showToast('HISTÓRICO', 'Registro de métricas exibido', '#a855f7');
});

document.getElementById('closeHistoryCsvBtn').addEventListener('click', () => {
  document.getElementById('historyCsvModal').classList.add('hidden');
  playSound();
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  exportCSV();
  playSound();
});

document.getElementById('physicsBtn').addEventListener('click', () => {
  state.isPhysicsEnabled = !state.isPhysicsEnabled;
  const btn = document.getElementById('physicsBtn');
  btn.classList.toggle('btn-active', state.isPhysicsEnabled);
  playSound();

  showToast(
    'FÍSICA REAL',
    state.isPhysicsEnabled ? 'Resposta a colisões ativada' : 'Só deteção (cubos se atravessam)',
    state.isPhysicsEnabled ? '#10b981' : '#71717a'
  );
});


captureBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `physics-sim-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
  playSound();

  showToast('CAPTURA', 'Imagem salva com sucesso', '#10b981');
});

window.addEventListener('keydown', (e) => {
  // Não intercepta digitação em campos nem atalhos do navegador (Ctrl+R, Cmd+S...)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();

  if (e.code === 'Escape') {
    const openModal = document.querySelector('.modal:not(.hidden)');
    if (openModal) openModal.classList.add('hidden'); else exitPresentation();
    return;
  }
  if (key === 'p') { togglePresentation(); return; }
  if (key === 'c') { toggleRace(); return; }
  if (key === 'x') { setXray(true); return; } // raio-X enquanto a tecla estiver segura
  if (key === 't') { toggleTrail(); return; }

  if (presentationMode) return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  } else if (key === 'r') {
    document.getElementById('resetBtn').click();
  } else if (key === 's') {
    stressBtn.click();
  } else if (key === 'w') {
    toggleWireframeMode();
  } else if (key === 'b') {
    benchTopbarBtn.click();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'x') setXray(false);
});
// soltar a tecla com a janela sem foco não gera keyup: o raio-X desliga ao perder o foco
window.addEventListener('blur', () => setXray(false));

function toggleTrail() {
  setTrailEnabled(!isTrailEnabled());
  showToast('RASTRO', isTrailEnabled() ? 'Linhas de teste com rastro' : 'Rastro desligado', '#ff7139');
}

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('pointerdown', e => { if (e.target === modal) modal.classList.add('hidden'); });
});

// Depois de um clique com o mouse o foco sai do botão ou do slider. Sem isso o Espaço
// repetia o último botão em vez de pausar, e os atalhos paravam depois de mexer num slider.
document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (button && e.detail > 0) button.blur();
});
document.querySelectorAll('input[type="range"]').forEach(range =>
  range.addEventListener('pointerup', () => range.blur())
);

// ====================== DRAG & DROP 3D ======================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
const offset = new THREE.Vector3();

const forceLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const forceLineMat = new THREE.LineDashedMaterial({
  color: 0xffdd44, dashSize: 0.6, gapSize: 0.3, linewidth: 2
});
const forceLineMesh = new THREE.Line(forceLineGeo, forceLineMat);
forceLineMesh.visible = false;
scene.add(forceLineMesh);

const _cameraDir = new THREE.Vector3();
const _intersectPoint = new THREE.Vector3();
const _groundPoint = new THREE.Vector3();

function cubeMeshes() { return state.cubes.map(c => c.mesh); }

// Posição do ponteiro em coordenadas da câmera. Na corrida cada coluna é uma vista
// completa da cena, então o X é medido dentro da coluna em que o ponteiro está.
function setMouseFromEvent(e) {
  const colW = window.innerWidth / (state.raceMode ? RACE_MODES.length : 1);
  mouse.set(((e.clientX % colW) / colW) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}

function updateDropLine(pos) {
  _groundPoint.set(pos.x, 0, pos.z);
  dropLineMesh.geometry.setFromPoints([pos, _groundPoint]);
  dropLineMesh.computeLineDistances();
  dropLineMesh.visible = true;
}

window.addEventListener('wheel', e => {
  if (!state.draggedCube) return;
  e.preventDefault();
  const cube = state.draggedCube;
  const half = cube.size / 2;
  const step = e.deltaY < 0 ? 1.0 : -1.0;
  cube.mesh.position.y = THREE.MathUtils.clamp(cube.mesh.position.y + step, half, ARENA_HEIGHT - half);
  updateDropLine(cube.mesh.position);
  camera.getWorldDirection(_cameraDir);
  plane.setFromNormalAndCoplanarPoint(_cameraDir.negate(), cube.mesh.position);
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || presentationMode) return;
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(cubeMeshes());
  if (intersects.length === 0) return;

  const cube = intersects[0].object.userData;
  controls.enabled = false;
  state.draggedCube = cube;
  cube.dragging = true;
  cube.velocity.set(0, 0, 0);

  camera.getWorldDirection(_cameraDir);
  plane.setFromNormalAndCoplanarPoint(_cameraDir.negate(), cube.mesh.position);
  if (raycaster.ray.intersectPlane(plane, _intersectPoint)) {
    offset.copy(_intersectPoint).sub(cube.mesh.position);
  } else {
    offset.set(0, 0, 0);
  }

  cube.mesh.material.color.copy(DRAG_COLOR);
  hoverBoxHelper.setFromObject(cube.mesh);
  hoverBoxHelper.visible = true;
  updateDropLine(cube.mesh.position);
});

renderer.domElement.addEventListener('pointermove', e => {
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouse, camera);

  const cube = state.draggedCube;
  if (!cube) {
    // O realce de hover é aplicado em detectCollisions (que redefine as cores a cada frame)
    const intersects = raycaster.intersectObjects(cubeMeshes());
    const hit = intersects.length > 0 ? intersects[0].object.userData : null;
    state.hoveredCube = hit;
    if (hit) hoverBoxHelper.setFromObject(hit.mesh);
    hoverBoxHelper.visible = !!hit;
    document.body.style.cursor = hit ? 'pointer' : 'default';
    return;
  }

  if (!raycaster.ray.intersectPlane(plane, _intersectPoint)) return;
  const targetPos = _intersectPoint.sub(offset);
  const half = cube.size / 2;
  targetPos.x = THREE.MathUtils.clamp(targetPos.x, -ARENA_HALF_XZ + half, ARENA_HALF_XZ - half);
  targetPos.y = THREE.MathUtils.clamp(targetPos.y, half, ARENA_HEIGHT - half);
  targetPos.z = THREE.MathUtils.clamp(targetPos.z, -ARENA_HALF_XZ + half, ARENA_HALF_XZ - half);

  forceLineGeo.setFromPoints([cube.mesh.position, targetPos]);
  forceLineMesh.computeLineDistances();
  forceLineMesh.visible = true;

  cube.mesh.position.copy(targetPos);
  hoverBoxHelper.setFromObject(cube.mesh);
  hoverBoxHelper.visible = true;
  updateDropLine(targetPos);
});

const endDrag = () => {
  const cube = state.draggedCube;
  if (!cube) return;
  forceLineMesh.visible = false;
  hoverBoxHelper.visible = false;
  dropLineMesh.visible = false;
  cube.dragging = false;
  const s = state.simSpeed;
  cube.velocity.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  state.draggedCube = null;
  controls.enabled = !presentationMode;
};
// Na janela inteira: soltar o botão sobre um painel (fora do canvas) também encerra o arraste
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);

// ====================== ANIMAÇÃO ======================
const HISTORY_REFRESH_FRAMES = 30;
const TELEMETRY_REFRESH_FRAMES = 10; // barra de fases e placar da corrida: médias, não precisam de 60 Hz
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateSceneEffects(delta);
  updatePhysics(delta);
  detectCollisions();
  // pausado nada se move e o rastro só somaria brilho; na corrida as linhas mudam por coluna
  updatePairTrail(delta, !state.simPaused && !state.raceMode);
  // Grava a amostra do frame de cada estratégia que rodou (uma só, ou as três na corrida)
  const n = state.cubes.length;
  for (const mode of RACE_MODES) {
    const fs = frameStats[mode];
    if (!fs.ran) continue;
    perf[mode].record(n, fs.timeMs);
    phase[mode].record(fs.buildMs, fs.queryMs);
  }

  impactParticles.update(delta);

  if (lightTimer.value > 0) {
    lightTimer.value -= delta;
    if (lightTimer.value <= 0) {
      impactLight.intensity = 0;
    }
  }

  updateDebris(delta);

  if (presentationMode) {
    presentOrbitAngle += 0.003;
    const orbitRadius = state.raceMode ? Math.max(presentOrbitRadius, raceFitDistance()) : presentOrbitRadius;
    camera.position.x = Math.sin(presentOrbitAngle) * orbitRadius;
    camera.position.z = Math.cos(presentOrbitAngle) * orbitRadius;
    camera.position.y = presentOrbitY + Math.sin(presentOrbitAngle * 0.4) * 5;
    camera.lookAt(0, 3, 0);
    updatePresentHud();
  }
  controls.update();
  if (state.raceMode) {
    renderColumns(i => prepareRaceView(RACE_MODES[i]), glowHooks);
    finishRaceViews();
  } else {
    renderView(glowHooks);
  }
  drawChart();
  updateUI();
  if (frameCount % TELEMETRY_REFRESH_FRAMES === 0) {
    updatePhaseUI();
    if (state.raceMode) updateRaceHud();
  }
  if (++frameCount % HISTORY_REFRESH_FRAMES === 0) addOrUpdateHistoryEntry();
}

// ====================== ESTADO INICIAL VIA URL ======================
// Permite abrir um cenário pronto para aula ou captura, por exemplo:
//   /simulador?modo=grid&n=150&paineis=1
//   /simulador?modo=octree&n=60&apresentacao=1
//   /simulador?corrida=1&n=80
// Parâmetros: modo (brute|grid|octree), n (2-150), paineis=1|0, fisica=1, wireframe=1,
// corrida=1, apresentacao=1, brilho=0, rastro=0, raiox=1
function applyUrlState() {
  const params = new URLSearchParams(window.location.search);

  const mode = params.get('modo');
  const select = document.getElementById('broadPhaseSelect');
  if (mode && MODE_THEMES[mode] && mode !== state.currentBroadPhase) {
    select.value = mode;
    select.dispatchEvent(new Event('change'));
  }

  if (params.has('n')) {
    const n = Math.round(clampNumber(params.get('n'), LIMITS.cubes.min, LIMITS.cubes.max, 8));
    if (n > 20) setStressMode(true);
    setCubeCount(n);
  }

  if (params.get('paineis') === '1') {
    controlPanel.classList.contains('panel-hidden') && minimizeBtn.click();
    chartPanel.classList.contains('chart-hidden') && toggleChartBtn.click();
  }
  if (params.get('paineis') === '0') {
    controlPanel.classList.add('panel-hidden');
    chartPanel.classList.add('chart-hidden');
    syncPanelButtons();
  }
  if (params.get('fisica') === '1') document.getElementById('physicsBtn').click();
  if (params.get('wireframe') === '1') toggleWireframeMode();
  if (params.get('brilho') === '0') {
    document.getElementById('bloomToggle').checked = false;
    setBloomEnabled(false);
  }
  if (params.get('rastro') === '0') setTrailEnabled(false);
  if (params.get('raiox') === '1') setXray(true); // fica ligado até apertar e soltar X
  if (params.get('corrida') === '1') enterRace();
  if (params.get('apresentacao') === '1') enterPresentation();
}

// Arranque da aplicação quando o módulo é carregado
startApp();
applyUrlState();
