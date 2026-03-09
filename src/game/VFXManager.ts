import * as THREE from 'three';
import { CameraController } from '@/game/CameraController';

// ── Constants ────────────────────────────────────────────────────────────────
const BLOOD_PARTICLE_COUNT = 60;
const BLOOD_BURST_POOL = 8;
const BLOOD_LIFETIME = 0.8; // seconds
const GRAVITY = 14; // m/s²

const MAX_DECALS = 50;
const DECAL_LIFETIME = 30; // seconds

// Sword trail
const TRAIL_HISTORY = 12; // number of tip-position samples kept

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

interface SwordTrail {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  tipHistory: THREE.Vector3[];
  mat: THREE.MeshBasicMaterial;
}

/**
 * Manages all visual effects: blood splatter particles, persistent blood
 * decals on the ground, sword trail VFX, and camera shake requests.
 */
export class VFXManager {
  private readonly bloodBursts: BloodBurst[] = [];
  private readonly bloodDecals: BloodDecal[] = [];

  // Screen-edge blood flash overlay
  private readonly bloodFlashEl: HTMLElement;
  private bloodFlashOpacity = 0;

  // Sword trail
  private readonly swordTrail: SwordTrail;

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

    // Screen-edge blood flash overlay (DOM element)
    this.bloodFlashEl = document.createElement('div');
    Object.assign(this.bloodFlashEl.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '50',
      background: 'radial-gradient(ellipse at center, transparent 55%, rgba(160,0,0,0.85) 100%)',
      opacity: '0',
      transition: 'opacity 0.05s',
    });
    document.body.appendChild(this.bloodFlashEl);

    // Sword trail mesh
    this.swordTrail = this.createSwordTrail();
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
   * Trigger a brief screen-edge blood flash (for heavy hits on the player).
   */
  spawnBloodFlash(): void {
    this.bloodFlashOpacity = 1.0;
  }

  /**
   * Trigger a camera shake.
   * @param intensity  Maximum world-unit offset (e.g. 0.08 for light, 0.18 for heavy).
   * @param duration   Decay duration in seconds.
   */
  shakeCamera(intensity: number, duration: number): void {
    this.camera.shake(intensity, duration);
  }

  /**
   * Feed the sword trail the current world-space tip position.
   * Call every frame during attack states; the trail auto-fades when inactive.
   * @param tipPos   World-space position of the blade tip.
   * @param active   True while the player is attacking.
   */
  updateSwordTrail(tipPos: THREE.Vector3, active: boolean): void {
    if (active) {
      this.swordTrail.tipHistory.push(tipPos.clone());
      if (this.swordTrail.tipHistory.length > TRAIL_HISTORY) {
        this.swordTrail.tipHistory.shift();
      }
    } else {
      // Fade the history out when not attacking
      if (this.swordTrail.tipHistory.length > 0) {
        this.swordTrail.tipHistory.shift();
      }
    }

    this.rebuildTrailMesh();
  }

  /** Called every visual frame. */
  update(delta: number): void {
    this.updateBursts(delta);
    this.updateDecals(delta);
    this.updateBloodFlash(delta);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private updateBloodFlash(delta: number): void {
    if (this.bloodFlashOpacity <= 0) return;
    this.bloodFlashOpacity = Math.max(0, this.bloodFlashOpacity - delta * 3);
    this.bloodFlashEl.style.opacity = this.bloodFlashOpacity.toFixed(3);
  }

  private rebuildTrailMesh(): void {
    const history = this.swordTrail.tipHistory;
    const geo = this.swordTrail.geo;

    if (history.length < 2) {
      this.swordTrail.mesh.visible = false;
      return;
    }

    this.swordTrail.mesh.visible = true;

    // Build a ribbon: for each consecutive pair of points, emit a quad
    const quadCount = history.length - 1;
    const positions = new Float32Array(quadCount * 6 * 3);  // 2 triangles per quad, 3 verts each
    const halfW = 0.04;

    for (let i = 0; i < quadCount; i++) {
      const a = history[i]!;
      const b = history[i + 1]!;

      // Offset each point up/down by halfW to form width
      const pa1 = new THREE.Vector3(a.x, a.y + halfW, a.z);
      const pa2 = new THREE.Vector3(a.x, a.y - halfW, a.z);
      const pb1 = new THREE.Vector3(b.x, b.y + halfW, b.z);
      const pb2 = new THREE.Vector3(b.x, b.y - halfW, b.z);

      const base = i * 6 * 3;
      // Triangle 1: pa1, pa2, pb1
      positions[base + 0]  = pa1.x; positions[base + 1]  = pa1.y; positions[base + 2]  = pa1.z;
      positions[base + 3]  = pa2.x; positions[base + 4]  = pa2.y; positions[base + 5]  = pa2.z;
      positions[base + 6]  = pb1.x; positions[base + 7]  = pb1.y; positions[base + 8]  = pb1.z;
      // Triangle 2: pa2, pb2, pb1
      positions[base + 9]  = pa2.x; positions[base + 10] = pa2.y; positions[base + 11] = pa2.z;
      positions[base + 12] = pb2.x; positions[base + 13] = pb2.y; positions[base + 14] = pb2.z;
      positions[base + 15] = pb1.x; positions[base + 16] = pb1.y; positions[base + 17] = pb1.z;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeBoundingSphere();

    // Fade opacity based on how many samples we have
    const filled = Math.min(history.length / TRAIL_HISTORY, 1);
    this.swordTrail.mat.opacity = filled * 0.65;
  }

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

    const scale = 0.28 + Math.random() * 0.52; // larger decals
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
      size: 0.15, // larger particles
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
    const geo = new THREE.CircleGeometry(0.5, 8);
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

  private createSwordTrail(): SwordTrail {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8888ff, // electric blue matching sword emissive
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);

    return {
      mesh,
      geo,
      tipHistory: [],
      mat,
    };
  }
}
