// --- ui.js — Controles, atalhos, laço de animação e estado inicial via URL ---
// As partes maiores da interface ficam em módulos próprios:
//   telemetry.js  médias, custo por fase e gráfico assintótico
//   benchmark.js  painel de benchmark (as medições rodam em bench-worker.js)
//   history.js    histórico da sessão e CSV
//   view-modes.js apresentação e corrida
//   panels.js     trilhos laterais
//   drag.js       arrastar e largar cubos
import {
  handleResize, controls, renderer, clock, lightTimer, impactLight, impactParticles,
  renderColumns, renderView, floorGrid, setBloomEnabled, triggerGlitch,
  updateSceneEffects, setXray, updatePairTrail, setTrailEnabled, isTrailEnabled,
} from './three-setup.js';
import {
  state, LIMITS, clampNumber, initCubes, detectCollisions, updatePhysics, toggleWireframe,
  playSound, unlockAudio, clearDebugGizmos, updateContextPanel, RACE_MODES, frameStats,
  prepareRaceView, finishRaceViews, switchStrategy, updateDebris, glowHooks,
} from './physics.js';
import { STRATEGY, MODE_KEYS, strategyOf } from './strategies.js';
import { perf, phase, resetPhases, currentTimeReadout, drawChart, updatePhaseUI } from './telemetry.js';
import { runBenchmark } from './benchmark.js';
import { startHistorySession, addOrUpdateHistoryEntry, renderHistoryTable, exportCSV } from './history.js';
import {
  setModeTheme, isPresenting, enterPresentation, exitPresentation, togglePresentation,
  updatePresentation, enterRace, toggleRace, updateRaceHud,
} from './view-modes.js';
import { controlPanel, setPanels } from './panels.js';
import { setText, showToast } from './dom.js';
import { isMenuOpen, closeMenu } from './menu.js';
import './drag.js';
import './proof.js';

// ====================== ELEMENTOS DA UI ======================
const cubeCountInput = document.getElementById('cubeCount');
const cubeCountNumber = document.getElementById('cubeCountInput');
const speedSlider = document.getElementById('speed');
const cellSizeSlider = document.getElementById('cellSize');
const cellSizeNumber = document.getElementById('cellSizeInput');
const octreeDepthSlider = document.getElementById('octreeDepth');
const octreeDepthNumber = document.getElementById('octreeDepthInput');
const broadPhaseSelect = document.getElementById('broadPhaseSelect');
const collisionBadge = document.getElementById('collisionBadge');
const theoryModal = document.getElementById('theoryModal');
const stressBtn = document.getElementById('stressBtn');
const soundBtn = document.getElementById('soundBtn');
const wireframeBtn = document.getElementById('wireframeBtn');
const benchTopbarBtn = document.getElementById('benchTopbarBtn');

const statN = document.getElementById('statN');
const statAlgo = document.getElementById('statAlgo');
const statComp = document.getElementById('statComp');
const statTime = document.getElementById('statTime');
const badgeTextEl = document.getElementById('badgeText');
const tbObjectsEl = document.getElementById('tbObjects');
const tbModeEl = document.getElementById('tbMode');
const badgeIndicator = document.getElementById('badgeIndicator');

// ====================== LEITURAS ======================
function updateUI() {
  const label = strategyOf(state.currentBroadPhase).label;
  setText(badgeTextEl, state.collisionCount);
  setText(tbObjectsEl, state.cubes.length);
  setText(tbModeEl, label);

  const active = state.activeCollisions > 0;
  if (collisionBadge && collisionBadge.classList.contains('has-collision') !== active) {
    collisionBadge.classList.toggle('has-collision', active);
    badgeIndicator.classList.toggle('is-live', active);
  }

  setText(statN, state.cubes.length);
  setText(statAlgo, label);
  setText(statComp, state.lastComparisonCount.toLocaleString('pt-BR'));
  setText(statTime, currentTimeReadout());
}

// ====================== CENA ======================
// Toda reconfiguração da cena passa por aqui
function restartScene() {
  initCubes();
  resetPhases();
  startHistorySession();
}

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

// Cada parâmetro só vale para a sua estratégia; os outros ficam esmaecidos e
// também saem da navegação por teclado.
function syncParameterControls(mode) {
  const groups = [
    [cellSizeSlider.closest('.control-group'), mode === 'grid'],
    [octreeDepthSlider.closest('.control-group'), mode === 'octree'],
  ];
  for (const [group, enabled] of groups) {
    group.classList.toggle('control-disabled', !enabled);
    group.querySelectorAll('input').forEach(input => { input.disabled = !enabled; });
  }
}

// ====================== ESTRATÉGIA ======================
broadPhaseSelect.addEventListener('change', e => {
  // Os cubos ficam onde estão: a cena é a mesma para a estratégia nova. Só a contagem,
  // as médias e a linha do histórico recomeçam; a paleta troca em onda e a imagem falha
  // por meio segundo.
  const mode = e.target.value;
  switchStrategy(mode);
  resetPhases();
  startHistorySession();
  triggerGlitch();
  playSound();

  setModeTheme(mode);
  updateContextPanel(mode);
  clearDebugGizmos();
  MODE_KEYS.forEach(k => controlPanel.classList.remove('mode-' + k));
  controlPanel.classList.add('mode-' + mode);
  syncParameterControls(mode);
  startTyping(STRATEGY[mode].pseudo);
  showToast('ALGORITMO', STRATEGY[mode].label, STRATEGY[mode].color);
});

function selectStrategy(mode) {
  if (!STRATEGY[mode] || broadPhaseSelect.value === mode) return;
  broadPhaseSelect.value = mode;
  broadPhaseSelect.dispatchEvent(new Event('change'));
}

// As teclas da barra superior escolhem a estratégia através do select (que guarda o valor)
document.querySelectorAll('.mode-key').forEach(key => {
  key.addEventListener('click', () => selectStrategy(key.dataset.mode));
});

// Terminal de pseudocódigo com efeito de digitação
let typingInterval = null;
function startTyping(targetText) {
  if (typingInterval) clearInterval(typingInterval);
  const el = document.getElementById('pseudoCode');
  el.textContent = '';
  let charIndex = 0;
  typingInterval = setInterval(() => {
    if (charIndex < targetText.length) {
      el.textContent += targetText.charAt(charIndex++);
    } else {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }, 15);
}

// ====================== AÇÕES ======================
function togglePause() {
  state.simPaused = !state.simPaused;
  document.getElementById('toggleBtn').classList.toggle('btn-active', state.simPaused);
  document.getElementById('toggleLabel').textContent = state.simPaused ? 'Retomar' : 'Pausar';
  document.body.classList.toggle('sim-paused', state.simPaused);
  document.getElementById('chartPanel').classList.toggle('sim-paused', state.simPaused);
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
    isActive ? `Modo de alta densidade (${LIMITS.cubes.max} objetos)` : 'Modo padrão restaurado',
    isActive ? '#ff4e3e' : '#71717a'
  );
});

soundBtn.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  document.getElementById('soundIconOn').style.display = state.soundEnabled ? '' : 'none';
  document.getElementById('soundIconOff').style.display = state.soundEnabled ? 'none' : '';
  document.getElementById('soundLabel').textContent = state.soundEnabled ? 'Som ligado' : 'Som desligado';
  soundBtn.setAttribute('aria-checked', String(state.soundEnabled));
  playSound();
  showToast(
    'SOM',
    state.soundEnabled ? 'Efeitos sonoros ativados' : 'Áudio mutado',
    state.soundEnabled ? '#10b981' : '#71717a'
  );
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

function togglePhysics() {
  state.isPhysicsEnabled = !state.isPhysicsEnabled;
  document.getElementById('physicsBtn').classList.toggle('btn-active', state.isPhysicsEnabled);
  playSound();
  showToast(
    'FÍSICA REAL',
    state.isPhysicsEnabled ? 'Resposta a colisões ativada' : 'Só deteção (cubos se atravessam)',
    state.isPhysicsEnabled ? '#10b981' : '#71717a'
  );
}
document.getElementById('physicsBtn').addEventListener('click', togglePhysics);

function toggleTrail() {
  setTrailEnabled(!isTrailEnabled());
  showToast('RASTRO', isTrailEnabled() ? 'Linhas de teste com rastro' : 'Rastro desligado', '#ff7139');
}

document.getElementById('captureBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `physics-sim-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
  playSound();
  showToast('CAPTURA', 'Imagem salva com sucesso', '#10b981');
});

// ====================== MODAIS, BENCHMARK, CORRIDA, APRESENTAÇÃO ======================
document.getElementById('theoryBtn').addEventListener('click', () => { theoryModal.classList.remove('hidden'); playSound(); });
document.getElementById('closeTheoryBtn').addEventListener('click', () => { theoryModal.classList.add('hidden'); playSound(); });

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
document.getElementById('exportCsvBtn').addEventListener('click', () => { exportCSV(); playSound(); });

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('pointerdown', e => { if (e.target === modal) modal.classList.add('hidden'); });
});

benchTopbarBtn.addEventListener('click', () => {
  if (runBenchmark()) showToast('BENCHMARK', 'Medindo a cena atual e ajustando a curva', '#ff7139');
});
document.getElementById('benchWidgetRerun').addEventListener('click', () => { runBenchmark(); });
document.getElementById('benchWidgetClose').addEventListener('click', () => {
  document.getElementById('benchWidget').classList.remove('visible');
  playSound();
});

document.getElementById('raceBtn').addEventListener('click', toggleRace);

document.getElementById('presentBtn').addEventListener('click', () => {
  const willEnter = !isPresenting();
  togglePresentation();
  showToast(
    'APRESENTAÇÃO',
    willEnter ? 'Câmera orbital e HUD limpo' : 'Modo de edição restaurado',
    willEnter ? '#ff7139' : '#71717a'
  );
});

// ====================== TECLADO E FOCO ======================
window.addEventListener('resize', handleResize);

// Libera o áudio na primeira interação (o navegador bloqueia som antes disso).
// Fase de captura: roda antes dos handlers dos botões, então o som do próprio clique já sai.
['pointerdown', 'keydown', 'touchstart'].forEach(type =>
  window.addEventListener(type, unlockAudio, { capture: true, passive: true })
);

window.addEventListener('keydown', e => {
  // Não intercepta digitação em campos nem atalhos do navegador (Ctrl+R, Cmd+S...)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();

  if (e.code === 'Escape') {
    if (isMenuOpen()) { closeMenu(); return; }
    const openModal = document.querySelector('.modal:not(.hidden)');
    if (openModal) openModal.classList.add('hidden'); else exitPresentation();
    return;
  }
  if (key === 'p') { togglePresentation(); return; }
  if (key === 'c') { toggleRace(); return; }
  if (key === 'x') { setXray(true); return; } // raio-X enquanto a tecla estiver segura
  if (key === 't') { toggleTrail(); return; }
  // 1 a 4 escolhem a estratégia, na ordem das teclas da barra superior
  if (/^[1-9]$/.test(e.key) && MODE_KEYS[Number(e.key) - 1]) { selectStrategy(MODE_KEYS[Number(e.key) - 1]); return; }

  if (isPresenting()) return;

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

window.addEventListener('keyup', e => {
  if (e.key.toLowerCase() === 'x') setXray(false);
});
// soltar a tecla com a janela sem foco não gera keyup: o raio-X desliga ao perder o foco
window.addEventListener('blur', () => setXray(false));

// Depois de um clique com o mouse o foco sai do botão ou do slider. Sem isso o Espaço
// repetia o último botão em vez de pausar, e os atalhos paravam depois de mexer num slider.
document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (button && e.detail > 0) button.blur();
});
document.querySelectorAll('input[type="range"]').forEach(range =>
  range.addEventListener('pointerup', () => range.blur())
);

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
  // Grava a amostra do frame de cada estratégia que rodou (uma só, ou todas na corrida)
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
    if (lightTimer.value <= 0) impactLight.intensity = 0;
  }
  updateDebris(delta);

  updatePresentation();
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

// ====================== INICIALIZAÇÃO ======================
function initDefaults() {
  cubeCountInput.value = 8;
  cubeCountNumber.value = 8;
  speedSlider.value = '0.8';
  state.simSpeed = parseFloat(speedSlider.value);
  broadPhaseSelect.value = 'brute';
  document.getElementById('showGrid').checked = true;
  document.getElementById('bloomToggle').checked = true;
  cellSizeSlider.value = 2;
  cellSizeNumber.value = 2;
  octreeDepthSlider.value = 6;
  octreeDepthNumber.value = 6;
  syncParameterControls('brute');
}

// ====================== ESTADO INICIAL VIA URL ======================
// Permite abrir um cenário pronto para aula ou captura, por exemplo:
//   /simulador?modo=grid&n=150&paineis=1
//   /simulador?modo=sap&n=60&apresentacao=1
//   /simulador?corrida=1&n=80
// Parâmetros: modo (brute|grid|octree|sap), n (2-150), paineis=1|0, fisica=1, wireframe=1,
// corrida=1, apresentacao=1, brilho=0, rastro=0, raiox=1
function applyUrlState() {
  const params = new URLSearchParams(window.location.search);

  const mode = params.get('modo');
  if (mode) selectStrategy(mode);

  if (params.has('n')) {
    const n = Math.round(clampNumber(params.get('n'), LIMITS.cubes.min, LIMITS.cubes.max, 8));
    if (n > 20) setStressMode(true);
    setCubeCount(n);
  }

  if (params.get('paineis') === '1') setPanels({ controls: true, chart: true });
  if (params.get('paineis') === '0') setPanels({ controls: false, chart: false });
  if (params.get('fisica') === '1') togglePhysics();
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
initDefaults();
restartScene();
startTyping(STRATEGY.brute.pseudo);
updateContextPanel('brute');
animate();
applyUrlState();
