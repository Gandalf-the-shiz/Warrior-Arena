/**
 * Manages all player input:
 *  - Keyboard (WASD, Space, Shift)
 *  - Mouse (pointer-lock, left-click attack)
 *  - Touch: virtual joystick (bottom-left) + attack button (bottom-right)
 */
export class InputManager {
  // ── Keyboard state ─────────────────────────────────────────────────────
  private keys: Record<string, boolean> = {};

  // ── Mouse state ────────────────────────────────────────────────────────
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private mouseAttack = false;
  private pointerLocked = false;

  // ── Touch / virtual joystick ───────────────────────────────────────────
  private joystickActive = false;
  private joystickId: number | null = null;
  private joystickOriginX = 0;
  private joystickOriginY = 0;
  private joystickDeltaX = 0;
  private joystickDeltaY = 0;
  private readonly JOYSTICK_RADIUS = 60; // pixels

  private touchAttack = false;

  // Camera touch (right half of screen)
  private camTouchId: number | null = null;
  private camTouchLastX = 0;
  private camTouchLastY = 0;
  private camTouchDeltaX = 0;
  private camTouchDeltaY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.bindKeyboard();
    this.bindMouse(canvas);
    this.bindTouch();
    this.bindAttackButton();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Normalised movement vector in the XZ plane, magnitude ≤ 1. */
  getMovementVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;

    if (this.pointerLocked || !this.isTouchDevice()) {
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) z -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) z += 1;
    }

    // Virtual joystick overrides keyboard on touch devices
    if (this.joystickActive) {
      x = this.joystickDeltaX / this.JOYSTICK_RADIUS;
      z = this.joystickDeltaY / this.JOYSTICK_RADIUS;
    }

    // Normalise diagonal movement
    const len = Math.sqrt(x * x + z * z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  isJumping(): boolean {
    return this.keys['Space'] === true;
  }

  isDodging(): boolean {
    return this.keys['ShiftLeft'] === true || this.keys['ShiftRight'] === true;
  }

  isAttacking(): boolean {
    const val = this.mouseAttack || this.touchAttack;
    // Consume the attack flag so it fires once per press
    this.mouseAttack = false;
    this.touchAttack = false;
    return val;
  }

  /** Mouse-delta in pixels since the last frame (pointer-lock). */
  getMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    // Accumulate any pending camera touch delta too
    if (this.camTouchId !== null) {
      delta.x += this.camTouchDeltaX;
      delta.y += this.camTouchDeltaY;
      this.camTouchDeltaX = 0;
      this.camTouchDeltaY = 0;
    }
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  // ── Private Binding ─────────────────────────────────────────────────────

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  private bindMouse(canvas: HTMLCanvasElement): void {
    // Request pointer lock on canvas click
    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        canvas.requestPointerLock();
      } else {
        this.mouseAttack = true;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });

    // Left-click = light attack when locked
    window.addEventListener('mousedown', (e) => {
      if (this.pointerLocked && e.button === 0) {
        this.mouseAttack = true;
      }
    });
  }

  private bindTouch(): void {
    const joystickZone = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');

    // ── Joystick: bind directly to #joystick-zone so overlay intercepts work
    if (joystickZone) {
      joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.changedTouches[0];
        if (touch && this.joystickId === null) {
          this.joystickId = touch.identifier;
          this.joystickOriginX = touch.clientX;
          this.joystickOriginY = touch.clientY;
          this.joystickActive = true;

          joystickZone.style.left = `${touch.clientX - 60}px`;
          joystickZone.style.bottom = '';
          joystickZone.style.top = `${touch.clientY - 60}px`;
        }
      }, { passive: false });

      joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
          if (touch.identifier === this.joystickId) {
            const dx = touch.clientX - this.joystickOriginX;
            const dy = touch.clientY - this.joystickOriginY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clamped = Math.min(dist, this.JOYSTICK_RADIUS);
            const angle = Math.atan2(dy, dx);
            this.joystickDeltaX = Math.cos(angle) * clamped;
            this.joystickDeltaY = Math.sin(angle) * clamped;

            if (knob) {
              knob.style.transform = `translate(calc(-50% + ${this.joystickDeltaX}px), calc(-50% + ${this.joystickDeltaY}px))`;
            }
          }
        }
      }, { passive: false });

      const endJoystick = (e: TouchEvent): void => {
        for (const touch of Array.from(e.changedTouches)) {
          if (touch.identifier === this.joystickId) {
            this.joystickId = null;
            this.joystickActive = false;
            this.joystickDeltaX = 0;
            this.joystickDeltaY = 0;
            if (knob) {
              knob.style.transform = 'translate(-50%, -50%)';
            }
            joystickZone.style.left = '24px';
            joystickZone.style.top = '';
            joystickZone.style.bottom = '24px';
          }
        }
      };

      joystickZone.addEventListener('touchend', endJoystick, { passive: false });
      joystickZone.addEventListener('touchcancel', endJoystick, { passive: false });
    }

    // ── Camera rotation: bind to document so right-side touches always register
    document.addEventListener('touchstart', (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.clientX >= window.innerWidth / 2 && this.camTouchId === null) {
          this.camTouchId = touch.identifier;
          this.camTouchLastX = touch.clientX;
          this.camTouchLastY = touch.clientY;
        }
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === this.camTouchId) {
          this.camTouchDeltaX += touch.clientX - this.camTouchLastX;
          this.camTouchDeltaY += touch.clientY - this.camTouchLastY;
          this.camTouchLastX = touch.clientX;
          this.camTouchLastY = touch.clientY;
        }
      }
    }, { passive: true });

    const endCamTouch = (e: TouchEvent): void => {
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === this.camTouchId) {
          this.camTouchId = null;
          this.camTouchDeltaX = 0;
          this.camTouchDeltaY = 0;
        }
      }
    };

    document.addEventListener('touchend', endCamTouch, { passive: true });
    document.addEventListener('touchcancel', endCamTouch, { passive: true });
  }

  private bindAttackButton(): void {
    const btn = document.getElementById('attack-btn');
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchAttack = true;
    }, { passive: false });
  }

  private isTouchDevice(): boolean {
    return window.matchMedia('(pointer: coarse)').matches;
  }
}
