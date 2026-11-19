// --- telemetry.js — Médias de tempo, custo por fase e gráfico de crescimento ---
import { state, RACE_MODES } from './physics.js';
import { STRATEGIES, strategyOf } from './strategies.js';
import { setText, fmtLiveMs, fmtTime } from './dom.js';
import { measureTotal, createStructures } from './broadphase.js';

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
// Se todos os frames leram 0 (cena pequena, relógio grosso), o tempo é medido à parte:
// a detecção roda em lote até somar 1 ms (measureTotal), no máximo a cada 500 ms.
// Isso só acontece com cenas de microssegundos, então custa no máximo ~1 ms por vez.
const BATCH_EVERY_MS = 500;
let batchCache = { key: '', at: -Infinity, ms: 0 };

function batchedTime() {
  const mode = state.currentBroadPhase;
  const key = `${mode}:${state.cubes.length}:${state.cellSize}:${state.octreeDepth}`;
  const now = performance.now();
  if (batchCache.key !== key || now - batchCache.at > BATCH_EVERY_MS) {
    // estruturas próprias, com os parâmetros da cena, para não mexer nas da simulação
    const structures = createStructures({ cellSize: state.cellSize, octreeDepth: state.octreeDepth });
    batchCache = { key, at: now, ms: measureTotal(mode, state.cubes, structures, 1, 5) };
  }
  return batchCache.ms;
}

export function currentTimeReadout() {
  const store = perf[state.currentBroadPhase];
  const arr = store?.samples.get(state.cubes.length);
  if (!arr || arr.length === 0) return '—';
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return fmtTime(mean > 0 ? mean : batchedTime());
}

// ====================== GRÁFICO DE CRESCIMENTO ======================
// Gráfico teórico das curvas assintóticas de cada estratégia: n² (força bruta),
// n log n (Octree), n + k (Sweep and Prune, com k = 2n pares sobrepostos no eixo) e
// n (grade). Sem números nos eixos: o que importa é a forma quando n → ∞, então os
// eixos e as curvas terminam em seta, indicando que continuam crescendo.
// SVG com viewBox e width 100%; é estático, então é desenhado uma vez só.
const chartSvg = document.getElementById('perfChart');
const chartPanelEl = document.getElementById('chartPanel');
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOR = Object.fromEntries(STRATEGIES.map(st => [st.key, st.color]));

const N_MAX = 100;     // escala interna do desenho (não aparece no gráfico)
const Y_MAX = 1000;
const CURVES = [
  { mode: 'brute', label: 'n²', f: n => n * n },
  { mode: 'octree', label: 'n log n', f: n => (n > 1 ? n * Math.log2(n) : 0) },
  { mode: 'sap', label: 'n + k', f: n => n + 2 * n },
  { mode: 'grid', label: 'n', f: n => n },
];

let drawn = false;

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Ponta de seta em (x, y) apontando na direção (dx, dy)
function arrowHead(x, y, dx, dy, color, size = 6) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = x - ux * size, by = y - uy * size;
  const px = -uy * size * 0.5, py = ux * size * 0.5;
  return el('path', { d: `M${x},${y} L${bx + px},${by + py} L${bx - px},${by - py} Z`, fill: color });
}

function drawGrowth() {
  const W = 300, H = 200, ml = 22, mr = 62, mt = 14, mb = 22;
  const X = n => ml + (n / N_MAX) * (W - ml - mr);
  const Y = v => mt + (1 - v / Y_MAX) * (H - mt - mb);
  chartSvg.replaceChildren();

  // eixos com seta: n → ∞ e operações → ∞
  const axis = 'rgba(255,255,255,0.45)';
  const x0 = ml, y0 = H - mb, xEnd = W - mr + 30, yEnd = mt - 8;
  chartSvg.append(el('line', { x1: x0, y1: y0, x2: xEnd, y2: y0, stroke: axis, 'stroke-width': 1 }));
  chartSvg.append(arrowHead(xEnd + 1, y0, 1, 0, axis));
  chartSvg.append(el('line', { x1: x0, y1: y0, x2: x0, y2: yEnd, stroke: axis, 'stroke-width': 1 }));
  chartSvg.append(arrowHead(x0, yEnd - 1, 0, -1, axis));
  chartSvg.append(el('text', { x: xEnd, y: y0 + 15, 'text-anchor': 'end', class: 'ac-label' }, 'n → ∞'));
  chartSvg.append(el('text', { x: x0 - 4, y: y0 + 4, 'text-anchor': 'end', class: 'ac-label' }, '0'));
  const cy = (mt + y0) / 2;
  chartSvg.append(el('text', { x: 10, y: cy, transform: `rotate(-90 10 ${cy})`, 'text-anchor': 'middle', class: 'ac-label' }, 'operações'));

  for (const c of CURVES) {
    // até a borda direita, ou até onde a curva sai pelo topo
    let nEnd = N_MAX;
    if (c.f(N_MAX) > Y_MAX) {
      let lo = 0, hi = N_MAX;
      for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (c.f(mid) < Y_MAX) lo = mid; else hi = mid; }
      nEnd = lo;
    }
    const pts = [];
    for (let s = 0; s <= 200; s++) {
      const n = (nEnd * s) / 200;
      pts.push([X(n), Y(c.f(n))]);
    }
    const color = COLOR[c.mode];
    chartSvg.append(el('polyline', {
      points: pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '), stroke: color, class: 'ac-curve',
    }));
    const [xa, ya] = pts[pts.length - 4], [xb, yb] = pts[pts.length - 1];
    chartSvg.append(arrowHead(xb + (xb - xa) * 0.4, yb + (yb - ya) * 0.4, xb - xa, yb - ya, color, 7));
    const top = nEnd < N_MAX;
    chartSvg.append(el('text', {
      x: xb + (top ? 7 : 9), y: top ? yb + 8 : yb + 4, fill: color, class: 'ac-name',
    }, c.label));
  }
}

export function drawChart() {
  if (drawn || !chartSvg || chartPanelEl?.classList.contains('chart-hidden')) return;
  drawn = true;
  drawGrowth();
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
