import * as THREE from 'three';
import { InputManager } from '@/engine/InputManager';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

const MIN_PITCH = -20 * (Math.PI / 180); // −20°
const MAX_PITCH = 60 * (Math.PI / 180);  //  60°
const CAM_LERP = 0.1;
const SENSITIVITY = 0.003;

/**
 * Third-person camera (Dark Souls / Skyrim style).
 * The camera yaw is driven by mouse X input — independent of player facing.
 * Movement is camera-relative: W always moves toward the camera's look direction.
 * Orbits around the player and avoids geometry via raycasting.
 */
export class CameraController {
  /** Current horizontal yaw (radians). Driven by mouse X. Read by PlayerController for camera-relative movement. */
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

  // Centered behind the player. Positive Z = behind player (player forward = +Z in local space).
  private readonly OFFSET = new THREE.Vector3(0, 2.5, 5.0);

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
   * @param playerPos  World-space position of the player.
   * @param delta      Frame delta time (seconds).
   *
   * Camera yaw is now controlled by mouse X input (not player facing).
   * This allows the player to look around the arena independently.
   */
  update(playerPos: THREE.Vector3, delta: number): void {
    // ── Camera yaw and pitch from mouse / touch input ─────────────────────
    const mouse = this.input.getMouseDelta();
    this.yaw -= mouse.x * SENSITIVITY;   // horizontal orbit from mouse X
    this.pitch -= mouse.y * SENSITIVITY; // vertical tilt from mouse Y
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
