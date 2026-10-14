// --- 1. CONFIGURAÇÃO BASE DO THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1b1f);
scene.fog = new THREE.FogExp2(0x1b1b1f, 0.008); // Nevoeiro volumétrico estilo PS2

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 40, 70);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: false }); // Estética retro PS2
renderer.setPixelRatio(1);
const pixelScale = 0.5; // Ajuste de pixelização (0.5 = metade da resolução original)
renderer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale, false);
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';
document.body.appendChild(renderer.domElement);

// --- 1.1 CONFIGURAÇÃO DE SOMBRAS DE CONTACTO ---
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 15;
controls.maxDistance = 150;

const clock = new THREE.Clock(); // Clock para calcular delta time do ParticleSystem

scene.add(new THREE.AmbientLight(0xffe0d0, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
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

// Plano sutil recetor de sombra na base do chão
const shadowPlaneGeo = new THREE.PlaneGeometry(100, 100);
const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.4 });
const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = -0.01;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// --- 1.2 CAIXA DE CONFINAMENTO (BOUNDING CAGE) ---
const cageGeo = new THREE.BoxGeometry(40, 20, 40);
const cageEdges = new THREE.EdgesGeometry(cageGeo);
const cageMat = new THREE.LineBasicMaterial({
  color: 0x6e6b85, // Tom mais claro para evitar a quantização para preto pelo shader
  transparent: true,
  opacity: 0.7
});
const cageMesh = new THREE.LineSegments(cageEdges, cageMat);
cageMesh.position.set(0, 10, 0);
scene.add(cageMesh);

// --- 1.3 LUZ DE IMPACTO, ONDAS DE CHOQUE E HELPERS ---
const impactLight = new THREE.PointLight(0xffaa00, 0, 25);
scene.add(impactLight);
let lightTimer = 0;

function triggerImpactLight(pos) {
  impactLight.position.copy(pos);
  impactLight.intensity = 8;
  lightTimer = 0.12;
}

const shockwaves = [];
const shockwaveGeo = new THREE.RingGeometry(0.1, 0.4, 32);

function triggerShockwave(pos) {
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

// Visualizador de limite individual AABB (Hover/Drag)
const hoverBoxHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x00ffcc);
hoverBoxHelper.visible = false;
scene.add(hoverBoxHelper);

// Guia de projeção vertical até ao chão (Height Drop Line)
const dropLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const dropLineMat = new THREE.LineDashedMaterial({
  color: 0x00ffcc,
  dashSize: 0.4,
  gapSize: 0.2,
  linewidth: 1.5
});
const dropLineMesh = new THREE.Line(dropLineGeo, dropLineMat);
dropLineMesh.visible = false;
scene.add(dropLineMesh);

// Gizmo de células ativas da Grade Espacial
const gridDebugGroup = new THREE.Group();
scene.add(gridDebugGroup);

function renderGridDebug() {
  while (gridDebugGroup.children.length > 0) {
    const child = gridDebugGroup.children.pop();
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }

  if (currentBroadPhase !== 'grid' || !spatialGrid) return;

  const cellGeo = new THREE.BoxGeometry(spatialGrid.cellSize, spatialGrid.cellSize, spatialGrid.cellSize);
  const edgesGeo = new THREE.EdgesGeometry(cellGeo);
  const cellMat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.15 });

  for (const key of spatialGrid.grid.keys()) {
    const [cx, cy, cz] = key.split(',').map(Number);
    const wireframe = new THREE.LineSegments(edgesGeo, cellMat);
    wireframe.position.set(
      (cx + 0.5) * spatialGrid.cellSize,
      (cy + 0.5) * spatialGrid.cellSize,
      (cz + 0.5) * spatialGrid.cellSize
    );
    gridDebugGroup.add(wireframe);
  }
}

// ====================== PARTICLE SYSTEM – IMPACT SPARKS ======================
class ParticleSystem {
    constructor(maxParticles = 200) {
        this.maxParticles = maxParticles;
        this.particles = new Array(maxParticles).fill(null);
        this.free = [];

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 3);
        const colors    = new Float32Array(maxParticles * 3);
        const sizes     = new Float32Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color',    new THREE.BufferAttribute(colors,    3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('size',     new THREE.BufferAttribute(sizes,     1).setUsage(THREE.DynamicDrawUsage));

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
            const phi   = Math.random() * Math.PI * 2;
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

const impactParticles = new ParticleSystem();

// ====================== LASER TEST LINES (VISUALIZAÇÃO BIG-O) ======================
const MAX_PAIR_LINES = 12000;
const pairLinesGeo = new THREE.BufferGeometry();
const pairLinesPos = new Float32Array(MAX_PAIR_LINES * 2 * 3);
pairLinesGeo.setAttribute('position', new THREE.BufferAttribute(pairLinesPos, 3).setUsage(THREE.DynamicDrawUsage));

const pairLinesMat = new THREE.LineBasicMaterial({
  color: 0xff7139,
  transparent: true,
  opacity: 0.35,
  blending: THREE.AdditiveBlending
});
const pairLinesMesh = new THREE.LineSegments(pairLinesGeo, pairLinesMat);
scene.add(pairLinesMesh);

let activePairLineCount = 0;

function clearPairLines() {
  activePairLineCount = 0;
}

function addPairLine(posA, posB) {
  if (activePairLineCount >= MAX_PAIR_LINES) return;
  const idx = activePairLineCount * 6;
  pairLinesPos[idx]     = posA.x; pairLinesPos[idx + 1] = posA.y; pairLinesPos[idx + 2] = posA.z;
  pairLinesPos[idx + 3] = posB.x; pairLinesPos[idx + 4] = posB.y; pairLinesPos[idx + 5] = posB.z;
  activePairLineCount++;
}

function updatePairLinesBuffer() {
  pairLinesGeo.setDrawRange(0, activePairLineCount * 2);
  pairLinesGeo.attributes.position.needsUpdate = true;
  
  const modeColorStr = getComputedStyle(document.documentElement).getPropertyValue('--mode-color').trim();
  if (modeColorStr) pairLinesMat.color.setStyle(modeColorStr);
}

// --- 2. VARIÁVEIS, CORES E CONFIGURAÇÃO DE CONTEXTO ---
let cubes = [];
let nextId = 0;
let draggedCube = null;
let simPaused = false;
let collisionCount = 0;
let activeCollisions = 0;
let currentCollidingPairs = new Set();
let soundEnabled = true;
let audioContext = null;
let wireframeEnabled = false;
let isPhysicsEnabled = false;   // Física Real (Resolução de Colisão AABB)
let isHeatmapEnabled = false;   // Heatmap de Colisões
let typingInterval = null;
let lastComparisonCount = 0;
const pseudoCodeEl = document.getElementById('pseudoCode');

const CONTEXT_CONFIG = {
  brute: {
    algorithm: "AABB — Axis-Aligned Bounding Box",
    worstCase: "O(n²) — verificação por força bruta",
    op: "Sobreposição nos eixos X, Y e Z"
  },
  grid: {
    algorithm: "Grade Espacial Uniforme 3D",
    worstCase: "O(n²) no pior caso / O(n) no caso médio",
    op: "Hashing espacial e teste entre células vizinhas"
  },
  octree: {
    algorithm: "Octree 3D — Subdivisão Recursiva",
    worstCase: "O(n²) no pior caso / O(n log n) no caso médio",
    op: "Travessia de 8 octantes e teste de nós com entidades"
  }
};

function updateContextPanel(mode) {
  const config = CONTEXT_CONFIG[mode] || CONTEXT_CONFIG.brute;
  const algEl = document.getElementById('context-algorithm');
  const worstEl = document.getElementById('context-worstcase');
  const opEl = document.getElementById('context-op');

  if (algEl) algEl.textContent = config.algorithm;
  if (worstEl) worstEl.textContent = config.worstCase;
  if (opEl) opEl.textContent = config.op;
}

let simulationLogArray = [];

let frameCount = 0;
let lastLoggedN = 0;
let lastLoggedAlgo = '';
let performanceData = {};           // Força Bruta O(n²)
let spatialPerformanceData = {};    // Grade Espacial O(n)
let octreePerformanceData = {};     // Octree O(n log n)
let chartPoints = []; 

const pseudoCodeBrute = `> FUNCAO intersectarAABB(A, B):
>   dx = abs(A.x - B.x)
>   dy = abs(A.y - B.y)
>   dz = abs(A.z - B.z)
>
>   SE dx < (A.size + B.size)/2
>    E dy < (A.size + B.size)/2
>    E dz < (A.size + B.size)/2:
>      RETORNAR VERDADEIRO
>   RETORNAR FALSO`;

const pseudoCodeSpatial = `> FUNCAO detectarColisoesComGrade():
>   grade.limpar()
>   PARA CADA c EM cubos grade.inserir(c)
>   PARA CADA c EM cubos
>     vizinhos = grade.obterVizinhos(c)
>     PARA CADA v EM vizinhos
>       SE v.id > c.id E intersectarAABB(c, v)
>         MARCAR colisao(c, v)
>   RETORNAR colisoes`;

const pseudoCodeOctree = `> FUNCAO inserir(no, obj, box):
>   SE box cabe em filho:
>     inserir(filho, obj, box)
>   SENÃO:           // straddling
>     no.objects.add(obj)
>
> FUNCAO candidatos(no, obj, box):
>   PARA CADA o EM no.objects:
>     candidatos.add(o)   // ancestrais sempre
>   PARA CADA filho:
>     SE filho.bounds.intersecta(box):
>       candidatos(filho, obj, box)
>   RETORNAR candidatos`;

// Grade Espacial O(n) com Inserção Multi-Célula (Evita que cubos se atravessem)
class SpatialGrid {
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  getCellKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  clear() {
    this.grid.clear();
  }

  insert(obj) {
    const half = obj.size / 2;
    const pos = obj.mesh.position;

    const minX = Math.floor((pos.x - half) / this.cellSize);
    const maxX = Math.floor((pos.x + half) / this.cellSize);
    const minY = Math.floor((pos.y - half) / this.cellSize);
    const maxY = Math.floor((pos.y + half) / this.cellSize);
    const minZ = Math.floor((pos.z - half) / this.cellSize);
    const maxZ = Math.floor((pos.z + half) / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = this.getCellKey(x, y, z);
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(obj);
        }
      }
    }
  }

  getPotentialCollisions(obj) {
    const half = obj.size / 2;
    const pos = obj.mesh.position;
    const minX = Math.floor((pos.x - half) / this.cellSize);
    const maxX = Math.floor((pos.x + half) / this.cellSize);
    const minY = Math.floor((pos.y - half) / this.cellSize);
    const maxY = Math.floor((pos.y + half) / this.cellSize);
    const minZ = Math.floor((pos.z - half) / this.cellSize);
    const maxZ = Math.floor((pos.z + half) / this.cellSize);

    const potentialSet = new Set();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const cell = this.grid.get(this.getCellKey(x, y, z));
          if (cell) {
            for (let i = 0; i < cell.length; i++) {
              if (cell[i].id !== obj.id) {
                potentialSet.add(cell[i]);
              }
            }
          }
        }
      }
    }
    return Array.from(potentialSet);
  }
}

// Octree simulado O(n log n)
class OctreeSimulator {
  constructor(boundsSize = 60, maxDepth = 6, maxObjectsPerNode = 4) {
    this.boundsSize  = boundsSize;
    this.maxDepth    = maxDepth;
    this.maxObjects  = maxObjectsPerNode;

    const h = boundsSize / 2;
    this.root = this._createNode(
      new THREE.Box3(
        new THREE.Vector3(-h, -h, -h),
        new THREE.Vector3( h,  h,  h)
      ),
      0
    );
  }

  _createNode(box3, depth) {
    return {
      bounds:   box3,
      depth:    depth,
      children: null,
      objects:  [],
    };
  }

  _getBox3(obj) {
    const h = obj.size / 2;
    const p = obj.mesh.position;
    return new THREE.Box3(
      new THREE.Vector3(p.x - h, p.y - h, p.z - h),
      new THREE.Vector3(p.x + h, p.y + h, p.z + h)
    );
  }

  _subdivide(node) {
    const { min, max } = node.bounds;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;

    node.children = [
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(cx,    cy,    cz   )), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx,    min.y, min.z), new THREE.Vector3(max.x, cy,    cz   )), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, cy,    min.z), new THREE.Vector3(cx,    max.y, cz   )), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx,    cy,    min.z), new THREE.Vector3(max.x, max.y, cz   )), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, min.y, cz   ), new THREE.Vector3(cx,    cy,    max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx,    min.y, cz   ), new THREE.Vector3(max.x, cy,    max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(min.x, cy,    cz   ), new THREE.Vector3(cx,    max.y, max.z)), node.depth + 1),
      this._createNode(new THREE.Box3(new THREE.Vector3(cx,    cy,    cz   ), new THREE.Vector3(max.x, max.y, max.z)), node.depth + 1),
    ];
  }

  insert(obj) {
    this._insertNode(this.root, obj, this._getBox3(obj));
  }

  _insertNode(node, obj, objBox) {
    if (node.depth < this.maxDepth && node.objects.length >= this.maxObjects) {
      if (!node.children) this._subdivide(node);
    }

    if (node.children) {
      let inserted = false;
      for (let i = 0; i < 8; i++) {
        if (node.children[i].bounds.intersectsBox(objBox)) {
          this._insertNode(node.children[i], obj, objBox);
          inserted = true;
        }
      }
      if (inserted) return;
    }

    node.objects.push(obj);
  }

  getPotentialCollisions(obj) {
    const objBox    = this._getBox3(obj);
    const potential = [];
    this._queryNode(this.root, obj, objBox, potential);
    return potential;
  }

  _queryNode(node, obj, objBox, potential) {
    for (const other of node.objects) {
      if (other.id !== obj.id) potential.push(other);
    }

    if (node.children) {
      for (let i = 0; i < 8; i++) {
        if (node.children[i].bounds.intersectsBox(objBox)) {
          this._queryNode(node.children[i], obj, objBox, potential);
        }
      }
    }
  }

  clear() {
    const h = this.boundsSize / 2;
    this.root = this._createNode(
      new THREE.Box3(
        new THREE.Vector3(-h, -h, -h),
        new THREE.Vector3( h,  h,  h)
      ),
      0
    );
  }
}

let spatialGrid = null;
let octreeSimulator = null;
let currentBroadPhase = 'brute'; 

function startTyping(targetText) {
  if (typingInterval) clearInterval(typingInterval);
  pseudoCodeEl.textContent = '';
  let charIndex = 0;
  typingInterval = setInterval(() => {
    if (charIndex < targetText.length) {
      pseudoCodeEl.textContent += targetText.charAt(charIndex);
      charIndex++;
    } else {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }, 15);
}

function logSimulationData(timestamp, nCubos, algoritmo, comparacoes, tempoMs, colisoesAtivas) {
  simulationLogArray.push({
    Timestamp: timestamp,
    N_Cubos: nCubos,
    Algoritmo: algoritmo,
    Comparações: comparacoes,
    Tempo_Ms: tempoMs.toFixed(3),
    Colisões_Ativas: colisoesAtivas
  });
}

function exportCSV() {
  if (simulationLogArray.length === 0) {
    alert('Nenhum dado para exportar. Execute algumas simulações primeiro.');
    return;
  }

  const headers = ['Timestamp', 'N_Cubos', 'Algoritmo', 'Comparações', 'Tempo_Ms', 'Colisões_Ativas'];
  const csvContent = [
    headers.join(','),
    ...simulationLogArray.map(row =>
      headers.map(key => {
        const value = row[key];
        const escaped = String(value).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = `simulation_log_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const CUBE_PALETTES = {
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

const COLLISION_COLOR = new THREE.Color(0xff2a2a);
const DRAG_COLOR      = new THREE.Color(0xffdd44);

// --- 3. ELEMENTOS DA UI ---
const cubeCountInput = document.getElementById('cubeCount');
const cubeCountNumber = document.getElementById('cubeCountInput');
const speedSlider = document.getElementById('speed');
const collisionBadge = document.getElementById('collisionBadge');
const minimizeBtn = document.getElementById('minimizeBtn');
const toggleChartBtn = document.getElementById('toggleChartBtn');
const controlPanel = document.getElementById('controlPanel');
const chartPanel = document.getElementById('chartPanel');
const theoryModal = document.getElementById('theoryModal');
const stressBtn = document.getElementById('stressBtn');
const soundBtn = document.getElementById('soundBtn');
const wireframeBtn = document.getElementById('wireframeBtn');
const chartCanvas = document.getElementById('perfChart');
const chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;

const statN    = document.getElementById('statN');
const statAlgo = document.getElementById('statAlgo');
const statComp = document.getElementById('statComp');
const statTime = document.getElementById('statTime');

// --- 4. PÓS-PROCESSAMENTO: EFEITO DITHERING + SCANLINES CRT ---
const composer = new THREE.EffectComposer(renderer);
composer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);

const renderPass = new THREE.RenderPass(scene, camera);
composer.addPass(renderPass);

const ditherShader = {
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

    // Efeito CRT Scanline sutil (linhas horizontais retro)
    float scanline = sin(vUv.y * resolution.y * 3.1415) * 0.04;
    retroColor -= scanline;

    gl_FragColor = vec4(retroColor, color.a);
  }
`
};

const ditherPass = new THREE.ShaderPass(ditherShader);
ditherPass.renderToScreen = true;
composer.addPass(ditherPass);

// --- 5. LÓGICA DO GRÁFICO O(n²) E O(n) ---
function recordPerformance(n, timeMs) {
  if (!performanceData[n]) performanceData[n] = [];
  performanceData[n].push(timeMs);
  if (performanceData[n].length > 60) performanceData[n].shift();
}

function getAverageTime(n) {
  if (!performanceData[n] || performanceData[n].length === 0) return 0;
  let times = [...performanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) {
    times = times.slice(trim, times.length - trim);
  }
  let sum = times.reduce((a, b) => a + b, 0);
  return sum / times.length;
}

function recordSpatialPerformance(n, timeMs) {
  if (!spatialPerformanceData[n]) spatialPerformanceData[n] = [];
  spatialPerformanceData[n].push(timeMs);
  if (spatialPerformanceData[n].length > 60) spatialPerformanceData[n].shift();
}

function getSpatialAverageTime(n) {
  if (!spatialPerformanceData[n] || spatialPerformanceData[n].length === 0) return 0;
  let times = [...spatialPerformanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) {
    times = times.slice(trim, times.length - trim);
  }
  let sum = times.reduce((a, b) => a + b, 0);
  return sum / times.length;
}

function recordOctreePerformance(n, timeMs) {
  if (!octreePerformanceData[n]) octreePerformanceData[n] = [];
  octreePerformanceData[n].push(timeMs);
  if (octreePerformanceData[n].length > 60) octreePerformanceData[n].shift();
}

function getOctreeAverageTime(n) {
  if (!octreePerformanceData[n] || octreePerformanceData[n].length === 0) return 0;
  let times = [...octreePerformanceData[n]].sort((a, b) => a - b);
  let trim = Math.floor(times.length * 0.15);
  if (trim > 0 && times.length > 5) {
    times = times.slice(trim, times.length - trim);
  }
  let sum = times.reduce((a, b) => a + b, 0);
  return sum / times.length;
}

function getAlgoLabel(broadPhase) {
  switch (broadPhase) {
    case 'brute': return 'Força Bruta O(n²)';
    case 'grid': return 'Grade Espacial O(n)';
    case 'octree': return 'Octree O(n log n)';
    default: return 'Desconhecido';
  }
}

function drawChart() {
  if (!chartCtx) return;
  const w = chartCanvas.width;
  const h = chartCanvas.height;

  chartCtx.clearRect(0, 0, w, h);

  const padX = 40;
  const padY = 38;
  const chartW = w - padX - 10;
  const chartH = h - padY - 10;

  chartPoints = [];

  chartCtx.save();
  chartCtx.setLineDash([4, 2]);
  chartCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(padX, h - padY); chartCtx.lineTo(w - 10, h - padY);
  chartCtx.moveTo(padX, 10);       chartCtx.lineTo(padX, h - padY);
  chartCtx.stroke();
  chartCtx.restore();

  chartCtx.fillStyle = 'rgba(255,255,255,0.6)';
  chartCtx.font = '10px "Fira Code", monospace';
  chartCtx.textAlign = 'center';
  chartCtx.fillText("N Cubos", padX + chartW / 2, h - 5);
  chartCtx.save();
  chartCtx.translate(12, 10 + chartH / 2);
  chartCtx.rotate(-Math.PI / 2);
  chartCtx.fillText("Tempo (ms)", 0, 0);
  chartCtx.restore();

  const N = Math.max(cubes.length, 2);
  const maxN = Math.max(20, N);

  const measuredBrute   = getAverageTime(N) > 0          ? getAverageTime(N)          : null;
  const measuredSpatial = getSpatialAverageTime(N) > 0   ? getSpatialAverageTime(N)   : null;
  const measuredOctree  = getOctreeAverageTime(N) > 0    ? getOctreeAverageTime(N)    : null;

  let maxTime = 0.001;
  if (measuredBrute   !== null && measuredBrute   < 30) maxTime = Math.max(maxTime, measuredBrute);
  if (measuredSpatial !== null && measuredSpatial < 30) maxTime = Math.max(maxTime, measuredSpatial);
  if (measuredOctree  !== null && measuredOctree  < 30) maxTime = Math.max(maxTime, measuredOctree);
  if (maxTime <= 0.001) maxTime = (N * N) * 0.0002;
  maxTime *= 1.2;

  // --- Curvas teóricas (tracejadas) ---
  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#ff7139'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = Math.pow(nx, 2) * 0.95;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#7b2cbf'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = ((i * Math.log(i + 2)) / (maxN * Math.log(maxN + 2))) * 0.65;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  chartCtx.save(); chartCtx.setLineDash([4, 2]); chartCtx.strokeStyle = '#00ddff'; chartCtx.lineWidth = 2; chartCtx.beginPath();
  for (let i = 0; i <= maxN; i += Math.max(1, Math.floor(maxN / 20))) {
    const nx = i / maxN;
    const px = padX + nx * chartW;
    const ny = nx * 0.35;
    const py = (h - padY) - ny * chartH;
    if (i === 0) chartCtx.moveTo(px, py); else chartCtx.lineTo(px, py);
  } chartCtx.stroke(); chartCtx.restore();

  function drawDot(color, t) {
    if (t === null || t <= 0) return;
    const px = padX + (N / maxN) * chartW;
    const py = (h - padY) - Math.min(t / maxTime, 1) * chartH;
    chartCtx.beginPath();
    chartCtx.arc(px, py, 4, 0, Math.PI * 2);
    chartCtx.fillStyle = color;
    chartCtx.fill();
    chartCtx.strokeStyle = '#1b1b1f';
    chartCtx.lineWidth = 1.5;
    chartCtx.stroke();
  }

  function drawMeasuredLine(color, getAvgFn, keys) {
    if (keys.length === 0) return;
    chartCtx.save();
    chartCtx.setLineDash([]);
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 2;
    chartCtx.beginPath();
    let started = false;
    keys.forEach(k => {
      const avgT = getAvgFn(k);
      if (avgT <= 0) return;
      const px = padX + (k / maxN) * chartW;
      const py = (h - padY) - Math.min(avgT / maxTime, 1) * chartH;
      if (!started) { chartCtx.moveTo(px, py); started = true; }
      else chartCtx.lineTo(px, py);
    });
    if (started) chartCtx.stroke();
    chartCtx.restore();
  }

  const bruteKeys   = Object.keys(performanceData).map(Number).sort((a, b) => a - b);
  const spatialKeys = Object.keys(spatialPerformanceData).map(Number).sort((a, b) => a - b);
  const octreeKeys  = Object.keys(octreePerformanceData).map(Number).sort((a, b) => a - b);

  drawMeasuredLine('#ff4e3e', getAverageTime,        bruteKeys);
  drawMeasuredLine('#00ddff', getSpatialAverageTime, spatialKeys);
  drawMeasuredLine('#7b2cbf', getOctreeAverageTime,  octreeKeys);

  drawDot('#ff4e3e', measuredBrute);
  drawDot('#00ddff', measuredSpatial);
  drawDot('#7b2cbf', measuredOctree);

  chartCtx.save();
  chartCtx.setLineDash([3, 3]);
  chartCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  chartCtx.lineWidth = 1;
  const curNx = padX + (N / maxN) * chartW;
  chartCtx.beginPath();
  chartCtx.moveTo(curNx, h - padY);
  chartCtx.lineTo(curNx, 10);
  chartCtx.stroke();

  chartCtx.setLineDash([]);
  const badgeText = 'n=' + N;
  chartCtx.font = 'bold 9px "Fira Code", monospace';
  const badgeW = chartCtx.measureText(badgeText).width + 10;
  const badgeH = 14;
  const badgeX = curNx - badgeW / 2;
  const badgeY = h - padY + 4;

  const modeColor = getComputedStyle(document.documentElement).getPropertyValue('--mode-color').trim();
  let pillBg = modeColor;
  if (pillBg.startsWith('#') && pillBg.length === 7) {
    const r = parseInt(pillBg.slice(1,3), 16);
    const g = parseInt(pillBg.slice(3,5), 16);
    const b = parseInt(pillBg.slice(5,7), 16);
    pillBg = `rgba(${r}, ${g}, ${b}, 0.85)`;
  }
  chartCtx.fillStyle = pillBg;
  const r = 4;
  chartCtx.beginPath();
  chartCtx.moveTo(badgeX + r, badgeY);
  chartCtx.lineTo(badgeX + badgeW - r, badgeY);
  chartCtx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + r, r);
  chartCtx.lineTo(badgeX + badgeW, badgeY + badgeH - r);
  chartCtx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - r, badgeY + badgeH, r);
  chartCtx.lineTo(badgeX + r, badgeY + badgeH);
  chartCtx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - r, r);
  chartCtx.lineTo(badgeX, badgeY + r);
  chartCtx.arcTo(badgeX, badgeY, badgeX + r, badgeY, r);
  chartCtx.closePath();
  chartCtx.fill();

  chartCtx.fillStyle = '#fff';
  chartCtx.textAlign = 'center';
  chartCtx.fillText(badgeText, curNx, badgeY + badgeH - 3);
  chartCtx.restore();
}

// --- 6. FÍSICA E CUBOS ---
function createCube(spawnIndex = 0) {
  const size = Math.random() * 4 + 2;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const palette = CUBE_PALETTES[currentBroadPhase] || CUBE_PALETTES.brute;
  const baseCol = palette[Math.floor(Math.random() * palette.length)];
  const solidMaterial = new THREE.MeshStandardMaterial({
    color: baseCol.clone(),
    roughness: 0.9,
    flatShading: true
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: baseCol.clone(),
    wireframe: true
  });
  const mesh = new THREE.Mesh(geometry, solidMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set((Math.random() - 0.5) * 40, (Math.random() * 15) + size, (Math.random() - 0.5) * 40);
  const speed = parseFloat(speedSlider.value);
  const velocity = new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);

  const arrowHelper = new THREE.ArrowHelper(
    velocity.clone().normalize(),
    mesh.position,
    3,
    0xffdd44,
    0.8,
    0.5
  );
  scene.add(arrowHelper);

  const cubeData = {
    mesh,
    arrow: arrowHelper,
    id: nextId++,
    size,
    velocity,
    dragging: false,
    colliding: false,
    baseColor: baseCol.clone(),
    geometry,
    solidMaterial,
    wireframeMaterial,
    collisionCount: 0,
    spawnScale: -Math.min(spawnIndex * 0.08, 1.5),
    spawnDone: false
  };
  mesh.userData = cubeData;
  cubes.push(cubeData);
  scene.add(mesh);
  mesh.scale.set(0.01, 0.01, 0.01);

  if (currentBroadPhase === 'grid' && spatialGrid) {
    spatialGrid.insert(cubeData);
  } else if (currentBroadPhase === 'octree' && octreeSimulator) {
    octreeSimulator.insert(cubeData);
  }
}

function initCubes() {
  cubes.forEach(c => {
    if (c.arrow) scene.remove(c.arrow);
    scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh.material.dispose();
    if (c.solidMaterial) c.solidMaterial.dispose();
    if (c.wireframeMaterial) c.wireframeMaterial.dispose();
  });
  cubes = [];
  nextId = 0;
  collisionCount = 0;
  activeCollisions = 0;
  currentCollidingPairs.clear();

  if (currentBroadPhase === 'grid') {
    spatialGrid = new SpatialGrid(2);
    octreeSimulator = null;
  } else if (currentBroadPhase === 'octree') {
    octreeSimulator = new OctreeSimulator(60);
    spatialGrid = null;
  } else {
    spatialGrid = null;
    octreeSimulator = null;
  }

  const count = parseInt(cubeCountInput.value, 10);
  for (let i = 0; i < count; i++) createCube(i);
  updateUI();
}

function updateUI() {
  const badgeText = document.getElementById('badgeText');
  if (badgeText) badgeText.textContent = collisionCount;

  const tbObjects = document.getElementById('tbObjects');
  if (tbObjects) tbObjects.textContent = cubes.length;

  const tbMode = document.getElementById('tbMode');
  if (tbMode) tbMode.textContent = getAlgoLabel(currentBroadPhase);

  if (activeCollisions > 0) {
    if (collisionBadge) collisionBadge.classList.add('has-collision');
    const badgeIndicator = document.getElementById('badgeIndicator');
    if (badgeIndicator) {
      badgeIndicator.style.background = 'var(--accent-red)';
      badgeIndicator.style.boxShadow  = '0 0 7px rgba(255,78,62,0.8)';
    }
  } else {
    if (collisionBadge) collisionBadge.classList.remove('has-collision');
    const badgeIndicator = document.getElementById('badgeIndicator');
    if (badgeIndicator) {
      badgeIndicator.style.background = '#3f3f46';
      badgeIndicator.style.boxShadow  = 'none';
    }
  }
}

// SÍNTESE DE ÁUDIO DINÂMICA POR ENERGIA DE COLISÃO
function playSound(impactVelocity = 1.0) {
  if (!soundEnabled) return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  // Frequência varia entre 220Hz (grave) e 1200Hz (agudo) de acordo com a velocidade do impacto
  const baseFreq = THREE.MathUtils.clamp(220 + impactVelocity * 140, 180, 1200);

  oscillator.type = 'triangle'; // Onda triângular estilo chiptune retro
  oscillator.frequency.setValueAtTime(baseFreq, audioContext.currentTime);

  gainNode.gain.setValueAtTime(0.0, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.25, audioContext.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.13);
}

function intersectAABB(a, b) {
  const hA = a.size / 2, hB = b.size / 2;
  return Math.abs(a.mesh.position.x - b.mesh.position.x) < (hA + hB) &&
         Math.abs(a.mesh.position.y - b.mesh.position.y) < (hA + hB) &&
         Math.abs(a.mesh.position.z - b.mesh.position.z) < (hA + hB);
}

// RESOLUÇÃO DE COLISÃO AABB
function resolveCollision(cubeA, cubeB) {
  const hA = cubeA.size / 2;
  const hB = cubeB.size / 2;
  const sum = hA + hB;

  const dx = cubeA.mesh.position.x - cubeB.mesh.position.x;
  const dy = cubeA.mesh.position.y - cubeB.mesh.position.y;
  const dz = cubeA.mesh.position.z - cubeB.mesh.position.z;

  const overlapX = sum - Math.abs(dx);
  const overlapY = sum - Math.abs(dy);
  const overlapZ = sum - Math.abs(dz);

  if (overlapX <= overlapY && overlapX <= overlapZ) {
    const sign = dx >= 0 ? 1 : -1;
    const correction = overlapX / 2;
    cubeA.mesh.position.x += sign * correction;
    cubeB.mesh.position.x -= sign * correction;
    cubeA.velocity.x =  Math.abs(cubeA.velocity.x) * sign;
    cubeB.velocity.x = -Math.abs(cubeB.velocity.x) * sign;

  } else if (overlapY <= overlapX && overlapY <= overlapZ) {
    const sign = dy >= 0 ? 1 : -1;
    const correction = overlapY / 2;
    cubeA.mesh.position.y += sign * correction;
    cubeB.mesh.position.y -= sign * correction;
    cubeA.velocity.y =  Math.abs(cubeA.velocity.y) * sign;
    cubeB.velocity.y = -Math.abs(cubeB.velocity.y) * sign;

  } else {
    const sign = dz >= 0 ? 1 : -1;
    const correction = overlapZ / 2;
    cubeA.mesh.position.z += sign * correction;
    cubeB.mesh.position.z -= sign * correction;
    cubeA.velocity.z =  Math.abs(cubeA.velocity.z) * sign;
    cubeB.velocity.z = -Math.abs(cubeB.velocity.z) * sign;
  }

  // Velocidade relativa de impacto para ajustar o pitch do som
  const relVel = cubeA.velocity.clone().sub(cubeB.velocity).length();

  const impactPos = new THREE.Vector3()
    .addVectors(cubeA.mesh.position, cubeB.mesh.position)
    .multiplyScalar(0.5);

  impactParticles.spawn(impactPos);
  triggerImpactLight(impactPos);
  triggerShockwave(impactPos);
  playSound(relVel);
}

// HEATMAP DE COLISÕES
const HEATMAP_COLORS = [
  new THREE.Color(0xffee44),
  new THREE.Color(0xff8800),
  new THREE.Color(0xff2a2a),
  new THREE.Color(0xff00cc),
];

function updateCubeHeatmap(cube) {
  cube.collisionCount++;
  const count = cube.collisionCount;

  let heatColor;
  if      (count <= 2) heatColor = HEATMAP_COLORS[0];
  else if (count <= 4) heatColor = HEATMAP_COLORS[1];
  else if (count <= 7) heatColor = HEATMAP_COLORS[2];
  else                 heatColor = HEATMAP_COLORS[3];

  if (!cube.dragging) cube.mesh.material.color.copy(heatColor);
}

function resetHeatmap() {
  cubes.forEach(cube => {
    cube.collisionCount = 0;
    if (!cube.dragging) cube.mesh.material.color.copy(cube.baseColor);
  });
}

function detectCollisions() {
  clearPairLines();

  cubes.forEach(c => {
    c.colliding = false;
    if (!c.dragging) {
      if (!isHeatmapEnabled) c.mesh.material.color.copy(c.baseColor);
      c.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }
  });

  const newPairs = new Set();
  let localActiveCollisions = 0;
  let comparisons = 0;

  const start = performance.now();

  if (currentBroadPhase === 'grid' && spatialGrid) {
    spatialGrid.clear();
    cubes.forEach(cube => spatialGrid.insert(cube));
    renderGridDebug();

    cubes.forEach(cube => {
      if (cube.dragging) return;
      const potentialCollisions = spatialGrid.getPotentialCollisions(cube);
      potentialCollisions.forEach(other => {
        if (other.id <= cube.id) return;
        comparisons++;
        addPairLine(cube.mesh.position, other.mesh.position);
        if (intersectAABB(cube, other)) {
          localActiveCollisions++;
          newPairs.add(`${cube.id}-${other.id}`);
          if (isPhysicsEnabled) resolveCollision(cube, other);
        }
      });
    });
  } else if (currentBroadPhase === 'octree' && octreeSimulator) {
    octreeSimulator.clear();
    cubes.forEach(cube => octreeSimulator.insert(cube));

    const testedPairs = new Set();

    cubes.forEach(cube => {
      if (cube.dragging) return;
      const potentialCollisions = octreeSimulator.getPotentialCollisions(cube);
      
      potentialCollisions.forEach(other => {
        const pairKey = cube.id < other.id ? `${cube.id}-${other.id}` : `${other.id}-${cube.id}`;
        if (testedPairs.has(pairKey)) return;
        testedPairs.add(pairKey);

        comparisons++;
        addPairLine(cube.mesh.position, other.mesh.position);
        if (intersectAABB(cube, other)) {
          localActiveCollisions++;
          newPairs.add(pairKey);
          if (isPhysicsEnabled) resolveCollision(cube, other);
        }
      });
    });
  } else {
    for (let i = 0; i < cubes.length; i++) {
      if (cubes[i].dragging) continue;
      for (let j = i + 1; j < cubes.length; j++) {
        if (cubes[j].dragging) continue;
        comparisons++;
        addPairLine(cubes[i].mesh.position, cubes[j].mesh.position);
        if (intersectAABB(cubes[i], cubes[j])) {
          localActiveCollisions++;
          newPairs.add(`${cubes[i].id}-${cubes[j].id}`);
          if (isPhysicsEnabled) resolveCollision(cubes[i], cubes[j]);
        }
      }
    }
  }

  updatePairLinesBuffer();

  const end = performance.now();
  const pureComputeTime = end - start;

  if (currentBroadPhase === 'grid') {
    recordSpatialPerformance(cubes.length, pureComputeTime);
  } else if (currentBroadPhase === 'octree') {
    recordOctreePerformance(cubes.length, pureComputeTime);
  } else {
    recordPerformance(cubes.length, pureComputeTime);
  }

  activeCollisions = localActiveCollisions;
  newPairs.forEach(key => {
    const [id1, id2] = key.split('-');
    const c1 = cubes.find(c => c.id == parseInt(id1));
    const c2 = cubes.find(c => c.id == parseInt(id2));
    if (c1) { c1.colliding = true; if (!c1.dragging) { if (isHeatmapEnabled) updateCubeHeatmap(c1); else c1.mesh.material.color.copy(COLLISION_COLOR); c1.mesh.scale.set(1.15, 0.85, 1.15); } }
    if (c2) { c2.colliding = true; if (!c2.dragging) { if (isHeatmapEnabled) updateCubeHeatmap(c2); else c2.mesh.material.color.copy(COLLISION_COLOR); c2.mesh.scale.set(1.15, 0.85, 1.15); } }

    if (!currentCollidingPairs.has(key)) {
      collisionCount++;
      if (!isPhysicsEnabled) playSound(1.5);
      const badgeTextEl = document.getElementById('badgeText');
      if (badgeTextEl) {
        badgeTextEl.classList.remove('collision-bump');
        void badgeTextEl.offsetWidth; 
        badgeTextEl.classList.add('collision-bump');
      }
    }
  });

  currentCollidingPairs = newPairs;
  lastComparisonCount = comparisons;

  const savingsEl = document.getElementById('savings-metric');
  if (savingsEl) {
    const totalN = cubes.length;
    const baseComps = (totalN * (totalN - 1)) / 2;
    if (currentBroadPhase === 'brute' || baseComps <= 0) {
      savingsEl.textContent = 'ECONOMIA: 0%';
      savingsEl.style.color = '#52525b';
    } else {
      const saved = Math.max(0, ((baseComps - comparisons) / baseComps) * 100);
      savingsEl.textContent = `ECONOMIA: ${saved.toFixed(1)}%`;
      savingsEl.style.color = saved > 0 ? '#00ffcc' : '#52525b';
    }
  }

  if (cubes.length !== lastLoggedN || currentBroadPhase !== lastLoggedAlgo) {
    const timestamp = new Date().toISOString();
    let algoritmoLabel = getAlgoLabel(currentBroadPhase);
    logSimulationData(timestamp, cubes.length, algoritmoLabel, comparisons, pureComputeTime, activeCollisions);
    lastLoggedN = cubes.length;
    lastLoggedAlgo = currentBroadPhase;
  }

  updateUI();

  let displayTime = 0;
  switch (currentBroadPhase) {
    case 'brute':
      displayTime = getAverageTime(cubes.length);
      break;
    case 'grid':
      displayTime = getSpatialAverageTime(cubes.length);
      break;
    case 'octree':
      displayTime = getOctreeAverageTime(cubes.length);
      break;
  }
  const t = displayTime > 0 ? displayTime : pureComputeTime;
  const algoLabel = getAlgoLabel(currentBroadPhase);

  if (statN)    statN.textContent    = cubes.length;
  if (statAlgo) statAlgo.textContent = algoLabel;
  if (statComp) statComp.textContent = lastComparisonCount.toLocaleString('pt-BR');
  if (statTime) statTime.textContent = `${t.toFixed(3)} ms`;

  composer.render();
  frameCount++;
}

function updatePhysics() {
  if (simPaused) return;
  const speed = parseFloat(speedSlider.value);
  cubes.forEach(c => {
    if (!c.spawnDone) {
      c.spawnScale = Math.min(c.spawnScale + 0.08, 1);
      const visibleScale = Math.max(c.spawnScale, 0);
      if (!c.colliding && !c.dragging) {
        c.mesh.scale.setScalar(visibleScale < 0.01 ? 0.001 : visibleScale);
      }
      if (c.spawnScale >= 1) c.spawnDone = true;
      return; 
    }

    if (c.dragging) return;
    c.mesh.position.addScaledVector(c.velocity, speed);
    const half = c.size / 2;
    if (Math.abs(c.mesh.position.x) > 20 - half) { c.velocity.x *= -0.95; c.mesh.position.x = Math.sign(c.mesh.position.x) * (20 - half); }
    if (c.mesh.position.y > 20 - half) { c.velocity.y *= -0.95; c.mesh.position.y = 20 - half; }
    else if (c.mesh.position.y < half) { c.velocity.y *= -0.95; c.mesh.position.y = half; }
    if (Math.abs(c.mesh.position.z) > 20 - half) { c.velocity.z *= -0.95; c.mesh.position.z = Math.sign(c.mesh.position.z) * (20 - half); }

    if (c.arrow) {
      c.arrow.position.copy(c.mesh.position);
      if (c.velocity.lengthSq() > 0.00001) {
        c.arrow.setDirection(c.velocity.clone().normalize());
      }
      c.arrow.setLength(Math.min(c.velocity.length() * 2, 5));
      c.arrow.visible = !c.dragging;
    }
  });
}

function toggleWireframe() {
  cubes.forEach(cube => {
    cube.mesh.material = wireframeEnabled ? cube.wireframeMaterial : cube.solidMaterial;
  });
}

function populateBenchWidget(results, n) {
  const widget = document.getElementById('benchWidget');
  const nLabel = document.getElementById('benchWidgetN');
  const rowsEl = document.getElementById('benchWidgetRows');
  if (!widget || !rowsEl) return;

  if (nLabel) nLabel.textContent = `n = ${n}`;

  const maxTime = Math.max(...results.map(r => r.time || 0));

  rowsEl.innerHTML = '';

  results.forEach((r, i) => {
    const ratio     = typeof r.ratio === 'number' ? r.ratio : 1;
    const isFastest = ratio <= 1.05;
    const barPct    = maxTime > 0 ? Math.min((r.time / maxTime) * 100, 100) : 0;
    const ratioStr  = ratio.toFixed(1) + 'x';
    const timeStr   = typeof r.time === 'number' ? r.time.toFixed(3) + ' ms' : '— ms';
    const compStr   = typeof r.comparisons === 'number'
      ? r.comparisons.toLocaleString('pt-BR')
      : '—';

    const row = document.createElement('div');
    row.className = 'bench-row';
    row.innerHTML =
      '<div class="bench-row-meta">' +
        '<span class="bench-row-label" style="color:' + r.color + ';">' + r.label + '</span>' +
        '<div class="bench-row-stats">' +
          '<span class="bench-row-time">' + timeStr + '</span>' +
          '<span class="bench-row-ratio' + (isFastest ? ' fastest' : '') + '">' +
            (isFastest ? '★ 1.0x' : ratioStr) +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div style="font-family:\'Fira Code\',monospace;font-size:0.65rem;color:#e4e4e7;margin-bottom:3px;letter-spacing:0.02em;">' +
        '<span style="color:#a1a1aa;font-size:0.58rem;margin-right:4px;">COMP.</span>' + compStr +
      '</div>' +
      '<div class="bench-bar-track">' +
        '<div class="bench-bar-fill" id="benchFill_' + i + '" style="width:0%;background:' + r.color + ';opacity:0.8;"></div>' +
      '</div>';

    rowsEl.appendChild(row);

    if (i < results.length - 1) {
      const div = document.createElement('div');
      div.className = 'bench-divider';
      rowsEl.appendChild(div);
    }
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      results.forEach((r, i) => {
        const maxT  = Math.max(...results.map(x => x.time || 0));
        const pct   = maxT > 0 ? Math.min((r.time / maxT) * 100, 100) : 0;
        const fill  = document.getElementById('benchFill_' + i);
        if (fill) fill.style.width = pct.toFixed(1) + '%';
      });
    });
  });

  widget.classList.add('visible');
}

// BENCHMARK AUTOMÁTICO
function runBenchmark() {
  if (cubes.length === 0) return;

  const RUNS = 20;
  const TRIM = 0.15;

  function trimmedAvg(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * TRIM);
    const trimmed = sorted.slice(cut, sorted.length - cut);
    if (trimmed.length === 0) return arr.reduce((s, v) => s + v, 0) / arr.length;
    return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
  }

  function benchBrute() {
    try {
      const times = [];
      let comparisons = 0;
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        const t0 = performance.now();
        for (let i = 0; i < cubes.length; i++) {
          for (let j = i + 1; j < cubes.length; j++) {
            comps++;
            intersectAABB(cubes[i], cubes[j]);
          }
        }
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchBrute error:', e); return { time: 0, comparisons: 0 }; }
  }

  function benchGrid() {
    try {
      const times = [];
      let comparisons = 0;
      const grid = new SpatialGrid(2);
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        grid.clear();
        cubes.forEach(c => grid.insert(c));
        const t0 = performance.now();
        cubes.forEach(cube => {
          const potential = grid.getPotentialCollisions(cube);
          potential.forEach(other => {
            if (other.id <= cube.id) return;
            comps++;
            intersectAABB(cube, other);
          });
        });
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchGrid error:', e); return { time: 0, comparisons: 0 }; }
  }

  function benchOctree() {
    try {
      const times = [];
      let comparisons = 0;
      for (let run = 0; run < RUNS; run++) {
        let comps = 0;
        const oct = new OctreeSimulator(60);
        cubes.forEach(c => oct.insert(c));
        const t0 = performance.now();
        
        const testedPairs = new Set();

        cubes.forEach(cube => {
          const potential = oct.getPotentialCollisions(cube);
          potential.forEach(other => {
            const pairKey = cube.id < other.id ? `${cube.id}-${other.id}` : `${other.id}-${cube.id}`;
            if (testedPairs.has(pairKey)) return;
            testedPairs.add(pairKey);

            comps++;
            intersectAABB(cube, other);
          });
        });
        times.push(performance.now() - t0);
        comparisons = comps;
      }
      return { time: trimmedAvg(times), comparisons };
    } catch(e) { console.warn('benchOctree error:', e); return { time: 0, comparisons: 0 }; }
  }

  const results = [
    { key: 'brute',  label: 'Força Bruta O(n²)',        color: '#ff7139', ...benchBrute() },
    { key: 'grid',   label: 'Grade Espacial O(n)',       color: '#00ddff', ...benchGrid() },
    { key: 'octree', label: 'Octree O(n log n)',         color: '#a855f7', ...benchOctree() },
  ];

  const minTime = Math.min(...results.map(r => r.time));
  results.forEach(r => {
    r.ratio = minTime > 0 ? (r.time / minTime) : 1;
  });

  populateBenchWidget(results, cubes.length);

  const benchN = document.getElementById('benchN');
  if (benchN) benchN.textContent = cubes.length + ' cubos';

  const tbody = document.getElementById('benchmarkTbody');
  if (tbody) {
    tbody.innerHTML = '';
    results.forEach(r => {
      const isActive = r.key === currentBroadPhase;
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      if (isActive) {
        tr.style.background = 'rgba(255,255,255,0.04)';
      }
      const ratioStr = r.ratio === 1 ? '1.0x' : r.ratio.toFixed(1) + 'x';
      const isFastest = r.ratio <= 1.0001;
      tr.innerHTML = `
        <td style="padding:10px 12px;color:${r.color};font-weight:500;white-space:nowrap;">
          ${isActive ? '<span style="font-size:0.6rem;opacity:0.7;margin-right:6px;">▶</span>' : ''}${r.label}
        </td>
        <td style="padding:10px 12px;text-align:right;color:var(--text-muted);">${r.comparisons.toLocaleString('pt-BR')}</td>
        <td style="padding:10px 12px;text-align:right;color:var(--text-main);">${r.time.toFixed(4)} ms</td>
        <td style="padding:10px 12px;text-align:right;color:${isFastest ? '#4ade80' : 'var(--text-muted)'};">${ratioStr}${isFastest ? ' 🏆' : ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const modal = document.getElementById('benchmarkModal');
  if (modal) modal.classList.remove('hidden');
  playSound();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updatePhysics();
  detectCollisions();
  impactParticles.update(delta);

  if (lightTimer > 0) {
    lightTimer -= delta;
    if (lightTimer <= 0) {
      impactLight.intensity = 0;
    }
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.scale += 0.25;
    sw.opacity -= 0.04;
    sw.mesh.scale.set(sw.scale, sw.scale, 1);
    sw.mesh.material.opacity = Math.max(0, sw.opacity);

    if (sw.opacity <= 0) {
      scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
      shockwaves.splice(i, 1);
    }
  }

  if (presentationMode) {
    presentOrbitAngle += 0.003;
    camera.position.x = Math.sin(presentOrbitAngle) * presentOrbitRadius;
    camera.position.z = Math.cos(presentOrbitAngle) * presentOrbitRadius;
    camera.position.y = presentOrbitY + Math.sin(presentOrbitAngle * 0.4) * 5;
    camera.lookAt(0, 3, 0);
    updatePresentHud();
  }
  controls.update();
  drawChart(); 
}

// --- 7. EVENTOS E INTERATIVIDADE ---

const MODE_THEMES = {
  brute: {
    color:  '#ff7139',
    dim:    'rgba(255, 113, 57, 0.35)',
    glow:   'rgba(255, 113, 57, 0.15)',
    subtle: 'rgba(255, 113, 57, 0.08)',
  },
  grid: {
    color:  '#00ddff',
    dim:    'rgba(0, 221, 255, 0.35)',
    glow:   'rgba(0, 221, 255, 0.12)',
    subtle: 'rgba(0, 221, 255, 0.07)',
  },
  octree: {
    color:  '#a855f7',
    dim:    'rgba(168, 85, 247, 0.35)',
    glow:   'rgba(168, 85, 247, 0.15)',
    subtle: 'rgba(168, 85, 247, 0.08)',
  },
};

function setModeTheme(mode) {
  const t = MODE_THEMES[mode] || MODE_THEMES.brute;
  const root = document.documentElement;
  root.style.setProperty('--mode-color',        t.color);
  root.style.setProperty('--mode-color-dim',    t.dim);
  root.style.setProperty('--mode-color-glow',   t.glow);
  root.style.setProperty('--mode-color-subtle', t.subtle);

  const topBar = document.getElementById('topBar');
  if (topBar) {
    let leftTint, rightTint;
    if (mode === 'brute') {
      leftTint  = 'rgba(255,113,57,0.07)';
      rightTint = 'rgba(255,113,57,0.03)';
    } else if (mode === 'grid') {
      leftTint  = 'rgba(0,221,255,0.03)';
      rightTint = 'rgba(0,221,255,0.07)';
    } else { 
      leftTint  = 'rgba(168,85,247,0.05)';
      rightTint = 'rgba(168,85,247,0.05)';
    }
    topBar.style.background = `linear-gradient(to right, ${leftTint} 0%, rgba(27,27,31,0.88) 30%, rgba(27,27,31,0.88) 70%, ${rightTint} 100%)`;
    topBar.style.backdropFilter = 'blur(14px)';
    topBar.style.webkitBackdropFilter = 'blur(14px)';
  }
}

let presentationMode = false;
let presentOrbitAngle = Math.atan2(camera.position.x, camera.position.z);
const presentOrbitRadius = 68;
const presentOrbitY      = 32;

let savedCameraPos    = null;
let savedCameraTarget = null;

function updatePresentHud() {
  const modeEl  = document.getElementById('presentMode');
  const nEl     = document.getElementById('presentN');
  const compEl  = document.getElementById('presentComp');
  const collEl  = document.getElementById('presentCollisions');
  if (modeEl) modeEl.textContent = getAlgoLabel(currentBroadPhase);
  if (nEl)    nEl.textContent    = `n = ${cubes.length}`;
  if (compEl) compEl.textContent = `${lastComparisonCount.toLocaleString('pt-BR')} comp.`;
  if (collEl) collEl.textContent = `${collisionCount} colisões`;
}

function enterPresentation() {
  if (presentationMode) return;
  presentationMode = true;

  savedCameraPos    = camera.position.clone();
  savedCameraTarget = controls.target.clone();

  presentOrbitAngle = Math.atan2(camera.position.x, camera.position.z);
  controls.enabled = false;

  document.body.classList.add('presentation-mode');
  document.getElementById('presentBtn').title = 'Sair da Apresentação [P]';
  updatePresentHud();
  playSound();
}

function exitPresentation() {
  if (!presentationMode) return;
  presentationMode = false;

  if (savedCameraPos) {
    camera.position.copy(savedCameraPos);
    controls.target.copy(savedCameraTarget);
    camera.lookAt(savedCameraTarget);
  }
  controls.enabled = true;

  document.body.classList.remove('presentation-mode');
  document.getElementById('presentBtn').title = 'Modo Apresentação [P]';
  playSound();
}

function togglePresentation() {
  presentationMode ? exitPresentation() : enterPresentation();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale, false);
  composer.setSize(window.innerWidth * pixelScale, window.innerHeight * pixelScale);
  ditherPass.material.uniforms.resolution.value.set(window.innerWidth * pixelScale, window.innerHeight * pixelScale);
});

cubeCountInput.addEventListener('input', e => {
  cubeCountNumber.value = e.target.value;
  const disp = document.getElementById('cubeCountDisplay');
  if (disp) disp.textContent = e.target.value;
  initCubes();
});
cubeCountNumber.addEventListener('change', e => {
  cubeCountInput.value = e.target.value;
  const disp = document.getElementById('cubeCountDisplay');
  if (disp) disp.textContent = e.target.value;
  initCubes();
});
document.getElementById('toggleBtn').addEventListener('click', e => {
  simPaused = !simPaused;
  const btn = document.getElementById('toggleBtn');
  btn.lastChild.textContent = simPaused ? ' RETOMAR' : ' PAUSAR';
  chartPanel.classList.toggle('sim-paused', simPaused);
  document.getElementById('chartStats').classList.toggle('sim-paused', simPaused);
  playSound();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  cubeCountInput.max = 20;
  cubeCountNumber.max = 20;
  cubeCountInput.value = 8;
  cubeCountNumber.value = 8;
  initCubes();
  playSound();
});
document.getElementById('showGrid').addEventListener('change', e => scene.children.find(c => c.type === "GridHelper").visible = e.target.checked);

document.getElementById('heatmapToggle').addEventListener('change', e => {
  isHeatmapEnabled = e.target.checked;
  if (!isHeatmapEnabled) resetHeatmap();
  playSound();
});

minimizeBtn.addEventListener('click', () => {
  controlPanel.classList.toggle('panel-hidden');
  const active = !controlPanel.classList.contains('panel-hidden');
  minimizeBtn.style.background = active ? 'var(--mode-color-glow)' : '';
  minimizeBtn.style.borderColor = active ? 'var(--mode-color-dim)' : '';
  minimizeBtn.style.color = active ? 'var(--mode-color)' : '';
  playSound();
});

toggleChartBtn.addEventListener('click', () => {
  chartPanel.classList.toggle('chart-hidden');
  const active = !chartPanel.classList.contains('chart-hidden');
  toggleChartBtn.style.background = active ? 'var(--mode-color-glow)' : '';
  toggleChartBtn.style.borderColor = active ? 'var(--mode-color-dim)' : '';
  toggleChartBtn.style.color = active ? 'var(--mode-color)' : '';
  playSound();
});

document.getElementById('theoryBtn').addEventListener('click', () => { theoryModal.classList.remove('hidden'); playSound(); });
document.getElementById('closeTheoryBtn').addEventListener('click', () => { theoryModal.classList.add('hidden'); playSound(); });
const benchTopbarBtn = document.getElementById('benchTopbarBtn');
if (benchTopbarBtn) benchTopbarBtn.addEventListener('click', () => { runBenchmark(); });
document.getElementById('closeBenchmarkBtn').addEventListener('click', () => { document.getElementById('benchmarkModal').classList.add('hidden'); playSound(); });

const benchWidgetClose = document.getElementById('benchWidgetClose');
if (benchWidgetClose) benchWidgetClose.addEventListener('click', () => {
  document.getElementById('benchWidget').classList.remove('visible');
  playSound();
});

const benchWidgetRerun = document.getElementById('benchWidgetRerun');
if (benchWidgetRerun) benchWidgetRerun.addEventListener('click', () => { runBenchmark(); });

document.getElementById('presentBtn').addEventListener('click', togglePresentation);

stressBtn.addEventListener('click', () => {
  const isActive = stressBtn.classList.toggle('btn-stress');
  if (isActive) {
    cubeCountInput.max = 150;
    cubeCountNumber.max = 150;
    cubeCountInput.value = 150;
    cubeCountNumber.value = 150;
  } else {
    cubeCountInput.max = 20;
    cubeCountNumber.max = 20;
    cubeCountInput.value = 8;
    cubeCountNumber.value = 8;
  }

  controlPanel.classList.toggle('stress-active', isActive);
  const stressBadge = document.getElementById('stressBadge');
  if (stressBadge) stressBadge.classList.toggle('visible', isActive);

  document.body.classList.toggle('stress-mode', isActive);

  const flicker = document.getElementById('stressFlicker');
  if (flicker) {
    flicker.classList.remove('flash');
    void flicker.offsetWidth; 
    flicker.classList.add('flash');
  }

  initCubes();
  playSound();
});

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  document.getElementById('soundIconOn').style.display  = soundEnabled ? '' : 'none';
  document.getElementById('soundIconOff').style.display = soundEnabled ? 'none' : '';
  document.getElementById('soundLabel').textContent = soundEnabled ? 'SOM' : 'SEM SOM';
  playSound();
});

document.getElementById('broadPhaseSelect').addEventListener('change', (e) => {
  currentBroadPhase = e.target.value;
  initCubes();
  playSound();

  setModeTheme(currentBroadPhase);
  updateContextPanel(currentBroadPhase);

  controlPanel.classList.remove('mode-brute', 'mode-grid', 'mode-octree');
  controlPanel.classList.add('mode-' + currentBroadPhase);

  switch (currentBroadPhase) {
    case 'brute':
      startTyping(pseudoCodeBrute);
      break;
    case 'grid':
      startTyping(pseudoCodeSpatial);
      break;
    case 'octree':
      startTyping(pseudoCodeOctree);
      break;
  }
});

wireframeBtn.addEventListener('click', () => {
  wireframeEnabled = !wireframeEnabled;
  wireframeBtn.style.background = wireframeEnabled ? 'var(--accent)' : 'var(--sidebar-bg)';
  playSound();
  toggleWireframe();
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  exportCSV();
  playSound();
});

document.getElementById('physicsBtn').addEventListener('click', () => {
  isPhysicsEnabled = !isPhysicsEnabled;
  const btn = document.getElementById('physicsBtn');
  btn.classList.toggle('btn-active', isPhysicsEnabled);
  btn.style.background   = isPhysicsEnabled ? 'var(--mode-color-glow)'   : '';
  btn.style.borderColor  = isPhysicsEnabled ? 'var(--mode-color-dim)'    : '';
  btn.style.color        = isPhysicsEnabled ? 'var(--mode-color)'        : '';
  playSound();
});

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const key = e.key.toLowerCase();

  if (e.code === 'Escape') {
    exitPresentation();
    return;
  }
  if (key === 'p') {
    togglePresentation();
    return;
  }

  if (presentationMode) return;

  if (e.code === 'Space') {
    e.preventDefault();
    simPaused = !simPaused;
    document.getElementById('toggleBtn').textContent = simPaused ? 'RETOMAR' : 'PAUSAR';
    chartPanel.classList.toggle('sim-paused', simPaused);
    document.getElementById('chartStats').classList.toggle('sim-paused', simPaused);
    playSound();
  } else if (key === 'r') {
    document.getElementById('resetBtn').click();
  } else if (key === 's') {
    stressBtn.click();
  } else if (key === 'w') {
    wireframeEnabled = !wireframeEnabled;
    wireframeBtn.style.background = wireframeEnabled ? 'var(--accent)' : 'var(--sidebar-bg)';
    playSound();
    toggleWireframe();
  } else if (key === 'b') {
    runBenchmark();
  }
});

// --- DRAG & DROP 3D COM CONTROLO DE ALTURA (EIXO Y) E HEIGHT DROP LINE ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
const offset = new THREE.Vector3();

// Linha pontilhada do vetor de força ao arrastar
const forceLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const forceLineMat = new THREE.LineDashedMaterial({
  color: 0xffdd44,
  dashSize: 0.6,
  gapSize: 0.3,
  linewidth: 2
});
const forceLineMesh = new THREE.Line(forceLineGeo, forceLineMat);
forceLineMesh.visible = false;
scene.add(forceLineMesh);

let hoveredCube = null;

// Roda do rato para subir/descer a altura (Y) em tempo real enquanto segura o cubo
window.addEventListener('wheel', e => {
  if (!draggedCube) return;
  e.preventDefault();

  const step = e.deltaY < 0 ? 1.0 : -1.0;
  const half = draggedCube.size / 2;

  draggedCube.mesh.position.y = THREE.MathUtils.clamp(
    draggedCube.mesh.position.y + step,
    half,
    20 - half
  );

  // Atualiza a guia de projeção até ao chão
  const groundPoint = new THREE.Vector3(draggedCube.mesh.position.x, 0, draggedCube.mesh.position.z);
  dropLineGeo.setFromPoints([draggedCube.mesh.position, groundPoint]);
  dropLineGeo.attributes.position.needsUpdate = true;
  dropLineMesh.computeLineDistances();
  dropLineMesh.visible = true;

  // Recalcula o plano orientado à câmara
  const cameraDir = new THREE.Vector3();
  camera.getWorldDirection(cameraDir);
  plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), draggedCube.mesh.position);
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.target.closest('#controlPanel') || e.target.closest('#chartPanel') || e.target.closest('button') || e.target.closest('#collisionBadge')) return;

  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(cubes.map(c => c.mesh));

  if (intersects.length > 0) {
    controls.enabled = false;
    draggedCube = intersects[0].object.userData;
    draggedCube.dragging = true; 
    draggedCube.velocity.set(0,0,0);

    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), draggedCube.mesh.position);

    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
      offset.copy(intersectPoint).sub(draggedCube.mesh.position);
    }

    draggedCube.mesh.material.color.copy(DRAG_COLOR);
    hoverBoxHelper.setFromObject(draggedCube.mesh);
    hoverBoxHelper.visible = true;

    // Ativa a linha de guia vertical
    const groundPoint = new THREE.Vector3(draggedCube.mesh.position.x, 0, draggedCube.mesh.position.z);
    dropLineGeo.setFromPoints([draggedCube.mesh.position, groundPoint]);
    dropLineGeo.attributes.position.needsUpdate = true;
    dropLineMesh.computeLineDistances();
    dropLineMesh.visible = true;
  }
});

renderer.domElement.addEventListener('pointermove', e => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);

  if (!draggedCube) {
    const intersects = raycaster.intersectObjects(cubes.map(c => c.mesh));
    if (intersects.length > 0) {
      const c = intersects[0].object.userData;
      if (hoveredCube !== c) {
        if (hoveredCube && !hoveredCube.colliding) hoveredCube.mesh.material.color.copy(hoveredCube.baseColor);
        hoveredCube = c;
        document.body.style.cursor = 'pointer';
      }
      if (!c.colliding) c.mesh.material.color.lerp(new THREE.Color(0xffffff), 0.3);
      hoverBoxHelper.setFromObject(hoveredCube.mesh);
      hoverBoxHelper.visible = true;
    } else {
      if (hoveredCube && !hoveredCube.colliding) hoveredCube.mesh.material.color.copy(hoveredCube.baseColor);
      hoveredCube = null;
      hoverBoxHelper.visible = false;
      document.body.style.cursor = 'default';
    }
  } else {
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
      const targetPos = intersectPoint.sub(offset);

      const half = draggedCube.size / 2;
      targetPos.x = THREE.MathUtils.clamp(targetPos.x, -20 + half, 20 - half);
      targetPos.y = THREE.MathUtils.clamp(targetPos.y, half, 20 - half);
      targetPos.z = THREE.MathUtils.clamp(targetPos.z, -20 + half, 20 - half);

      forceLineGeo.setFromPoints([draggedCube.mesh.position, targetPos]);
      forceLineGeo.attributes.position.needsUpdate = true;
      forceLineMesh.computeLineDistances();
      forceLineMesh.visible = true;

      draggedCube.mesh.position.copy(targetPos);
      hoverBoxHelper.setFromObject(draggedCube.mesh);
      hoverBoxHelper.visible = true;

      // Atualiza a linha de projeção vertical até ao chão
      const groundPoint = new THREE.Vector3(targetPos.x, 0, targetPos.z);
      dropLineGeo.setFromPoints([targetPos, groundPoint]);
      dropLineGeo.attributes.position.needsUpdate = true;
      dropLineMesh.computeLineDistances();
      dropLineMesh.visible = true;
    }
  }
});

const endDrag = () => {
  if (!draggedCube) return;
  forceLineMesh.visible = false;
  hoverBoxHelper.visible = false;
  dropLineMesh.visible = false;
  draggedCube.dragging = false;
  draggedCube.velocity.set(
    (Math.random() - 0.5) * parseFloat(speedSlider.value),
    (Math.random() - 0.5) * parseFloat(speedSlider.value),
    (Math.random() - 0.5) * parseFloat(speedSlider.value)
  );
  draggedCube = null;
  controls.enabled = true;
};
renderer.domElement.addEventListener('pointerup', endDrag);

// --- 8. ARRANQUE ---
cubeCountInput.value        = 8;
cubeCountNumber.value       = 8;
document.getElementById('cubeCountDisplay').textContent = 8;
document.getElementById('speed').value              = '0.8';
document.getElementById('broadPhaseSelect').value   = 'brute';
document.getElementById('showGrid').checked         = true;
currentBroadPhase = 'brute';

initCubes();
startTyping(pseudoCodeBrute);
updateContextPanel('brute');
animate();
setModeTheme('brute');

// --- 9. LANDING PAGE ---
const landingPage = document.getElementById('landingPage');
const startBtn = document.getElementById('startBtn');

function animateCounters() {
  document.querySelectorAll('.counter-num').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    const duration = 1200;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  });
}
setTimeout(animateCounters, 900);

if (startBtn && landingPage) {
  startBtn.addEventListener('click', () => {
    landingPage.classList.add('hidden');
    playSound();
  });
}