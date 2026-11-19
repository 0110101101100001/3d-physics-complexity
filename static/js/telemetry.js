// --- telemetry.js — Médias de tempo, custo por fase e gráfico assintótico ---
import { state, RACE_MODES } from './physics.js';
import { STRATEGIES, strategyOf } from './strategies.js';
import { setText, fmtLiveMs } from './dom.js';
import { THEORY, theoryCrossings, N_MIN, N_MAX } from './asymptotic.js';

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

export const perf = Object.fromEntries(RACE_MODES.map(mode => [mode, new PerfStore()]));
export const phase = Object.fromEntries(RACE_MODES.map(mode => [mode, new PhaseStore()]));

export function resetPhases() {
  RACE_MODES.forEach(mode => phase[mode].reset());
}

export function currentAverageTime() {
  const store = perf[state.currentBroadPhase];
  return store ? store.average(state.cubes.length) : 0;
}

// ====================== TEMPO MÉDIO (leitura do painel) ======================
// Cada frame mede a detecção com performance.now(). Abaixo da resolução do relógio
// muitos frames leem 0; a média simples de 60 frames soma esses degraus e recupera o
// valor médio (a média aparada descartaria justamente os poucos frames não nulos).
// Se todos os frames leram 0, só dá para dizer que o tempo ficou abaixo da resolução.
const CLOCK_RES = (() => {
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    let t1 = t0;
    while (t1 === t0) t1 = performance.now();
    best = Math.min(best, t1 - t0);
  }
  return best;
})();

function fmtDuration(ms) {
  if (ms < 1) {
    const us = ms * 1000;
    return `${us.toFixed(us < 10 ? 2 : 1).replace('.', ',')} µs`;
  }
  return `${ms.toFixed(2).replace('.', ',')} ms`;
}

export function currentTimeReadout() {
  const store = perf[state.currentBroadPhase];
  const arr = store?.samples.get(state.cubes.length);
  if (!arr || arr.length === 0) return '—';
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return mean > 0 ? fmtDuration(mean) : `< ${fmtDuration(CLOCK_RES)}`;
}

// ====================== GRÁFICO ASSINTÓTICO ======================
// Log-log de verdade: x = log10(n), de 10 a 10⁷; y = log10(operações), com operações =
// testes de par + inserções, a grandeza que os teoremas da "Prova de complexidade"
// limitam. Tracejado: as fórmulas dos teoremas com as constantes de asymptotic.js.
// Marcadores: contagens feitas no worker, nas mesmas estruturas da simulação.
// Abaixo, T(n)/n com x em log10(n) e y linear: Θ(n) vira reta horizontal e
// Θ(n log n), reta inclinada. Os dois gráficos são SVG com viewBox e width 100%.
const mainSvg = document.getElementById('perfChart');
const ratioSvg = document.getElementById('perfRatioChart');
const chartNote = document.getElementById('chartNote');
const chartKeyMeasured = document.getElementById('chartKeyMeasured');
const crossingsBody = document.getElementById('chartCrossings');
const chartPanelEl = document.getElementById('chartPanel');

const COLOR = Object.fromEntries(STRATEGIES.map(st => [st.key, st.color]));
const NAME = {
  brute: 'força bruta n(n−1)/2', grid: 'grade c_g·n', octree: 'octree c_o·n·log₈ n',
  octreeD: 'octree c_o·n·D', sap: 'SAP n·log₂ n + k', sapH2: 'SAP n + k (H2)',
};
const CROSSINGS = theoryCrossings();
const RATIO_MAX = 80;     // topo do gráfico T(n)/n
const SVG_NS = 'http://www.w3.org/2000/svg';

let measured = null;
let measuring = false;
let lastN = -1;

const lx = Math.log10;

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const pow10Label = e => '10' + String(e).split('').map(ch => SUP[ch]).join('');

// Geometria comum: viewBox, margens e o eixo x em log10(n)
function frame(H, mb = 30) {
  const W = 300, ml = 40, mr = 8, mt = 8;
  const X = n => ml + ((lx(n) - lx(N_MIN)) / (lx(N_MAX) - lx(N_MIN))) * (W - ml - mr);
  return { W, H, ml, mr, mt, mb, X, x0: ml, x1: W - mr, y0: mt, y1: H - mb };
}

// Grade vertical e marcas do eixo x em 10, 10², …, 10⁷
function xAxis(g, f) {
  for (let e = lx(N_MIN); e <= lx(N_MAX); e++) {
    g.append(el('line', { x1: f.X(10 ** e), x2: f.X(10 ** e), y1: f.y0, y2: f.y1, class: 'ac-grid' }));
    g.append(el('text', { x: f.X(10 ** e), y: f.y1 + 11, 'text-anchor': 'middle', class: 'ac-tick' }, pow10Label(e)));
  }
  g.append(el('text', { x: (f.x0 + f.x1) / 2, y: f.H - 4, 'text-anchor': 'middle', class: 'ac-label' }, 'n (cubos), escala log'));
}

function yLabel(g, f, text) {
  const cy = (f.y0 + f.y1) / 2;
  g.append(el('text', { x: 9, y: cy, transform: `rotate(-90 9 ${cy})`, 'text-anchor': 'middle', class: 'ac-label' }, text));
}

function clipArea(svg, f, id) {
  const clip = el('clipPath', { id });
  clip.append(el('rect', { x: f.x0, y: f.y0, width: f.x1 - f.x0, height: f.y1 - f.y0 }));
  const defs = el('defs');
  defs.append(clip);
  svg.append(defs);
  return el('g', { 'clip-path': `url(#${id})` });
}

// Curva teórica amostrada em log n
function curvePath(f, Y, theory, map = v => v) {
  const steps = 160;
  const pts = [];
  for (let s = 0; s <= steps; s++) {
    const n = 10 ** (lx(N_MIN) + ((lx(N_MAX) - lx(N_MIN)) * s) / steps);
    pts.push(`${f.X(n).toFixed(2)},${Y(map(theory.f(n), n)).toFixed(2)}`);
  }
  return el('polyline', {
    points: pts.join(' '), stroke: COLOR[theory.mode], class: theory.light ? 'ac-theory ac-theory--light' : 'ac-theory',
  });
}

// Marcador: cheio = medido; vazado = SAP medido no frame seguinte, sob H2
function marker(x, y, color, hollow) {
  return el('circle', {
    cx: x.toFixed(2), cy: y.toFixed(2), r: 2.8,
    fill: hollow ? 'none' : color, stroke: hollow ? color : 'var(--well)', 'stroke-width': hollow ? 1.3 : 0.8,
  });
}

function seriesList() {
  if (!measured) return [];
  return [
    { mode: 'brute', pts: measured.brute },
    { mode: 'grid', pts: measured.grid },
    { mode: 'octree', pts: measured.octree },
    { mode: 'sap', pts: measured.sap },
    { mode: 'sap', hollow: true, pts: measured.sapH2 },
  ];
}

function drawMain() {
  const f = frame(270);
  const yLo = 1, yHi = 14;   // 10¹ a 10¹⁴ operações
  const Y = v => f.y0 + (1 - (lx(Math.max(v, 1e-9)) - yLo) / (yHi - yLo)) * (f.y1 - f.y0);
  mainSvg.replaceChildren();
  const axes = el('g');
  xAxis(axes, f);
  for (let e = yLo; e <= yHi; e++) {
    axes.append(el('line', { x1: f.x0, x2: f.x1, y1: Y(10 ** e), y2: Y(10 ** e), class: 'ac-grid' }));
    axes.append(el('text', { x: f.x0 - 3, y: Y(10 ** e) + 3, 'text-anchor': 'end', class: 'ac-tick' }, pow10Label(e)));
  }
  yLabel(axes, f, 'Operações (testes de par + inserções)');
  mainSvg.append(axes);

  const plot = clipArea(mainSvg, f, 'acMainClip');
  // N atual da cena
  const N = state.cubes.length;
  if (N >= N_MIN) plot.append(el('line', { x1: f.X(N), x2: f.X(N), y1: f.y0, y2: f.y1, class: 'ac-now' }));

  // triângulos de inclinação 1 e 2 no canto inferior direito (uma década na horizontal)
  const slope = (n0, v0, k) => {
    const xa = f.X(n0), xb = f.X(n0 * 10), ya = Y(v0), yb = Y(v0 * 10 ** k);
    plot.append(el('path', { d: `M${xa},${ya} L${xb},${ya} L${xb},${yb} Z`, class: 'ac-slope' }));
    plot.append(el('text', { x: xb - 3, y: (ya + yb) / 2 + 3, 'text-anchor': 'end', class: 'ac-tick' }, String(k)));
  };
  slope(10 ** 4.7, 10 ** 1.5, 1);
  slope(10 ** 5.95, 10 ** 1.5, 2);

  for (const t of THEORY) plot.append(curvePath(f, Y, t));
  for (const s of seriesList()) for (const p of s.pts) plot.append(marker(f.X(p.n), Y(p.ops), COLOR[s.mode], s.hollow));
  CROSSINGS.forEach((c, i) => {
    plot.append(el('circle', { cx: f.X(c.n), cy: Y(c.y), r: 2.4, class: 'ac-cross' }));
    plot.append(el('text', { x: f.X(c.n) + 3, y: Y(c.y) - 3, class: 'ac-cross-label' }, String(i + 1)));
  });
  mainSvg.append(plot);
}

function drawRatio() {
  const f = frame(180);
  const Y = r => f.y0 + (1 - r / RATIO_MAX) * (f.y1 - f.y0);
  ratioSvg.replaceChildren();
  const axes = el('g');
  xAxis(axes, f);
  for (let r = 0; r <= RATIO_MAX; r += 20) {
    axes.append(el('line', { x1: f.x0, x2: f.x1, y1: Y(r), y2: Y(r), class: 'ac-grid' }));
    axes.append(el('text', { x: f.x0 - 3, y: Y(r) + 3, 'text-anchor': 'end', class: 'ac-tick' }, String(r)));
  }
  yLabel(axes, f, 'T(n)/n');
  ratioSvg.append(axes);

  const plot = clipArea(ratioSvg, f, 'acRatioClip');
  for (const t of THEORY) plot.append(curvePath(f, Y, t, (v, n) => Math.min(v / n, RATIO_MAX * 1.05)));
  ratioSvg.append(plot);

  // Seta para cima onde uma curva ou um ponto sai pelo topo
  const arrow = (x, color) => ratioSvg.append(el('path', {
    d: `M${x},${f.y0 - 5} l-3.5,6 h7 Z`, fill: color,
  }));
  const bruteTop = THEORY.find(t => t.id === 'brute');
  let lo = N_MIN, hi = N_MAX;   // bisseção: (n−1)/2 = RATIO_MAX
  for (let it = 0; it < 60; it++) {
    const mid = Math.sqrt(lo * hi);
    if (bruteTop.f(mid) / mid < RATIO_MAX) lo = mid; else hi = mid;
  }
  arrow(f.X(lo), COLOR.brute);
  ratioSvg.append(el('text', { x: f.X(lo) + 6, y: f.y0 + 9, class: 'ac-tick' }, 'n² sai pelo topo'));

  for (const s of seriesList()) {
    for (const p of s.pts) {
      const r = p.ops / p.n;
      if (r > RATIO_MAX) arrow(f.X(p.n), COLOR[s.mode]);
      else ratioSvg.append(marker(f.X(p.n), Y(r), COLOR[s.mode], s.hollow));
    }
  }
}

function fmtN(n) {
  if (n < 1000) return n.toFixed(n < 100 ? 1 : 0).replace('.', ',');
  const e = Math.floor(lx(n));
  return `${(n / 10 ** e).toFixed(2).replace('.', ',')}·${pow10Label(e)}`;
}

function renderCrossings() {
  if (!crossingsBody) return;
  crossingsBody.replaceChildren(...CROSSINGS.map((c, i) => {
    const tr = document.createElement('tr');
    for (const text of [String(i + 1), `${NAME[c.a]} × ${NAME[c.b]}`, fmtN(c.n)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
}

function measure() {
  if (measuring || measured) return;
  measuring = true;
  const worker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'asymptotic-progress') {
      if (chartNote) chartNote.textContent = `Contando operações: n = ${data.n.toLocaleString('pt-BR')}…`;
    } else if (data.type === 'asymptotic-done') {
      measured = data.ok;
      if (chartKeyMeasured) chartKeyMeasured.hidden = false;
      if (chartNote) chartNote.textContent = 'Contagens em cenas que respeitam as hipóteses de cada teorema, de n = 10 a 10⁵ (força bruta até 10⁴).';
      lastN = -1;
      worker.terminate();
    }
  };
  worker.onerror = e => {
    measuring = false;
    if (chartNote) chartNote.textContent = 'As medições falharam; veja o console.';
    console.error(e.message);
  };
  worker.postMessage({ type: 'asymptotic' });
}

renderCrossings();

export function drawChart() {
  if (!mainSvg || chartPanelEl?.classList.contains('chart-hidden')) return;
  measure();
  const N = state.cubes.length;
  if (N === lastN) return;
  lastN = N;
  drawMain();
  drawRatio();
}

// ====================== CUSTO POR FASE (trilho de telemetria) ======================
const phaseBarEl = document.getElementById('phaseBar');
const phaseBuildFill = document.getElementById('phaseBuildFill');
const phaseBuildMs = document.getElementById('phaseBuildMs');
const phaseBuildPct = document.getElementById('phaseBuildPct');
const phaseQueryMs = document.getElementById('phaseQueryMs');
const phaseQueryPct = document.getElementById('phaseQueryPct');
const phaseNote = document.getElementById('phaseNote');

export function updatePhaseUI() {
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
  setText(phaseNote, strategyOf(state.currentBroadPhase).phaseNote);
}
