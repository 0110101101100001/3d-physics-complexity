// --- three-setup.js — Configuração base do Three.js e pós-processamento ---
// Exporta instâncias e helpers partilhados pelos módulos physics.js e ui.js.
// Three.js vem do import map de simulador.html ("three" e "three/addons/").

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// A estética foi ajustada na r128, antes da gestão de cor e das luzes físicas. Para a
// cena continuar igual: cores sem conversão sRGB e saída linear, como era o padrão.
THREE.ColorManagement.enabled = false;

// Cena
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1b1f);
scene.fog = new THREE.FogExp2(0x1b1b1f, 0.008);

// Câmera
export const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 40, 70);
camera.lookAt(0, 0, 0);

// Renderer (estética retro PS2)
export const pixelScale = 0.5;
export const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale, false);
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Sombras
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// OrbitControls
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 15;
controls.maxDistance = 150;

// Clock
export const clock = new THREE.Clock();

// Luzes. Desde a r155 as intensidades são físicas: o fator PI devolve o brilho que
// estes valores davam no modo antigo.
const AMBIENT_INTENSITY = 0.7 * Math.PI;
const DIR_INTENSITY = 1.5 * Math.PI;
const ambientLight = new THREE.AmbientLight(0xffe0d0, AMBIENT_INTENSITY);
scene.add(ambientLight);
export const dirLight = new THREE.DirectionalLight(0xffffff, DIR_INTENSITY);
dirLight.position.set(10, 30, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 150;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// ====================== PISO REATIVO ======================
// A grade do chão é um plano subdividido com as linhas desenhadas no shader. Cada
// colisão solta uma ondulação que se espalha a partir do ponto de impacto: o vértice
// sobe e desce com a soma das ondas ativas e as linhas acendem na crista.
const MAX_RIPPLES = 24;
const RIPPLE_LIFE = 1.4;          // segundos até a onda sumir
const RIPPLE_MIN_INTERVAL = 0.06; // MAX_RIPPLES * intervalo > vida: uma onda nunca é cortada no meio
const rippleSlots = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0));

const floorUniforms = THREE.UniformsUtils.merge([
  THREE.UniformsLib.fog,
  {
    uTime: { value: 0 },
    uRipples: { value: rippleSlots },
    uLineColor: { value: new THREE.Color(0x2b2a33) },
    uCenterColor: { value: new THREE.Color(0x3d3a4a) },
    uRippleColor: { value: new THREE.Color(0xffaa00) },
    uGlowOnly: { value: 0 },
    uDim: { value: 0 },        // 0 a 1: raio-X (o piso apaga para a estrutura aparecer)
  },
]);
// merge() clona os valores: o shader precisa ler os mesmos Vector4 que triggerShockwave escreve
floorUniforms.uRipples.value = rippleSlots;

const floorMaterial = new THREE.ShaderMaterial({
  uniforms: floorUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
  vertexShader: `
    #define MAX_RIPPLES ${MAX_RIPPLES}
    uniform float uTime;
    uniform vec4 uRipples[MAX_RIPPLES]; // x, z, instante do impacto, força
    varying vec2 vXZ;
    varying float vGlow;
    #include <fog_pars_vertex>

    void main() {
      vec3 pos = position;
      float height = 0.0;
      float glow = 0.0;
      for (int i = 0; i < MAX_RIPPLES; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(2)}) continue;
        float front = age * 15.0;                       // raio da frente de onda
        float d = distance(pos.xz, r.xy) - front;
        float env = exp(-d * d / 6.0) * r.w * (1.0 - age / ${RIPPLE_LIFE.toFixed(2)}) / (1.0 + front * 0.12);
        height += sin(d * 2.2) * env;
        glow += env;
      }
      pos.y += height * 0.9;
      vXZ = position.xz;
      vGlow = glow;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: `
    uniform vec3 uLineColor;
    uniform vec3 uCenterColor;
    uniform vec3 uRippleColor;
    uniform float uGlowOnly;
    uniform float uDim;
    varying vec2 vXZ;
    varying float vGlow;
    #include <fog_pars_fragment>

    void main() {
      vec2 fw = fwidth(vXZ);
      vec2 g = abs(fract(vXZ - 0.5) - 0.5) / fw;
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      // longe da câmera as linhas ficam mais finas que um pixel: esmaece em vez de serrilhar
      line *= mix(0.3, 1.0, 1.0 - smoothstep(0.35, 0.9, max(fw.x, fw.y)));
      vec2 c = abs(vXZ) / fw;
      float center = 1.0 - min(min(c.x, c.y), 1.0);

      float glow = clamp(vGlow, 0.0, 1.0);
      vec3 color = mix(mix(uLineColor, uCenterColor, center), uRippleColor, glow * 0.85);
      float alpha = line + glow * 0.08 * (1.0 - line);
      color *= 1.0 - 0.7 * uDim;
      alpha *= 1.0 - 0.45 * uDim;
      if (uGlowOnly > 0.5) {        // passe de brilho: só a crista das ondas emite luz
        color = uRippleColor;
        alpha = glow * (line * 0.45 + 0.03);
      }
      gl_FragColor = vec4(color, alpha);
      #include <fog_fragment>
    }
  `,
});

const floorGeometry = new THREE.PlaneGeometry(50, 50, 96, 96);
floorGeometry.rotateX(-Math.PI / 2);
export const floorGrid = new THREE.Mesh(floorGeometry, floorMaterial);
floorGrid.frustumCulled = false; // os vértices saem do plano original
scene.add(floorGrid);

let rippleIndex = 0;
let lastRippleTime = -1000;

// Solta uma ondulação no piso sob o ponto de impacto. strength vai de 0 a 1.
// Com muitas colisões por frame só uma a cada RIPPLE_MIN_INTERVAL entra, para as
// ondas terem tempo de se espalhar antes de o espaço delas ser reaproveitado.
export function triggerShockwave(pos, strength = 0.6) {
  const now = floorUniforms.uTime.value;
  if (now - lastRippleTime < RIPPLE_MIN_INTERVAL) return;
  lastRippleTime = now;
  rippleSlots[rippleIndex].set(pos.x, pos.z, now, 0.4 + 0.8 * THREE.MathUtils.clamp(strength, 0, 1));
  rippleIndex = (rippleIndex + 1) % MAX_RIPPLES;
}

const axesHelper = new THREE.AxesHelper(25);
axesHelper.visible = false;
scene.add(axesHelper);

// Plano recetor de sombra
const shadowPlaneGeo = new THREE.PlaneGeometry(100, 100);
const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.4 });
const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = -0.01;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// Caixa de confinamento
const cageGeo = new THREE.BoxGeometry(40, 20, 40);
const cageEdges = new THREE.EdgesGeometry(cageGeo);
const cageMat = new THREE.LineBasicMaterial({
  color: 0x6e6b85,
  transparent: true,
  opacity: 0.7
});
const cageMesh = new THREE.LineSegments(cageEdges, cageMat);
cageMesh.position.set(0, 10, 0);
scene.add(cageMesh);

// Luz de impacto
// decay 0: queda só pela distância de corte, perto do modelo antigo (não físico)
export const impactLight = new THREE.PointLight(0xffaa00, 0, 25, 0);
scene.add(impactLight);
export const lightTimer = { value: 0 };

export function triggerImpactLight(pos) {
  impactLight.position.copy(pos);
  impactLight.intensity = 8 * Math.PI;
  lightTimer.value = 0.12;
}

// Hover box helper
export const hoverBoxHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x00ffcc);
hoverBoxHelper.visible = false;
scene.add(hoverBoxHelper);

// Linha de projeção vertical (height drop line)
const dropLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const dropLineMat = new THREE.LineDashedMaterial({
  color: 0x00ffcc,
  dashSize: 0.4,
  gapSize: 0.2,
  linewidth: 1.5
});
export const dropLineMesh = new THREE.Line(dropLineGeo, dropLineMat);
dropLineMesh.visible = false;
scene.add(dropLineMesh);

// Gizmo de células ativas da Grade Espacial
export const gridDebugGroup = new THREE.Group();
scene.add(gridDebugGroup);

// Gizmo de nós da Octree
export const octreeDebugGroup = new THREE.Group();
scene.add(octreeDebugGroup);

// Preenchimento das células e nós no raio-X (mais claro onde há mais testes)
export const gridHeatGroup = new THREE.Group();
scene.add(gridHeatGroup);
export const octreeHeatGroup = new THREE.Group();
scene.add(octreeHeatGroup);

// Régua do Sweep and Prune: intervalos no eixo X com cor por segmento, e o plano da
// varredura atravessando a arena (os dois preenchidos por renderSapDebug)
const SAP_MAX_SEGMENTS = 3 * 160 + 2;
const sapDebugGeo = new THREE.BufferGeometry();
sapDebugGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SAP_MAX_SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
sapDebugGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SAP_MAX_SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
sapDebugGeo.setDrawRange(0, 0);
export const sapDebugMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
export const sapDebugLines = new THREE.LineSegments(sapDebugGeo, sapDebugMat);
sapDebugLines.frustumCulled = false;

const sapSweepGeo = new THREE.PlaneGeometry(1, 1);
sapSweepGeo.rotateY(Math.PI / 2); // plano YZ: a escala x vira profundidade em z
export const sapSweepMat = new THREE.MeshBasicMaterial({
  color: 0xa3e635, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
  depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
export const sapSweepMesh = new THREE.Mesh(sapSweepGeo, sapSweepMat);
sapSweepMesh.visible = false;
sapSweepMesh.raycast = () => {};

export const sapDebugGroup = new THREE.Group();
sapDebugGroup.add(sapDebugLines, sapSweepMesh);
scene.add(sapDebugGroup);

// ====================== PARTICLE SYSTEM — IMPACT SPARKS ======================
export class ParticleSystem {
  constructor(maxParticles = 200) {
    this.maxParticles = maxParticles;
    this.particles = new Array(maxParticles).fill(null);
    this.free = [];

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);

    for (let i = 0; i < maxParticles; i++) this.free.push(i);
  }

  spawn(position, count = 5 + Math.floor(Math.random() * 6)) {
    for (let i = 0; i < count && this.free.length > 0; i++) {
      const idx = this.free.pop();
      const p = {};

      p.position = position.clone();

      const speed = 2 + Math.random() * 3;
      const phi = Math.random() * Math.PI * 2;
      const costheta = 2 * Math.random() - 1;
      const sintheta = Math.sqrt(1 - costheta * costheta);
      p.velocity = new THREE.Vector3(
        sintheta * Math.cos(phi) * speed,
        sintheta * Math.sin(phi) * speed,
        costheta * speed
      );

      p.life = 0;
      p.maxLife = 0.2 + Math.random() * 0.2;

      p.color = new THREE.Color(0xffaa00);
      p.size = 0.1 + Math.random() * 0.05;

      this.particles[idx] = p;

      const posAttr = this.points.geometry.attributes.position;
      const colAttr = this.points.geometry.attributes.color;
      const sizeAttr = this.points.geometry.attributes.size;

      posAttr.setXYZ(idx, p.position.x, p.position.y, p.position.z);
      colAttr.setXYZ(idx, p.color.r, p.color.g, p.color.b);
      sizeAttr.setX(idx, p.size);

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    }
  }

  update(delta) {
    let dirty = false;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p) continue;

      p.life += delta;
      if (p.life >= p.maxLife) {
        this.free.push(i);
        this.particles[i] = null;
        const sizeAttr = this.points.geometry.attributes.size;
        sizeAttr.setX(i, 0);
        sizeAttr.needsUpdate = true;
        continue;
      }

      p.velocity.y -= 9.8 * 0.3 * delta;
      p.position.addScaledVector(p.velocity, delta);

      const alpha = 1 - p.life / p.maxLife;
      const posAttr = this.points.geometry.attributes.position;
      const colAttr = this.points.geometry.attributes.color;
      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
      colAttr.setXYZ(i, p.color.r * alpha, p.color.g * alpha, p.color.b * alpha);
      dirty = true;
    }

    if (dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

export const impactParticles = new ParticleSystem();

// ====================== LASER TEST LINES (VISUALIZAÇÃO BIG-O) ======================
export const MAX_PAIR_LINES = 12000;
export const pairLinesGeo = new THREE.BufferGeometry();
export const pairLinesPos = new Float32Array(MAX_PAIR_LINES * 2 * 3);
pairLinesGeo.setAttribute('position', new THREE.BufferAttribute(pairLinesPos, 3).setUsage(THREE.DynamicDrawUsage));

export const pairLinesMat = new THREE.LineBasicMaterial({
  color: 0xff7139, // cor inicial = modo Força Bruta; ver setPairLineColor
  transparent: true,
  opacity: 0.35,
  blending: THREE.AdditiveBlending
});
export const pairLinesMesh = new THREE.LineSegments(pairLinesGeo, pairLinesMat);
scene.add(pairLinesMesh);

export let activePairLineCount = 0;

export function clearPairLines() {
  activePairLineCount = 0;
}

export function addPairLine(posA, posB) {
  if (activePairLineCount >= MAX_PAIR_LINES) return;
  const idx = activePairLineCount * 6;
  pairLinesPos[idx] = posA.x; pairLinesPos[idx + 1] = posA.y; pairLinesPos[idx + 2] = posA.z;
  pairLinesPos[idx + 3] = posB.x; pairLinesPos[idx + 4] = posB.y; pairLinesPos[idx + 5] = posB.z;
  activePairLineCount++;
}

export function updatePairLinesBuffer() {
  pairLinesGeo.setDrawRange(0, activePairLineCount * 2);
  // Envia à GPU só o trecho usado do buffer (na corrida ele é reenviado uma vez por coluna)
  const attr = pairLinesGeo.attributes.position;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, activePairLineCount * 6);
  attr.needsUpdate = true;
}

// --- Rastro de fósforo ---
// As linhas dos pares deixam um rastro que some em ~0,8 s, como o fósforo de um
// osciloscópio. A cada 1/15 s o buffer do frame é copiado para a fatia mais antiga de um
// anel de 12; cada fatia é desenhada com a cor que as linhas tinham quando ela foi gravada.
// Numa troca de estratégia o rastro da cor antiga se apaga enquanto as linhas novas
// aparecem. Fica fora da medição: só copia o que já foi desenhado.
//
// Para aparecer sem estourar o brilho:
// - a fatia nasce invisível e acende em 0,12 s: a mais nova fica quase em cima da linha
//   atual e só a engrossaria; o rastro aparece onde a linha já saiu do lugar;
// - depois cai com idade^2,2 (forte no começo, cauda curta);
// - com muitas linhas (força bruta, 150 cubos = 11 mil) e no raio-X ele enfraquece, senão
//   a sobreposição vira uma mancha branca.
const TRAIL_SLOTS = 12;
const TRAIL_INTERVAL = 1 / 15;
const TRAIL_LIFE = TRAIL_SLOTS * TRAIL_INTERVAL;
const TRAIL_STRENGTH = 0.55;
const TRAIL_FADE_IN = 0.12;
const TRAIL_DENSE = 900; // acima disto o rastro enfraquece na proporção (até 1/4)
const trailSlots = [];
for (let i = 0; i < TRAIL_SLOTS; i++) {
  const pos = new Float32Array(MAX_PAIR_LINES * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: 0xff7139, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.visible = false;
  mesh.frustumCulled = false; // o buffer muda a cada gravação; a esfera de corte ficaria velha
  scene.add(mesh);
  trailSlots.push({ pos, geo, mat, mesh, age: Infinity, count: 0 });
}
let trailEnabled = true;
let trailClock = 0;
let trailNext = 0;

export function setTrailEnabled(on) {
  trailEnabled = on;
  if (!on) for (const t of trailSlots) { t.age = Infinity; t.mesh.visible = false; }
}
export const isTrailEnabled = () => trailEnabled;

// capture=false (pausado, corrida) deixa o rastro existente apagar sem gravar outro
export function updatePairTrail(delta, capture) {
  for (const t of trailSlots) {
    t.age += delta;
    const k = 1 - t.age / TRAIL_LIFE;
    t.mesh.visible = trailEnabled && k > 0 && t.count > 0;
    if (!t.mesh.visible) continue;
    const fadeIn = Math.min(1, t.age / TRAIL_FADE_IN);
    const density = Math.max(0.25, Math.min(1, TRAIL_DENSE / t.count));
    const strength = TRAIL_STRENGTH * density * (1 - 0.6 * xray.level);
    t.mat.opacity = pairLinesMat.opacity * strength * fadeIn * Math.pow(k, 2.2);
  }
  if (!trailEnabled || !capture) { trailClock = 0; return; }
  trailClock += delta;
  if (trailClock < TRAIL_INTERVAL) return;
  trailClock %= TRAIL_INTERVAL;
  const t = trailSlots[trailNext];
  trailNext = (trailNext + 1) % TRAIL_SLOTS;
  const n = activePairLineCount * 6;
  t.pos.set(pairLinesPos.subarray(0, n));
  t.geo.setDrawRange(0, activePairLineCount * 2);
  const attr = t.geo.attributes.position;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n);
  attr.needsUpdate = true;
  t.mat.color.copy(pairLinesMat.color);
  t.count = activePairLineCount;
  t.age = 0;
}

// Chamado só na troca de modo (antes era lido via getComputedStyle a cada frame)
export function setPairLineColor(cssColor) {
  pairLinesMat.color.setStyle(cssColor);
}

export const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

// Cores partilhadas (usadas por physics.js e ui.js)
export const CUBE_PALETTES = {
  brute: [
    new THREE.Color(0xff5c00),
    new THREE.Color(0xff8c00),
    new THREE.Color(0xe63900),
    new THREE.Color(0xffaa33),
  ],
  grid: [
    new THREE.Color(0x00c2d4),
    new THREE.Color(0x00eeff),
    new THREE.Color(0x009eb3),
    new THREE.Color(0x33d6e8),
  ],
  // violetas puxados para o azul: o rosa da colisão fica longe deles
  octree: [
    new THREE.Color(0x8b5cf6),
    new THREE.Color(0x6d28d9),
    new THREE.Color(0xa78bfa),
    new THREE.Color(0x7c3aed),
  ],
  sap: [
    new THREE.Color(0x84cc16),
    new THREE.Color(0xa3e635),
    new THREE.Color(0x65a30d),
    new THREE.Color(0xbef264),
  ],
};

// Fora das quatro paletas (laranja, ciano, roxo, verde): a colisão se destaca em qualquer modo
export const COLLISION_COLOR = new THREE.Color(0xff2e88);
export const DRAG_COLOR = new THREE.Color(0xffdd44);

// ====================== PÓS-PROCESSAMENTO: BRILHO + DITHERING + SCANLINES CRT ======================
const viewSize = () => new THREE.Vector2(window.innerWidth * pixelScale, window.innerHeight * pixelScale);

// --- Brilho neon (bloom seletivo) ---
// A cena é desenhada duas vezes. Na primeira ("passe de brilho") só emite luz o que deve
// brilhar: linhas de teste, gizmos, cubos em colisão, faíscas e a crista das ondas do
// piso; o resto fica preto, mas continua tapando o que está atrás. Essa imagem é borrada
// pelo UnrealBloomPass e somada à cena normal no passe final, antes do dithering.
const BLOOM_MIX = 0.7;
let bloomEnabled = true;

// Render targets de 8 bits, como na r128: desde a r152 o padrão é half-float, e as
// milhares de linhas somadas passam de 1.0 e estouram o brilho.
const ldrTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });

const bloomComposer = new EffectComposer(renderer, ldrTarget());
bloomComposer.renderToScreen = false;
bloomComposer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);
bloomComposer.addPass(new RenderPass(scene, camera));
// força, raio, limiar: limiar 0 porque o passe de brilho já contém só o que emite luz
bloomComposer.addPass(new UnrealBloomPass(viewSize(), 1.0, 0.55, 0.0));

export function setBloomEnabled(on) {
  bloomEnabled = on;
}

const BLACK = new THREE.Color(0x000000);
const _sceneBackground = scene.background;
const _fogColor = scene.fog.color.clone();

function beginGlowPass() {
  scene.background = BLACK;
  scene.fog.color.copy(BLACK);
  floorUniforms.uGlowOnly.value = 1;
  cageMesh.visible = false;
  shadowPlane.visible = false;
  renderer.shadowMap.autoUpdate = false; // as sombras são recalculadas só no passe normal
}

function endGlowPass() {
  scene.background = _sceneBackground;
  scene.fog.color.copy(_fogColor);
  floorUniforms.uGlowOnly.value = 0;
  cageMesh.visible = true;
  shadowPlane.visible = true;
  renderer.shadowMap.autoUpdate = true;
}

export const composer = new EffectComposer(renderer, ldrTarget());
composer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

export const ditherShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    bloomMix: { value: 0 },
    glitch: { value: 0 },   // 0 a 1: intensidade da falha (troca de estratégia)
    xray: { value: 0 },     // 0 a 1: raio-X (tom frio e vinheta)
    time: { value: 0 },
    resolution: { value: viewSize() }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float bloomMix;
  uniform float glitch;
  uniform float xray;
  uniform float time;
  uniform vec2 resolution;
  varying vec2 vUv;

  float getBayer(int x, int y) {
    if (y == 0) {
      if (x == 0) return 0.0; if (x == 1) return 8.0; if (x == 2) return 2.0; return 10.0;
    } else if (y == 1) {
      if (x == 0) return 12.0; if (x == 1) return 4.0; if (x == 2) return 14.0; return 6.0;
    } else if (y == 2) {
      if (x == 0) return 3.0; if (x == 1) return 11.0; if (x == 2) return 1.0; return 9.0;
    } else {
      if (x == 0) return 15.0; if (x == 1) return 7.0; if (x == 2) return 13.0; return 5.0;
    }
  }

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  vec3 sampleScene(vec2 uv) {
    return texture2D(tDiffuse, uv).rgb + texture2D(tBloom, uv).rgb * bloomMix;
  }

  void main() {
    vec2 uv = vUv;
    vec3 color;

    if (glitch > 0.0) {
      // faixas horizontais deslocadas e canais R/B separados
      float row = floor(uv.y * 36.0);
      float tick = floor(time * 24.0);
      float tear = step(0.78, hash(row * 13.7 + tick * 7.1));
      uv.x += tear * (hash(row + tick) - 0.5) * 0.12 * glitch;
      float split = (0.004 + 0.012 * hash(tick)) * glitch;
      color = vec3(
        sampleScene(uv + vec2(split, 0.0)).r,
        sampleScene(uv).g,
        sampleScene(uv - vec2(split, 0.0)).b
      );
    } else {
      color = sampleScene(uv);
    }

    if (xray > 0.0) {
      // raio-X: tom frio e bordas escuras, a estrutura fica no centro da atenção
      color = mix(color, color * vec3(0.8, 0.97, 1.15), xray * 0.6);
      float v = smoothstep(0.3, 0.95, length(vUv - 0.5) * 1.35);
      color *= 1.0 - xray * 0.6 * v;
    }

    int x = int(mod(gl_FragCoord.x, 4.0));
    int y = int(mod(gl_FragCoord.y, 4.0));

    float bayer = getBayer(x, y);
    float dither = (bayer / 15.0) - 0.5;
    vec3 retroColor = color + dither * 0.15;
    retroColor = floor(retroColor * 12.0) / 12.0;

    float scanline = sin(vUv.y * resolution.y * 3.1415) * 0.04 * (1.0 + 4.0 * glitch);
    retroColor -= scanline;

    gl_FragColor = vec4(retroColor, 1.0);
  }
`
};

export const ditherPass = new ShaderPass(ditherShader);
ditherPass.renderToScreen = true;
composer.addPass(ditherPass);

// --- Falha de sinal (glitch) na troca de estratégia ---
const GLITCH_DURATION = 0.5;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotion.matches;
let glitchLevel = 0;

export function triggerGlitch() {
  if (!reducedMotion.matches) glitchLevel = 1;
}

// --- Raio-X (segurar X) ---
// A cena apaga (luzes, piso, caixa, sombras) e os cubos viram fantasmas; physics.js lê
// xray.level para acender a estrutura da estratégia. Com movimento reduzido não há
// transição, a cena muda de uma vez.
export const xray = { level: 0, target: 0 };
export function setXray(on) { xray.target = on ? 1 : 0; }

function updateXray(delta) {
  const rate = reducedMotion.matches ? 1 : Math.min(1, delta * 9);
  xray.level += (xray.target - xray.level) * rate;
  if (Math.abs(xray.target - xray.level) < 0.003) xray.level = xray.target;
  const l = xray.level;
  ambientLight.intensity = AMBIENT_INTENSITY * (1 - 0.75 * l);
  dirLight.intensity = DIR_INTENSITY * (1 - 0.75 * l);
  floorUniforms.uDim.value = l;
  cageMat.opacity = 0.7 * (1 - 0.6 * l);
  shadowPlaneMat.opacity = 0.4 * (1 - l);
  ditherPass.uniforms.xray.value = l;
}

// Avança os efeitos que dependem do tempo (ondas do piso e glitch). Uma vez por frame.
export function updateSceneEffects(delta) {
  floorUniforms.uTime.value += delta;
  updateXray(delta);
  glitchLevel = Math.max(0, glitchLevel - delta / GLITCH_DURATION);
  ditherPass.uniforms.glitch.value = glitchLevel * glitchLevel; // some suave no fim
  ditherPass.uniforms.time.value = floorUniforms.uTime.value;
}

// Desenha a vista atual: passe de brilho (se ligado) e depois a cena com dithering.
// glowHooks.begin/end deixam quem conhece os objetos (physics.js) escurecer o que não
// deve brilhar e desfazer em seguida.
export function renderView(glowHooks) {
  if (bloomEnabled) {
    beginGlowPass();
    glowHooks?.begin?.();
    bloomComposer.render();
    glowHooks?.end?.();
    endGlowPass();
    ditherPass.uniforms.tBloom.value = bloomComposer.readBuffer.texture;
    ditherPass.uniforms.bloomMix.value = BLOOM_MIX;
  } else {
    ditherPass.uniforms.bloomMix.value = 0;
  }
  composer.render();
}

// ====================== VISTAS (colunas) E REDIMENSIONAMENTO ======================
// Normalmente há uma vista só, na tela inteira. Na corrida a tela é dividida em colunas
// iguais e a mesma cena é desenhada uma vez por coluna: a câmera e o pós-processamento
// passam a ter o tamanho de uma coluna.
let viewColumns = 1;
const COLUMN_VIEW_SHIFT = 0.12; // fração da altura que a imagem desce nas colunas

export function handleResize() {
  const w = window.innerWidth * pixelScale;
  const h = window.innerHeight * pixelScale;
  const viewW = Math.max(1, Math.floor(w / viewColumns));
  camera.aspect = viewW / h;
  if (viewColumns > 1) {
    // Colunas são altas e estreitas, e o topo de cada uma tem o placar: a imagem
    // desce um pouco para a arena ficar no meio da área livre.
    camera.setViewOffset(viewW, h, 0, -h * COLUMN_VIEW_SHIFT, viewW, h);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(viewW, h);
  bloomComposer.setSize(viewW, h);
  ditherPass.material.uniforms.resolution.value.set(viewW, h);
}

export function setViewColumns(n) {
  viewColumns = Math.max(1, Math.round(n));
  handleResize();
}

// Desenha a cena uma vez por coluna. beforeEach(i) prepara o que muda de uma coluna
// para a outra (linhas de teste, gizmos, cores). O passe final do composer desenha no
// viewport do renderer, então basta mover viewport e recorte antes de cada render.
const _fullSize = new THREE.Vector2();
export function renderColumns(beforeEach, glowHooks) {
  const cw = renderer.domElement.width;
  const ch = renderer.domElement.height;
  const vw = Math.floor(cw / viewColumns);
  renderer.setScissorTest(true);
  for (let i = 0; i < viewColumns; i++) {
    const x = i * vw;
    const w = i === viewColumns - 1 ? cw - x : vw;
    renderer.setViewport(x, 0, w, ch);
    renderer.setScissor(x, 0, w, ch);
    beforeEach(i);
    renderView(glowHooks);
  }
  renderer.setScissorTest(false);
  renderer.getSize(_fullSize);
  renderer.setViewport(0, 0, _fullSize.x, _fullSize.y);
}
