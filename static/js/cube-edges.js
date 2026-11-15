// Bordas em cubos das capturas da página inicial: a borda da imagem é feita de células
// quadradas que vão sumindo para fora, como pixels perdidos do pós-processamento do simulador.
// Nada é cortado seco: as três fileiras de fora têm opacidade em degraus (mais fraca na de
// fora), os cubos "perdidos" ficam quase transparentes em vez de virar buraco, e um desfoque
// leve na máscara arredonda a quina de cada cubo sem perder o desenho em blocos.
//
// De tempos em tempos dois ou três cubos piscam; durante um glitch (evento "glitch:tick" de
// glitch.js) a borda se desfaz mais e se refaz a cada sorteio. Com movimento reduzido a borda
// fica parada.

const CELL = 14;
const DEPTH = 3;          // fileiras da borda com opacidade própria
const LEVELS = 12;        // opacidades agrupadas num caminho cada (máscara menor)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const hash = (n) => { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); };

// opacidade de um cubo presente e de um cubo perdido, por fileira (0 = a de fora)
const PRESENT = [0.5, 0.78, 0.94];
const LOST = [0.04, 0.16, 0.38];

function buildMask(w, h, seed, extra = 0, variant = 0, flicker = null) {
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const missing = new Set();
  const key = (i, j) => i * 10007 + j;
  const rnd = (i, j, v) => hash(i * 127.1 + j * 311.7 + seed * 74.7 + v * 19.3);
  const depth = (i, j) => Math.min(i, cols - 1 - i, j, rows - 1 - j);

  // Uma célula só se perde na segunda ou terceira fileira se a de fora, no mesmo lado, já se
  // perdeu: a borda se corrói de fora para dentro, sem buracos soltos no meio da imagem.
  for (let d = 0; d < DEPTH; d++) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (depth(i, j) !== d) continue;
        const di = Math.min(i, cols - 1 - i), dj = Math.min(j, rows - 1 - j);
        const corner = di <= 3 && dj <= 3 ? 0.25 : 0;
        let p = [0.3, 0.12, 0.04][d] + corner + extra * [0.45, 0.3, 0.15][d];
        if (d > 0) {
          const oi = di === d ? (i < cols / 2 ? i - 1 : i + 1) : i;
          const oj = dj === d ? (j < rows / 2 ? j - 1 : j + 1) : j;
          if (!missing.has(key(oi, oj))) p *= 0.15;
        }
        if (rnd(i, j, extra > 0 ? variant : 0) < p) missing.add(key(i, j));
      }
    }
  }
  if (flicker) for (const [i, j] of flicker) {
    const k = key(i, j);
    if (missing.has(k)) missing.delete(k); else missing.add(k);
  }

  // miolo opaco num retângulo só; cada cubo da borda num caminho da sua faixa de opacidade
  const paths = Array.from({ length: LEVELS + 1 }, () => '');
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = depth(i, j);
      if (d >= DEPTH) { i = Math.max(i, cols - 1 - DEPTH); continue; }
      const lost = missing.has(key(i, j));
      const jitter = 0.86 + 0.14 * rnd(i, j, 7);
      const a = (lost ? LOST[d] : PRESENT[d]) * jitter;
      paths[Math.round(a * LEVELS)] += `M${i * CELL} ${j * CELL}h${CELL}v${CELL}h-${CELL}Z`;
    }
  }
  const ix = DEPTH * CELL, iw = Math.max(0, (cols - DEPTH) * CELL - ix);
  const ih = Math.max(0, (rows - DEPTH) * CELL - ix);
  let body = `<rect x="${ix}" y="${ix}" width="${iw}" height="${ih}"/>`;
  paths.forEach((d, lvl) => { if (d && lvl) body += `<path fill-opacity="${(lvl / LEVELS).toFixed(3)}" d="${d}"/>`; });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<filter id="s" x="0" y="0" width="1" height="1"><feGaussianBlur stdDeviation="1.6"/></filter>`
    + `<g fill="#fff" shape-rendering="crispEdges" filter="url(#s)">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function apply(el, url) {
  el.style.maskImage = url;
  el.style.webkitMaskImage = url;
}

function edgeCells(w, h, n, v) {
  const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = hash(v * 9.1 + k * 3.7), side = Math.floor(hash(v * 4.3 + k) * 4);
    const depth = hash(v + k * 1.3) < 0.7 ? 0 : 1;
    const along = side < 2 ? Math.floor(r * cols) : Math.floor(r * rows);
    if (side === 0) out.push([along, depth]);
    else if (side === 1) out.push([along, rows - 1 - depth]);
    else if (side === 2) out.push([depth, along]);
    else out.push([cols - 1 - depth, along]);
  }
  return out;
}

document.querySelectorAll('[data-cube-edge]').forEach((el, idx) => {
  const seed = idx + 1;
  let w = 0, h = 0, base = '', flickerTimer = 0;

  const redraw = () => { base = buildMask(w, h, seed); apply(el, base); };
  new ResizeObserver(([entry]) => {
    const box = entry.borderBoxSize?.[0];
    const nw = Math.round(box ? box.inlineSize : el.offsetWidth);
    const nh = Math.round(box ? box.blockSize : el.offsetHeight);
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    if (w && h) redraw();
  }).observe(el);

  el.addEventListener('glitch:tick', (e) => {
    const { level, tick } = e.detail;
    apply(el, level > 0.02 ? buildMask(w, h, seed, level, tick) : base);
  });
  el.addEventListener('glitch:end', () => apply(el, base));

  // uns cubos que piscam sozinhos, de vez em quando
  const flicker = () => {
    flickerTimer = setTimeout(() => {
      if (!document.hidden && w && !el.classList.contains('is-glitching')) {
        const v = performance.now();
        apply(el, buildMask(w, h, seed, 0, 0, edgeCells(w, h, 2 + Math.floor(hash(v) * 3), v)));
        setTimeout(() => { if (!el.classList.contains('is-glitching')) apply(el, base); }, 90 + hash(v * 2) * 80);
      }
      flicker();
    }, 1800 + Math.random() * 3400);
  };
  if (!reducedMotion.matches) flicker();
  reducedMotion.addEventListener?.('change', () => { clearTimeout(flickerTimer); if (!reducedMotion.matches) flicker(); });
});
