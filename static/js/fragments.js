// --- fragments.js — Estilhaços soltos pelas colisões fortes ---
// Efeito só visual: os fragmentos não fazem parte de state.cubes, então nunca entram
// na broad-phase nem nos tempos medidos. São instâncias de uma única malha
// (InstancedMesh), com física própria e simples: gravidade, quique no chão e nas
// paredes da arena, e somem depois de um tempo.

import * as THREE from 'three';
import { scene } from './three-setup.js';

const MAX_FRAGMENTS = 320;
const MAX_SPAWN_PER_FRAME = 10; // teto por frame: 150 cubos colidindo não esgotam o pool de uma vez
const GRAVITY = 26;
const FADE_PORTION = 0.3;       // fração final da vida em que o fragmento encolhe até sumir

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
export const fragmentMesh = new THREE.InstancedMesh(geometry, material, MAX_FRAGMENTS);
fragmentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
fragmentMesh.setColorAt(0, new THREE.Color(0xffffff)); // cria o atributo de cor antes do primeiro render
fragmentMesh.castShadow = true;
fragmentMesh.frustumCulled = false;
fragmentMesh.count = 0;
scene.add(fragmentMesh);

// Pool fixo: os ativos ocupam os índices 0..activeCount-1 (remoção troca com o último)
const pool = Array.from({ length: MAX_FRAGMENTS }, () => ({
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  rotation: new THREE.Euler(),
  spin: new THREE.Vector3(),
  color: new THREE.Color(),
  size: 0.5,
  life: 0,
  maxLife: 1,
}));
let activeCount = 0;
let spawnedThisFrame = 0;

// Solta fragmentos a partir do ponto de impacto. strength vai de 0 a 1;
// colorA e colorB são as cores dos dois cubos que colidiram.
export function spawnFragments(position, colorA, colorB, strength) {
  const wanted = 3 + Math.round(strength * 5);
  for (let i = 0; i < wanted; i++) {
    if (activeCount >= MAX_FRAGMENTS || spawnedThisFrame >= MAX_SPAWN_PER_FRAME) return;
    const f = pool[activeCount++];
    spawnedThisFrame++;

    f.position.copy(position);
    // direção aleatória na esfera, com um empurrão extra para cima
    const phi = Math.random() * Math.PI * 2;
    const cosTheta = 2 * Math.random() - 1;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const speed = 3 + Math.random() * 6 + strength * 4;
    f.velocity.set(
      sinTheta * Math.cos(phi) * speed,
      Math.abs(cosTheta) * speed + 2 + Math.random() * 4,
      sinTheta * Math.sin(phi) * speed
    );
    f.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    f.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    f.color.copy(Math.random() < 0.5 ? colorA : colorB);
    f.size = 0.3 + Math.random() * 0.5;
    f.life = 0;
    f.maxLife = 1.3 + Math.random() * 0.9;
  }
}

const _dummy = new THREE.Object3D();

// arenaHalf: metade do lado da arena em X e Z (as paredes onde os fragmentos quicam)
export function updateFragments(delta, arenaHalf) {
  spawnedThisFrame = 0;
  if (activeCount === 0 && fragmentMesh.count === 0) return;

  for (let i = 0; i < activeCount; i++) {
    const f = pool[i];
    f.life += delta;
    if (f.life >= f.maxLife) {
      // troca com o último ativo e reavalia este índice
      activeCount--;
      pool[i] = pool[activeCount];
      pool[activeCount] = f;
      i--;
      continue;
    }

    const half = f.size / 2;
    f.velocity.y -= GRAVITY * delta;
    f.position.addScaledVector(f.velocity, delta);

    if (f.position.y < half) {
      f.position.y = half;
      if (f.velocity.y < 0) f.velocity.y *= -0.45;
      f.velocity.x *= 0.8;
      f.velocity.z *= 0.8;
      f.spin.multiplyScalar(0.7);
    }
    const limit = arenaHalf - half;
    if (Math.abs(f.position.x) > limit) { f.position.x = Math.sign(f.position.x) * limit; f.velocity.x *= -0.5; }
    if (Math.abs(f.position.z) > limit) { f.position.z = Math.sign(f.position.z) * limit; f.velocity.z *= -0.5; }

    f.rotation.x += f.spin.x * delta;
    f.rotation.y += f.spin.y * delta;
    f.rotation.z += f.spin.z * delta;

    const remaining = 1 - f.life / f.maxLife;
    const scale = f.size * Math.min(1, remaining / FADE_PORTION);
    _dummy.position.copy(f.position);
    _dummy.rotation.copy(f.rotation);
    _dummy.scale.setScalar(Math.max(scale, 0.001));
    _dummy.updateMatrix();
    fragmentMesh.setMatrixAt(i, _dummy.matrix);
    fragmentMesh.setColorAt(i, f.color);
  }

  fragmentMesh.count = activeCount;
  fragmentMesh.instanceMatrix.needsUpdate = true;
  fragmentMesh.instanceColor.needsUpdate = true;
}

export function clearFragments() {
  activeCount = 0;
  fragmentMesh.count = 0;
}
