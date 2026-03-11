import { describe, it, expect } from 'vitest';
import { computeCameraRelativeMovement } from './movementUtils';

/**
 * Unit tests for camera-relative movement conversion.
 *
 * Convention under test:
 *   moveX > 0  → strafe right  relative to camera
 *   moveX < 0  → strafe left   relative to camera
 *   moveY > 0  → move forward  relative to camera
 *   moveY < 0  → move backward relative to camera
 *
 *   cameraYaw = 0    → camera looks toward +Z
 *   cameraYaw = π/2  → camera looks toward +X
 *   cameraYaw = π    → camera looks toward -Z
 *   cameraYaw = -π/2 → camera looks toward -X
 *
 * Camera forward basis = (sin(yaw), 0, cos(yaw)).
 * Camera right  basis  = (cos(yaw), 0, -sin(yaw)).
 */

const HALF_PI = Math.PI / 2;
/** Accept floating-point results within this tolerance. */
const EPSILON = 1e-10;

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

describe('computeCameraRelativeMovement', () => {
  // ── Camera yaw = 0 (camera looks toward +Z) ────────────────────────────

  describe('yaw = 0 (camera faces +Z)', () => {
    const yaw = 0;

    it('joystick UP (moveY=+1) → world +Z (forward)', () => {
      const r = computeCameraRelativeMovement(0, 1, yaw);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, 1)).toBe(true);
    });

    it('joystick DOWN (moveY=-1) → world -Z (backward)', () => {
      const r = computeCameraRelativeMovement(0, -1, yaw);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, -1)).toBe(true);
    });

    it('joystick RIGHT (moveX=+1) → world +X (strafe right)', () => {
      const r = computeCameraRelativeMovement(1, 0, yaw);
      expect(approx(r.x, 1)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });

    it('joystick LEFT (moveX=-1) → world -X (strafe left)', () => {
      const r = computeCameraRelativeMovement(-1, 0, yaw);
      expect(approx(r.x, -1)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });

    it('diagonal UP+RIGHT (0.707, 0.707) → world (+X, +Z) quadrant', () => {
      const d = 1 / Math.sqrt(2);
      const r = computeCameraRelativeMovement(d, d, yaw);
      expect(approx(r.x, d)).toBe(true);
      expect(approx(r.z, d)).toBe(true);
    });

    it('diagonal DOWN+LEFT (-0.707, -0.707) → world (-X, -Z) quadrant', () => {
      const d = 1 / Math.sqrt(2);
      const r = computeCameraRelativeMovement(-d, -d, yaw);
      expect(approx(r.x, -d)).toBe(true);
      expect(approx(r.z, -d)).toBe(true);
    });
  });

  // ── Camera yaw = π/2 (camera faces +X) ────────────────────────────────

  describe('yaw = π/2 (camera faces +X)', () => {
    const yaw = HALF_PI;

    it('joystick UP (moveY=+1) → world +X (forward)', () => {
      const r = computeCameraRelativeMovement(0, 1, yaw);
      expect(approx(r.x, 1)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });

    it('joystick DOWN (moveY=-1) → world -X (backward)', () => {
      const r = computeCameraRelativeMovement(0, -1, yaw);
      expect(approx(r.x, -1)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });

    it('joystick RIGHT (moveX=+1) → world -Z (strafe right from +X facing)', () => {
      const r = computeCameraRelativeMovement(1, 0, yaw);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, -1)).toBe(true);
    });

    it('joystick LEFT (moveX=-1) → world +Z (strafe left from +X facing)', () => {
      const r = computeCameraRelativeMovement(-1, 0, yaw);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, 1)).toBe(true);
    });
  });

  // ── Camera yaw = π (camera faces -Z) ──────────────────────────────────

  describe('yaw = π (camera faces -Z)', () => {
    const yaw = Math.PI;

    it('joystick UP (moveY=+1) → world -Z (forward)', () => {
      const r = computeCameraRelativeMovement(0, 1, yaw);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, -1)).toBe(true);
    });

    it('joystick RIGHT (moveX=+1) → world -X (strafe right from -Z facing)', () => {
      const r = computeCameraRelativeMovement(1, 0, yaw);
      expect(approx(r.x, -1)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });
  });

  // ── Magnitude preservation ─────────────────────────────────────────────

  describe('magnitude preservation', () => {
    it('half-tilt forward (moveY=0.5) preserves magnitude 0.5', () => {
      const r = computeCameraRelativeMovement(0, 0.5, 0);
      const mag = Math.hypot(r.x, r.z);
      expect(approx(mag, 0.5)).toBe(true);
    });

    it('diagonal (0.6, 0.8) preserves magnitude 1.0', () => {
      const r = computeCameraRelativeMovement(0.6, 0.8, Math.PI / 4);
      const mag = Math.hypot(r.x, r.z);
      expect(approx(mag, 1.0)).toBe(true);
    });

    it('zero input returns zero vector', () => {
      const r = computeCameraRelativeMovement(0, 0, 1.23);
      expect(approx(r.x, 0)).toBe(true);
      expect(approx(r.z, 0)).toBe(true);
    });
  });

  // ── Self-consistency: facing angle matches cameraYaw when moving forward ─

  describe('self-consistency: player facing = cameraYaw when moving forward', () => {
    const yaws = [0, HALF_PI, Math.PI, -HALF_PI, Math.PI / 4, -Math.PI / 3];

    for (const yaw of yaws) {
      it(`yaw = ${yaw.toFixed(3)} rad: atan2(worldX, worldZ) ≈ yaw`, () => {
        const r = computeCameraRelativeMovement(0, 1, yaw);
        const facingAngle = Math.atan2(r.x, r.z);
        // Normalise to [-π, π] for comparison
        const diff = facingAngle - yaw;
        const normalised = Math.atan2(Math.sin(diff), Math.cos(diff));
        expect(Math.abs(normalised)).toBeLessThan(EPSILON);
      });
    }
  });

  // ── Keyboard WASD mapping validation ──────────────────────────────────
  // (keyboard input uses the same getMovementInput convention)

  describe('keyboard WASD (yaw = 0)', () => {
    const yaw = 0;

    it('W key (moveY=+1) moves forward (+Z)', () => {
      const r = computeCameraRelativeMovement(0, 1, yaw);
      expect(r.z).toBeGreaterThan(0);
      expect(approx(r.x, 0)).toBe(true);
    });

    it('S key (moveY=-1) moves backward (-Z)', () => {
      const r = computeCameraRelativeMovement(0, -1, yaw);
      expect(r.z).toBeLessThan(0);
      expect(approx(r.x, 0)).toBe(true);
    });

    it('D key (moveX=+1) strafes right (+X)', () => {
      const r = computeCameraRelativeMovement(1, 0, yaw);
      expect(r.x).toBeGreaterThan(0);
      expect(approx(r.z, 0)).toBe(true);
    });

    it('A key (moveX=-1) strafes left (-X)', () => {
      const r = computeCameraRelativeMovement(-1, 0, yaw);
      expect(r.x).toBeLessThan(0);
      expect(approx(r.z, 0)).toBe(true);
    });
  });
});
