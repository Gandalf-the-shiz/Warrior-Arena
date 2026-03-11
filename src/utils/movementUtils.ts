/**
 * Pure utility: compute a camera-relative world-space XZ movement vector.
 *
 * Convention:
 *   moveX  > 0  → strafe right  relative to camera
 *   moveX  < 0  → strafe left   relative to camera
 *   moveY  > 0  → move forward  relative to camera
 *   moveY  < 0  → move backward relative to camera
 *
 * Forward and right basis vectors are derived from the camera yaw angle only
 * (ignoring pitch so locomotion stays planar).
 *
 * @param moveX     Horizontal intent: -1 (left) → +1 (right), magnitude ≤ 1.
 * @param moveY     Forward intent: -1 (backward) → +1 (forward), magnitude ≤ 1.
 * @param cameraYaw Camera yaw in radians (Y-axis rotation).
 *                  yaw = 0 → camera looks toward +Z; yaw = π/2 → toward +X.
 * @returns World-space XZ direction with the same magnitude as the input vector.
 */
export function computeCameraRelativeMovement(
  moveX: number,
  moveY: number,
  cameraYaw: number,
): { x: number; z: number } {
  // Camera basis vectors (flat, ignoring pitch):
  //   forward = (sin(yaw), 0, cos(yaw))
  //   right   = (cos(yaw), 0, -sin(yaw))
  const sinYaw = Math.sin(cameraYaw);
  const cosYaw = Math.cos(cameraYaw);

  return {
    x: cosYaw * moveX + sinYaw * moveY,
    z: -sinYaw * moveX + cosYaw * moveY,
  };
}
