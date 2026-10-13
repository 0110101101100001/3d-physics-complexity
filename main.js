// --- 1. CONFIGURAÇÃO BASE DO THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1C1B1A); // Fundo Anthropic

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 40, 70);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Luzes
scene.add(new THREE.AmbientLight(0xFFF5E6, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(10, 30, 20);
scene.add(dirLight);

// Grelha
scene.add(new THREE.GridHelper(50, 50, 0x3D3B3A, 0x2E2D2C));

// --- 2. VARIÁVEIS E CORES (Mascote Claude) ---
let cubes = [];
let nextId = 0;
let draggedCube = null;
let simPaused = false;
let collisionCount = 0;
let activeCollisions = 0;
let currentCollidingPairs = new Set();

const SAFE_COLOR = new THREE.Color(0xD97706);      // Laranja Claude
const ALT_COLOR = new THREE.Color(0xFDE68A);       // Bege
const COLLISION_COLOR = new THREE.Color(0xEF4444); // Vermelho Impacto
const DRAG_COLOR = new THREE.Color(0xFBBF24);      // Amarelo Arrastar

// --- 3. ELEMENTOS DA UI ---
const cubeCountInput = document.getElementById('cubeCount');
const cubeCountNumber = document.getElementById('cubeCountInput');
const speedSlider = document.getElementById('speed');
const collisionBadge = document.getElementById('collisionBadge');
const minimizeBtn = document.getElementById('minimizeBtn');
const controlPanel = document.getElementById('controlPanel');
const theoryModal = document.getElementById('theoryModal');

// --- 4. LÓGICA DE FÍSICA E CUBOS ---
function createCube() {
  const size = Math.random() * 4 + 2;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? SAFE_COLOR : ALT_COLOR, roughness: 0.9 })
  );
  
  mesh.position.set((Math.random() - 0.5) * 40, (Math.random() * 15) + size, (Math.random() - 0.5) * 40);
  
  const speed = parseFloat(speedSlider.value);
  const velocity = new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);

  const cubeData = { mesh, id: nextId++, size, velocity, dragging: false, colliding: false, baseColor: mesh.material.color.clone() };
  mesh.userData = cubeData;
  cubes.push(cubeData);
  scene.add(mesh);
}

function initCubes() {
  cubes.forEach(c => { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); });
  cubes = []; nextId = 0; collisionCount = 0; currentCollidingPairs.clear();
  const count = parseInt(cubeCountInput.value, 10);
  for (let i = 0; i < count; i++) createCube();
  updateUI();
}

function updateUI() {
  collisionBadge.textContent = `Total: ${collisionCount}`;
  if(activeCollisions > 0) collisionBadge.style.color = "#EF4444";
  else collisionBadge.style.color = "var(--text-main)";
}

function intersectAABB(a, b) {
  const hA = a.size / 2, hB = b.size / 2;
  return Math.abs(a.mesh.position.x - b.mesh.position.x) < (hA + hB) &&
         Math.abs(a.mesh.position.y - b.mesh.position.y) < (hA + hB) &&
         Math.abs(a.mesh.position.z - b.mesh.position.z) < (hA + hB);
}

function detectCollisions() {
  cubes.forEach(c => {
    c.colliding = false;
    if (!c.dragging) {
      c.mesh.material.color.copy(c.baseColor);
      c.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1); // Volta ao normal
    }
  });

  const newPairs = new Set();
  activeCollisions = 0;

  for (let i = 0; i < cubes.length; i++) {
    for (let j = i + 1; j < cubes.length; j++) {
      if (intersectAABB(cubes[i], cubes[j])) {
        cubes[i].colliding = cubes[j].colliding = true;
        activeCollisions++;
        
        if (!cubes[i].dragging) { cubes[i].mesh.material.color.copy(COLLISION_COLOR); cubes[i].mesh.scale.set(1.15, 0.85, 1.15); }
        if (!cubes[j].dragging) { cubes[j].mesh.material.color.copy(COLLISION_COLOR); cubes[j].mesh.scale.set(1.15, 0.85, 1.15); }
        
        newPairs.add(`${cubes[i].id}-${cubes[j].id}`);
      }
    }
  }

  for (const key of newPairs) { if (!currentCollidingPairs.has(key)) collisionCount++; }
  currentCollidingPairs = newPairs;
  updateUI();
}

function updatePhysics() {
  if (simPaused) return;
  const speed = parseFloat(speedSlider.value);
  cubes.forEach(c => {
    if (c.dragging) return;
    c.mesh.position.addScaledVector(c.velocity, speed);
    const half = c.size / 2;
    // Bounds
    if (Math.abs(c.mesh.position.x) > 20 - half) { c.velocity.x *= -0.95; c.mesh.position.x = Math.sign(c.mesh.position.x) * (20 - half); }
    if (c.mesh.position.y > 20 - half) { c.velocity.y *= -0.95; c.mesh.position.y = 20 - half; } 
    else if (c.mesh.position.y < half) { c.velocity.y *= -0.95; c.mesh.position.y = half; }
    if (Math.abs(c.mesh.position.z) > 20 - half) { c.velocity.z *= -0.95; c.mesh.position.z = Math.sign(c.mesh.position.z) * (20 - half); }
  });
}

function animate() {
  requestAnimationFrame(animate);
  updatePhysics();
  detectCollisions();
  renderer.render(scene, camera);
}

// --- 5. EVENTOS E INTERATIVIDADE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

cubeCountInput.addEventListener('input', e => { cubeCountNumber.value = e.target.value; initCubes(); });
cubeCountNumber.addEventListener('change', e => { cubeCountInput.value = e.target.value; initCubes(); });
document.getElementById('toggleBtn').addEventListener('click', e => { simPaused = !simPaused; e.target.textContent = simPaused ? 'RETOMAR' : 'PAUSAR'; });
document.getElementById('resetBtn').addEventListener('click', initCubes);
document.getElementById('showGrid').addEventListener('change', e => scene.children.find(c => c.type === "GridHelper").visible = e.target.checked);

minimizeBtn.addEventListener('click', () => {
  controlPanel.classList.toggle('panel-hidden');
  minimizeBtn.style.background = controlPanel.classList.contains('panel-hidden') ? 'var(--accent)' : 'var(--sidebar-bg)';
});

document.getElementById('theoryBtn').addEventListener('click', () => theoryModal.classList.remove('hidden'));
document.getElementById('closeTheoryBtn').addEventListener('click', () => theoryModal.classList.add('hidden'));

// Drag Logic Simplificada
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), offset = new THREE.Vector3();
renderer.domElement.addEventListener('pointerdown', e => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(cubes.map(c => c.mesh));
  if (intersects.length > 0) {
    draggedCube = intersects[0].object.userData;
    draggedCube.dragging = true; draggedCube.velocity.set(0,0,0);
    plane.constant = draggedCube.mesh.position.y;
    raycaster.ray.intersectPlane(plane, offset);
    offset.sub(draggedCube.mesh.position);
    draggedCube.mesh.material.color.copy(DRAG_COLOR);
  }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!draggedCube) return;
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const intersectPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersectPoint);
  draggedCube.mesh.position.copy(intersectPoint.sub(offset));
});
const endDrag = () => {
  if (!draggedCube) return;
  draggedCube.dragging = false;
  draggedCube.velocity.set((Math.random()-0.5)*parseFloat(speedSlider.value), (Math.random()-0.5)*parseFloat(speedSlider.value), (Math.random()-0.5)*parseFloat(speedSlider.value));
  draggedCube = null;
};
renderer.domElement.addEventListener('pointerup', endDrag);

// --- 6. ARRANQUE ---
initCubes();
animate();