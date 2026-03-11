/**
 * MobileJoystick — floating/dynamic 360° virtual joystick for touch devices.
 *
 * Design (mirrors Brawl Stars / Clash Royale joystick behaviour):
 * - The joystick base FLOATS to wherever the player first touches within the zone.
 * - This eliminates thumb-reach problems; the base always appears under the finger.
 * - Single-touch tracking with multi-touch safety via touch identifier.
 * - Circular knob clamping to base radius with analog magnitude output.
 * - Dead zone prevents drift from micro-touches.
 * - Base hides instantly on touch release; no CSS transition jitter.
 * - passive:false + preventDefault() blocks scroll/zoom interference.
 *
 * Coordinate conventions (matches InputManager / PlayerController):
 *   dx  :  -1 = left on screen,   +1 = right on screen.
 *   dy  :  -1 = up on screen,     +1 = down on screen.
 *
 * Caller (InputManager) maps these with a Y-inversion:
 *   moveX =  joystick.dx   →  right intent
 *   moveY = -joystick.dy   →  positive = forward (thumb up → forward)
 */
export class MobileJoystick {
  /** Normalized X: −1 (left) → +1 (right). Magnitude embedded. */
  dx = 0;
  /**
   * Normalized Y in screen space: −1 = up on screen, +1 = down on screen.
   * InputManager negates this value (moveY = -dy) so that thumb-up maps to
   * positive forward intent.
   */
  dy = 0;
  /** Scalar 0–1 representing how far the knob is from center. */
  magnitude = 0;
  /** Angle in radians from Math.atan2(dy, dx). */
  angle = 0;

  private activeTouchId: number | null = null;

  /** Screen-pixel position of the floating base centre (set on touchstart). */
  private baseCenterX = 0;
  private baseCenterY = 0;

  private readonly zoneEl: HTMLElement;
  private readonly baseEl: HTMLElement;
  private readonly knobEl: HTMLElement;

  /** Radius of the visible joystick base in pixels. */
  private static readonly BASE_RADIUS = 55;
  /** Pixels of displacement before the joystick registers input. */
  private static readonly DEAD_ZONE_PX = 6;

  constructor() {
    this.zoneEl = document.getElementById('joystick-zone')!;
    this.baseEl = document.getElementById('joystick-base')!;
    this.knobEl = document.getElementById('joystick-knob')!;

    this.zoneEl.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.zoneEl.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.zoneEl.addEventListener('touchend', this.onTouchEnd, { passive: false });
    this.zoneEl.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  /** True while a finger is actively on the joystick zone. */
  get active(): boolean {
    return this.activeTouchId !== null;
  }

  /** Remove all event listeners — call on game teardown. */
  dispose(): void {
    this.zoneEl.removeEventListener('touchstart', this.onTouchStart);
    this.zoneEl.removeEventListener('touchmove', this.onTouchMove);
    this.zoneEl.removeEventListener('touchend', this.onTouchEnd);
    this.zoneEl.removeEventListener('touchcancel', this.onTouchEnd);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.activeTouchId !== null) return; // already tracking one finger
    const touch = e.changedTouches[0];
    if (!touch) return;

    this.activeTouchId = touch.identifier;

    // Float the base to the touch position, clamped so the full circle stays in zone
    const R = MobileJoystick.BASE_RADIUS;
    const rect = this.zoneEl.getBoundingClientRect();
    this.baseCenterX = Math.min(Math.max(touch.clientX, rect.left + R), rect.right - R);
    this.baseCenterY = Math.min(Math.max(touch.clientY, rect.top + R), rect.bottom - R);

    // Position and reveal the base element (coordinates relative to zone top-left)
    this.baseEl.style.left = `${this.baseCenterX - rect.left}px`;
    this.baseEl.style.top = `${this.baseCenterY - rect.top}px`;
    this.baseEl.style.display = 'block';

    this.updateFromTouch(touch);
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch && touch.identifier === this.activeTouchId) {
        this.updateFromTouch(touch);
        return;
      }
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch && touch.identifier === this.activeTouchId) {
        this.activeTouchId = null;
        this.resetKnob();
        return;
      }
    }
  };

  // ── Core logic ────────────────────────────────────────────────────────────

  private updateFromTouch(touch: Touch): void {
    const R = MobileJoystick.BASE_RADIUS;
    const rect = this.zoneEl.getBoundingClientRect();

    let offsetX = touch.clientX - this.baseCenterX;
    let offsetY = touch.clientY - this.baseCenterY;
    const dist = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

    // Clamp knob inside the base circle
    if (dist > R) {
      const scale = R / dist;
      offsetX *= scale;
      offsetY *= scale;
    }

    // Move knob visually — absolute pixels from zone top-left
    const baseLocalX = this.baseCenterX - rect.left;
    const baseLocalY = this.baseCenterY - rect.top;
    this.knobEl.style.left = `${baseLocalX + offsetX}px`;
    this.knobEl.style.top = `${baseLocalY + offsetY}px`;

    // Dead zone — suppress output for accidental micro-touches
    if (dist < MobileJoystick.DEAD_ZONE_PX) {
      this.dx = 0;
      this.dy = 0;
      this.magnitude = 0;
      this.angle = 0;
      return;
    }

    // Normalize into [-1, 1] with magnitude ≤ 1
    const clampedDist = Math.min(dist, R);
    this.dx = offsetX / R;
    this.dy = offsetY / R;       // raw screen Y: dy < 0 = up on screen; InputManager negates this to forward
    this.magnitude = clampedDist / R;
    this.angle = Math.atan2(offsetY, offsetX);
  }

  private resetKnob(): void {
    this.dx = 0;
    this.dy = 0;
    this.magnitude = 0;
    this.angle = 0;
    this.baseEl.style.display = 'none';
    this.knobEl.style.left = '50%';
    this.knobEl.style.top = '50%';
  }
}
