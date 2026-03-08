import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';
import { WarriorModel } from '@/game/WarriorModel';
import { AnimationStateMachine, AnimState } from '@/game/AnimationStateMachine';

const MOVE_SPEED = 7;
const JUMP_IMPULSE = 8;
const ROTATION_LERP = 0.12;

// Footstep dust particle constants
const DUST_PARTICLE_COUNT = 18;
const DUST_SPAWN_INTERVAL = 0.28; // seconds between bursts while running

/**
 * One pooled footstep-dust burst.
 */
interface DustBurst {
  points: THREE.Points;
  velocities: Float32Array; // 3 floats per particle (vx, vy, vz)
  ages: Float32Array;       // age in seconds per particle
  life: number;             // total lifetime for this burst (seconds)
  active: boolean;
}

/**
 * The player-controlled warrior.
 * Physics body: Rapier capsule (radius 0.4, half-height 0.6).
 * Visual:       Procedural WarriorModel with AnimationStateMachine.
 */
export class PlayerController {
  /** Expose warrior group as `mesh` for backwards compatibility. */
  readonly mesh: THREE.Group;

  readonly body: RAPIER.RigidBody;
  private readonly warrior: WarriorModel;
  private readonly anim: AnimationStateMachine;

  private isGrounded = false;
  private readonly targetRotation = new THREE.Quaternion();

  // Footstep dust
  private readonly dustBursts: DustBurst[] = [];
  private dustTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly input: InputManager,
    startX = 0,
    startY = 2,
    startZ = 0,
  ) {
    // ── Physics body ─────────────────────────────────────────────────────
    this.body = this.physics.createDynamicBody(startX, startY, startZ, true);
    this.body.setLinearDamping(4);
    this.physics.createCapsuleCollider(this.body, 0.4, 0.6, 0.6, 0.0);

    // ── Warrior model ─────────────────────────────────────────────────────
    this.warrior = new WarriorModel();
    this.warrior.group.position.set(startX, startY, startZ);
    this.warrior.group.castShadow = true;
    this.scene.add(this.warrior.group);

    // Expose as `mesh` for callers that reference it
    this.mesh = this.warrior.group;

    // ── Animation state machine ───────────────────────────────────────────
    this.anim = new AnimationStateMachine(this.warrior);

    // ── Pre-allocate dust burst pool ──────────────────────────────────────
    for (let i = 0; i < 4; i++) {
      this.dustBursts.push(this.createDustBurst());
    }
  }

  /**
   * Called every fixed physics step.
   * Applies camera-relative velocity so that movement is deterministic at 60 Hz.
   */
  fixedUpdate(cameraYaw: number): void {
    this.checkGrounded();

    const move = this.input.getMovementVector();
    const hasMove = move.x !== 0 || move.z !== 0;

    if (hasMove) {
      const cos = Math.cos(cameraYaw);
      const sin = Math.sin(cameraYaw);
      const worldX = move.x * cos - move.z * sin;
      const worldZ = move.x * sin + move.z * cos;

      const vel = this.body.linvel();
      this.body.setLinvel(
        { x: worldX * MOVE_SPEED, y: vel.y, z: worldZ * MOVE_SPEED },
        true,
      );

      const angle = Math.atan2(worldX, worldZ);
      this.targetRotation.setFromEuler(new THREE.Euler(0, angle, 0));
    } else {
      const vel = this.body.linvel();
      this.body.setLinvel({ x: vel.x * 0.7, y: vel.y, z: vel.z * 0.7 }, true);
    }

    // Jump
    if (this.input.isJumping() && this.isGrounded) {
      this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
      this.isGrounded = false;
    }
  }

  /**
   * Called every visual frame (variable timestep).
   * Syncs mesh to physics, drives animations and particles.
   */
  update(delta: number): void {
    const pos = this.body.translation();
    this.warrior.group.position.set(pos.x, pos.y, pos.z);
    this.warrior.group.quaternion.slerp(this.targetRotation, ROTATION_LERP);

    // ── Determine animation state ─────────────────────────────────────────
    const move = this.input.getMovementVector();
    const speed = Math.sqrt(move.x * move.x + move.z * move.z);
    const isMoving = speed > 0.05;

    const current = this.anim.currentState;
    const isAttacking = [
      AnimState.ATTACK_LIGHT_1,
      AnimState.ATTACK_LIGHT_2,
      AnimState.ATTACK_LIGHT_3,
      AnimState.ATTACK_HEAVY,
    ].includes(current);

    if (!isAttacking && current !== AnimState.DEATH && current !== AnimState.HIT) {
      if (this.input.isDodging()) {
        this.anim.setState(AnimState.DODGE);
      } else if (this.input.isAttacking()) {
        this.anim.setState(AnimState.ATTACK_LIGHT_1);
      } else if (isMoving) {
        this.anim.setState(AnimState.RUN);
      } else {
        this.anim.setState(AnimState.IDLE);
      }
    } else if (!isAttacking && current !== AnimState.DEATH) {
      // Allow interrupting HIT with movement
      if (isMoving) {
        this.anim.setState(AnimState.RUN);
      }
    }

    // ── Update animation ──────────────────────────────────────────────────
    const elapsed = performance.now() / 1000;
    this.anim.update(delta, elapsed, speed);
    this.warrior.updateCape(elapsed);

    // ── Footstep dust ─────────────────────────────────────────────────────
    if (isMoving && this.isGrounded) {
      this.dustTimer -= delta;
      if (this.dustTimer <= 0) {
        this.dustTimer = DUST_SPAWN_INTERVAL;
        this.spawnDust(pos.x, pos.y - 0.9, pos.z); // near feet
      }
    } else {
      this.dustTimer = 0;
    }
    this.updateDust(delta);
  }

  getPosition(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private checkGrounded(): void {
    const pos = this.body.translation();
    const toi = this.physics.castRay(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: 0, y: -1, z: 0 },
      1.2,
    );
    this.isGrounded = toi !== null;
  }

  // ── Dust particle system ───────────────────────────────────────────────

  private createDustBurst(): DustBurst {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(DUST_PARTICLE_COUNT * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x8a7660,
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
      velocities: new Float32Array(DUST_PARTICLE_COUNT * 3),
      ages: new Float32Array(DUST_PARTICLE_COUNT),
      life: 0.5,
      active: false,
    };
  }

  private spawnDust(x: number, y: number, z: number): void {
    // Find an inactive burst
    const burst = this.dustBursts.find((b) => !b.active);
    if (!burst) return;

    burst.active = true;
    const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
      posAttr.setXYZ(
        i,
        x + (Math.random() - 0.5) * 0.3,
        y + Math.random() * 0.08,
        z + (Math.random() - 0.5) * 0.3,
      );

      burst.velocities[i * 3]     = (Math.random() - 0.5) * 0.8;
      burst.velocities[i * 3 + 1] = Math.random() * 0.6 + 0.2;
      burst.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      burst.ages[i] = 0;
    }

    posAttr.needsUpdate = true;
    (burst.points.material as THREE.PointsMaterial).opacity = 0.55;
  }

  private updateDust(delta: number): void {
    for (const burst of this.dustBursts) {
      if (!burst.active) continue;

      const posAttr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
      let anyAlive = false;

      for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
        burst.ages[i] += delta;
        if (burst.ages[i] >= burst.life) continue;
        anyAlive = true;

        const px = posAttr.getX(i) + burst.velocities[i * 3]!     * delta;
        const py = posAttr.getY(i) + burst.velocities[i * 3 + 1]! * delta;
        const pz = posAttr.getZ(i) + burst.velocities[i * 3 + 2]! * delta;
        posAttr.setXYZ(i, px, py, pz);

        // Drag
        burst.velocities[i * 3]!     *= 0.92;
        burst.velocities[i * 3 + 1]! *= 0.96;
        burst.velocities[i * 3 + 2]! *= 0.92;
      }

      posAttr.needsUpdate = true;

      const mat = burst.points.material as THREE.PointsMaterial;
      if (!anyAlive) {
        burst.active = false;
        mat.opacity = 0;
      } else {
        const maxAge = Math.max(...Array.from(burst.ages));
        mat.opacity = Math.max(0, 0.55 * (1 - maxAge / burst.life));
      }
    }
  }
}
