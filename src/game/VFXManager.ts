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

// Hit sparks
const SPARK_COUNT = 10;
const SPARK_POOL = 6;
const SPARK_LIFETIME = 0.3;

// Gore chunks (small physics-lite gore pieces on heavy dismemberment)
const MAX_GORE_CHUNKS = 20;
const GORE_CHUNK_LIFETIME = 5; // seconds

// Screen blood splatter (DOM overlay droplets on close-range kills)
const MAX_SCREEN_BLOOD_DROPS = 12;
const SCREEN_BLOOD_LIFETIME = 1.2; // seconds

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

interface SparkBurst {
  points: THREE.Points;
  velocities: Float32Array;
  ages: Float32Array;
  active: boolean;
}

interface GroundSlam {
  mesh: THREE.Mesh;
  age: number;
  active: boolean;
}

interface HitFlash {
  mesh: THREE.Object3D;
  timer: number;
  originalMaterials: THREE.Material[];
}

interface KillStreakAura {
  points: THREE.Points;
  velocities: Float32Array;
  ages: Float32Array;
  active: boolean;
  angle: number; // orbit angle
}

interface GoreChunk {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  active: boolean;
}

/**
 * Manages all visual effects: blood splatter particles, persistent blood
 * decals on the ground, sword trail VFX, hit sparks, ground slam rings,
 * dodge afterimages, kill streak aura, gore chunks, arterial spray,
 * screen blood splatter, and camera shake requests.
 */
export class VFXManager {
  private readonly bloodBursts: BloodBurst[] = [];
  private readonly bloodDecals: BloodDecal[] = [];

  // Screen-edge blood flash overlay
  private readonly bloodFlashEl: HTMLElement;
  private bloodFlashOpacity = 0;

  // Gore chunks (small physics-lite meat pieces on heavy dismemberment)
  private readonly goreChunks: GoreChunk[] = [];

  // Screen blood splatter container (DOM overlay)
  private readonly screenBloodContainer: HTMLElement;

  // Sword trail
  private readonly swordTrail: SwordTrail;

  // Hit sparks
  private readonly sparkBursts: SparkBurst[] = [];

  // Ground slam rings
  private readonly groundSlams: GroundSlam[] = [];

  // Active hit flashes (1-frame white flash on enemies)
  private readonly hitFlashes: HitFlash[] = [];

  // Kill streak aura (orbiting particles)
  private killStreak = 0;
  private killStreakResetTimer = 0;
  private readonly auraParticles: KillStreakAura[] = [];
  private auraOrbitAngle = 0;

  // Dodge afterimages
  private readonly afterimageMeshes: Array<{ box: THREE.Mesh; age: number }> = [];

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
    for (let i = 0; i < SPARK_POOL; i++) {
      this.sparkBursts.push(this.createSparkBurst());
    }
    for (let i = 0; i < 4; i++) {
      this.groundSlams.push(this.createGroundSlam());
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

    // Screen blood splatter container (DOM overlay for close-range kills)
    this.screenBloodContainer = document.createElement('div');
    Object.assign(this.screenBloodContainer.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '48',
      overflow: 'hidden',
    });
    document.body.appendChild(this.screenBloodContainer);

    // Sword trail mesh
    this.swordTrail = this.createSwordTrail();

    // Kill streak aura pool
    for (let i = 0; i < 20; i++) {
      this.auraParticles.push(this.createAuraParticle());
    }

    // Pre-create gore chunk pool
    for (let i = 0; i < MAX_GORE_CHUNKS; i++) {
      this.goreChunks.push(this.createGoreChunk());
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
   * Trigger a brief screen-edge blood flash (for heavy hits on the player).
   */
  spawnBloodFlash(): void {
    this.bloodFlashOpacity = 1.0;
  }

  /**
   * Spawn a directional arterial blood spray from a sever point.
   * Simulates pulsing heartbeat with multiple quick bursts.
   *
   * @param position  World-space origin (stump location).
   * @param direction Normalised direction of the spray.
   * @param intensity Multiplier 0–1.5 (1 = default, 1.5 = finisher).
   */
  spawnArterialSpray(position: THREE.Vector3, direction: THREE.Vector3, intensity = 1.0): void {
    // Spawn 2–3 blood bursts in rapid succession to simulate pulsing spray
    const burstCount = Math.round(2 + intensity);
    for (let b = 0; b < burstCount; b++) {
      const burst = this.bloodBursts.find((bst) => !bst.active);
      if (!burst) continue;

      burst.active = true;
      const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
      const speed = 5.0 + intensity * 2;

      for (let i = 0; i < BLOOD_PARTICLE_COUNT; i++) {
        posAttr.setXYZ(
          i,
          position.x + (Math.random() - 0.5) * 0.15,
          position.y + (Math.random() - 0.5) * 0.15,
          position.z + (Math.random() - 0.5) * 0.15,
        );

        // Arterial spray is more directional and faster than standard blood burst
        const spread = 0.8 + b * 0.2; // later pulses spread more
        burst.velocities[i * 3]!     = direction.x * speed + (Math.random() - 0.5) * spread;
        burst.velocities[i * 3 + 1]! = Math.random() * 1.5 + 0.5 + direction.y * speed * 0.3;
        burst.velocities[i * 3 + 2]! = direction.z * speed + (Math.random() - 0.5) * spread;
        burst.ages[i]! = 0;
      }

      posAttr.needsUpdate = true;
      (burst.points.material as THREE.PointsMaterial).opacity = 0.95;

      // Leave extra decals on the ground
      const numDecals = 2 + Math.floor(intensity * 2);
      for (let i = 0; i < numDecals; i++) {
        this.spawnDecal(
          position.x + (Math.random() - 0.5) * 1.2,
          position.z + (Math.random() - 0.5) * 1.2,
        );
      }
    }
  }

  /**
   * Spawn small physics-lite gore chunk meshes that bounce off the ground.
   *
   * @param position World-space origin.
   * @param count    Number of chunks (default 3).
   */
  spawnGoreChunks(position: THREE.Vector3, count = 3): void {
    const clampedCount = Math.min(count, 5);
    let spawned = 0;
    for (const chunk of this.goreChunks) {
      if (spawned >= clampedCount) break;
      if (chunk.active) continue;

      chunk.active = true;
      chunk.age = 0;
      chunk.mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.3,
        position.y + 0.1,
        position.z + (Math.random() - 0.5) * 0.3,
      );
      chunk.mesh.visible = true;

      // Random outward velocity with upward bounce
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      chunk.velocity.set(
        Math.cos(angle) * speed,
        2 + Math.random() * 3,
        Math.sin(angle) * speed,
      );

      spawned++;
    }
  }

  /**
   * Spawn blood droplets on the screen (DOM overlay) for close-range kills.
   *
   * @param intensity 0–1 scale; 1.0 = maximum splatter, 0.35 = light hit.
   */
  spawnScreenBlood(intensity: number): void {
    const clampedIntensity = Math.min(1.0, Math.max(0, intensity));
    const count = Math.round(clampedIntensity * MAX_SCREEN_BLOOD_DROPS);

    for (let i = 0; i < count; i++) {
      const drop = document.createElement('div');
      const size = (4 + Math.random() * 18 * clampedIntensity) | 0;
      const x = (Math.random() * 90 + 5) | 0;
      const y = (Math.random() * 80 + 10) | 0;
      const opacity = 0.55 + Math.random() * 0.45;

      Object.assign(drop.style, {
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50% 40% 60% 45%',
        background: `rgba(${Math.floor(100 + Math.random() * 60)}, 0, 0, ${opacity.toFixed(2)})`,
        pointerEvents: 'none',
        transform: `rotate(${Math.floor(Math.random() * 360)}deg)`,
        transition: `opacity ${SCREEN_BLOOD_LIFETIME.toFixed(1)}s ease-out`,
      });
      this.screenBloodContainer.appendChild(drop);

      // Fade out
      requestAnimationFrame(() => {
        drop.style.opacity = '0';
        setTimeout(() => drop.remove(), SCREEN_BLOOD_LIFETIME * 1000 + 100);
      });
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

  /**
   * Spawn orange/white metallic spark particles on a hit.
   */
  spawnHitSparks(position: THREE.Vector3, direction: THREE.Vector3): void {
    const burst = this.sparkBursts.find((b) => !b.active);
    if (!burst) return;
    burst.active = true;
    const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SPARK_COUNT; i++) {
      posAttr.setXYZ(i,
        position.x + (Math.random() - 0.5) * 0.15,
        position.y + (Math.random() - 0.5) * 0.15,
        position.z + (Math.random() - 0.5) * 0.15,
      );
      const speed = 2.5 + Math.random() * 4.0;
      burst.velocities[i * 3]!     = direction.x * speed + (Math.random() - 0.5) * 3;
      burst.velocities[i * 3 + 1]! = Math.random() * 4 + 1;
      burst.velocities[i * 3 + 2]! = direction.z * speed + (Math.random() - 0.5) * 3;
      burst.ages[i]! = 0;
    }
    posAttr.needsUpdate = true;
    (burst.points.material as THREE.PointsMaterial).opacity = 1.0;
  }

  /**
   * Flash an enemy mesh white for one frame (hit feedback).
   */
  spawnHitFlash(mesh: THREE.Object3D): void {
    const original: THREE.Material[] = [];
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        original.push(child.material as THREE.Material);
      }
    });
    if (original.length === 0) return;

    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = whiteMat;
      }
    });

    this.hitFlashes.push({ mesh, timer: 0.06, originalMaterials: original });
  }

  /**
   * Spawn an expanding shockwave ring on the ground for heavy attacks.
   */
  spawnGroundSlam(position: THREE.Vector3): void {
    const slam = this.groundSlams.find((s) => !s.active);
    if (!slam) return;
    slam.active = true;
    slam.age = 0;
    slam.mesh.position.set(position.x, 0.05, position.z);
    slam.mesh.scale.set(0.1, 0.1, 0.1);
    slam.mesh.visible = true;
    (slam.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
  }

  /**
   * Spawn a brief ghostly afterimage at the player's current position.
   */
  spawnDodgeAfterimage(position: THREE.Vector3): void {
    const geo = new THREE.BoxGeometry(0.5, 1.6, 0.3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const box = new THREE.Mesh(geo, mat);
    box.position.copy(position);
    this.scene.add(box);
    this.afterimageMeshes.push({ box, age: 0 });
  }

  /**
   * Notify VFX of a kill so kill-streak effects can be managed.
   * @param playerPos Current player world position (for aura orbit).
   */
  onKill(playerPos: THREE.Vector3): void {
    this.killStreak++;
    this.killStreakResetTimer = 4.0; // reset if no kills for 4 seconds

    // Activate aura particles proportional to streak
    const auraCount = this.killStreak >= 10 ? 16 : this.killStreak >= 5 ? 8 : 0;
    for (let i = 0; i < this.auraParticles.length; i++) {
      const p = this.auraParticles[i]!;
      p.active = i < auraCount;
      if (p.active) {
        p.angle = (i / auraCount) * Math.PI * 2;
        const pp = p.points;
        pp.visible = true;
        const pos = playerPos.clone().add(new THREE.Vector3(
          Math.cos(p.angle) * 0.8, 0.5, Math.sin(p.angle) * 0.8,
        ));
        (pp.geometry.attributes.position as THREE.BufferAttribute).setXYZ(0, pos.x, pos.y, pos.z);
        (pp.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      } else {
        p.points.visible = false;
      }
    }
  }

  /** Reset kill streak (call when player takes damage or wave ends). */
  resetKillStreak(): void {
    this.killStreak = 0;
    for (const p of this.auraParticles) {
      p.active = false;
      p.points.visible = false;
    }
  }

  /** Called every visual frame. */
  update(delta: number, playerPos?: THREE.Vector3): void {
    this.updateBursts(delta);
    this.updateDecals(delta);
    this.updateBloodFlash(delta);
    this.updateSparks(delta);
    this.updateGroundSlams(delta);
    this.updateHitFlashes(delta);
    this.updateAfterimages(delta);
    this.updateGoreChunks(delta);
    if (playerPos) this.updateAura(delta, playerPos);

    // Decay kill streak timer
    if (this.killStreakResetTimer > 0) {
      this.killStreakResetTimer -= delta;
      if (this.killStreakResetTimer <= 0) this.resetKillStreak();
    }
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

  private createSparkBurst(): SparkBurst {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(SPARK_COUNT * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffaa22,
      size: 0.06,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    return {
      points,
      velocities: new Float32Array(SPARK_COUNT * 3),
      ages: new Float32Array(SPARK_COUNT).fill(SPARK_LIFETIME),
      active: false,
    };
  }

  private createGroundSlam(): GroundSlam {
    const geo = new THREE.RingGeometry(0.1, 0.4, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, age: 0, active: false };
  }

  private createAuraParticle(): KillStreakAura {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    this.scene.add(points);
    return { points, velocities: new Float32Array(3), ages: new Float32Array(1), active: false, angle: 0 };
  }

  private updateSparks(delta: number): void {
    for (const burst of this.sparkBursts) {
      if (!burst.active) continue;
      const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
      let anyAlive = false;
      for (let i = 0; i < SPARK_COUNT; i++) {
        burst.ages[i]! += delta;
        if (burst.ages[i]! >= SPARK_LIFETIME) continue;
        anyAlive = true;
        const px = posAttr.getX(i) + burst.velocities[i * 3]! * delta;
        const py = posAttr.getY(i) + burst.velocities[i * 3 + 1]! * delta;
        const pz = posAttr.getZ(i) + burst.velocities[i * 3 + 2]! * delta;
        posAttr.setXYZ(i, px, Math.max(0.05, py), pz);
        burst.velocities[i * 3 + 1]! -= GRAVITY * delta;
        burst.velocities[i * 3]! *= 0.9;
        burst.velocities[i * 3 + 2]! *= 0.9;
      }
      posAttr.needsUpdate = true;
      const mat = burst.points.material as THREE.PointsMaterial;
      if (!anyAlive) {
        burst.active = false;
        mat.opacity = 0;
      } else {
        const maxAge = Math.max(...Array.from({ length: SPARK_COUNT }, (_, i) => burst.ages[i]!));
        mat.opacity = Math.max(0, 1.0 * (1 - maxAge / SPARK_LIFETIME));
      }
    }
  }

  private updateGroundSlams(delta: number): void {
    const SLAM_DURATION = 0.5;
    for (const slam of this.groundSlams) {
      if (!slam.active) continue;
      slam.age += delta;
      if (slam.age >= SLAM_DURATION) {
        slam.active = false;
        slam.mesh.visible = false;
        continue;
      }
      const t = slam.age / SLAM_DURATION;
      const scale = 0.1 + t * 6.0;
      slam.mesh.scale.set(scale, scale, scale);
      (slam.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }
  }

  private updateHitFlashes(delta: number): void {
    for (let i = this.hitFlashes.length - 1; i >= 0; i--) {
      const hf = this.hitFlashes[i]!;
      hf.timer -= delta;
      if (hf.timer <= 0) {
        // Restore original materials
        let matIdx = 0;
        hf.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = hf.originalMaterials[matIdx++] ?? child.material;
          }
        });
        this.hitFlashes.splice(i, 1);
      }
    }
  }

  private updateAfterimages(delta: number): void {
    const AFTERIMAGE_DURATION = 0.3;
    for (let i = this.afterimageMeshes.length - 1; i >= 0; i--) {
      const ai = this.afterimageMeshes[i]!;
      ai.age += delta;
      if (ai.age >= AFTERIMAGE_DURATION) {
        this.scene.remove(ai.box);
        ai.box.geometry.dispose();
        this.afterimageMeshes.splice(i, 1);
      } else {
        const t = ai.age / AFTERIMAGE_DURATION;
        (ai.box.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
      }
    }
  }

  private updateAura(delta: number, playerPos: THREE.Vector3): void {
    this.auraOrbitAngle += delta * 2.5;
    const count = this.auraParticles.filter((p) => p.active).length;
    if (count === 0) return;
    let idx = 0;
    for (const p of this.auraParticles) {
      if (!p.active) continue;
      p.angle = this.auraOrbitAngle + (idx / count) * Math.PI * 2;
      const r = 0.8 + Math.sin(p.angle * 3) * 0.1;
      const yOff = 0.5 + Math.sin(this.auraOrbitAngle * 2 + idx) * 0.2;
      const pos = new THREE.Vector3(
        playerPos.x + Math.cos(p.angle) * r,
        playerPos.y + yOff,
        playerPos.z + Math.sin(p.angle) * r,
      );
      (p.points.geometry.attributes.position as THREE.BufferAttribute).setXYZ(0, pos.x, pos.y, pos.z);
      (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const mat = p.points.material as THREE.PointsMaterial;
      // 10+ streak gets brighter/larger
      mat.size = this.killStreak >= 10 ? 0.18 : 0.12;
      mat.color.set(this.killStreak >= 10 ? 0xffff00 : 0xff6600);
      idx++;
    }
  }

  private createGoreChunk(): GoreChunk {
    // Small irregular box with dark red gore material
    const w = 0.06 + Math.random() * 0.10;
    const h = 0.06 + Math.random() * 0.08;
    const d = 0.06 + Math.random() * 0.10;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.35 + Math.random() * 0.15, 0, 0),
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), age: 0, active: false };
  }

  private updateGoreChunks(delta: number): void {
    for (const chunk of this.goreChunks) {
      if (!chunk.active) continue;

      chunk.age += delta;

      // Simple physics: gravity + ground bounce
      chunk.velocity.y -= GRAVITY * delta;
      chunk.mesh.position.addScaledVector(chunk.velocity, delta);

      // Bounce off ground
      if (chunk.mesh.position.y < 0.04) {
        chunk.mesh.position.y = 0.04;
        chunk.velocity.y = Math.abs(chunk.velocity.y) * 0.4;
        chunk.velocity.x *= 0.75;
        chunk.velocity.z *= 0.75;
        // Stamp a tiny blood decal when it hits
        this.spawnDecal(chunk.mesh.position.x, chunk.mesh.position.z);
      }

      // Tumble rotation
      chunk.mesh.rotation.x += delta * (2 + Math.random() * 3);
      chunk.mesh.rotation.z += delta * (1.5 + Math.random() * 2);

      // Fade opacity in the last 1.5 seconds
      const fadeStart = GORE_CHUNK_LIFETIME - 1.5;
      if (chunk.age > fadeStart) {
        const opacity = 1.0 - (chunk.age - fadeStart) / 1.5;
        const mat = chunk.mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = Math.max(0, opacity);
      }

      if (chunk.age >= GORE_CHUNK_LIFETIME) {
        chunk.active = false;
        chunk.mesh.visible = false;
        const mat = chunk.mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = false;
        mat.opacity = 1.0;
      }
    }
  }
}
