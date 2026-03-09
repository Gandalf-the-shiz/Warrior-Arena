import * as THREE from 'three';
import type { PhysicsWorld } from '@/engine/PhysicsWorld';
import type { Enemy } from '@/game/Enemy';
import type { PlayerController } from '@/game/PlayerController';
import type { AudioManager } from '@/engine/AudioManager';

/**
 * Arena environmental hazards: spike traps and fire pillars.
 * Active from wave 3+.
 *
 * Spike traps: 4 circular areas at (±12, ±12) that periodically activate.
 * Fire pillars: 2 pillars at (±18, 0) that shoot horizontal flame jets.
 */
export class ArenaHazards {
  private activeWave = 0;
  private audio: AudioManager | null = null;

  // ── Spike traps ─────────────────────────────────────────────────────────
  private readonly spikeTraps: SpikeTrap[] = [];

  // ── Fire pillars ────────────────────────────────────────────────────────
  private readonly firePillars: FirePillar[] = [];

  constructor(
    scene: THREE.Scene,
    _physics: PhysicsWorld,
  ) {
    // Spike trap positions (4 at ±12, ±12)
    const spikePositions: [number, number][] = [
      [ 12,  12],
      [-12,  12],
      [ 12, -12],
      [-12, -12],
    ];
    // Stagger their timers so they don't all activate at once
    spikePositions.forEach(([x, z], i) => {
      const trap = new SpikeTrap(scene, x, z, i * 2.0);
      this.spikeTraps.push(trap);
    });

    // Fire pillar positions (2 at ±18, 0)
    const pillarPositions: [number, number, number][] = [
      [ 18, 0, 0],
      [-18, 0, Math.PI],
    ];
    pillarPositions.forEach(([x, z, angle], i) => {
      const pillar = new FirePillar(scene, x, z, angle, i * 4.0);
      this.firePillars.push(pillar);
    });
  }

  /** Inject audio manager (called from main.ts after audio is created). */
  setAudio(audio: AudioManager): void {
    this.audio = audio;
  }

  /** Set the current wave number — hazards activate at wave 3+. */
  setWave(wave: number): void {
    this.activeWave = wave;
  }

  /**
   * Called every visual frame.
   * @param delta - time since last frame
   * @param player - player controller for damage/position checks
   * @param enemies - active enemy list
   */
  update(
    delta: number,
    player: PlayerController,
    enemies: readonly Enemy[],
  ): void {
    if (this.activeWave < 3) return;

    for (const trap of this.spikeTraps) {
      const wasInactive = !trap.isActive;
      trap.update(delta);

      // Play sound when first activating
      if (trap.isActive && wasInactive && this.audio) {
        this.audio.playSpikeTrap();
      }

      // Damage check while spikes are up
      if (trap.isDamaging) {
        const playerDist = trap.position.distanceTo(player.getPosition());
        if (playerDist <= 2.5) {
          player.takeDamage(15);
        }
        for (const enemy of enemies) {
          if (enemy.isDead) continue;
          const dist = trap.position.distanceTo(enemy.getPosition());
          if (dist <= 2.5) {
            const knockback = enemy.getPosition().clone().sub(trap.position).normalize();
            enemy.takeDamage(15, knockback);
          }
        }
      }
    }

    for (const pillar of this.firePillars) {
      const wasActive = pillar.isJetActive;
      pillar.update(delta);

      // Play sound when jet first fires
      if (pillar.isJetActive && !wasActive && this.audio) {
        this.audio.playFireJet();
      }

      // Damage check while jet is firing
      if (pillar.isJetActive) {
        const jetDamage = 10 * delta; // 10 per second
        if (pillar.isInJetPath(player.getPosition())) {
          player.takeDamage(Math.round(jetDamage));
        }
        for (const enemy of enemies) {
          if (enemy.isDead) continue;
          if (pillar.isInJetPath(enemy.getPosition())) {
            const knockback = enemy.getPosition().clone().sub(pillar.worldPosition).normalize();
            enemy.takeDamage(Math.round(jetDamage * 6), knockback); // enemies take per-tick damage
          }
        }
      }
    }
  }

  /** Fixed-rate update (not currently needed, but provided for consistency). */
  fixedUpdate(): void {}
}

// ── SpikeTrap ───────────────────────────────────────────────────────────────

class SpikeTrap {
  readonly position: THREE.Vector3;

  // State: timer cycles through warn → active → cooldown
  private timer: number;
  private state: 'cooldown' | 'warn' | 'active' = 'cooldown';

  // 3s active, 5s cooldown, 1s warning
  private readonly WARN_TIME    = 1.0;
  private readonly ACTIVE_TIME  = 3.0;
  private readonly COOLDOWN_TIME = 5.0;

  get isActive(): boolean { return this.state === 'active'; }
  get isDamaging(): boolean { return this.state === 'active'; }

  // Visual meshes
  private readonly grate: THREE.Mesh;
  private readonly spikes: THREE.Mesh[] = [];
  private readonly grateMat: THREE.MeshStandardMaterial;

  constructor(
    scene: THREE.Scene,
    x: number,
    z: number,
    phaseOffset: number,
  ) {
    this.position = new THREE.Vector3(x, 0.01, z);
    this.timer = phaseOffset;

    // Determine initial state based on phase offset
    let remaining = phaseOffset % (this.COOLDOWN_TIME + this.WARN_TIME + this.ACTIVE_TIME);
    if (remaining < this.COOLDOWN_TIME) {
      this.state = 'cooldown';
      this.timer = this.COOLDOWN_TIME - remaining;
    } else if (remaining < this.COOLDOWN_TIME + this.WARN_TIME) {
      this.state = 'warn';
      this.timer = this.WARN_TIME - (remaining - this.COOLDOWN_TIME);
    } else {
      this.state = 'active';
      this.timer = this.ACTIVE_TIME - (remaining - this.COOLDOWN_TIME - this.WARN_TIME);
    }

    // Grate ring
    this.grateMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.6,
      metalness: 0.7,
      emissive: new THREE.Color(0x100808),
      emissiveIntensity: 0.2,
    });

    const grateGeo = new THREE.TorusGeometry(2.2, 0.12, 8, 24);
    this.grate = new THREE.Mesh(grateGeo, this.grateMat);
    this.grate.rotation.x = Math.PI / 2;
    this.grate.position.copy(this.position);
    this.grate.receiveShadow = true;
    scene.add(this.grate);

    // Inner cross-bars
    for (let c = 0; c < 4; c++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 0.08, 0.1),
        this.grateMat.clone(),
      );
      bar.position.copy(this.position);
      bar.rotation.y = c * Math.PI / 4;
      scene.add(bar);
    }

    // Spike meshes (starts hidden below ground)
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.4,
      metalness: 0.8,
      emissive: new THREE.Color(0x0a0808),
      emissiveIntensity: 0.3,
    });

    for (let s = 0; s < 8; s++) {
      const angle = (s / 8) * Math.PI * 2;
      const radius = 0.5 + Math.random() * 1.4;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.8, 6),
        spikeMat.clone(),
      );
      spike.position.set(
        x + Math.cos(angle) * radius,
        -0.5, // hidden below ground
        z + Math.sin(angle) * radius,
      );
      spike.castShadow = true;
      scene.add(spike);
      this.spikes.push(spike);
    }
  }

  update(delta: number): void {
    this.timer -= delta;

    switch (this.state) {
      case 'cooldown':
        if (this.timer <= 0) {
          this.state = 'warn';
          this.timer = this.WARN_TIME;
          this.setGrateWarning(0);
        }
        this.setSpikeHeight(-0.5);
        this.setGrateWarning(0);
        break;

      case 'warn': {
        const t = 1 - this.timer / this.WARN_TIME;
        this.setGrateWarning(t);
        this.setSpikeHeight(-0.5);
        if (this.timer <= 0) {
          this.state = 'active';
          this.timer = this.ACTIVE_TIME;
        }
        break;
      }

      case 'active':
        this.setGrateWarning(0);
        this.setSpikeHeight(0.7); // spikes up
        if (this.timer <= 0) {
          this.state = 'cooldown';
          this.timer = this.COOLDOWN_TIME;
        }
        break;
    }
  }

  private setGrateWarning(t: number): void {
    // Ramp emissive from dim to bright red as warning
    this.grateMat.emissive.setRGB(0.4 * t, 0.02 * t, 0);
    this.grateMat.emissiveIntensity = 0.2 + t * 3.0;
  }

  private setSpikeHeight(y: number): void {
    for (const spike of this.spikes) {
      spike.position.y = THREE.MathUtils.lerp(spike.position.y, y, 0.2);
    }
  }
}

// ── FirePillar ──────────────────────────────────────────────────────────────

class FirePillar {
  readonly worldPosition: THREE.Vector3;

  // Jet fires every 8s, lasts 2s, with 1.5s warning
  private timer: number;
  private state: 'idle' | 'warn' | 'firing' = 'idle';
  private readonly IDLE_TIME    = 8.0;
  private readonly WARN_TIME    = 1.5;
  private readonly FIRE_TIME    = 2.0;

  get isJetActive(): boolean { return this.state === 'firing'; }

  // Jet direction
  private readonly jetDir: THREE.Vector3;
  private readonly jetLength = 15;

  private readonly pillarMat: THREE.MeshStandardMaterial;
  private readonly flameMat: THREE.MeshStandardMaterial;
  private fireParticleTimer = 0;

  // Ember particles on pillar top
  private readonly emberMeshes: THREE.Mesh[] = [];
  private readonly emberVelocities: THREE.Vector3[] = [];
  private readonly emberAges: number[] = [];

  constructor(
    scene: THREE.Scene,
    x: number,
    z: number,
    _yRot: number,
    phaseOffset: number,
  ) {
    this.worldPosition = new THREE.Vector3(x, 0, z);
    this.timer = phaseOffset;

    // Jet fires perpendicular to pillar line (across the arena)
    this.jetDir = new THREE.Vector3(-Math.sign(x), 0, 0);

    // Stone pillar
    this.pillarMat = new THREE.MeshStandardMaterial({
      color: 0x4a4040,
      roughness: 0.85,
      metalness: 0.1,
      emissive: new THREE.Color(0x200a00),
      emissiveIntensity: 0.5,
    });

    const pillarBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 4.0, 12),
      this.pillarMat,
    );
    pillarBase.position.set(x, 2.0, z);
    pillarBase.castShadow = true;
    pillarBase.receiveShadow = true;
    scene.add(pillarBase);

    const pillarCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.5, 0.25, 12),
      this.pillarMat.clone(),
    );
    pillarCap.position.set(x, 4.12, z);
    scene.add(pillarCap);

    // Flame material for jet visualization
    this.flameMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 4.0,
      transparent: true,
      opacity: 0.0,
      roughness: 0.4,
    });

    // Ember pool
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      emissive: new THREE.Color(0xff4400),
      emissiveIntensity: 5.0,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 20; i++) {
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 4, 3),
        emberMat.clone(),
      );
      ember.position.set(x, 4.5, z);
      ember.visible = false;
      scene.add(ember);
      this.emberMeshes.push(ember);
      this.emberVelocities.push(new THREE.Vector3());
      this.emberAges.push(0);
    }
  }

  update(delta: number): void {
    this.timer -= delta;

    switch (this.state) {
      case 'idle':
        if (this.timer <= 0) {
          this.state = 'warn';
          this.timer = this.WARN_TIME;
          this.pillarMat.emissiveIntensity = 0.5;
        }
        break;

      case 'warn': {
        const t = 1 - this.timer / this.WARN_TIME;
        this.pillarMat.emissiveIntensity = 0.5 + t * 4.0;
        if (this.timer <= 0) {
          this.state = 'firing';
          this.timer = this.FIRE_TIME;
        }
        break;
      }

      case 'firing':
        this.pillarMat.emissiveIntensity = 3.0 + Math.sin(performance.now() * 0.01) * 1.0;
        this.flameMat.opacity = 0.7;
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = this.IDLE_TIME;
          this.flameMat.opacity = 0.0;
          this.pillarMat.emissiveIntensity = 0.5;
        }
        break;
    }

    // Update embers
    this.fireParticleTimer += delta;
    if (this.fireParticleTimer > 0.05) {
      this.fireParticleTimer = 0;
      this.spawnEmber();
    }
    this.updateEmbers(delta);
  }

  /**
   * Check if a world position is within the fire jet's damage box.
   * Jet is a horizontal beam from pillar across the arena.
   */
  isInJetPath(pos: THREE.Vector3): boolean {
    if (!this.isJetActive) return false;

    // Project point onto jet axis and check lateral distance
    const toPos = pos.clone().sub(this.worldPosition);
    const along = toPos.dot(this.jetDir);
    if (along < 0 || along > this.jetLength) return false;

    const lateralDist = toPos.clone().sub(this.jetDir.clone().multiplyScalar(along)).length();
    return lateralDist < 1.5 && Math.abs(pos.y - this.worldPosition.y - 3.5) < 2.0;
  }

  private spawnEmber(): void {
    for (let i = 0; i < this.emberMeshes.length; i++) {
      if (!this.emberMeshes[i]!.visible) {
        this.emberMeshes[i]!.visible = true;
        this.emberMeshes[i]!.position.set(
          this.worldPosition.x + (Math.random() - 0.5) * 0.4,
          4.5,
          this.worldPosition.z + (Math.random() - 0.5) * 0.4,
        );
        this.emberVelocities[i]!.set(
          (Math.random() - 0.5) * 1.5,
          2.0 + Math.random() * 2,
          (Math.random() - 0.5) * 1.5,
        );
        this.emberAges[i] = 0;
        break;
      }
    }
  }

  private updateEmbers(delta: number): void {
    for (let i = 0; i < this.emberMeshes.length; i++) {
      if (!this.emberMeshes[i]!.visible) continue;
      this.emberAges[i]! += delta;
      const age = this.emberAges[i]!;
      const maxAge = 1.0;

      this.emberVelocities[i]!.y -= 3.0 * delta;
      this.emberMeshes[i]!.position.addScaledVector(this.emberVelocities[i]!, delta);
      (this.emberMeshes[i]!.material as THREE.MeshStandardMaterial).opacity =
        Math.max(0, 1 - age / maxAge);

      if (age >= maxAge) {
        this.emberMeshes[i]!.visible = false;
      }
    }
  }
}
