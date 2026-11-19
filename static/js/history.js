// --- history.js — Histórico da sessão (modal) e exportação CSV ---
import { state } from './physics.js';
import { strategyOf } from './strategies.js';
import { currentAverageTime } from './telemetry.js';
import { showToast } from './dom.js';

const MAX_ENTRIES = 50;
const historyLog = [];
let sessionStartTime = Date.now();
let historyBreak = false; // força nova linha mesmo com mesmo N/algoritmo (ex.: reset)

// A configuração mudou (cena reiniciada, estratégia trocada): a sessão recomeça numa linha nova
export function startHistorySession() {
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
// a configuração atual.
export function addOrUpdateHistoryEntry() {
  const avgMs = currentAverageTime();
  const mode = state.currentBroadPhase;
  const entry = {
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    n: state.cubes.length,
    mode,
    algo: strategyOf(mode).label,
    speed: `${parseFloat(state.simSpeed).toFixed(1)}x`,
    cellSize: mode === 'grid' ? state.cellSize : '-',
    octreeDepth: mode === 'octree' ? state.octreeDepth : '-',
    collisions: state.collisionCount,
    timeMs: Number((avgMs > 0 ? avgMs : state.lastExecutionTime || 0).toFixed(4)),
    duration: formatDuration(Date.now() - sessionStartTime),
  };

  const last = historyLog[historyLog.length - 1];
  if (last && last.n === entry.n && last.mode === entry.mode && !historyBreak) {
    historyLog[historyLog.length - 1] = entry;
  } else {
    historyLog.push(entry);
  }
  historyBreak = false;
  if (historyLog.length > MAX_ENTRIES) historyLog.shift();
}

export function renderHistoryTable() {
  const tbody = document.getElementById('historyTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const na = v => (v === '-' ? '—' : v);
  historyLog.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="num">${entry.n}</td>
      <td><span class="algo-cell algo-${entry.mode}">${entry.algo}</span></td>
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

export function exportCSV() {
  if (historyLog.length === 0) {
    showToast('HISTÓRICO', 'Nenhum registro para exportar', '#71717a');
    return;
  }

  const headers = ['Timestamp', 'N_Cubos', 'Algoritmo', 'Velocidade', 'Tam_Celula', 'Profundidade_Octree', 'Colisoes', 'Tempo_Ms', 'Duracao_Sessao'];
  const csvLines = [
    headers.join(','),
    ...historyLog.map(row =>
      `"${row.timestamp}","${row.n}","${row.algo}","${row.speed}","${row.cellSize}","${row.octreeDepth}","${row.collisions}","${row.timeMs.toFixed(3)}","${row.duration}"`
    ),
  ];

  const blob = new Blob(['﻿' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `simulation_history_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
