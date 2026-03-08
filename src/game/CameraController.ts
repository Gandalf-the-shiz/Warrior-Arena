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

  // Over-the-shoulder offset in camera-local space (behind, above, slightly right)
  private readonly OFFSET = new THREE.Vector3(0.6, 2.5, 4.5);

  constructor(
    private readonly camera: THREE.Camera,
    private readonly input: InputManager,
    private readonly physics: PhysicsWorld,
  ) {
    this.currentPosition.set(0, 5, 8);
  }

  /**
   * Called every visual frame.
   * @param playerPos  World-space position of the player.
   * @param delta      Frame delta time (seconds).
   */
  update(playerPos: THREE.Vector3, _delta: number): void {
    // ── Rotate from mouse / touch ─────────────────────────────────────────
    const mouse = this.input.getMouseDelta();
    this.yaw -= mouse.x * SENSITIVITY;
    this.pitch -= mouse.y * SENSITIVITY;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch));

    // ── Compute desired camera position ───────────────────────────────────
    // Build rotation matrix from yaw + pitch
    const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    const pitchQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, 0, 0));
    const orbitQ = yawQ.multiply(pitchQ);

    // Rotate the local offset into world space and add to the look-at point
    const lookAt = playerPos.clone().add(new THREE.Vector3(0, 1, 0)); // chest height
    const worldOffset = this.OFFSET.clone().applyQuaternion(orbitQ);
    this.targetPosition.copy(lookAt).add(worldOffset);

    // ── Collision avoidance ───────────────────────────────────────────────
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

    // ── Smooth follow ─────────────────────────────────────────────────────
    this.currentPosition.lerp(this.targetPosition, CAM_LERP);
    this.camera.position.copy(this.currentPosition);
    (this.camera as THREE.PerspectiveCamera).lookAt(lookAt);
  }
}
