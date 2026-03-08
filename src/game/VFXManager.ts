import * as THREE from 'three';
import { CameraController } from '@/game/CameraController';

// ── Constants ────────────────────────────────────────────────────────────────
const BLOOD_PARTICLE_COUNT = 30;
const BLOOD_BURST_POOL = 8;
const BLOOD_LIFETIME = 0.8; // seconds
const GRAVITY = 14; // m/s²

const MAX_DECALS = 50;
const DECAL_LIFETIME = 30; // seconds

// ── Interfaces ────────────────────────────────────────────────────────────────
interface BloodBurst {
  points: THREE.Points;
  velocities: Float32Array; // 3 floats per particle
  ages: Float32Array;
  active: boolean;
}

interface BloodDecal {
  mesh: THREE.Mesh;
  age: number;
  active: boolean;
}

/**
 * Manages all visual effects: blood splatter particles, persistent blood
 * decals on the ground, and camera shake requests.
 */
export class VFXManager {
  private readonly bloodBursts: BloodBurst[] = [];
  private readonly bloodDecals: BloodDecal[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: CameraController,
  ) {
    for (let i = 0; i < BLOOD_BURST_POOL; i++) {
      this.bloodBursts.push(this.createBloodBurst());
    }
    for (let i = 0; i < MAX_DECALS; i++) {
      this.bloodDecals.push(this.createBloodDecal());
    }
  }

  /**
   * Spawn a burst of blood particles at `position`, flying in `direction`.
   * Also stamps 1–2 blood decals near the hit position on the ground.
   */
  spawnBlood(position: THREE.Vector3, direction: THREE.Vector3): void {
    const burst = this.bloodBursts.find((b) => !b.active);
    if (!burst) return;

    burst.active = true;
    const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < BLOOD_PARTICLE_COUNT; i++) {
      posAttr.setXYZ(
        i,
        position.x + (Math.random() - 0.5) * 0.25,
        position.y + (Math.random() - 0.5) * 0.25,
        position.z + (Math.random() - 0.5) * 0.25,
      );

      const spread = 2.2;
      burst.velocities[i * 3]!     = direction.x * 3.5 + (Math.random() - 0.5) * spread;
      burst.velocities[i * 3 + 1]! = Math.random() * 2.5 + 0.8;
      burst.velocities[i * 3 + 2]! = direction.z * 3.5 + (Math.random() - 0.5) * spread;
      burst.ages[i]! = 0;
    }

    posAttr.needsUpdate = true;
    (burst.points.material as THREE.PointsMaterial).opacity = 0.92;

    // Stamp ground decals immediately
    const numDecals = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numDecals; i++) {
      this.spawnDecal(
        position.x + (Math.random() - 0.5) * 0.6,
        position.z + (Math.random() - 0.5) * 0.6,
      );
    }
  }

  /**
   * Trigger a camera shake.
   * @param intensity  Maximum world-unit offset (e.g. 0.08 for light, 0.18 for heavy).
   * @param duration   Decay duration in seconds.
   */
  shakeCamera(intensity: number, duration: number): void {
    this.camera.shake(intensity, duration);
  }

  /** Called every visual frame. */
  update(delta: number): void {
    this.updateBursts(delta);
    this.updateDecals(delta);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private updateBursts(delta: number): void {
    for (const burst of this.bloodBursts) {
      if (!burst.active) continue;

      const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
      let anyAlive = false;
      let maxAge = 0;

      for (let i = 0; i < BLOOD_PARTICLE_COUNT; i++) {
        burst.ages[i]! += delta;
        if (burst.ages[i]! >= BLOOD_LIFETIME) continue;
        anyAlive = true;
        if (burst.ages[i]! > maxAge) maxAge = burst.ages[i]!;

        const vx = burst.velocities[i * 3]!;
        const vy = burst.velocities[i * 3 + 1]!;
        const vz = burst.velocities[i * 3 + 2]!;

        let px = posAttr.getX(i) + vx * delta;
        let py = posAttr.getY(i) + vy * delta;
        const pz = posAttr.getZ(i) + vz * delta;

        // Bounce off ground
        if (py < 0.01) {
          py = 0.01;
          burst.velocities[i * 3 + 1]! = 0;
        }

        posAttr.setXYZ(i, px, py, pz);

        // Gravity + drag
        burst.velocities[i * 3 + 1]! -= GRAVITY * delta;
        burst.velocities[i * 3]!     *= 0.95;
        burst.velocities[i * 3 + 2]! *= 0.95;
      }

      posAttr.needsUpdate = true;

      const mat = burst.points.material as THREE.PointsMaterial;
      if (!anyAlive) {
        burst.active = false;
        mat.opacity = 0;
      } else {
        mat.opacity = Math.max(0, 0.92 * (1 - maxAge / BLOOD_LIFETIME));
      }
    }
  }

  private updateDecals(delta: number): void {
    for (const decal of this.bloodDecals) {
      if (!decal.active) continue;
      decal.age += delta;
      if (decal.age >= DECAL_LIFETIME) {
        decal.active = false;
        decal.mesh.visible = false;
      } else {
        const mat = decal.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.75 * (1 - decal.age / DECAL_LIFETIME);
      }
    }
  }

  private spawnDecal(x: number, z: number): void {
    const decal = this.bloodDecals.find((d) => !d.active);
    if (!decal) return;

    decal.active = true;
    decal.age = 0;
    decal.mesh.visible = true;
    decal.mesh.position.set(x, 0.01, z);
    decal.mesh.rotation.y = Math.random() * Math.PI * 2;

    const scale = 0.18 + Math.random() * 0.38;
    decal.mesh.scale.setScalar(scale);

    const mat = decal.mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = 0.75;
  }

  private createBloodBurst(): BloodBurst {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(BLOOD_PARTICLE_COUNT * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaa0000,
      size: 0.07,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    return {
      points,
      velocities: new Float32Array(BLOOD_PARTICLE_COUNT * 3),
      ages: new Float32Array(BLOOD_PARTICLE_COUNT).fill(BLOOD_LIFETIME), // start inactive
      active: false,
    };
  }

  private createBloodDecal(): BloodDecal {
    const geo = new THREE.CircleGeometry(0.5, 7);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x550000,
      roughness: 1.0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    this.scene.add(mesh);

    return { mesh, age: 0, active: false };
  }
}
