import * as THREE from 'three';
import { InputManager } from '@/engine/InputManager';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

const MIN_PITCH = -20 * (Math.PI / 180); // −20°
const MAX_PITCH = 60 * (Math.PI / 180);  //  60°
const CAM_LERP = 0.1;
const SENSITIVITY = 0.00165;
const MOUSE_YAW_DECAY = 3.0; // rate at which mouse orbit offset decays back to 0

/**
 * Third-person camera (Dark Souls / Skyrim style).
 * The camera yaw tracks the player's facing direction with a mouse-orbit offset.
 * Mouse X adds a temporary orbital offset that decays back to 0, so the camera
 * always settles back directly behind the warrior after the player stops moving
 * the mouse. Movement is camera-relative: W always moves toward the camera's
 * look direction. Orbits around the player and avoids geometry via raycasting.
 */
export class CameraController {
  /**
   * Current horizontal yaw (radians).
   * Equals playerFacingYaw + mouseYawOffset — used by PlayerController for
   * camera-relative movement direction.
   */
  yaw = 0;

  /** Temporary mouse orbit offset — decays to 0 over time. */
  private mouseYawOffset = 0;

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

  // Camera sits behind the player. Negative Z = behind player when player faces +Z.
  // Applying the yaw quaternion (player facing) rotates this offset into world space,
  // placing the camera directly behind the warrior.
  // NOTE: OFFSET is mutated in-place by setDeathZoom(); readonly prevents reference reassignment only.
  private readonly OFFSET = new THREE.Vector3(0, 2.5, -5.0);
  private readonly BASE_OFFSET = new THREE.Vector3(0, 2.5, -5.0);
  private readonly DEATH_OFFSET = new THREE.Vector3(0, 1.8, -2.5);

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
   * Interpolate the camera offset toward a closer position during the death
   * sequence. t = 0 → normal distance, t = 1 → close-in death zoom.
   */
  setDeathZoom(t: number): void {
    this.OFFSET.lerpVectors(this.BASE_OFFSET, this.DEATH_OFFSET, Math.min(1, Math.max(0, t)));
  }

  /**
   * Subtle finisher zoom — slightly closer than normal, lerps back when t=0.
   * t = 1 → finisher active, t = 0 → return to normal.
   */
  setFinisherZoom(t: number): void {
    const FINISHER_OFFSET = new THREE.Vector3(0, 2.0, -3.5);
    this.OFFSET.lerpVectors(this.BASE_OFFSET, FINISHER_OFFSET, Math.min(1, Math.max(0, t)));
  }

  /**
   * Called every visual frame.
   * @param playerPos        World-space position of the player.
   * @param delta            Frame delta time (seconds).
   * @param playerFacingYaw  Current Y-axis rotation of the warrior mesh (radians).
   *                         Camera yaw tracks this value so the camera stays
   *                         directly behind the warrior when the mouse is idle.
   *
   * Camera yaw = playerFacingYaw + mouseYawOffset.
   * Mouse X input adds to mouseYawOffset; it decays back toward 0 at
   * MOUSE_YAW_DECAY per second so the camera snaps back behind the warrior.
   */
  update(playerPos: THREE.Vector3, delta: number, playerFacingYaw = 0): void {
    // ── Camera yaw and pitch from mouse / touch input ─────────────────────
    const mouse = this.input.getMouseDelta();
    this.mouseYawOffset -= mouse.x * SENSITIVITY;  // mouse adds temporary orbit
    this.pitch -= mouse.y * SENSITIVITY;            // vertical tilt stays direct
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch));

    // Decay mouse orbit offset back toward 0 (camera settles behind warrior)
    const decayAmount = MOUSE_YAW_DECAY * delta;
    if (Math.abs(this.mouseYawOffset) > decayAmount) {
      this.mouseYawOffset -= Math.sign(this.mouseYawOffset) * decayAmount;
    } else {
      this.mouseYawOffset = 0;
    }

    // Final yaw is warrior facing + temporary mouse orbit
    this.yaw = playerFacingYaw + this.mouseYawOffset;

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
