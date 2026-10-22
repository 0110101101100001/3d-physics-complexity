// --- ui.js (parte 1) — Variáveis de UI, desempenho e gráfico assintótico ---
// Three.js é carregado globalmente via CDN (window.THREE) pelo index.html.

const THREE = window.THREE;
import {
  handleResize, camera, controls, scene, renderer, clock,
  shockwaves, lightTimer, impactLight, dropLineMesh, hoverBoxHelper,
  impactParticles,
} from './three-setup.js';
import {
  state,
  initCubes, detectCollisions, updatePhysics, toggleWireframe, resetHeatmap,
  playSound, renderGridDebug, renderOctreeDebug, updateContextPanel,
  CONTEXT_CONFIG, intersectAABB, SpatialGrid, OctreeSimulator,
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
let performanceData = {};
let spatialPerformanceData = {};
let octreePerformanceData = {};

function recordPerformance(n, timeMs) {
  if (!performanceData[n]) performanceData[n] = [];
  performanceData[n].push(timeMs);
  if (performanceData[n].length > 60) performanceData[n].shift();
}
function getAverageTime(n) {
  if (!performanceData[n] || performanceData[n].length === 0) return 0;
  let times = [...performanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) times = times.slice(trim, times.length - trim);
  return times.reduce((a, b) => a + b, 0) / times.length;
}
function recordSpatialPerformance(n, timeMs) {
  if (!spatialPerformanceData[n]) spatialPerformanceData[n] = [];
  spatialPerformanceData[n].push(timeMs);
  if (spatialPerformanceData[n].length > 60) spatialPerformanceData[n].shift();
}
function getSpatialAverageTime(n) {
  if (!spatialPerformanceData[n] || spatialPerformanceData[n].length === 0) return 0;
  let times = [...spatialPerformanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) times = times.slice(trim, times.length - trim);
  return times.reduce((a, b) => a + b, 0) / times.length;
}
function recordOctreePerformance(n, timeMs) {
  if (!octreePerformanceData[n]) octreePerformanceData[n] = [];
  octreePerformanceData[n].push(timeMs);
  if (octreePerformanceData[n].length > 60) octreePerformanceData[n].shift();
}
function getOctreeAverageTime(n) {
  if (!octreePerformanceData[n] || octreePerformanceData[n].length === 0) return 0;
  let times = [...octreePerformanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) times = times.slice(trim, times.length - trim);
  return times.reduce((a, b) => a + b, 0) / times.length;
}

// Re-exportar para que physics.js possa usá-las se necessário
export { recordPerformance, recordSpatialPerformance, recordOctreePerformance,
  getAverageTime, getSpatialAverageTime, getOctreeAverageTime };

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
  chartCtx.font = '10px "Fira Code", monospace';
  chartCtx.textAlign = 'center';
  chartCtx.fillText("N Cubos", padX + chartW / 2, h - 5);
  chartCtx.save();
  chartCtx.translate(12, 10 + chartH / 2);
  chartCtx.rotate(-Math.PI / 2);
  chartCtx.fillText("Tempo (ms)", 0, 0);
  chartCtx.restore();

  const N = Math.max(state.cubes.length, 2);
  const maxN = Math.max(20, N);

  const measuredBrute   = getAverageTime(N) > 0          ? getAverageTime(N)          : null;
  const measuredSpatial = getSpatialAverageTime(N) > 0   ? getSpatialAverageTime(N)   : null;
  const measuredOctree  = getOctreeAverageTime(N) > 0    ? getOctreeAverageTime(N)    : null;

  let maxTime = 0.001;
  if (measuredBrute   !== null && measuredBrute   < 30) maxTime = Math.max(maxTime, measuredBrute);
  if (measuredSpatial !== null && measuredSpatial < 30) maxTime = Math.max(maxTime, measuredSpatial);
  if (measuredOctree  !== null && measuredOctree  < 30) maxTime = Math.max(maxTime, measuredOctree);
  if (maxTime <= 0.001) maxTime = (N * N) * 0.0002;
  maxTime *= 1.2;

  // Curvas teóricas (tracejadas)
  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#ff7139'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = Math.pow(nx, 2) * 0.95;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#7b2cbf'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = ((i * Math.log(i + 2)) / (maxN * Math.log(maxN + 2))) * 0.65;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#00ddff'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = nx * 0.35;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  function drawDot(color, t) {
    if (t === null || t <= 0) return;
    const px = padX + (N / maxN) * chartW;
    const py = (h - padY) - Math.min(t / maxTime, 1) * chartH;
    chartCtx.beginPath();
    chartCtx.arc(px, py, 4, 0, Math.PI * 2);
    chartCtx.fillStyle = color;
    chartCtx.fill();
    chartCtx.strokeStyle = '#1b1b1f';
    chartCtx.lineWidth = 1.5;
    chartCtx.stroke();
  }

  function drawMeasuredLine(color, getAvgFn, keys) {
    if (keys.length === 0) return;
    chartCtx.save();
    chartCtx.setLineDash([]);
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 2;
    chartCtx.beginPath();
    let started = false;
    keys.forEach(k => {
      const avgT = getAvgFn(k);
      if (avgT <= 0) return;
      const px = padX + (k / maxN) * chartW;
      const py = (h - padY) - Math.min(avgT / maxTime, 1) * chartH;
      if (!started) { chartCtx.moveTo(px, py); started = true; }
      else chartCtx.lineTo(px, py);
    });
    if (started) chartCtx.stroke();
    chartCtx.restore();
  }

  const bruteKeys   = Object.keys(performanceData).map(Number).sort((a, b) => a - b);
  const spatialKeys = Object.keys(spatialPerformanceData).map(Number).sort((a, b) => a - b);
  const octreeKeys  = Object.keys(octreePerformanceData).map(Number).sort((a, b) => a - b);

  drawMeasuredLine('#ff4e3e', getAverageTime,        bruteKeys);
  drawMeasuredLine('#00ddff', getSpatialAverageTime, spatialKeys);
  drawMeasuredLine('#7b2cbf', getOctreeAverageTime,  octreeKeys);

  drawDot('#ff4e3e', measuredBrute);
  drawDot('#00ddff', measuredSpatial);
  drawDot('#7b2cbf', measuredOctree);

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
}

// ====================== UPDATE UI ======================
function updateUI() {
  document.getElementById('badgeText').textContent = state.collisionCount;
  document.getElementById('tbObjects').textContent = state.cubes.length;
  document.getElementById('tbMode').textContent = getAlgoLabel(state.currentBroadPhase);

  const active = state.activeCollisions > 0;
  collisionBadge.classList.toggle('has-collision', active);
  const badgeIndicator = document.getElementById('badgeIndicator');
  badgeIndicator.style.background = active ? 'var(--accent-red)' : '#3f3f46';
  badgeIndicator.style.boxShadow = active ? '0 0 7px rgba(255,78,62,0.8)' : 'none';

  const getTimeByMode = {
    brute:   () => getAverageTime(state.cubes.length),
    grid:    () => getSpatialAverageTime(state.cubes.length),
    octree:  () => getOctreeAverageTime(state.cubes.length),
  };
  const t = Math.max(0, (getTimeByMode[state.currentBroadPhase] || (() => 0))());

  statN.textContent    = state.cubes.length;
  statAlgo.textContent = getAlgoLabel(state.currentBroadPhase);
  statComp.textContent = state.lastComparisonCount.toLocaleString('pt-BR');
  statTime.textContent = `${t.toFixed(3)} ms`;
}

export { drawChart, updateUI, getAlgoLabel };

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
    <span class="toast-badge" style="color: ${accentColor};">[${title}]</span>
    <span>${message}</span>
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
function runBenchmark() {
  if (state.cubes.length === 0) return;

  const RUNS = 20;
  const TRIM = 0.15;

  function trimmedAvg(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * TRIM);
    const trimmed = sorted.slice(cut, sorted.length - cut);
    if (trimmed.length === 0) return arr.reduce((s, v) => s + v, 0) / arr.length;
    return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
  }

  function benchBrute() {
    try {
      const times = [];
      let comparisons = 0;
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        const t0 = performance.now();
        for (let i = 0; i < state.cubes.length; i++) {
          for (let j = i + 1; j < state.cubes.length; j++) {
            comps++;
            intersectAABB(state.cubes[i], state.cubes[j]);
          }
        }
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchBrute error:', e); return { time: 0, comparisons: 0 }; }
  }

  function benchGrid() {
    try {
      const times = [];
      let comparisons = 0;
      const grid = new SpatialGrid(2);
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        grid.clear();
        state.cubes.forEach(c => grid.insert(c));
        const t0 = performance.now();
        state.cubes.forEach(cube => {
          const potential = grid.getPotentialCollisions(cube);
          potential.forEach(other => {
            if (other.id <= cube.id) return;
            comps++;
            intersectAABB(cube, other);
          });
        });
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchGrid error:', e); return { time: 0, comparisons: 0 }; }
  }

  function benchOctree() {
    try {
      const times = [];
      let comparisons = 0;
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        const oct = new OctreeSimulator(60);
        state.cubes.forEach(c => oct.insert(c));
        const t0 = performance.now();
        const testedPairs = new Set();
        state.cubes.forEach(cube => {
          const potential = oct.getPotentialCollisions(cube);
          potential.forEach(other => {
            const pairKey = cube.id < other.id ? `${cube.id}-${other.id}` : `${other.id}-${cube.id}`;
            if (testedPairs.has(pairKey)) return;
            testedPairs.add(pairKey);
            comps++;
            intersectAABB(cube, other);
          });
        });
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchOctree error:', e); return { time: 0, comparisons: 0 }; }
  }

  const results = [
    { key: 'brute',  label: 'Força Bruta O(n²)',        color: '#ff7139', ...benchBrute() },
    { key: 'grid',   label: 'Grade Espacial O(n)',       color: '#00ddff', ...benchGrid() },
    { key: 'octree', label: 'Octree O(n log n)',         color: '#a855f7', ...benchOctree() },
  ];

  const minTime = Math.min(...results.map(r => r.time));
  results.forEach(r => {
    r.ratio = minTime > 0 ? (r.time / minTime) : 1;
  });

  populateBenchWidget(results, state.cubes.length);

  playSound();
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
    const barPct    = maxTime > 0 ? Math.min((r.time / maxTime) * 100, 100) : 0;
    const ratioStr  = ratio.toFixed(1) + 'x';
    const timeStr   = typeof r.time === 'number' ? r.time.toFixed(3) + ' ms' : '— ms';
    const compStr   = typeof r.comparisons === 'number'
      ? r.comparisons.toLocaleString('pt-BR')
      : '—';

    const row = document.createElement('div');
    row.className = 'bench-row';
    row.innerHTML =
      '<div class="bench-row-meta">' +
        '<span class="bench-row-label" style="color:' + r.color + ';">' + r.label + '</span>' +
        '<div class="bench-row-stats">' +
          '<span class="bench-row-time">' + timeStr + '</span>' +
          '<span class="bench-row-ratio' + (isFastest ? ' fastest' : '') + '">' +
            (isFastest ? '★ 1.0x' : ratioStr) +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div style="font-family:\'Fira Code\',monospace;font-size:0.65rem;color:#e4e4e7;margin-bottom:3px;letter-spacing:0.02em;">' +
        '<span style="color:#a1a1aa;font-size:0.58rem;margin-right:4px;">COMP.</span>' + compStr +
      '</div>' +
      '<div class="bench-bar-track">' +
        '<div class="bench-bar-fill" id="benchFill_' + i + '" style="width:0%;background:' + r.color + ';opacity:0.8;"></div>' +
      '</div>';

    rowsEl.appendChild(row);

    if (i < results.length - 1) {
      const div = document.createElement('div');
      div.className = 'bench-divider';
      rowsEl.appendChild(div);
    }
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      results.forEach((r, i) => {
        const maxT  = Math.max(...results.map(x => x.time || 0));
        const pct   = maxT > 0 ? Math.min((r.time / maxT) * 100, 100) : 0;
        const fill  = document.getElementById('benchFill_' + i);
        if (fill) fill.style.width = pct.toFixed(1) + '%';
      });
    });
  });

  widget.classList.add('visible');
}

// ====================== HISTÓRICO CSV (modal) ======================
let historyLog = [];
let sessionStartTime = Date.now();

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function addOrUpdateHistoryEntry() {
  const avgTime = getAverageTime(state.cubes.length) || 0;
  const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
  const minutes = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const seconds = String(elapsedSec % 60).padStart(2, '0');
  const durationStr = `${minutes}:${seconds}`;

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
    timeMs: avgTime,
    duration: durationStr,
  };

  if (historyLog.length === 0) {
    historyLog.push(entry);
  } else {
    const last = historyLog[historyLog.length - 1];
    if (last.n === entry.n && last.algo === entry.algo) {
      historyLog[historyLog.length - 1] = entry;
    } else {
      historyLog.push(entry);
    }
  }

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
    tr.innerHTML = `
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);color:#a1a1aa;">#${idx + 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:#e4e4e7;">${entry.n}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;" class="${algoClass}">${entry.algo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:#e4e4e7;">${entry.speed}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:${entry.cellSize !== '-' ? '#00ddff' : '#52525b'};">${entry.cellSize}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:${entry.octreeDepth !== '-' ? '#a855f7' : '#52525b'};">${entry.octreeDepth}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:#e4e4e7;">${entry.collisions}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:#e4e4e7;">${entry.timeMs.toFixed(3)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;color:#e4e4e7;">${entry.duration}</td>
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
  cellSizeSlider.value = 2;
  cellSizeNumber.value = 2;
  octreeDepthSlider.value = 6;
  octreeDepthNumber.value = 6;

  // Aplica desativação dinâmica de sliders no modo padrão (Força Bruta)
  const cellSizeGroup = cellSizeSlider.closest('.control-group');
  const octreeDepthGroup = octreeDepthSlider.closest('.control-group');
  cellSizeGroup.classList.add('control-disabled');
  octreeDepthGroup.classList.add('control-disabled');
}

export function startApp() {
  initDefaults();
  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
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
  brute: { color: '#ff7139', rgb: '255, 113, 57', dim: 'rgba(255, 113, 57, 0.35)', glow: 'rgba(255, 113, 57, 0.15)', subtle: 'rgba(255, 113, 57, 0.08)' },
  grid:  { color: '#00ddff', rgb: '0, 221, 255',  dim: 'rgba(0, 221, 255, 0.35)',  glow: 'rgba(0, 221, 255, 0.12)',  subtle: 'rgba(0, 221, 255, 0.07)' },
  octree:{ color: '#a855f7', rgb: '168, 85, 247', dim: 'rgba(168, 85, 247, 0.35)', glow: 'rgba(168, 85, 247, 0.15)', subtle: 'rgba(168, 85, 247, 0.08)' },
};

function setModeTheme(mode) {
  const t = MODE_THEMES[mode] || MODE_THEMES.brute;
  const root = document.documentElement;
  root.style.setProperty('--mode-color', t.color);
  root.style.setProperty('--mode-color-rgb', t.rgb);
  root.style.setProperty('--mode-color-dim', t.dim);
  root.style.setProperty('--mode-color-glow', t.glow);
  root.style.setProperty('--mode-color-subtle', t.subtle);

  const topBar = document.getElementById('topBar');
  if (topBar) {
    let leftTint, rightTint;
    if (mode === 'brute') {
      leftTint = 'rgba(255,113,57,0.07)';
      rightTint = 'rgba(255,113,57,0.03)';
    } else if (mode === 'grid') {
      leftTint = 'rgba(0,221,255,0.03)';
      rightTint = 'rgba(0,221,255,0.07)';
    } else {
      leftTint = 'rgba(168,85,247,0.05)';
      rightTint = 'rgba(168,85,247,0.05)';
    }
    topBar.style.background = `linear-gradient(to right, ${leftTint} 0%, rgba(27,27,31,0.88) 30%, rgba(27,27,31,0.88) 70%, ${rightTint} 100%)`;
    topBar.style.backdropFilter = 'blur(14px)';
    topBar.style.webkitBackdropFilter = 'blur(14px)';
  }
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
  if (modeEl) modeEl.textContent = getAlgoLabel(state.currentBroadPhase);
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
  document.getElementById('presentBtn').title = 'Sair da Apresentação [P]';
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
  controls.enabled = true;
  document.body.classList.remove('presentation-mode');
  document.getElementById('presentBtn').title = 'Modo Apresentação [P]';
  playSound();
}

function togglePresentation() {
  presentationMode ? exitPresentation() : enterPresentation();
}

window.addEventListener('resize', handleResize);

cubeCountInput.addEventListener('input', e => {
  cubeCountNumber.value = e.target.value;
  const disp = document.getElementById('cubeCountDisplay');
  if (disp) disp.textContent = e.target.value;
  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
});
cubeCountNumber.addEventListener('change', e => {
  cubeCountInput.value = e.target.value;
  const disp = document.getElementById('cubeCountDisplay');
  if (disp) disp.textContent = e.target.value;
  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
});
speedSlider.addEventListener('input', e => {
  state.simSpeed = parseFloat(e.target.value);
});
document.getElementById('toggleBtn').addEventListener('click', e => {
  state.simPaused = !state.simPaused;
  const btn = document.getElementById('toggleBtn');
  btn.classList.toggle('btn-active', state.simPaused);
  btn.lastChild.textContent = state.simPaused ? ' RETOMAR' : ' PAUSAR';
  chartPanel.classList.toggle('sim-paused', state.simPaused);
  document.getElementById('chartStats').classList.toggle('sim-paused', state.simPaused);
  playSound();

  showToast(
    state.simPaused ? 'PAUSADO' : 'EM EXECUÇÃO',
    state.simPaused ? 'Simulação interrompida' : 'Simulação retomada',
    state.simPaused ? '#f59e0b' : '#10b981'
  );
});
document.getElementById('resetBtn').addEventListener('click', () => {
  cubeCountInput.max = 20;
  cubeCountNumber.max = 20;
  cubeCountInput.value = 8;
  cubeCountNumber.value = 8;
  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
  playSound();

  showToast('REINICIAR', 'Cena e objetos redefinidos', '#00ddff');
});
document.getElementById('showGrid').addEventListener('change', e => {
  scene.children.find(c => c.type === "GridHelper").visible = e.target.checked;
  showToast('GRADE 3D', e.target.checked ? 'Grade visível' : 'Grade oculta', '#71717a');
});



cellSizeSlider.addEventListener('input', e => {
  cellSizeNumber.value = e.target.value;
  state.cellSize = parseFloat(e.target.value);
  if (state.currentBroadPhase === 'grid') {
    state.spatialGrid = new SpatialGrid(state.cellSize);
    state.cubes.forEach(c => state.spatialGrid.insert(c));
    renderGridDebug();
  }
});
cellSizeNumber.addEventListener('change', e => {
  cellSizeSlider.value = e.target.value;
  state.cellSize = parseFloat(e.target.value);
  if (state.currentBroadPhase === 'grid') {
    state.spatialGrid = new SpatialGrid(state.cellSize);
    state.cubes.forEach(c => state.spatialGrid.insert(c));
    renderGridDebug();
  }
});

octreeDepthSlider.addEventListener('input', e => {
  octreeDepthNumber.value = e.target.value;
  state.octreeDepth = parseInt(e.target.value, 10);
  if (state.currentBroadPhase === 'octree') {
    state.octreeSimulator = new OctreeSimulator(60, state.octreeDepth);
    state.cubes.forEach(c => state.octreeSimulator.insert(c));
    renderOctreeDebug();
  }
});

octreeDepthNumber.addEventListener('change', e => {
  octreeDepthSlider.value = e.target.value;
  state.octreeDepth = parseInt(e.target.value, 10);
  if (state.currentBroadPhase === 'octree') {
    state.octreeSimulator = new OctreeSimulator(60, state.octreeDepth);
    state.cubes.forEach(c => state.octreeSimulator.insert(c));
    renderOctreeDebug();
  }
});

minimizeBtn.addEventListener('click', () => {
  controlPanel.classList.toggle('panel-hidden');
  const active = !controlPanel.classList.contains('panel-hidden');
  minimizeBtn.style.background = active ? 'var(--mode-color-glow)' : '';
  minimizeBtn.style.borderColor = active ? 'var(--mode-color-dim)' : '';
  minimizeBtn.style.color = active ? 'var(--mode-color)' : '';
  playSound();
});

toggleChartBtn.addEventListener('click', () => {
  chartPanel.classList.toggle('chart-hidden');
  const active = !chartPanel.classList.contains('chart-hidden');
  toggleChartBtn.style.background = active ? 'var(--mode-color-glow)' : '';
  toggleChartBtn.style.borderColor = active ? 'var(--mode-color-dim)' : '';
  toggleChartBtn.style.color = active ? 'var(--mode-color)' : '';
  playSound();
});

document.getElementById('theoryBtn').addEventListener('click', () => { theoryModal.classList.remove('hidden'); playSound(); });
document.getElementById('closeTheoryBtn').addEventListener('click', () => { theoryModal.classList.add('hidden'); playSound(); });
const benchTopbarBtn = document.getElementById('benchTopbarBtn');
benchTopbarBtn.addEventListener('click', () => {
  runBenchmark();
  showToast('BENCHMARK', 'Executando testes comparativos (20x)...', '#ff7139');
});
document.getElementById('closeBenchmarkBtn').addEventListener('click', () => { document.getElementById('benchmarkModal').classList.add('hidden'); playSound(); });

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

stressBtn.addEventListener('click', () => {
  const isActive = stressBtn.classList.toggle('btn-active');
  if (isActive) {
    cubeCountInput.max = 150;
    cubeCountNumber.max = 150;
    cubeCountInput.value = 150;
    cubeCountNumber.value = 150;
  } else {
    cubeCountInput.max = 20;
    cubeCountNumber.max = 20;
    cubeCountInput.value = 8;
    cubeCountNumber.value = 8;
  }

  controlPanel.classList.toggle('stress-active', isActive);
  document.getElementById('stressBadge').classList.toggle('visible', isActive);

  document.body.classList.toggle('stress-mode', isActive);

  const flicker = document.getElementById('stressFlicker');
  flicker.classList.remove('flash');
  void flicker.offsetWidth;
  flicker.classList.add('flash');

  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
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
  document.getElementById('soundLabel').textContent = state.soundEnabled ? 'SOM' : 'SEM SOM';
  playSound();

  showToast(
    'SOM',
    state.soundEnabled ? 'Efeitos sonoros ativados' : 'Áudio mutado',
    state.soundEnabled ? '#10b981' : '#71717a'
  );
});

document.getElementById('broadPhaseSelect').addEventListener('change', (e) => {
  state.currentBroadPhase = e.target.value;
  initCubes();
  sessionStartTime = Date.now();
  addOrUpdateHistoryEntry();
  playSound();

  setModeTheme(state.currentBroadPhase);
  updateContextPanel(state.currentBroadPhase);
  renderGridDebug();
  renderOctreeDebug();

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

  switch (state.currentBroadPhase) {
    case 'brute': startTyping(pseudoCodeBrute); break;
    case 'grid': startTyping(pseudoCodeSpatial); break;
    case 'octree': startTyping(pseudoCodeOctree); break;
  }

  const toastColors = { brute: '#ff7139', grid: '#00ddff', octree: '#a855f7' };
  showToast('ALGORITMO', getAlgoLabel(state.currentBroadPhase), toastColors[state.currentBroadPhase]);
});

wireframeBtn.addEventListener('click', () => {
  state.wireframeEnabled = !state.wireframeEnabled;
  wireframeBtn.classList.toggle('btn-active', state.wireframeEnabled);
  playSound();
  toggleWireframe();

  showToast(
    'WIREFRAME',
    state.wireframeEnabled ? 'Modo de malha ativado' : 'Modo sólido ativado',
    state.wireframeEnabled ? '#a855f7' : '#71717a'
  );
});

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
    state.isPhysicsEnabled ? 'Gravidade e forças ativadas' : 'Modo cinemático (sem forças)',
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
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const key = e.key.toLowerCase();

  if (e.code === 'Escape') { exitPresentation(); return; }
  if (key === 'p') { togglePresentation(); return; }

  if (presentationMode) return;

  if (e.code === 'Space') {
    e.preventDefault();
    state.simPaused = !state.simPaused;
    const btn = document.getElementById('toggleBtn');
    btn.classList.toggle('btn-active', state.simPaused);
    btn.lastChild.textContent = state.simPaused ? ' RETOMAR' : ' PAUSAR';
    chartPanel.classList.toggle('sim-paused', state.simPaused);
    document.getElementById('chartStats').classList.toggle('sim-paused', state.simPaused);
    playSound();
  } else if (key === 'r') {
    document.getElementById('resetBtn').click();
  } else if (key === 's') {
    stressBtn.click();
  } else if (key === 'w') {
    state.wireframeEnabled = !state.wireframeEnabled;
    wireframeBtn.classList.toggle('btn-active', state.wireframeEnabled);
    playSound();
    toggleWireframe();
  } else if (key === 'b') {
    runBenchmark();
  }
});

// ====================== DRAG & DROP 3D ======================
const raycaster = new (THREE).Raycaster();
const mouse = new (THREE).Vector2();
const plane = new (THREE).Plane();
const offset = new (THREE).Vector3();

const forceLineGeo = new (THREE).BufferGeometry().setFromPoints([new (THREE).Vector3(), new (THREE).Vector3()]);
const forceLineMat = new (THREE).LineDashedMaterial({
  color: 0xffdd44, dashSize: 0.6, gapSize: 0.3, linewidth: 2
});
const forceLineMesh = new (THREE).Line(forceLineGeo, forceLineMat);
forceLineMesh.visible = false;
scene.add(forceLineMesh);

let hoveredCube = null;

window.addEventListener('wheel', e => {
  if (!state.draggedCube) return;
  e.preventDefault();
  const step = e.deltaY < 0 ? 1.0 : -1.0;
  const half = state.draggedCube.size / 2;
  state.draggedCube.mesh.position.y = (THREE).MathUtils.clamp(
    state.draggedCube.mesh.position.y + step, half, 20 - half
  );
  const groundPoint = new (THREE).Vector3(state.draggedCube.mesh.position.x, 0, state.draggedCube.mesh.position.z);
  dropLineMesh.geometry.setFromPoints([state.draggedCube.mesh.position, groundPoint]);
  dropLineMesh.geometry.attributes.position.needsUpdate = true;
  dropLineMesh.computeLineDistances();
  dropLineMesh.visible = true;
  const cameraDir = new (THREE).Vector3();
  camera.getWorldDirection(cameraDir);
  plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), state.draggedCube.mesh.position);
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.target.closest('#controlPanel') || e.target.closest('#chartPanel') || e.target.closest('button') || e.target.closest('#collisionBadge')) return;

  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(state.cubes.map(c => c.mesh));

  if (intersects.length > 0) {
    controls.enabled = false;
    state.draggedCube = intersects[0].object.userData;
    state.draggedCube.dragging = true;
    state.draggedCube.velocity.set(0, 0, 0);

    const cameraDir = new (THREE).Vector3();
    camera.getWorldDirection(cameraDir);
    plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), state.draggedCube.mesh.position);

    const intersectPoint = new (THREE).Vector3();
    if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
      offset.copy(intersectPoint).sub(state.draggedCube.mesh.position);
    }

    state.draggedCube.mesh.material.color.copy(DRAG_COLOR);
    hoverBoxHelper.setFromObject(state.draggedCube.mesh);
    hoverBoxHelper.visible = true;

    const groundPoint = new (THREE).Vector3(state.draggedCube.mesh.position.x, 0, state.draggedCube.mesh.position.z);
    dropLineMesh.geometry.setFromPoints([state.draggedCube.mesh.position, groundPoint]);
    dropLineMesh.geometry.attributes.position.needsUpdate = true;
    dropLineMesh.computeLineDistances();
    dropLineMesh.visible = true;
  }
});

renderer.domElement.addEventListener('pointermove', e => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);

  if (!state.draggedCube) {
    const intersects = raycaster.intersectObjects(state.cubes.map(c => c.mesh));
    if (intersects.length > 0) {
      const c = intersects[0].object.userData;
      if (hoveredCube !== c) {
        if (hoveredCube && !hoveredCube.colliding) hoveredCube.mesh.material.color.copy(hoveredCube.baseColor);
        hoveredCube = c;
        document.body.style.cursor = 'pointer';
      }
      if (!c.colliding) c.mesh.material.color.lerp(new (THREE).Color(0xffffff), 0.3);
      hoverBoxHelper.setFromObject(hoveredCube.mesh);
      hoverBoxHelper.visible = true;
    } else {
      if (hoveredCube && !hoveredCube.colliding) hoveredCube.mesh.material.color.copy(hoveredCube.baseColor);
      hoveredCube = null;
      hoverBoxHelper.visible = false;
      document.body.style.cursor = 'default';
    }
  } else {
    const intersectPoint = new (THREE).Vector3();
    if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
      const targetPos = intersectPoint.sub(offset);

      const half = state.draggedCube.size / 2;
      targetPos.x = (THREE).MathUtils.clamp(targetPos.x, -20 + half, 20 - half);
      targetPos.y = (THREE).MathUtils.clamp(targetPos.y, half, 20 - half);
      targetPos.z = (THREE).MathUtils.clamp(targetPos.z, -20 + half, 20 - half);

      forceLineGeo.setFromPoints([state.draggedCube.mesh.position, targetPos]);
      forceLineGeo.attributes.position.needsUpdate = true;
      forceLineMesh.computeLineDistances();
      forceLineMesh.visible = true;

      state.draggedCube.mesh.position.copy(targetPos);
      hoverBoxHelper.setFromObject(state.draggedCube.mesh);
      hoverBoxHelper.visible = true;

      const groundPoint = new (THREE).Vector3(targetPos.x, 0, targetPos.z);
      dropLineMesh.geometry.setFromPoints([targetPos, groundPoint]);
      dropLineMesh.geometry.attributes.position.needsUpdate = true;
      dropLineMesh.computeLineDistances();
      dropLineMesh.visible = true;
    }
  }
});

const endDrag = () => {
  if (!state.draggedCube) return;
  forceLineMesh.visible = false;
  hoverBoxHelper.visible = false;
  dropLineMesh.visible = false;
  state.draggedCube.dragging = false;
  state.draggedCube.velocity.set(
    (Math.random() - 0.5) * parseFloat(speedSlider.value),
    (Math.random() - 0.5) * parseFloat(speedSlider.value),
    (Math.random() - 0.5) * parseFloat(speedSlider.value)
  );
  state.draggedCube = null;
  controls.enabled = true;
};
renderer.domElement.addEventListener('pointerup', endDrag);

// ====================== ANIMAÇÃO ======================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updatePhysics();
  const res = detectCollisions();
  state.lastComparisonCount = res.comparisons;

  impactParticles.update(delta);

  if (lightTimer.value > 0) {
    lightTimer.value -= delta;
    if (lightTimer.value <= 0) {
      impactLight.intensity = 0;
    }
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.scale += 0.25;
    sw.opacity -= 0.04;
    sw.mesh.scale.set(sw.scale, sw.scale, 1);
    sw.mesh.material.opacity = Math.max(0, sw.opacity);

    if (sw.opacity <= 0) {
      scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
      shockwaves.splice(i, 1);
    }
  }

  if (presentationMode) {
    presentOrbitAngle += 0.003;
    camera.position.x = Math.sin(presentOrbitAngle) * presentOrbitRadius;
    camera.position.z = Math.cos(presentOrbitAngle) * presentOrbitRadius;
    camera.position.y = presentOrbitY + Math.sin(presentOrbitAngle * 0.4) * 5;
    camera.lookAt(0, 3, 0);
    updatePresentHud();
  }
  controls.update();
  drawChart();
  updateUI();
  frameCount++;
}

// ====================== LANDING PAGE ======================
const landingPage = document.getElementById('landingPage');
const startBtn = document.getElementById('startBtn');

function animateCounters() {
  document.querySelectorAll('.counter-num').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    const duration = 1200;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  });
}
setTimeout(animateCounters, 900);

if (startBtn && landingPage) {
  startBtn.addEventListener('click', () => {
    landingPage.classList.add('hidden');
    playSound();
  });
}

// Arranque da aplicação quando o módulo é carregado
startApp();

// ====================== TYPEWRITER EFECT — TERMINAL LOGS ======================
function typewriterEffect() {
  const lines = document.querySelectorAll('.log-line:not(.log-empty)');
  const cursor = document.querySelector('.typewriter-cursor');
  let lineIndex = 0;

  function typeLine() {
    if (lineIndex >= lines.length) {
      // Todas as linhas digitadas — inicia live data
      startFakeLiveData();
      return;
    }

    const line = lines[lineIndex];
    const fullText = line.innerHTML;
    line.innerHTML = '';
    line.classList.add('typing');
    line.style.opacity = '1';

    let charIndex = 0;
    function typeChar() {
      if (charIndex <= fullText.length) {
        line.innerHTML = fullText.slice(0, charIndex);
        charIndex++;
        setTimeout(typeChar, 25);
      } else {
        lineIndex++;
        setTimeout(typeLine, 150);
      }
    }

    typeChar();
  }

  // Inicia com pequeno atraso para o fade-in da landing
  setTimeout(typeLine, 600);
}

// ====================== FAKE LIVE DATA — TERMINAL ======================
function startFakeLiveData() {
  const logFps = document.getElementById('log-fps');
  const logDelta = document.getElementById('log-delta');
  const logEntities = document.getElementById('log-entities');
  const logCollisions = document.getElementById('log-collisions');
  const terminalBody = document.querySelector('.terminal-body');
  const cursor = document.querySelector('.typewriter-cursor');

  const collisionMessages = [
    '[SYS] Broad-Phase query optimized...',
    '[MEM] Allocating node buffer: 4.1 MB',
    '[STATE] Octree rebalanced at depth 5',
    '[METRICS] Collision spike detected: 12 pairs',
    '[DATA] Spatial hash updated: 1024 buckets',
    '[SYS] Thread pool: 4 workers active',
    '[MEM] GC pause: 2.1ms (gen 0)',
    '[STATE] AABB sweep complete: 0 overlaps',
  ];

  let entities = 1024;
  let collisions = 34;

  setInterval(() => {
    // FPS flutua entre 58 e 60
    const fps = 58 + Math.floor(Math.random() * 3);
    const delta = (1000 / fps).toFixed(1);

    if (logFps) logFps.textContent = fps;
    if (logDelta) logDelta.textContent = delta;

    // Colisões mudam aleatoriamente
    collisions += Math.floor(Math.random() * 5) - 2;
    collisions = Math.max(0, Math.min(200, collisions));
    if (logCollisions) logCollisions.textContent = collisions;

    // Entidades mudam raramente
    if (Math.random() > 0.9) {
      entities += Math.floor(Math.random() * 10) - 5;
      entities = Math.max(100, Math.min(2000, entities));
      if (logEntities) logEntities.textContent = entities;
    }

    // Ocasionalmente insere nova linha de log (scroll)
    if (Math.random() > 0.85) {
      const msg = collisionMessages[Math.floor(Math.random() * collisionMessages.length)];
      const newLine = document.createElement('div');
      newLine.className = 'log-line';
      newLine.style.opacity = '0';
      newLine.style.transform = 'translateY(4px)';
      newLine.innerHTML = msg;
      terminalBody.insertBefore(newLine, cursor);
      // Anima entrada
      requestAnimationFrame(() => {
        newLine.style.transition = 'all 0.3s ease';
        newLine.style.opacity = '1';
        newLine.style.transform = 'translateY(0)';
      });
      // Remove linhas antigas se ficar muito cheio
      const allLines = terminalBody.querySelectorAll('.log-line:not(.log-empty)');
      if (allLines.length > 14) {
        allLines[0].remove();
      }
      // Scroll para baixo
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  }, 500); // atualiza a cada 500ms
}

// Inicia o typewriter quando o DOM está pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', typewriterEffect);
} else {
  typewriterEffect();
}


