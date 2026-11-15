// Glitch da página inicial: o mesmo da troca de estratégia no simulador (three-setup.js,
// ditherShader), refeito como filtro SVG para valer em texto e imagem do DOM.
//
// Do shader vêm os números: meio segundo de duração com queda quadrática, 24 sorteios por
// segundo, ~22% das faixas horizontais deslocadas em até ±6% da largura e os canais R e B
// separados em 0,4% a 1,6% da largura. Com prefers-reduced-motion nada disso roda.

const DURATION = 500;
const TICK = 1000 / 24;
const BINS = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const hash = (n) => { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); };

let defs = null;
let nextId = 0;
const states = new WeakMap();

function svgEl(name, attrs, parent) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function getDefs() {
  if (defs) return defs;
  const svg = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(svg);
  defs = svgEl('defs', {}, svg);
  return defs;
}

// Um filtro por elemento: ruído só no eixo y (faixas), quantizado em degraus, desloca as
// faixas em x; depois R, G e B saem separados e voltam somados com R e B fora do lugar.
function buildFilter() {
  const id = `glitch-${nextId++}`;
  const f = svgEl('filter', {
    id, x: '-8%', y: '0%', width: '116%', height: '100%', 'color-interpolation-filters': 'sRGB',
  }, getDefs());
  const noise = svgEl('feTurbulence', {
    type: 'fractalNoise', baseFrequency: '0 0.045', numOctaves: '1', seed: '1', result: 'noise',
  }, f);
  // o ruído fica quase todo perto de 0.5: estica o contraste para usar todos os degraus
  const contrast = svgEl('feComponentTransfer', { in: 'noise', result: 'wide' }, f);
  svgEl('feFuncR', { type: 'linear', slope: '2.2', intercept: '-0.6' }, contrast);
  svgEl('feFuncA', { type: 'linear', slope: '0', intercept: '1' }, contrast);
  const transfer = svgEl('feComponentTransfer', { in: 'wide', result: 'map' }, f);
  const funcR = svgEl('feFuncR', { type: 'discrete', tableValues: '0.5' }, transfer);
  svgEl('feFuncG', { type: 'linear', slope: '0', intercept: '0.5' }, transfer);
  const disp = svgEl('feDisplacementMap', {
    in: 'SourceGraphic', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G', result: 'torn',
  }, f);
  svgEl('feColorMatrix', { in: 'torn', type: 'matrix', values: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', result: 'r' }, f);
  svgEl('feColorMatrix', { in: 'torn', type: 'matrix', values: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', result: 'g' }, f);
  svgEl('feColorMatrix', { in: 'torn', type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', result: 'b' }, f);
  const offR = svgEl('feOffset', { in: 'r', dx: '0', dy: '0', result: 'ro' }, f);
  const offB = svgEl('feOffset', { in: 'b', dx: '0', dy: '0', result: 'bo' }, f);
  svgEl('feBlend', { in: 'ro', in2: 'g', mode: 'screen', result: 'rg' }, f);
  svgEl('feBlend', { in: 'rg', in2: 'bo', mode: 'screen' }, f);
  return { id, noise, funcR, disp, offR, offB };
}

function frame(filter, level, tick, width, bandFreq) {
  // tear: cada degrau do mapa tem ~22% de chance de deslocar a faixa (step(0.78, hash) no shader)
  const table = [];
  for (let i = 0; i < BINS; i++) {
    const torn = hash(i * 13.7 + tick * 7.1) >= 0.78;
    table.push(torn ? hash(i + tick).toFixed(3) : '0.5');
  }
  filter.funcR.setAttribute('tableValues', table.join(' '));
  filter.noise.setAttribute('seed', String(tick % 997));
  filter.noise.setAttribute('baseFrequency', `0 ${bandFreq}`);
  // deslocamento = scale * (valor - 0.5): com scale = 0.12W dá os ±6% do shader
  filter.disp.setAttribute('scale', (0.12 * width * level).toFixed(2));
  const split = (0.004 + 0.012 * hash(tick)) * width * level;
  filter.offR.setAttribute('dx', split.toFixed(2));
  filter.offB.setAttribute('dx', (-split).toFixed(2));
}

/**
 * Roda o glitch uma vez sobre o elemento. Resolve quando termina (ou na hora, com movimento
 * reduzido). Chamar de novo durante um glitch só reinicia a intensidade.
 */
export function glitch(el, { duration = DURATION } = {}) {
  if (!el || reducedMotion.matches) return Promise.resolve();
  let st = states.get(el);
  if (st && st.running) { st.start = performance.now(); st.duration = duration; return st.done; }
  if (!st) { st = { filter: buildFilter() }; states.set(el, st); }

  const rect = el.getBoundingClientRect();
  // a largura de referência tem piso: num logo de 150px a separação de cor sumiria
  const width = Math.min(Math.max(rect.width, 420), 1400);
  // ~36 faixas na altura do simulador; num título baixo, faixas de ~22px
  const bandFreq = Math.min(0.06, Math.max(0.012, 36 / Math.max(rect.height, 1) / 2.4)).toFixed(4);

  st.running = true;
  st.start = performance.now();
  st.duration = duration;
  el.classList.add('is-glitching');
  el.style.filter = `url(#${st.filter.id})`;

  st.done = new Promise((resolve) => {
    let lastTick = -1;
    const step = (now) => {
      const t = (now - st.start) / st.duration;
      if (t >= 1) {
        el.style.filter = '';
        el.style.removeProperty('--glitch');
        el.classList.remove('is-glitching');
        st.running = false;
        el.dispatchEvent(new CustomEvent('glitch:end'));
        resolve();
        return;
      }
      const level = (1 - t) * (1 - t); // some suave no fim, como glitchLevel² no simulador
      const tick = Math.floor(now / TICK);
      if (tick !== lastTick) {
        lastTick = tick;
        frame(st.filter, level, tick, width, bandFreq);
        el.style.setProperty('--glitch', level.toFixed(3));
        el.dispatchEvent(new CustomEvent('glitch:tick', { detail: { level, tick } }));
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return st.done;
}

export const prefersReducedMotion = () => reducedMotion.matches;

// --- Ligações declarativas ---
// data-glitch="hover": ao passar o mouse ou focar (data-glitch-target escolhe um filho)
// data-glitch="enter": uma vez, quando metade do elemento entra na tela
// data-glitch="load":  uma vez, logo depois da entrada da página
function targetOf(el) {
  const sel = el.getAttribute('data-glitch-target');
  return (sel && el.querySelector(sel)) || el;
}

function wire() {
  document.querySelectorAll('[data-glitch~="hover"]').forEach((el) => {
    const run = () => glitch(targetOf(el), { duration: 380 });
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') run(); });
    el.addEventListener('focusin', run);
  });

  const onEnter = document.querySelectorAll('[data-glitch~="enter"]');
  if (onEnter.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        setTimeout(() => glitch(targetOf(entry.target), { duration: 650 }), 120);
      });
    }, { threshold: 0.5 });
    onEnter.forEach((el) => io.observe(el));
  }

  const onLoad = document.querySelectorAll('[data-glitch~="load"]');
  if (onLoad.length) {
    const fire = () => onLoad.forEach((el, i) => setTimeout(() => glitch(targetOf(el), { duration: 600 }), 760 + i * 90));
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fire);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
