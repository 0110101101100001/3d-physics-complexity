// --- landing.js — animações de rolagem da página inicial (scroll-craft) ---
// O motor (static/scrollcraft/scrollcraft.js) não é alterado: este arquivo só prepara o
// markup antes de montar e desenha o pico (o "colapso de pares") a partir de --sc-p.
(function () {
  'use strict';

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var phone = matchMedia('(max-width: 640px)').matches;
  var fmt = function (n) { return Math.round(n).toLocaleString('pt-BR'); };
  var clamp01 = function (v) { return Math.min(1, Math.max(0, v)); };
  var easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var actP = function (el) { return el ? parseFloat(el.style.getPropertyValue('--sc-p')) || 0 : 0; };

  // ---------- hero: quadros de celular e pixels sem suavização ----------
  var seq = document.querySelector('canvas[data-sc-sequence]');
  var poster = document.querySelector('.act-hero .sc-stage__poster');
  if (phone && seq && seq.dataset.mobileSequence) {
    seq.setAttribute('data-sc-sequence', seq.dataset.mobileSequence);
    if (poster && poster.dataset.mobileSrc) poster.src = poster.dataset.mobileSrc;
  }

  ScrollCraft.mount(document.body);

  // O motor desenha os quadros com drawImage; o redimensionamento do canvas reinicia o
  // contexto, então a suavização é desligada a cada desenho para manter o serrilhado.
  if (seq) {
    var sctx = seq.getContext('2d');
    var draw = sctx.drawImage.bind(sctx);
    sctx.drawImage = function () { sctx.imageSmoothingEnabled = false; return draw.apply(null, arguments); };
  }

  // ---------- hero: contador da placa (1.770 = 60 × 59 / 2), formatado em pt-BR ----------
  var heroAct = document.querySelector('.act-hero');
  var heroCount = document.getElementById('heroCount');
  var heroTarget = heroCount ? Number(heroCount.dataset.target) : 0;
  var lastHero = -1;

  // ---------- pico: o colapso de pares ----------
  var peakAct = document.getElementById('estrategias');
  var cv = document.getElementById('pairsCanvas');
  var countEl = document.getElementById('peakCount');
  var unitEl = document.getElementById('peakUnit');
  var legendEl = document.getElementById('peakLegend');
  var ctx = cv ? cv.getContext('2d') : null;
  var data = null, bruteIdx = null, lastP = -1, dirty = true;
  var C = { brute: '255,113,57', grid: '0,221,255', octree: '168,85,247', ink: '228,228,231' };

  function resize() {
    if (!cv) return;
    var box = cv.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(box.width * dpr));
    cv.height = Math.max(1, Math.round(box.height * dpr));
    dirty = true;
  }

  // Vista de cima (x, z). A caixa do simulador vai de -20 a 20; a margem cobre os cubos da borda.
  function projector() {
    var w = cv.width, h = cv.height, pad = Math.min(w, h) * 0.07;
    var side = Math.min(w, h) - pad * 2;
    var s = side / 44, ox = (w - side) / 2 + side / 2, oz = (h - side) / 2 + side / 2;
    return { s: s, x: function (x) { return ox + x * s; }, z: function (z) { return oz + z * s; } };
  }

  function lines(pairs, count, P, rgb, alpha, width) {
    if (alpha <= 0.004 || !count) return;
    var cubes = data.cubes;
    ctx.beginPath();
    for (var k = 0; k < count; k++) {
      var a = cubes[pairs[k][0]], b = cubes[pairs[k][1]];
      ctx.moveTo(P.x(a[0]), P.z(a[2]));
      ctx.lineTo(P.x(b[0]), P.z(b[2]));
    }
    ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')';
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function render(p) {
    var P = projector(), dpr = cv.width / Math.max(1, cv.getBoundingClientRect().width);
    var n = data.counts;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // fases: 0-0.30 a força bruta preenche; 0.38-0.60 a grade derruba; 0.68-0.90 a Octree subdivide
    var tA = easeOut(clamp01(p / 0.30));
    var tB = easeInOut(clamp01((p - 0.38) / 0.22));
    var tC = easeInOut(clamp01((p - 0.68) / 0.22));
    if (reduce) { tA = 1; tB = p >= 0.36 ? 1 : 0; tC = p >= 0.66 ? 1 : 0; }

    var shown = Math.round(tA * n.brute);
    var bruteAlpha = 0.18 * (1 - tB);
    var gridAlpha = tB * (1 - tC);

    // 1. força bruta: os pares na ordem do laço i < j, aparecendo conforme a rolagem
    lines(bruteIdx, shown, P, C.brute, bruteAlpha, 1 * dpr);

    // 2. grade: células ocupadas (vistas de cima) e só os pares que dividem célula
    if (gridAlpha > 0.004) {
      var cs = data.grid.cell * P.s;
      ctx.fillStyle = 'rgba(' + C.grid + ',' + 0.09 * gridAlpha + ')';
      ctx.strokeStyle = 'rgba(' + C.grid + ',' + 0.28 * gridAlpha + ')';
      ctx.lineWidth = 1 * dpr;
      for (var i = 0; i < data.grid.cellsXZ.length; i++) {
        var c = data.grid.cellsXZ[i], gx = P.x(c[0] * data.grid.cell), gz = P.z(c[1] * data.grid.cell);
        ctx.fillRect(gx, gz, cs, cs);
        ctx.strokeRect(gx, gz, cs, cs);
      }
      lines(data.grid.pairs, data.grid.pairs.length, P, C.grid, 0.95 * gridAlpha, 1.6 * dpr);
    }

    // 3. Octree: os nós aparecem por profundidade, depois os pares que ela testa
    if (tC > 0.004) {
      var maxD = 0;
      for (var d = 0; d < data.octree.nodes.length; d++) maxD = Math.max(maxD, data.octree.nodes[d][3]);
      for (var m = 0; m < data.octree.nodes.length; m++) {
        var nd = data.octree.nodes[m];
        var vis = clamp01(tC * (maxD + 1) - nd[3]);
        if (vis <= 0) continue;
        ctx.strokeStyle = 'rgba(' + C.octree + ',' + (0.75 - nd[3] * 0.08) * vis + ')';
        ctx.lineWidth = (nd[3] === 0 ? 1.6 : 1) * dpr;
        ctx.strokeRect(P.x(nd[0]), P.z(nd[1]), nd[2] * P.s, nd[2] * P.s);
      }
      lines(data.octree.pairs, Math.round(clamp01((tC - 0.35) / 0.65) * data.octree.pairs.length), P, C.octree, 0.3, 1 * dpr);
    }

    // os cubos por cima, no tamanho real visto de cima
    ctx.fillStyle = 'rgba(' + C.ink + ',' + (0.55 + 0.3 * tB) + ')';
    for (var q = 0; q < data.cubes.length; q++) {
      var cb = data.cubes[q], sz = Math.max(2 * dpr, cb[3] * P.s * 0.3);
      ctx.fillRect(P.x(cb[0]) - sz / 2, P.z(cb[2]) - sz / 2, sz, sz);
    }

    // contador: exatamente quantas linhas a fase atual representa
    var value, colour, unit;
    if (tC > 0) { value = n.grid + (n.octree - n.grid) * tC; colour = 'var(--c-octree)'; unit = 'pares testados pela Octree'; }
    else if (tB > 0) { value = n.brute + (n.grid - n.brute) * tB; colour = 'var(--c-grid)'; unit = 'pares testados pela grade'; }
    else { value = shown; colour = 'var(--c-brute)'; unit = 'pares testados pela força bruta'; }
    countEl.textContent = fmt(value);
    countEl.style.setProperty('--peak-colour', colour);
    countEl.parentNode.style.setProperty('--peak-colour', colour);
    unitEl.textContent = unit;
    legendEl.textContent = 'vista de cima · 150 cubos · ' + fmt(n.collisions) + ' colisões reais';
  }

  function tick() {
    // placa do hero: conta de 0 a 1.770 enquanto aparece
    if (heroCount && heroAct) {
      var hp = actP(heroAct);
      var hv = reduce ? heroTarget : Math.round(easeOut(clamp01((hp - 0.42) / 0.3)) * heroTarget);
      if (hv !== lastHero) { heroCount.textContent = fmt(hv); lastHero = hv; }
    }
    if (data && ctx) {
      var p = actP(peakAct);
      if (dirty || Math.abs(p - lastP) > 0.0005) { render(p); lastP = p; dirty = false; }
    }
    requestAnimationFrame(tick);
  }

  if (cv) {
    fetch('static/data/broadphase-150.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        data = d;
        bruteIdx = [];
        for (var i = 0; i < d.cubes.length; i++) for (var j = i + 1; j < d.cubes.length; j++) bruteIdx.push([i, j]);
        resize();
      })
      .catch(function () { if (legendEl) legendEl.textContent = 'não foi possível carregar os pares'; });
    addEventListener('resize', resize);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv);
  }
  requestAnimationFrame(tick);
})();
