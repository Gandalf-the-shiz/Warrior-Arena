/**
 * EnemySpawnVFX — visual effects when enemies spawn into the arena.
 *
 * Each spawn point receives:
 *   1. A dark purple ring (RingGeometry with emissive material) that fades in
 *      then out over ~1 second.
 *   2. A burst of dark-red/purple billboard particles that scatter outward.
 *
 * Objects are pooled and reused to avoid GC spikes.
 */

import * as THREE from 'three';

const RING_FADE_IN  = 0.2; // seconds
const RING_HOLD     = 0.4;
const RING_FADE_OUT = 0.4;
const RING_TOTAL    = RING_FADE_IN + RING_HOLD + RING_FADE_OUT;

const PARTICLE_COUNT = 9;
const PARTICLE_SPEED = 4.0;
const PARTICLE_LIFE  = 0.6;

interface RingInstance {
  mesh: THREE.Mesh;
  timer: number;
  active: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  timer: number;
  life: number;
  active: boolean;
}

const POOL_SIZE = 8; // simultaneous spawn effects

export class EnemySpawnVFX {
  private readonly ringPool: RingInstance[] = [];
  private readonly particlePool: Particle[] = [];

  private readonly ringMat: THREE.MeshStandardMaterial;
  private readonly particleMat: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    // ── Shared materials ──────────────────────────────────────────────────────
    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0x6a0080,
      emissive: new THREE.Color(0x8800cc),
      emissiveIntensity: 2.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xaa0066,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    // ── Pre-build pool ────────────────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.6, 1.2, 32);
    ringGeo.rotateX(-Math.PI / 2); // lay flat on the ground

    const particleGeo = new THREE.SphereGeometry(0.08, 4, 4);

    for (let i = 0; i < POOL_SIZE; i++) {
      const ringMesh = new THREE.Mesh(ringGeo, this.ringMat.clone() as THREE.MeshStandardMaterial);
      ringMesh.visible = false;
      ringMesh.receiveShadow = false;
      ringMesh.castShadow    = false;
      this.scene.add(ringMesh);
      this.ringPool.push({ mesh: ringMesh, timer: 0, active: false });
    }

    for (let i = 0; i < POOL_SIZE * PARTICLE_COUNT; i++) {
      const pm = new THREE.Mesh(particleGeo, this.particleMat.clone() as THREE.MeshBasicMaterial);
      pm.visible = false;
      this.scene.add(pm);
      this.particlePool.push({
        mesh: pm,
        velocity: new THREE.Vector3(),
        timer: 0,
        life: PARTICLE_LIFE,
        active: false,
      });
    }
  }

  /**
   * Trigger a spawn effect at the given world position.
   * Call this once per enemy as they are created.
   */
  spawnEffect(position: THREE.Vector3): void {
    this.activateRing(position);
    this.activateParticles(position);
  }

  /** Call every visual frame. */
  update(delta: number): void {
    // ── Rings ─────────────────────────────────────────────────────────────────
    for (const ring of this.ringPool) {
      if (!ring.active) continue;
      ring.timer += delta;
      const t = ring.timer;
      const mat = ring.mesh.material as THREE.MeshStandardMaterial;

      if (t < RING_FADE_IN) {
        mat.opacity = t / RING_FADE_IN;
      } else if (t < RING_FADE_IN + RING_HOLD) {
        mat.opacity = 1.0;
      } else if (t < RING_TOTAL) {
        mat.opacity = 1 - (t - RING_FADE_IN - RING_HOLD) / RING_FADE_OUT;
      } else {
        mat.opacity = 0;
        ring.mesh.visible = false;
        ring.active = false;
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────────
    for (const p of this.particlePool) {
      if (!p.active) continue;
      p.timer += delta;
      const ratio = p.timer / p.life;
      if (ratio >= 1) {
        p.mesh.visible = false;
        p.active = false;
        continue;
      }
      p.mesh.position.addScaledVector(p.velocity, delta);
      p.velocity.y -= 6 * delta; // gravity
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - ratio;
      const s = 1 - ratio * 0.5;
      p.mesh.scale.setScalar(s);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private activateRing(pos: THREE.Vector3): void {
    const ring = this.ringPool.find(r => !r.active);
    if (!ring) return;
    ring.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    ring.mesh.visible = true;
    ring.timer = 0;
    ring.active = true;
    (ring.mesh.material as THREE.MeshStandardMaterial).opacity = 0;
  }

  private activateParticles(pos: THREE.Vector3): void {
    let spawned = 0;
    for (const p of this.particlePool) {
      if (p.active) continue;
      if (spawned >= PARTICLE_COUNT) break;

      // Random outward direction, mostly horizontal
      const angle = Math.random() * Math.PI * 2;
      const speed = PARTICLE_SPEED * (0.5 + Math.random() * 0.5);
      const upward = 2 + Math.random() * 4;

      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + 0.1,
        pos.z + (Math.random() - 0.5) * 0.3,
      );
      p.velocity.set(
        Math.cos(angle) * speed,
        upward,
        Math.sin(angle) * speed,
      );
      p.timer  = 0;
      p.life   = PARTICLE_LIFE * (0.7 + Math.random() * 0.6);
      p.active = true;
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      p.mesh.scale.setScalar(1);

      spawned++;
    }
  }
}
