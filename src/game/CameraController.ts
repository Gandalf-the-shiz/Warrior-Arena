import * as THREE from 'three';
import { InputManager } from '@/engine/InputManager';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

const MIN_PITCH = -20 * (Math.PI / 180); // −20°
const MAX_PITCH = 60 * (Math.PI / 180);  //  60°
const CAM_LERP = 0.1;
const SENSITIVITY = 0.003;

/**
 * Third-person over-the-shoulder camera (God-of-War style).
 * Orbits around the player, avoids geometry via raycasting.
 */
export class CameraController {
  /** Current horizontal yaw (radians). Exposed so PlayerController can read it. */
  yaw = 0;

  private pitch = 0.3; // slight downward tilt at start
  private readonly targetPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();

  // Camera shake state
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private readonly shakeOffset = new THREE.Vector3();

  private frameCount = 0;
  // Skip collision avoidance for the first few frames to avoid physics-settle
  // artifacts pushing the camera into a bad initial position.
  private static readonly COLLISION_GRACE_FRAMES = 10;

  // Over-the-shoulder offset in camera-local space (behind, above, slightly right)
  private readonly OFFSET = new THREE.Vector3(0.6, 2.5, -4.5);

  constructor(
    private readonly camera: THREE.Camera,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
  ) {
    // Place the camera behind and above the initial player position so the
    // first frame already shows the arena rather than a transitioning blur.
    const initialLookAt = new THREE.Vector3(0, 3, 0); // player (0,2,0) + 1 Y
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    const pitchQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, 0, 0));
    const orbitQ = new THREE.Quaternion().multiplyQuaternions(yawQ, pitchQ);
    const worldOffset = this.OFFSET.clone().applyQuaternion(orbitQ);
    this.currentPosition.copy(initialLookAt).add(worldOffset);
    this.camera.position.copy(this.currentPosition);
    (this.camera as THREE.PerspectiveCamera).lookAt(initialLookAt);
  }

  /**
   * Trigger a camera shake.
   * @param intensity  Maximum offset in world units.
   * @param duration   Duration in seconds over which the shake decays.
   */
  shake(intensity: number, duration: number): void {
    // Accumulate — take the stronger shake if one is already running
    if (intensity > this.shakeIntensity) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
      this.shakeTimer = 0;
    }
  }

  /**
   * Called every visual frame.
   * @param playerPos        World-space position of the player.
   * @param delta            Frame delta time (seconds).
   * @param playerFacingYaw  Y-axis angle the player character is currently facing (radians).
   *                         The camera yaw tracks this so the camera stays fixed behind the character.
   */
  update(playerPos: THREE.Vector3, delta: number, playerFacingYaw: number): void {
    // ── Camera yaw tracks player facing (locked behind character) ─────────
    // Shortest-path angle normalization to [-π, π], then smooth lerp.
    let diff = playerFacingYaw - this.yaw;
    diff -= Math.PI * 2 * Math.round(diff / (Math.PI * 2));
    this.yaw += diff * Math.min(1, 10 * delta);

    // ── Pitch from mouse / touch (up-down tilt only) ──────────────────────
    const mouse = this.input.getMouseDelta();
    this.pitch -= mouse.y * SENSITIVITY;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch));

    // ── Compute desired camera position ───────────────────────────────────
    // Build rotation matrix from yaw + pitch
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    const pitchQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, 0, 0));
    const orbitQ = new THREE.Quaternion().multiplyQuaternions(yawQ, pitchQ);

    // Rotate the local offset into world space and add to the look-at point
    const lookAt = playerPos.clone().add(new THREE.Vector3(0, 1, 0)); // chest height
    const worldOffset = this.OFFSET.clone().applyQuaternion(orbitQ);
    this.targetPosition.copy(lookAt).add(worldOffset);

    // ── Collision avoidance (skipped during initial grace period) ─────────
    this.frameCount += 1;
    if (this.frameCount > CameraController.COLLISION_GRACE_FRAMES) {
      const rayDir = worldOffset.clone().normalize();
      const maxDist = worldOffset.length();
      const toi = this.physics.castRay(
        { x: lookAt.x, y: lookAt.y, z: lookAt.z },
        { x: rayDir.x, y: rayDir.y, z: rayDir.z },
        maxDist,
      );
      if (toi !== null && toi < maxDist) {
        // Pull camera in front of the hit surface (small margin)
        this.targetPosition.copy(lookAt).addScaledVector(rayDir, Math.max(toi - 0.3, 0.5));
      }
    }

    // ── Smooth follow ─────────────────────────────────────────────────────
    this.currentPosition.lerp(this.targetPosition, CAM_LERP);

    // ── Camera shake ──────────────────────────────────────────────────────
    if (this.shakeTimer < this.shakeDuration) {
      this.shakeTimer += delta;
      const decay = 1 - Math.min(this.shakeTimer / this.shakeDuration, 1);
      const s = this.shakeIntensity * decay;
      this.shakeOffset.set(
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    this.camera.position.copy(this.currentPosition).add(this.shakeOffset);
    (this.camera as THREE.PerspectiveCamera).lookAt(lookAt);
  }
}
