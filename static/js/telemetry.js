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

// ====================== GRÁFICO ASSINTÓTICO ======================
// Log-log de N = 10 a 10⁷ contra o número de operações (testes de par + inserções), a
// grandeza que os teoremas da "Prova de complexidade" limitam. Tracejado: as fórmulas
// dos teoremas com as constantes declaradas em asymptotic.js. Marcadores: contagens
// feitas no worker, nas mesmas estruturas da simulação. Abaixo, T(n)/n com n em escala
// log e eixo y linear: Θ(n) vira reta horizontal e Θ(n log n), reta inclinada.
const chartCanvas = document.getElementById('perfChart');
const ratioCanvas = document.getElementById('perfRatioChart');
const chartNote = document.getElementById('chartNote');
const crossingsList = document.getElementById('chartCrossings');
const violateToggle = document.getElementById('chartViolate');
const chartPanelEl = document.getElementById('chartPanel');

const COLOR = Object.fromEntries(STRATEGIES.map(st => [st.key, st.color]));
const NAME = {
  brute: 'força bruta', grid: 'grade', octree: 'octree n log n', octreeD: 'octree n·D',
  sap: 'SAP n log n + k', sapH2: 'SAP n + k (H2)',
};
const CROSSINGS = theoryCrossings();
const SCALE = 2;          // resolução interna 2x da área em CSS
const FONT = '9px "IBM Plex Mono", monospace';
const INK = 'rgba(255,255,255,0.55)';
const RATIO_MAX = 70;     // topo do gráfico T(n)/n

let measuredOk = null;
let measuredBad = null;
let measuring = false;
let dirty = true;
let lastN = -1;

function lx(n) { return Math.log10(n); }

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width / SCALE, h = canvas.height / SCALE;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h };
}

function pow10Label(e) {
  const sup = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return '10' + String(e).split('').map(ch => sup[ch]).join('');
}

// Curva tracejada amostrada em log n, recortada à área do gráfico
function strokeCurve(ctx, f, X, Y, theory) {
  ctx.save();
  ctx.strokeStyle = COLOR[theory.mode];
  ctx.globalAlpha = theory.light ? 0.5 : 1;
  ctx.setLineDash(theory.light ? [2, 3] : [5, 3]);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const steps = 120;
  for (let s = 0; s <= steps; s++) {
    const n = 10 ** (lx(N_MIN) + ((lx(N_MAX) - lx(N_MIN)) * s) / steps);
    const x = X(n), y = Y(f(n), n);
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Marcador: cheio = medido; vazado = medido no frame seguinte, sob H2
function marker(ctx, x, y, color, hollow) {
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, Math.PI * 2);
  if (hollow) { ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke(); }
  else { ctx.fillStyle = color; ctx.fill(); }
}

// Séries de marcadores do regime ativo: [{ mode, hollow, pts: [{n, ops}] }]
function activeSeries() {
  const data = violateToggle?.checked ? measuredBad : measuredOk;
  if (!data) return [];
  return [
    { mode: 'brute', pts: data.brute },
    { mode: 'grid', pts: data.grid },
    { mode: 'octree', pts: data.octree },
    { mode: 'sap', pts: data.sap },
    { mode: 'sap', hollow: true, pts: data.sapH2 ?? [] },
  ];
}

function drawMain() {
  const { ctx, w, h } = setupCanvas(chartCanvas);
  const ml = 40, mr = 6, mt = 8, mb = 22;
  const yLo = 1, yHi = 14;   // 10¹ a 10¹⁴ operações
  const X = n => ml + ((lx(n) - lx(N_MIN)) / (lx(N_MAX) - lx(N_MIN))) * (w - ml - mr);
  const Y = v => mt + (1 - (Math.log10(Math.max(v, 1e-9)) - yLo) / (yHi - yLo)) * (h - mt - mb);

  // grade e marcas: x em toda potência de 10, y a cada duas
  ctx.fillStyle = INK;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let e = 1; e <= 7; e++) {
    ctx.beginPath(); ctx.moveTo(X(10 ** e), mt); ctx.lineTo(X(10 ** e), h - mb); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(pow10Label(e), X(10 ** e), h - mb + 11);
  }
  for (let e = yLo; e <= yHi; e++) {
    ctx.beginPath(); ctx.moveTo(ml, Y(10 ** e)); ctx.lineTo(w - mr, Y(10 ** e)); ctx.stroke();
    if (e % 2 === 0) { ctx.textAlign = 'right'; ctx.fillText(pow10Label(e), ml - 4, Y(10 ** e) + 3); }
  }
  ctx.textAlign = 'center';
  ctx.fillText('N cubos', ml + (w - ml - mr) / 2, h - 2);
  ctx.save();
  ctx.translate(7, mt + (h - mt - mb) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('operações', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(ml, mt, w - ml - mr, h - mt - mb);
  ctx.clip();

  // N atual da cena
  const N = Math.max(state.cubes.length, 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(X(N), mt); ctx.lineTo(X(N), h - mb); ctx.stroke();
  ctx.setLineDash([]);

  // triângulos de inclinação 1 e 2 (uma década na horizontal)
  const slope = (n0, v0, k) => {
    const x0 = X(n0), x1 = X(n0 * 10), y0 = Y(v0), y1 = Y(v0 * 10 ** k);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(String(k), x1 + 3, (y0 + y1) / 2 + 3);
  };
  slope(10 ** 4.3, 10 ** 1.4, 1);
  slope(10 ** 5.6, 10 ** 1.4, 2);

  for (const t of THEORY) strokeCurve(ctx, t.f, X, v => Y(v), t);
  for (const s of activeSeries()) {
    for (const p of s.pts) marker(ctx, X(p.n), Y(p.ops), COLOR[s.mode], s.hollow);
  }
  // cruzamentos numerados
  CROSSINGS.forEach((c, i) => {
    const x = X(c.n), y = Y(c.y);
    ctx.fillStyle = '#e4e4e7';
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), x + 3, y - 3);
  });
  ctx.restore();
}

function drawRatio() {
  if (!ratioCanvas) return;
  const { ctx, w, h } = setupCanvas(ratioCanvas);
  const ml = 40, mr = 6, mt = 8, mb = 22;
  const X = n => ml + ((lx(n) - lx(N_MIN)) / (lx(N_MAX) - lx(N_MIN))) * (w - ml - mr);
  const Y = r => mt + (1 - Math.min(r, RATIO_MAX * 1.2) / RATIO_MAX) * (h - mt - mb);

  ctx.fillStyle = INK;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let e = 1; e <= 7; e++) {
    ctx.beginPath(); ctx.moveTo(X(10 ** e), mt); ctx.lineTo(X(10 ** e), h - mb); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(pow10Label(e), X(10 ** e), h - mb + 11);
  }
  for (let r = 0; r <= RATIO_MAX; r += 20) {
    ctx.beginPath(); ctx.moveTo(ml, Y(r)); ctx.lineTo(w - mr, Y(r)); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(r), ml - 4, Y(r) + 3);
  }
  ctx.textAlign = 'center';
  ctx.fillText('N cubos', ml + (w - ml - mr) / 2, h - 2);
  ctx.save();
  ctx.translate(7, mt + (h - mt - mb) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('T(n)/n', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(ml, mt, w - ml - mr, h - mt - mb);
  ctx.clip();
  for (const t of THEORY) strokeCurve(ctx, t.f, X, (v, n) => Y(v / n), t);
  for (const s of activeSeries()) {
    for (const p of s.pts) {
      const r = p.ops / p.n;
      if (r > RATIO_MAX) {
        // acima do topo: seta para cima na borda
        const x = X(p.n);
        ctx.fillStyle = COLOR[s.mode];
        ctx.beginPath(); ctx.moveTo(x, mt + 1); ctx.lineTo(x - 3, mt + 6); ctx.lineTo(x + 3, mt + 6); ctx.fill();
      } else {
        marker(ctx, X(p.n), Y(r), COLOR[s.mode], s.hollow);
      }
    }
  }
  ctx.restore();
}

function fmtN(n) {
  if (n < 1000) return n.toFixed(n < 100 ? 1 : 0).replace('.', ',');
  const e = Math.floor(Math.log10(n));
  return `${(n / 10 ** e).toFixed(1).replace('.', ',')}·${pow10Label(e)}`;
}

function renderCrossings() {
  if (!crossingsList) return;
  crossingsList.replaceChildren(...CROSSINGS.map(c => {
    const li = document.createElement('li');
    li.textContent = `${NAME[c.a]} × ${NAME[c.b]}: n ≈ ${fmtN(c.n)}`;
    return li;
  }));
}

function measure() {
  if (measuring || measuredOk) return;
  measuring = true;
  const worker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'asymptotic-progress') {
      if (chartNote) chartNote.textContent = `Medindo ${data.violate ? 'os contraexemplos' : 'as cenas'}: n = ${data.n.toLocaleString('pt-BR')}…`;
    } else if (data.type === 'asymptotic-done') {
      measuredOk = data.ok;
      measuredBad = data.violate;
      updateNote();
      dirty = true;
      worker.terminate();
    }
  };
  worker.onerror = e => {
    if (chartNote) chartNote.textContent = 'As medições falharam; veja o console.';
    console.error(e.message);
  };
  worker.postMessage({ type: 'asymptotic' });
}

function updateNote() {
  if (!chartNote || !measuredOk) return;
  chartNote.textContent = violateToggle?.checked
    ? 'Contraexemplos: todos numa célula (grade), agrupados num ponto com D = 6 (octree), todos com o mesmo x (SAP). As medições sobem para a curva n(n−1)/2.'
    : 'Cenas que respeitam as hipóteses de cada teorema, de n = 10 a 10⁵ (força bruta até 10⁴). O círculo vazado é o Sweep and Prune no frame seguinte, sob H2.';
}

violateToggle?.addEventListener('change', () => { updateNote(); dirty = true; });
renderCrossings();

export function drawChart() {
  if (!chartCanvas || chartPanelEl?.classList.contains('chart-hidden')) return;
  measure();
  const N = state.cubes.length;
  if (!dirty && N === lastN) return;
  dirty = false;
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
