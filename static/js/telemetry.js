// --- telemetry.js — Médias de tempo, custo por fase e gráfico assintótico ---
import { state, RACE_MODES } from './physics.js';
import { STRATEGIES, strategyOf } from './strategies.js';
import { setText, fmtLiveMs } from './dom.js';

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

// ====================== GRÁFICO ASSINTÓTICO ======================
// O eixo de N vai muito além da cena (até AXIS_N cubos, com "N → ∞" na ponta) para
// mostrar para onde cada complexidade cresce, não só o trecho que o simulador alcança.
// O eixo y é escalado pelas estratégias mais baratas: a força bruta, quadrática, sai
// pelo topo, que é justamente o que acontece com ela quando N cresce.
//
// Antes do benchmark: curvas ilustrativas (forma e uma constante plausível de cada
// estratégia, sem unidade). Depois: tempos medidos como pontos e a forma teórica de
// cada estratégia ancorada no último ponto medido e extrapolada até AXIS_N.
const chartCanvas = document.getElementById('perfChart');
const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;
const chartNote = document.getElementById('chartNote');

const AXIS_N = 1000;      // ponta do eixo de N
const Y_HEADROOM = 1.8;   // o topo fica em 1,8x a curva mais alta, fora a força bruta
const CURVE_STEPS = 80;

// Forma de cada complexidade em função de n (a escala vem do ponto medido)
const THEORY_SHAPE = {
  brute: n => n * n,
  grid: n => n,
  octree: n => n * Math.log(n),
  sap: n => n,
};

// Curvas ilustrativas: custo fixo de montar a estrutura + constante x forma. Com N
// pequeno o custo fixo pesa e a força bruta ganha; as curvas se cruzam cedo.
const ILLUSTRATIVE = {
  brute: n => n * n,
  grid: n => 2000 + 60 * n,
  octree: n => 1500 + 12 * n * Math.log(Math.max(n, 1)),
  sap: n => 800 + 35 * n,
};

let measured = null; // { series, sizes, params } do último benchmark

export function setMeasuredCurves({ series, sizes }) {
  measured = { series, sizes, params: `célula ${state.cellSize}, profundidade ${state.octreeDepth}` };
  if (chartNote) {
    const nMax = sizes[sizes.length - 1];
    chartNote.textContent = `Pontos: tempos medidos no último benchmark, até n = ${nMax} (${measured.params}). ` +
      `Tracejado: forma teórica ancorada em n = ${nMax} e extrapolada até ${AXIS_N.toLocaleString('pt-BR')}.`;
  }
}

function fmtAxisMs(ms) {
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  if (ms >= 0.01) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(3)} ms`;
}

export function drawChart() {
  if (!chartCtx) return;
  const ctx = chartCtx;
  const w = chartCanvas.width;
  const h = chartCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const padX = 40;
  const padY = 38;
  const chartW = w - padX - 10;
  const chartH = h - padY - 10;
  const baseY = h - padY;
  const xOf = n => padX + (n / AXIS_N) * chartW;

  // Curvas: f(n) em unidades de y; o topo é 1,8x o maior valor em AXIS_N fora a força bruta
  const curves = {};
  const dots = {};
  if (measured) {
    const { series, sizes } = measured;
    const nMax = sizes[sizes.length - 1];
    for (const st of STRATEGIES) {
      const pts = series[st.key];
      const last = pts[pts.length - 1];
      dots[st.key] = pts;
      if (last && last.t > 0) {
        const c = last.t / THEORY_SHAPE[st.key](nMax);
        curves[st.key] = n => c * THEORY_SHAPE[st.key](n);
      }
    }
  } else {
    Object.assign(curves, ILLUSTRATIVE);
  }
  const atEnd = STRATEGIES.filter(st => st.key !== 'brute' && curves[st.key]).map(st => curves[st.key](AXIS_N));
  const yMax = (atEnd.length ? Math.max(...atEnd) : 1) * Y_HEADROOM || 1;
  const yOf = v => baseY - (v / yMax) * chartH;

  // Eixos
  ctx.save();
  ctx.setLineDash([4, 2]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, baseY); ctx.lineTo(w - 10, baseY);
  ctx.moveTo(padX, 10);    ctx.lineTo(padX, baseY);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N cubos', padX + chartW / 2, h - 5);
  ctx.save();
  ctx.translate(12, 10 + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(measured ? 'Tempo (ms)' : 'Tempo', 0, 0);
  ctx.restore();

  // Marcas do eixo de N: 0, o limite do simulador e a ponta "N → ∞"
  const limitN = measured ? measured.sizes[measured.sizes.length - 1] : 150;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'left';
  ctx.fillText('0', padX - 2, baseY + 12);
  ctx.textAlign = 'center';
  ctx.fillText(String(limitN), xOf(limitN), baseY + 12);
  ctx.textAlign = 'right';
  ctx.fillText('N → ∞', w - 10, baseY + 12);
  if (measured) {
    ctx.textAlign = 'left';
    ctx.fillText(fmtAxisMs(yMax), padX + 4, 16);
  }

  // Recorta tudo à área do gráfico para nada vazar sobre eixos e rótulos
  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, 6, w - padX - 6, h - padY - 6 + 4);
  ctx.clip();

  // Faixa que o simulador alcança (até 150 cubos)
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fillRect(padX, 10, xOf(limitN) - padX, baseY - 10);

  // Curvas tracejadas, de 1 até AXIS_N
  for (const st of STRATEGIES) {
    const f = curves[st.key];
    if (!f) continue;
    ctx.save();
    ctx.setLineDash([4, 2]);
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let s = 0; s <= CURVE_STEPS; s++) {
      const n = Math.max(1, (s / CURVE_STEPS) * AXIS_N);
      const y = Math.max(yOf(f(n)), -10); // acima do topo só precisa sair da área
      if (s === 0) ctx.moveTo(xOf(n), y); else ctx.lineTo(xOf(n), y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Pontos medidos
  for (const st of STRATEGIES) {
    ctx.fillStyle = st.color;
    for (const p of dots[st.key] ?? []) ctx.fillRect(xOf(p.n) - 1.5, yOf(p.t) - 1.5, 3, 3);
  }

  // N atual
  const N = Math.max(state.cubes.length, 2);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xOf(N), baseY);
  ctx.lineTo(xOf(N), 10);
  ctx.stroke();
  ctx.restore(); // fim do recorte da área do gráfico
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
