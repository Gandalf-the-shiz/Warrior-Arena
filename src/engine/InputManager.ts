import { MobileJoystick } from '@/input/MobileJoystick';

/**
 * Manages all player input:
 *  - Keyboard (WASD, Space, Shift)
 *  - Mouse (pointer-lock, left-click attack)
 *  - Touch: virtual joystick (bottom-left) + attack button (bottom-right)
 */
export class InputManager {
  // ── Keyboard state ─────────────────────────────────────────────────────
  private keys: Record<string, boolean> = {};
  private pausePressedThisFrame = false;
  private finisherPressedThisFrame = false;
  private shieldBashPressedThisFrame = false;

  // ── Mouse state ────────────────────────────────────────────────────────
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private mouseAttack = false;
  private mouseHeavyAttack = false;
  private pointerLocked = false;

  // ── Attack hold tracking ───────────────────────────────────────────────
  private attackButtonDown = false;
  private attackPressTimestamp = 0;

  // ── Touch / virtual joystick ───────────────────────────────────────────
  private readonly joystick: MobileJoystick;
  private touchAttack = false;

  // Camera touch (right half of screen)
  private camTouchId: number | null = null;
  private camTouchLastX = 0;
  private camTouchLastY = 0;
  private camTouchDeltaX = 0;
  private camTouchDeltaY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.joystick = new MobileJoystick();
    this.bindKeyboard();
    this.bindMouse(canvas);
    this.bindCameraTouch();
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

    // Virtual joystick overrides keyboard on touch devices.
    // joystick.dx: -1 = left, +1 = right (screen space, magnitude embedded).
    // joystick.dy: -1 = up on screen, +1 = down on screen.
    // Negate dy so that "up on screen" → negative Z (forward in Three.js).
    if (this.joystick.active) {
      x = this.joystick.dx;
      z = -this.joystick.dy;
    }

    // Normalise diagonal movement (keyboard may produce len > 1 on diagonals;
    // joystick vector has magnitude ≤ 1 so the branch is a no-op for touch input)
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
    if (val) {
      this.attackButtonDown = true;
      this.attackPressTimestamp = Date.now();
    }
    return val;
  }

  /** Returns the current hold duration in seconds (0 if not held). */
  getAttackHoldTime(): number {
    if (!this.attackButtonDown) return 0;
    return (Date.now() - this.attackPressTimestamp) / 1000;
  }

  /** True when the attack button has been held for more than 0.4 seconds. */
  isHeavyAttackReady(): boolean {
    return this.attackButtonDown && this.getAttackHoldTime() > 0.4;
  }

  /** Right-click or E key — heavy attack (costs stamina). */
  isHeavyAttacking(): boolean {
    const val = this.mouseHeavyAttack || this.keys['KeyE'] === true;
    this.mouseHeavyAttack = false;
    // KeyE is edge-triggered: consume it so it fires once per press
    if (this.keys['KeyE']) this.keys['KeyE'] = false;
    return val;
  }

  /**
   * Edge-triggered — returns true once when Escape is pressed.
   * Resets after being read.
   */
  isPausePressed(): boolean {
    const val = this.pausePressedThisFrame;
    this.pausePressedThisFrame = false;
    return val;
  }

  /**
   * Edge-triggered — returns true once when F is pressed (finisher / execution).
   * Resets after being read.
   */
  isFinisherReady(): boolean {
    const val = this.finisherPressedThisFrame;
    this.finisherPressedThisFrame = false;
    return val;
  }

  /**
   * Returns true while Q is held down — player is raising shield to block.
   */
  isBlocking(): boolean {
    return this.keys['KeyQ'] === true;
  }

  /**
   * Edge-triggered — returns true once when LMB is clicked while blocking.
   * Resets after being read. Used for shield bash.
   */
  isShieldBashing(): boolean {
    const val = this.shieldBashPressedThisFrame;
    this.shieldBashPressedThisFrame = false;
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
      if (e.code === 'Escape') {
        this.pausePressedThisFrame = true;
      }
      if (e.code === 'KeyF') {
        this.finisherPressedThisFrame = true;
      }
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

    // Left-click = light attack (or shield bash if blocking), right-click = heavy attack when locked
    window.addEventListener('mousedown', (e) => {
      if (this.pointerLocked && e.button === 0) {
        if (this.keys['KeyQ']) {
          // LMB while blocking = shield bash (edge-triggered)
          this.shieldBashPressedThisFrame = true;
        } else {
          this.mouseAttack = true;
          this.attackButtonDown = true;
          this.attackPressTimestamp = Date.now();
        }
      }
      if (this.pointerLocked && e.button === 2) {
        this.mouseHeavyAttack = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.attackButtonDown = false;
      }
    });
  }

  private bindCameraTouch(): void {
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
      this.attackButtonDown = true;
      this.attackPressTimestamp = Date.now();
    }, { passive: false });
    btn.addEventListener('touchend', () => {
      this.attackButtonDown = false;
    }, { passive: false });
    btn.addEventListener('touchcancel', () => {
      this.attackButtonDown = false;
    }, { passive: false });
  }

  private isTouchDevice(): boolean {
    return window.matchMedia('(pointer: coarse)').matches;
  }
}
