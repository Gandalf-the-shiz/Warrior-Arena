/**
 * MobileJoystick — industry-standard 360° virtual joystick for touch devices.
 *
 * Design principles (mirroring Brawl Stars / Archero joystick behavior):
 * - Tracks a single touch by identifier (multi-touch safe)
 * - Clamps knob movement to circular base radius
 * - Outputs normalized direction vector (dx, dy) where magnitude encodes analog speed
 * - Dead zone prevents drift from accidental micro-touches
 * - Knob re-centers instantly on touch release (no CSS transition)
 * - passive:false + preventDefault() blocks scroll/zoom interference
 */
export class MobileJoystick {
  /** Normalized X component: -1 (left) to +1 (right). Magnitude is embedded. */
  dx = 0;
  /**
   * Normalized Y component in raw screen-space: negative = up on screen, positive = down.
   * Caller must negate dy when converting to world-space forward (screen Y-down ≠ world Z-forward).
   * Magnitude is embedded.
   */
  dy = 0;
  /** Scalar 0–1 representing how far the knob is from center (post-clamp). */
  magnitude = 0;
  /** Angle in radians from Math.atan2(dy, dx). */
  angle = 0;

  private activeTouchId: number | null = null;
  private readonly zoneEl: HTMLElement;
  private readonly baseEl: HTMLElement;
  private readonly knobEl: HTMLElement;

  /** Minimum pixel displacement before the joystick registers movement. */
  private static readonly DEAD_ZONE_PX = 4;

  constructor() {
    this.zoneEl = document.getElementById('joystick-zone')!;
    this.baseEl = document.getElementById('joystick-base')!;
    this.knobEl = document.getElementById('joystick-knob')!;

    this.zoneEl.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.zoneEl.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.zoneEl.addEventListener('touchend', this.onTouchEnd, { passive: false });
    this.zoneEl.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  /** True while a finger is actively on the joystick. */
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

  // ── Event handlers (arrow functions preserve `this`) ────────────────────

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (this.activeTouchId !== null) return; // already tracking one finger
    const touch = e.changedTouches[0];
    if (!touch) return;
    this.activeTouchId = touch.identifier;
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

  // ── Core logic ───────────────────────────────────────────────────────────

  private updateFromTouch(touch: Touch): void {
    const rect = this.baseEl.getBoundingClientRect();
    const baseRadius = rect.width / 2;
    const cx = rect.left + baseRadius;
    const cy = rect.top + baseRadius;

    let offsetX = touch.clientX - cx;
    let offsetY = touch.clientY - cy;
    const dist = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

    // Clamp knob to the base circle
    if (dist > baseRadius) {
      const scale = baseRadius / dist;
      offsetX *= scale;
      offsetY *= scale;
    }

    // Move knob visually (position as % of base, centered at 50%/50%)
    const knobPctX = (offsetX / baseRadius) * 50;
    const knobPctY = (offsetY / baseRadius) * 50;
    this.knobEl.style.left = `${50 + knobPctX}%`;
    this.knobEl.style.top = `${50 + knobPctY}%`;

    // Dead zone: suppress output for tiny accidental touches
    if (dist < MobileJoystick.DEAD_ZONE_PX) {
      this.dx = 0;
      this.dy = 0;
      this.magnitude = 0;
      this.angle = 0;
      return;
    }

    // Normalize: dx/dy encode both direction AND magnitude in [-1, 1].
    // After clamping above, clampedDist ≤ baseRadius, so magnitude is always ≤ 1.
    // sqrt(dx² + dy²) == magnitude ≤ 1 (no further clamping needed).
    const clampedDist = Math.min(dist, baseRadius);
    this.dx = offsetX / baseRadius;
    this.dy = offsetY / baseRadius;
    this.magnitude = clampedDist / baseRadius;
    this.angle = Math.atan2(offsetY, offsetX);
  }

  private resetKnob(): void {
    this.dx = 0;
    this.dy = 0;
    this.magnitude = 0;
    this.angle = 0;
    this.knobEl.style.left = '50%';
    this.knobEl.style.top = '50%';
  }
}
