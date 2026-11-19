// --- view-modes.js — Modo apresentação e corrida lado a lado ---
// Os dois mexem na câmera e um precisa saber do outro (a órbita da apresentação recua
// na corrida; sair da apresentação refaz o enquadramento da corrida), por isso moram juntos.
import * as THREE from 'three';
import { camera, controls, setViewColumns, setPairLineColor } from './three-setup.js';
import { state, RACE_MODES, frameStats, playSound } from './physics.js';
import { STRATEGIES, strategyOf } from './strategies.js';
import { phase, resetPhases } from './telemetry.js';
import { setText, fmtLiveMs, showToast } from './dom.js';
import { setPanels, isControlsOpen, isChartOpen } from './panels.js';

// ====================== TEMA POR ESTRATÉGIA ======================
// As cores da interface vêm do CSS (body[data-mode]). Aqui só se marca o modo,
// a tecla pressionada e a cor das linhas de teste da cena.
export function setModeTheme(mode) {
  const st = strategyOf(mode);
  document.body.dataset.mode = st.key;
  setPairLineColor(st.color);
  document.querySelectorAll('.mode-key').forEach(k =>
    k.setAttribute('aria-pressed', String(k.dataset.mode === st.key))
  );
}

// ====================== APRESENTAÇÃO ======================
const presentBtn = document.getElementById('presentBtn');
const presentOrbitRadius = 68;
const presentOrbitY = 32;
let presentationMode = false;
let presentOrbitAngle = 0;
let savedCameraPos = null;
let savedCameraTarget = null;

export const isPresenting = () => presentationMode;

export function updatePresentHud() {
  const modeEl = document.getElementById('presentMode');
  const nEl = document.getElementById('presentN');
  const compEl = document.getElementById('presentComp');
  const collEl = document.getElementById('presentCollisions');
  if (modeEl) modeEl.textContent = state.raceMode ? `Corrida: ${RACE_MODES.length} estratégias` : strategyOf(state.currentBroadPhase).label;
  if (nEl) nEl.textContent = `n = ${state.cubes.length}`;
  if (compEl) compEl.textContent = `${state.lastComparisonCount.toLocaleString('pt-BR')} comp.`;
  if (collEl) collEl.textContent = `${state.collisionCount} colisões`;
}

export function enterPresentation() {
  if (presentationMode) return;
  presentationMode = true;
  savedCameraPos = camera.position.clone();
  savedCameraTarget = controls.target.clone();
  presentOrbitAngle = Math.atan2(camera.position.x, camera.position.z);
  controls.enabled = false;
  document.body.classList.add('presentation-mode');
  presentBtn.setAttribute('aria-checked', 'true');
  updatePresentHud();
  playSound();
}

export function exitPresentation() {
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
  presentBtn.setAttribute('aria-checked', 'false');
  playSound();
}

export function togglePresentation() {
  presentationMode ? exitPresentation() : enterPresentation();
}

// Órbita automática, chamada a cada frame
export function updatePresentation() {
  if (!presentationMode) return;
  presentOrbitAngle += 0.003;
  const orbitRadius = state.raceMode ? Math.max(presentOrbitRadius, raceFitDistance()) : presentOrbitRadius;
  camera.position.x = Math.sin(presentOrbitAngle) * orbitRadius;
  camera.position.z = Math.cos(presentOrbitAngle) * orbitRadius;
  camera.position.y = presentOrbitY + Math.sin(presentOrbitAngle * 0.4) * 5;
  camera.lookAt(0, 3, 0);
  updatePresentHud();
}

// ====================== CORRIDA LADO A LADO ======================
// A tela é dividida em colunas, uma por estratégia. A simulação é uma só: todas as
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

export function updateRaceHud() {
  // Média simples dos últimos frames (a mesma janela do custo por fase). A média aparada
  // da telemetria descarta os frames mais lentos; com o relógio grosso do navegador, quase
  // todo frame mede 0 e os poucos que medem algo são justamente os descartados.
  const times = RACE_MODES.map(mode => phase[mode].buildAvg + phase[mode].queryAvg);
  const maxTime = Math.max(...times);
  const positive = times.filter(t => t > 0);
  const minTime = positive.length ? Math.min(...positive) : 0;

  // até 5% do mais rápido conta como primeiro lugar; dois ou mais aí é empate
  const isFastest = t => minTime > 0 && t > 0 && t / minTime <= 1.05;
  const tied = times.filter(isFastest).length > 1;

  RACE_MODES.forEach((mode, i) => {
    const els = raceEls[mode];
    if (!els) return;
    const t = times[i];
    setText(els.pairs, frameStats[mode].comparisons.toLocaleString('pt-BR'));
    setText(els.time, fmtLiveMs(t));

    const ratio = minTime > 0 && t > 0 ? t / minTime : 0;
    const fastest = isFastest(t);
    setText(els.rank, ratio === 0 ? '—' : fastest ? (tied ? 'empate' : 'mais rápido') : `${ratio.toFixed(1)}× mais lento`);
    els.rank.classList.toggle('is-first', fastest && !tied);
    els.rank.classList.toggle('is-tied', fastest && tied);

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

export function enterRace() {
  if (state.raceMode) return;
  state.raceMode = true;
  document.body.classList.add('race-mode');
  raceBtn.setAttribute('aria-pressed', 'true');

  // os trilhos cobririam as colunas das pontas: fecham ao entrar e voltam ao sair
  railsBeforeRace = { controls: isControlsOpen(), chart: isChartOpen() };
  setPanels({ controls: false, chart: false });

  fovBeforeRace = camera.fov;
  camera.fov = RACE_FOV;
  setViewColumns(RACE_MODES.length);
  raceZoomFactor = 1;
  if (!presentationMode) fitRaceCamera(); // na apresentação a órbita define a distância

  resetPhases();
  updateRaceHud();
}

export function exitRace() {
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

  if (railsBeforeRace) setPanels(railsBeforeRace);
  setModeTheme(state.currentBroadPhase); // devolve a cor das linhas de teste ao modo ativo
}

export function toggleRace() {
  const willEnter = !state.raceMode;
  willEnter ? enterRace() : exitRace();
  playSound();
  showToast(
    'CORRIDA',
    willEnter ? `${STRATEGIES.length} estratégias na mesma cena` : 'Vista única restaurada',
    willEnter ? '#10b981' : '#71717a'
  );
}
