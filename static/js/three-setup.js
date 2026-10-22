// --- three-setup.js — Configuração base do Three.js e pós-processamento ---
// Exporta instâncias e helpers partilhados pelos módulos physics.js e ui.js.
// Three.js é carregado globalmente via CDN (window.THREE) pelo index.html.

const THREE = window.THREE;

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
document.body.appendChild(renderer.domElement);

// Sombras
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// OrbitControls
export const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 15;
controls.maxDistance = 150;

// Clock
export const clock = new THREE.Clock();

// Luzes
scene.add(new THREE.AmbientLight(0xffe0d0, 0.7));
export const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
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

scene.add(new THREE.GridHelper(50, 50, 0x3d3a4a, 0x2b2a33));

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
export const impactLight = new THREE.PointLight(0xffaa00, 0, 25);
scene.add(impactLight);
export const lightTimer = { value: 0 };

export function triggerImpactLight(pos) {
  impactLight.position.copy(pos);
  impactLight.intensity = 8;
  lightTimer.value = 0.12;
}

// Ondas de choque
export const shockwaves = [];
const shockwaveGeo = new THREE.RingGeometry(0.1, 0.4, 32);

export function triggerShockwave(pos) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8
  });
  const ring = new THREE.Mesh(shockwaveGeo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  scene.add(ring);
  shockwaves.push({ mesh: ring, scale: 1, opacity: 0.8 });
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

      const progress = p.life / p.maxLife;
      const alpha = 1 - progress;
      const fadedColor = p.color.clone().multiplyScalar(alpha);

      const posAttr = this.points.geometry.attributes.position;
      const colAttr = this.points.geometry.attributes.color;
      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
      colAttr.setXYZ(i, fadedColor.r, fadedColor.g, fadedColor.b);

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
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
  color: 0xff7139,
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
  pairLinesGeo.attributes.position.needsUpdate = true;

  const modeColorStr = getComputedStyle(document.documentElement).getPropertyValue('--mode-color').trim();
  if (modeColorStr) pairLinesMat.color.setStyle(modeColorStr);
}

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
  octree: [
    new THREE.Color(0x9b4dca),
    new THREE.Color(0x7b2cbf),
    new THREE.Color(0xc084fc),
    new THREE.Color(0xb06fe8),
  ],
};

export const COLLISION_COLOR = new THREE.Color(0xff2a2a);
export const DRAG_COLOR = new THREE.Color(0xffdd44);

// ====================== PÓS-PROCESSAMENTO: DITHERING + SCANLINES CRT ======================
export const composer = new THREE.EffectComposer(renderer);
composer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);

const renderPass = new THREE.RenderPass(scene, camera);
composer.addPass(renderPass);

export const ditherShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(window.innerWidth * pixelScale, window.innerHeight * pixelScale) }
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

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    int x = int(mod(gl_FragCoord.x, 4.0));
    int y = int(mod(gl_FragCoord.y, 4.0));

    float bayer = getBayer(x, y);
    float dither = (bayer / 15.0) - 0.5;
    vec3 retroColor = color.rgb + dither * 0.15;
    retroColor = floor(retroColor * 12.0) / 12.0;

    float scanline = sin(vUv.y * resolution.y * 3.1415) * 0.04;
    retroColor -= scanline;

    gl_FragColor = vec4(retroColor, color.a);
  }
`
};

export const ditherPass = new THREE.ShaderPass(ditherShader);
ditherPass.renderToScreen = true;
composer.addPass(ditherPass);

// Redimensionamento
export function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale, false);
  composer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);
  ditherPass.material.uniforms.resolution.value.set(window.innerWidth * pixelScale, window.innerHeight * pixelScale);
}
