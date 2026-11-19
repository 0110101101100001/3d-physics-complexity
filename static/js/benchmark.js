// --- benchmark.js — Painel de benchmark e ajuste empírico da curva ---
// As medições rodam em bench-worker.js. Esta parte tira um retrato da cena, manda ao
// worker e desenha os resultados conforme chegam.
import { state, playSound } from './physics.js';
import { STRATEGIES, STRATEGY } from './strategies.js';
import { fmtTime } from './dom.js';
import { setMeasuredCurves } from './telemetry.js';

let worker = null;
let busy = false;
let lastFit = null; // { series, fits, sizes, cellSize, octreeDepth } do último ajuste

export const getLastFit = () => lastFit;

function startWorker() {
  worker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'scene') {
      populateBenchWidget(data.results, data.n);
      playSound();
    } else if (data.type === 'fit-progress') {
      setFitStatus(`medindo n = ${data.n} (${data.index + 1} de ${data.total})`);
    } else if (data.type === 'fit-done') {
      busy = false;
      renderFit(data.series, data.fits, data.sizes);
      setMeasuredCurves(data);
      lastFit = { ...data, cellSize: state.cellSize, octreeDepth: state.octreeDepth };
      setFitStatus(`n de ${data.sizes[0]} a ${data.sizes[data.sizes.length - 1]} · célula ${state.cellSize} · profundidade ${state.octreeDepth}`);
    }
  };
  worker.onerror = e => {
    busy = false;
    console.error('Benchmark falhou no worker:', e.message);
    setFitStatus('o benchmark falhou; veja o console');
  };
}

function setFitStatus(text) {
  const el = document.getElementById('benchFitStatus');
  if (el) el.textContent = text;
}

// Devolve false se não há cubos para medir
export function runBenchmark() {
  const cubes = state.cubes.filter(c => !c.dragging);
  if (cubes.length === 0) return false;

  // Um benchmark novo cancela o anterior: o worker em andamento é descartado
  if (busy && worker) { worker.terminate(); worker = null; }
  if (!worker) startWorker();
  busy = true;

  const widget = document.getElementById('benchWidget');
  widget?.classList.add('visible', 'is-measuring');
  renderFit({}, {}, []);
  setFitStatus('medindo a cena atual');

  worker.postMessage({
    cubes: cubes.map(c => {
      const p = c.mesh.position;
      return { id: c.id, size: c.size, x: p.x, y: p.y, z: p.z };
    }),
    cellSize: state.cellSize,
    octreeDepth: state.octreeDepth,
  });
  return true;
}

function populateBenchWidget(results, n) {
  const widget = document.getElementById('benchWidget');
  const nLabel = document.getElementById('benchWidgetN');
  const rowsEl = document.getElementById('benchWidgetRows');
  if (!widget || !rowsEl) return;
  widget.classList.remove('is-measuring');

  if (nLabel) nLabel.textContent = `n = ${n}`;

  const minTime = Math.min(...results.map(r => r.time));
  const maxTime = Math.max(...results.map(r => r.time || 0));

  // até 5% do mais rápido conta como primeiro lugar; dois ou mais aí é empate
  const tied = results.filter(r => minTime > 0 && r.time / minTime <= 1.05).length > 1;

  rowsEl.innerHTML = '';
  results.forEach(r => {
    const st = STRATEGY[r.key];
    const ratio = minTime > 0 ? r.time / minTime : 1;
    const isFastest = ratio <= 1.05;
    const phaseStr = r.key === 'brute'
      ? 'sem estrutura para montar'
      : 'montar ' + fmtTime(r.buildMs) + ' · consultar ' + fmtTime(r.queryMs);
    const buildPct = (Math.min(Math.max(r.buildShare || 0, 0), 1) * 100).toFixed(1);

    const row = document.createElement('div');
    row.className = 'bench-row';
    row.dataset.mode = r.key;
    row.innerHTML =
      '<div class="bench-row-label"><span>' + st.short + '</span><span class="bench-row-o">' + st.o + '</span></div>' +
      '<div class="bench-row-time">' + fmtTime(r.time) + '</div>' +
      '<div class="bench-row-meta">' +
        '<span class="bench-row-ratio' + (isFastest ? (tied ? ' tied' : ' fastest') : '') + '">' +
          (isFastest ? (tied ? 'empate' : 'mais rápido') : ratio.toFixed(1) + '× mais lento') +
        '</span>' +
        '<span>' + r.comparisons.toLocaleString('pt-BR') + ' pares</span>' +
      '</div>' +
      '<div class="bench-row-phase">' + phaseStr + '</div>' +
      '<div class="bench-bar-track"><div class="bench-bar-fill">' +
        '<span class="phase-bar__build" style="flex-basis:' + buildPct + '%"></span>' +
        '<span class="phase-bar__query"></span>' +
      '</div></div>';
    rowsEl.appendChild(row);
    row.dataset.scale = maxTime > 0 ? Math.min(r.time / maxTime, 1).toFixed(3) : '0';
  });

  // Dois frames: a barra nasce em zero e a transição do CSS a leva até o valor
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rowsEl.querySelectorAll('.bench-row').forEach(row => {
      row.querySelector('.bench-bar-fill').style.transform = `scaleX(${row.dataset.scale})`;
    });
  }));

  widget.classList.add('visible');
}

// ====================== AJUSTE EMPÍRICO DA CURVA ======================
function renderFit(series, fits, sizes) {
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
  drawFitChart(series, fits, sizes);
}

// Gráfico log-log em SVG: pontos medidos e a reta ajustada de cada estratégia
function drawFitChart(series, fits, sizes) {
  const svg = document.getElementById('fitChart');
  if (!svg) return;
  const W = 280, H = 140, padL = 56, padR = 10, padT = 10, padB = 24;
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;

  const parts = [
    `<path class="fit-axis" d="M${x0} ${y1}V${y0}H${x1}"/>`,
    `<text x="${(x0 + x1) / 2}" y="${H - 3}" text-anchor="middle">n (log)</text>`,
  ];

  const times = STRATEGIES.flatMap(st => (series[st.key] ?? []).map(p => p.t)).filter(t => t > 0);
  if (times.length >= 2 && sizes.length >= 2) {
    const nMin = sizes[0], nMax = sizes[sizes.length - 1];
    const lnN0 = Math.log(nMin), lnN1 = Math.log(nMax);
    let lnT0 = Math.log(Math.min(...times)), lnT1 = Math.log(Math.max(...times));
    if (lnT1 - lnT0 < 1e-9) { lnT0 -= 0.5; lnT1 += 0.5; }
    const px = n => x0 + ((Math.log(n) - lnN0) / (lnN1 - lnN0)) * (x1 - x0);
    const py = t => y0 - ((Math.log(t) - lnT0) / (lnT1 - lnT0)) * (y0 - y1);
    const clampY = y => Math.min(y0, Math.max(y1, y));

    [nMin, sizes[Math.floor(sizes.length / 2)], nMax].forEach(n => {
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
      for (const p of series[st.key] ?? []) {
        if (!(p.t > 0)) continue;
        parts.push(`<circle class="fit-dot" data-mode="${st.key}" cx="${px(p.n).toFixed(1)}" cy="${py(p.t).toFixed(1)}" r="2.2"/>`);
      }
    }
  }
  svg.innerHTML = parts.join('');
}
