// --- panels.js — Trilhos laterais (controles e telemetria) ---
// O botão de cada trilho na barra superior reflete o estado em aria-pressed.
// Em telas estreitas os dois trilhos disputam a mesma área, então abrir um fecha o outro.
import { playSound } from './physics.js';

export const controlPanel = document.getElementById('controlPanel');
export const chartPanel = document.getElementById('chartPanel');
const minimizeBtn = document.getElementById('minimizeBtn');
const toggleChartBtn = document.getElementById('toggleChartBtn');
const narrowScreen = window.matchMedia('(max-width: 900px)');

export const isControlsOpen = () => !controlPanel.classList.contains('panel-hidden');
export const isChartOpen = () => !chartPanel.classList.contains('chart-hidden');

function syncPanelButtons() {
  minimizeBtn.setAttribute('aria-pressed', String(isControlsOpen()));
  toggleChartBtn.setAttribute('aria-pressed', String(isChartOpen()));
}

export function setPanels({ controls, chart }) {
  if (controls !== undefined) controlPanel.classList.toggle('panel-hidden', !controls);
  if (chart !== undefined) chartPanel.classList.toggle('chart-hidden', !chart);
  syncPanelButtons();
}

minimizeBtn.addEventListener('click', () => {
  const opening = !isControlsOpen();
  setPanels({ controls: opening, chart: opening && narrowScreen.matches ? false : undefined });
  playSound();
});
toggleChartBtn.addEventListener('click', () => {
  const opening = !isChartOpen();
  setPanels({ chart: opening, controls: opening && narrowScreen.matches ? false : undefined });
  playSound();
});

// Em telas largas os dois trilhos já abrem; nas menores a cena começa livre
if (window.innerWidth >= 1100) setPanels({ controls: true, chart: true });
else syncPanelButtons();
