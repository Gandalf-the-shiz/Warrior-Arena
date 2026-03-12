/**
 * Fixed-timestep game loop using an accumulator pattern.
 * Physics runs at a deterministic 60 Hz; rendering runs as fast as the
 * display allows.
 *
 * ## Resilience features
 * - Delta is clamped to `MAX_DELTA` to prevent spiral-of-death catch-up
 *   after tab-throttling or long GC pauses.
 * - Fixed-step catch-up is further capped at `MAX_FIXED_STEPS_PER_FRAME`
 *   steps per rendered frame so a stall can never lock up the main thread.
 * - `unpause()` resets `lastTime` so no burst of frames is generated after
 *   returning from the pause menu or a background tab.
 *
 * ## Timing instrumentation
 * The loop exposes `lastUpdateMs`, `lastFixedUpdateMs`, and `lastRenderMs`
 * for use by PerformanceMonitor.  These are updated every frame.
 */

/** Maximum simulated seconds per rendered frame (caps spiral-of-death). */
const MAX_DELTA = 0.1;

/**
 * Maximum number of fixed-step iterations allowed per rendered frame.
 * At 60 Hz physics and 60 fps render this is normally 1.  Allowing up to 5
 * lets the simulation catch up across mild frame spikes without blocking.
 */
const MAX_FIXED_STEPS_PER_FRAME = 5;

export class GameLoop {
  private readonly FIXED_STEP = 1 / 60;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private _paused = false;
  private frameId = 0;

  // FPS tracking
  private fpsFrameCount = 0;
  private fpsTimer = 0;
  fps = 0;

  // Per-frame phase timing (ms) — written each frame, read by PerformanceMonitor
  lastUpdateMs      = 0;
  lastFixedUpdateMs = 0;
  lastRenderMs      = 0;

  constructor(
    private readonly onUpdate: (deltaTime: number) => void,
    private readonly onFixedUpdate: () => void,
    private readonly onRender: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  /**
   * Pause the loop — onUpdate and onFixedUpdate are skipped but onRender
   * continues so the scene remains visible.
   */
  pause(): void {
    this._paused = true;
  }

  /** Resume after a pause. */
  unpause(): void {
    // Reset lastTime so the first post-pause frame doesn't accumulate a
    // massive delta from the time spent in the pause menu.
    this.lastTime = performance.now();
    this.accumulator = 0; // discard any stale catch-up work
    this._paused = false;
  }

  get paused(): boolean {
    return this._paused;
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);

    // Clamp delta: prevents spiral-of-death after long pauses or GC stalls
    const rawDelta = (now - this.lastTime) / 1000;
    const delta = Math.min(rawDelta, MAX_DELTA);
    this.lastTime = now;

    if (!this._paused) {
      // ── Fixed-timestep accumulator ──────────────────────────────────────
      this.accumulator += delta;
      let fixedSteps = 0;
      const fixedStart = performance.now();
      while (this.accumulator >= this.FIXED_STEP && fixedSteps < MAX_FIXED_STEPS_PER_FRAME) {
        this.onFixedUpdate();
        this.accumulator -= this.FIXED_STEP;
        fixedSteps++;
      }
      // If we hit the cap, drain the accumulator to avoid future catch-up burst
      if (fixedSteps >= MAX_FIXED_STEPS_PER_FRAME) {
        this.accumulator = 0;
      }
      this.lastFixedUpdateMs = performance.now() - fixedStart;

      // ── Variable update ─────────────────────────────────────────────────
      const updateStart = performance.now();
      this.onUpdate(delta);
      this.lastUpdateMs = performance.now() - updateStart;
    }

    // ── Render ──────────────────────────────────────────────────────────────
    const renderStart = performance.now();
    this.onRender();
    this.lastRenderMs = performance.now() - renderStart;

    // FPS counter (updated every second)
    this.fpsFrameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 1) {
      this.fps = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.fpsTimer -= 1;
    }
  };
}
