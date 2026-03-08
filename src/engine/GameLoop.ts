/**
 * Fixed-timestep game loop using an accumulator pattern.
 * Physics runs at a deterministic 60 Hz; rendering runs as fast as the
 * display allows.
 */
export class GameLoop {
  private readonly FIXED_STEP = 1 / 60;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private frameId = 0;

  // FPS tracking
  private fpsFrameCount = 0;
  private fpsTimer = 0;
  fps = 0;

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

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);

    // Clamp delta to avoid spiral of death after tab becomes visible again
    const rawDelta = (now - this.lastTime) / 1000;
    const delta = Math.min(rawDelta, 0.1);
    this.lastTime = now;

    // Fixed-timestep accumulator
    this.accumulator += delta;
    while (this.accumulator >= this.FIXED_STEP) {
      this.onFixedUpdate();
      this.accumulator -= this.FIXED_STEP;
    }

    // Variable update (animations, lerp, etc.)
    this.onUpdate(delta);

    // Render
    this.onRender();

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
