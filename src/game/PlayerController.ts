import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';

const MOVE_SPEED = 7;
const JUMP_IMPULSE = 8;
const ROTATION_LERP = 0.12;

/**
 * The player-controlled warrior.
 * Physics body: Rapier capsule (radius 0.4, half-height 0.6).
 * Visual: dark metallic capsule mesh — will be replaced by a model in PR #2.
 */
export class PlayerController {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;

  private isGrounded = false;
  private readonly targetRotation = new THREE.Quaternion();

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
    // High linear damping prevents ice-skating; no angular damping needed
    // (rotations are locked anyway)
    this.body.setLinearDamping(4);
    this.physics.createCapsuleCollider(this.body, 0.4, 0.6, 0.6, 0.0);

    // ── Visual mesh ───────────────────────────────────────────────────────
    // Capsule = cylinder + two hemisphere caps
    const capsuleGeo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    const capsuleMat = new THREE.MeshStandardMaterial({
      color: 0x222233,
      metalness: 0.8,
      roughness: 0.3,
    });
    this.mesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    this.mesh.castShadow = true;
    this.mesh.position.set(startX, startY, startZ);
    this.scene.add(this.mesh);
  }

  /**
   * Called every fixed physics step.
   * Applies camera-relative velocity so that movement is deterministic and
   * runs at the fixed 60 Hz rate.
   *
   * @param cameraYaw  Horizontal yaw of the camera (radians).  Using the yaw
   *                   from the previous frame is acceptable for a game.
   */
  fixedUpdate(cameraYaw: number): void {
    this.checkGrounded();

    const move = this.input.getMovementVector();
    const hasMove = move.x !== 0 || move.z !== 0;

    if (hasMove) {
      // Rotate local input by camera yaw to get world-space direction
      const cos = Math.cos(cameraYaw);
      const sin = Math.sin(cameraYaw);
      const worldX = move.x * cos - move.z * sin;
      const worldZ = move.x * sin + move.z * cos;

      const vel = this.body.linvel();
      this.body.setLinvel(
        { x: worldX * MOVE_SPEED, y: vel.y, z: worldZ * MOVE_SPEED },
        true,
      );

      // Update facing direction target for the visual mesh
      const angle = Math.atan2(worldX, worldZ);
      this.targetRotation.setFromEuler(new THREE.Euler(0, angle, 0));
    } else {
      // Damp horizontal velocity when no input
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
   * Syncs Three.js mesh position to physics body and smoothly rotates it.
   */
  update(): void {
    const pos = this.body.translation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.slerp(this.targetRotation, ROTATION_LERP);
  }

  getPosition(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Downward raycast to determine whether the player is on the ground. */
  private checkGrounded(): void {
    const pos = this.body.translation();
    const toi = this.physics.castRay(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: 0, y: -1, z: 0 },
      1.2, // capsule half-height + small margin
    );
    this.isGrounded = toi !== null;
  }
}
