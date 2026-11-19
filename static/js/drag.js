// --- drag.js — Arrastar e largar cubos na cena 3D ---
import * as THREE from 'three';
import { camera, controls, scene, renderer, dropLineMesh, hoverBoxHelper, DRAG_COLOR } from './three-setup.js';
import { state, RACE_MODES, ARENA_HALF_XZ, ARENA_HEIGHT, pickSapInterval } from './physics.js';
import { isPresenting } from './view-modes.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
const offset = new THREE.Vector3();

const forceLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const forceLineMat = new THREE.LineDashedMaterial({ color: 0xffdd44, dashSize: 0.6, gapSize: 0.3 });
const forceLineMesh = new THREE.Line(forceLineGeo, forceLineMat);
forceLineMesh.visible = false;
scene.add(forceLineMesh);

const _cameraDir = new THREE.Vector3();
const _intersectPoint = new THREE.Vector3();
const _groundPoint = new THREE.Vector3();
const _rulerPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08); // altura da régua do Sweep and Prune

// Fora de um cubo, no modo Sweep and Prune, o ponteiro pode estar sobre um intervalo da régua
function cubeUnderRuler() {
  if (state.raceMode || state.currentBroadPhase !== 'sap') return null;
  if (!raycaster.ray.intersectPlane(_rulerPlane, _groundPoint)) return null;
  return pickSapInterval(_groundPoint.x, _groundPoint.z);
}

const cubeMeshes = () => state.cubes.map(c => c.mesh);

// Posição do ponteiro em coordenadas da câmera. Na corrida cada coluna é uma vista
// completa da cena, então o X é medido dentro da coluna em que o ponteiro está.
function setMouseFromEvent(e) {
  const colW = window.innerWidth / (state.raceMode ? RACE_MODES.length : 1);
  mouse.set(((e.clientX % colW) / colW) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}

function updateDropLine(pos) {
  _groundPoint.set(pos.x, 0, pos.z);
  dropLineMesh.geometry.setFromPoints([pos, _groundPoint]);
  dropLineMesh.computeLineDistances();
  dropLineMesh.visible = true;
}

// Roda do mouse durante o arraste: sobe e desce o cubo
window.addEventListener('wheel', e => {
  if (!state.draggedCube) return;
  e.preventDefault();
  const cube = state.draggedCube;
  const half = cube.size / 2;
  const step = e.deltaY < 0 ? 1.0 : -1.0;
  cube.mesh.position.y = THREE.MathUtils.clamp(cube.mesh.position.y + step, half, ARENA_HEIGHT - half);
  updateDropLine(cube.mesh.position);
  camera.getWorldDirection(_cameraDir);
  plane.setFromNormalAndCoplanarPoint(_cameraDir.negate(), cube.mesh.position);
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || isPresenting()) return;
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(cubeMeshes());
  if (intersects.length === 0) return;

  const cube = intersects[0].object.userData;
  controls.enabled = false;
  state.draggedCube = cube;
  cube.dragging = true;
  cube.velocity.set(0, 0, 0);

  camera.getWorldDirection(_cameraDir);
  plane.setFromNormalAndCoplanarPoint(_cameraDir.negate(), cube.mesh.position);
  if (raycaster.ray.intersectPlane(plane, _intersectPoint)) offset.copy(_intersectPoint).sub(cube.mesh.position);
  else offset.set(0, 0, 0);

  cube.mesh.material.color.copy(DRAG_COLOR);
  hoverBoxHelper.setFromObject(cube.mesh);
  hoverBoxHelper.visible = true;
  updateDropLine(cube.mesh.position);
});

renderer.domElement.addEventListener('pointermove', e => {
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouse, camera);

  const cube = state.draggedCube;
  if (!cube) {
    // O realce de hover é aplicado em detectCollisions (que redefine as cores a cada frame)
    const intersects = raycaster.intersectObjects(cubeMeshes());
    const hit = intersects.length > 0 ? intersects[0].object.userData : cubeUnderRuler();
    state.hoveredCube = hit;
    if (hit) hoverBoxHelper.setFromObject(hit.mesh);
    hoverBoxHelper.visible = !!hit;
    document.body.style.cursor = hit ? 'pointer' : 'default';
    return;
  }

  if (!raycaster.ray.intersectPlane(plane, _intersectPoint)) return;
  const targetPos = _intersectPoint.sub(offset);
  const half = cube.size / 2;
  targetPos.x = THREE.MathUtils.clamp(targetPos.x, -ARENA_HALF_XZ + half, ARENA_HALF_XZ - half);
  targetPos.y = THREE.MathUtils.clamp(targetPos.y, half, ARENA_HEIGHT - half);
  targetPos.z = THREE.MathUtils.clamp(targetPos.z, -ARENA_HALF_XZ + half, ARENA_HALF_XZ - half);

  forceLineGeo.setFromPoints([cube.mesh.position, targetPos]);
  forceLineMesh.computeLineDistances();
  forceLineMesh.visible = true;

  cube.mesh.position.copy(targetPos);
  hoverBoxHelper.setFromObject(cube.mesh);
  hoverBoxHelper.visible = true;
  updateDropLine(targetPos);
});

function endDrag() {
  const cube = state.draggedCube;
  if (!cube) return;
  forceLineMesh.visible = false;
  hoverBoxHelper.visible = false;
  dropLineMesh.visible = false;
  cube.dragging = false;
  const s = state.simSpeed;
  cube.velocity.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  state.draggedCube = null;
  controls.enabled = !isPresenting();
}
// Na janela inteira: soltar o botão sobre um painel (fora do canvas) também encerra o arraste
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
