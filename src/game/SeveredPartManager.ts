import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import type RAPIER_TYPE from '@dimforge/rapier3d-compat';

// Maximum number of simultaneously active severed parts for performance
const MAX_SEVERED_PARTS = 30;

// How long severed parts persist before despawning (seconds)
const PART_LIFETIME_MIN = 8;
const PART_LIFETIME_RANGE = 2;

// How long blood trail emits (seconds)
const BLOOD_TRAIL_DURATION = 2.0;

// Fade-out duration at end of life (seconds)
const FADE_DURATION = 1.0;

// Minimum speed to trigger blood trail particle (world units/s)
const BLOOD_TRAIL_MIN_SPEED = 0.8;

// Chance per frame that a moving severed part emits a blood particle
const BLOOD_TRAIL_CHANCE = 0.25;

interface SeveredPart {
  group: THREE.Group;
  body: RAPIER_TYPE.RigidBody;
  age: number;
  maxAge: number;
  active: boolean;
  bloodTrailTimer: number;
}

/**
 * Manages the full lifecycle of severed body parts:
 * - Object pool (max 30 active at once)
 * - Physics-driven tumbling via Rapier
 * - Blood trail for first 2 seconds
 * - Fade-out and despawn after 8–10 seconds
 * - Proper Three.js/Rapier cleanup on despawn
 */
export class SeveredPartManager {
  private readonly parts: SeveredPart[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {}

  /**
   * Add a severed part to the pool.
   * @param group       The Three.js group from the enemy (already detached from parent).
   * @param worldPos    World-space position of the sever point.
   * @param worldQuat   World-space rotation of the group.
   * @param impulse     Physics impulse to apply (attack direction + random + upward).
   */
  addPart(
    group: THREE.Group,
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion,
    impulse: THREE.Vector3,
  ): void {
    // Enforce max pool size — recycle the oldest active part
    if (this.parts.length >= MAX_SEVERED_PARTS) {
      let oldest: SeveredPart | undefined;
      for (const p of this.parts) {
        if (p.active && (!oldest || p.age > oldest.age)) {
          oldest = p;
        }
      }
      if (oldest) this.recyclePart(oldest);
    }

    // Create a dynamic Rapier body at the sever point
    const body = this.physics.createDynamicBody(worldPos.x, worldPos.y, worldPos.z);
    body.setLinearDamping(0.4);
    body.setAngularDamping(0.6);

    // Simple box collider — keeps physics budget low
    this.physics.createCuboidCollider(body, 0.18, 0.18, 0.22);

    // Apply launch impulse and tumble torque
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    body.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * 6,
        y: (Math.random() - 0.5) * 6,
        z: (Math.random() - 0.5) * 6,
      },
      true,
    );

    // Set world-space transform on the group
    group.position.copy(worldPos);
    group.quaternion.copy(worldQuat);
    this.scene.add(group);

    const maxAge = PART_LIFETIME_MIN + Math.random() * PART_LIFETIME_RANGE;

    this.parts.push({
      group,
      body,
      age: 0,
      maxAge,
      active: true,
      bloodTrailTimer: BLOOD_TRAIL_DURATION,
    });
  }

  /**
   * Update all active severed parts.
   * Syncs physics → visual, handles blood trails, and despawns expired parts.
   *
   * @param delta      Frame delta time in seconds.
   * @param onBlood    Optional callback to spawn a blood particle at a position.
   */
  update(
    delta: number,
    onBlood?: (pos: THREE.Vector3, dir: THREE.Vector3) => void,
  ): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      if (!part.active) continue;

      part.age += delta;

      // Sync physics position/rotation → Three.js group
      const pos = part.body.translation();
      const rot = part.body.rotation();
      part.group.position.set(pos.x, Math.max(pos.y, 0.05), pos.z);
      part.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      // Blood trail — emit while airborne and recently severed
      if (part.bloodTrailTimer > 0 && onBlood) {
        part.bloodTrailTimer -= delta;
        if (Math.random() < BLOOD_TRAIL_CHANCE) {
          const vel = part.body.linvel();
          const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
          if (speed > BLOOD_TRAIL_MIN_SPEED) {
            const dir = new THREE.Vector3(vel.x, vel.y, vel.z).normalize();
            onBlood(part.group.position.clone(), dir);
          }
        }
      }

      // Fade-out over the final FADE_DURATION seconds
      const fadeStart = part.maxAge - FADE_DURATION;
      if (part.age > fadeStart) {
        const opacity = Math.max(0, 1.0 - (part.age - fadeStart) / FADE_DURATION);
        part.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.transparent = true;
            mat.opacity = opacity;
          }
        });
      }

      // Despawn when expired
      if (part.age >= part.maxAge) {
        this.recyclePart(part);
        this.parts.splice(i, 1);
      }
    }
  }

  /** Return the number of currently active severed parts. */
  get activeCount(): number {
    return this.parts.filter((p) => p.active).length;
  }

  /** Clean up all active parts (call on game reset). */
  disposeAll(): void {
    for (const part of this.parts) {
      if (part.active) this.recyclePart(part);
    }
    this.parts.length = 0;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private recyclePart(part: SeveredPart): void {
    if (!part.active) return;

    // Remove from scene
    this.scene.remove(part.group);

    // Dispose Three.js geometry/material to prevent memory leaks
    part.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const m of child.material) m.dispose();
        } else {
          (child.material as THREE.Material).dispose();
        }
      }
    });

    // Remove Rapier body from the physics world
    // Guard against the body already being removed (e.g. by a previous cleanup pass)
    if (this.physics.world.getRigidBody(part.body.handle)) {
      this.physics.world.removeRigidBody(part.body);
    }

    part.active = false;
  }
}
