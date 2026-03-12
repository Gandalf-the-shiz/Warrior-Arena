/**
 * PerformanceMonitor — lightweight in-game performance instrumentation.
 *
 * Tracks FPS, per-phase frame timing, renderer draw-call stats, and JS heap
 * usage.  A toggleable debug overlay (default key: P) surfaces the data
 * in-game.  All measurement paths are near-zero cost and can be compiled
 * out by setting `enabled = false` before the first frame.
 *
 * Usage in main.ts:
 *   const perf = new PerformanceMonitor();
 *   // inside the game loop, bracket each phase:
 *   perf.beginFrame();
 *     perf.beginPhase('update');  player.update(dt);  perf.endPhase('update');
 *     perf.beginPhase('render');  renderer.render();  perf.endPhase('render');
 *   perf.endFrame(renderer.renderer);
 */

import * as THREE from 'three';

// How many samples to keep in the rolling windows.
const ROLLING_WINDOW = 60;

interface PhaseEntry {
  start: number;
  /** Rolling average duration in ms. */
  avg: number;
  samples: number[];
}

/** All performance counters exposed to callers. */
export interface PerfSnapshot {
  fps: number;
  frameTimeMs: number;     // latest frame time
  frameTimeAvgMs: number;  // rolling average
  phases: Record<string, number>; // rolling avg per phase (ms)
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  heapUsedMB: number;
  heapLimitMB: number;
  activeEnemies: number;
}

export class PerformanceMonitor {
  /** Set to false to disable all measurement and the overlay. */
  enabled = true;

  // ── Frame timing ─────────────────────────────────────────────────────────
  private frameStart = 0;
  private frameSamples: number[] = [];
  private _fps = 0;
  private _frameTimeMs = 0;
  private _frameTimeAvgMs = 0;
  private fpsFrameCount = 0;
  private fpsTimer = 0;

  // ── Phase timing ─────────────────────────────────────────────────────────
  private phases = new Map<string, PhaseEntry>();

  // ── Renderer stats ───────────────────────────────────────────────────────
  private _drawCalls = 0;
  private _triangles = 0;
  private _geometries = 0;
  private _textures = 0;

  // ── Memory ───────────────────────────────────────────────────────────────
  private _heapUsedMB = 0;
  private _heapLimitMB = 0;

  // ── Active entity counters ────────────────────────────────────────────────
  activeEnemies = 0;

  // ── Debug overlay ────────────────────────────────────────────────────────
  private overlayVisible = false;
  private readonly overlayEl: HTMLElement;
  private overlayUpdateTimer = 0;
  private readonly OVERLAY_UPDATE_INTERVAL = 0.1; // seconds

  constructor() {
    this.overlayEl = this.createOverlayElement();
    document.body.appendChild(this.overlayEl);

    // Toggle overlay with P key
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) {
        this.toggleOverlay();
      }
    });
  }

  // ── Measurement API ───────────────────────────────────────────────────────

  /** Call at the very start of each frame (before update/render). */
  beginFrame(): void {
    if (!this.enabled) return;
    this.frameStart = performance.now();
  }

  /** Call at the very end of each frame, passing the Three.js renderer. */
  endFrame(renderer?: THREE.WebGLRenderer): void {
    if (!this.enabled) return;

    const now = performance.now();
    this._frameTimeMs = now - this.frameStart;

    // Rolling average
    this.frameSamples.push(this._frameTimeMs);
    if (this.frameSamples.length > ROLLING_WINDOW) this.frameSamples.shift();
    this._frameTimeAvgMs =
      this.frameSamples.reduce((s, v) => s + v, 0) / this.frameSamples.length;

    // FPS counter (updated every second)
    this.fpsFrameCount++;
    this.fpsTimer += this._frameTimeMs / 1000;
    if (this.fpsTimer >= 1) {
      this._fps = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.fpsTimer -= 1;
    }

    // Renderer stats
    if (renderer) {
      const info = renderer.info;
      this._drawCalls = info.render.calls;
      this._triangles = info.render.triangles;
      this._geometries = info.memory.geometries;
      this._textures   = info.memory.textures;
      // Three.js accumulates render.calls across frames; reset each frame
      renderer.info.reset();
    }

    // Memory
    const perfAny = performance as unknown as Record<string, unknown>;
    const mem = perfAny['memory'] as Record<string, number> | undefined;
    if (mem) {
      this._heapUsedMB  = mem['usedJSHeapSize']!  / 1_048_576;
      this._heapLimitMB = mem['jsHeapSizeLimit']!  / 1_048_576;
    }

    // Update overlay periodically (not every frame to avoid DOM thrash)
    if (this.overlayVisible) {
      this.overlayUpdateTimer += this._frameTimeMs / 1000;
      if (this.overlayUpdateTimer >= this.OVERLAY_UPDATE_INTERVAL) {
        this.overlayUpdateTimer = 0;
        this.renderOverlay();
      }
    }
  }

  /** Mark the start of a named work phase (update / fixedUpdate / render). */
  beginPhase(name: string): void {
    if (!this.enabled) return;
    let entry = this.phases.get(name);
    if (!entry) {
      entry = { start: 0, avg: 0, samples: [] };
      this.phases.set(name, entry);
    }
    entry.start = performance.now();
  }

  /** Mark the end of a named work phase. */
  endPhase(name: string): void {
    if (!this.enabled) return;
    const entry = this.phases.get(name);
    if (!entry) return;
    const duration = performance.now() - entry.start;
    entry.samples.push(duration);
    if (entry.samples.length > ROLLING_WINDOW) entry.samples.shift();
    entry.avg =
      entry.samples.reduce((s, v) => s + v, 0) / entry.samples.length;
  }

  // ── Read-only snapshot ────────────────────────────────────────────────────

  getSnapshot(): PerfSnapshot {
    const phases: Record<string, number> = {};
    this.phases.forEach((v, k) => { phases[k] = Number(v.avg.toFixed(2)); });
    return {
      fps:              this._fps,
      frameTimeMs:      Number(this._frameTimeMs.toFixed(2)),
      frameTimeAvgMs:   Number(this._frameTimeAvgMs.toFixed(2)),
      phases,
      drawCalls:        this._drawCalls,
      triangles:        this._triangles,
      geometries:       this._geometries,
      textures:         this._textures,
      heapUsedMB:       Number(this._heapUsedMB.toFixed(1)),
      heapLimitMB:      Number(this._heapLimitMB.toFixed(1)),
      activeEnemies:    this.activeEnemies,
    };
  }

  /** Convenience getter — current FPS (updated ~1 Hz). */
  get fps(): number { return this._fps; }
  /** Latest frame time in ms. */
  get frameTimeMs(): number { return this._frameTimeMs; }
  /** Rolling-average frame time in ms. */
  get frameTimeAvgMs(): number { return this._frameTimeAvgMs; }

  // ── Overlay ───────────────────────────────────────────────────────────────

  toggleOverlay(): void {
    this.overlayVisible = !this.overlayVisible;
    this.overlayEl.style.display = this.overlayVisible ? 'block' : 'none';
    if (this.overlayVisible) this.renderOverlay();
  }

  private createOverlayElement(): HTMLElement {
    const el = document.createElement('pre');
    el.id = 'perf-overlay';
    Object.assign(el.style, {
      display: 'none',
      position: 'fixed',
      top: '8px',
      right: '8px',
      padding: '6px 10px',
      background: 'rgba(0,0,0,0.72)',
      color: '#00ff88',
      fontFamily: 'monospace',
      fontSize: '11px',
      lineHeight: '1.5',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '9999',
      whiteSpace: 'pre',
    });
    return el;
  }

  private renderOverlay(): void {
    const s = this.getSnapshot();
    const phaseLines = Object.entries(s.phases)
      .map(([k, v]) => `  ${k.padEnd(14)}${v.toFixed(2).padStart(6)} ms`)
      .join('\n');

    const memLine = s.heapLimitMB > 0
      ? `  heap            ${s.heapUsedMB.toFixed(0).padStart(5)} / ${s.heapLimitMB.toFixed(0)} MB`
      : '';

    this.overlayEl.textContent = [
      `FPS              ${String(s.fps).padStart(5)}`,
      `frame avg        ${s.frameTimeAvgMs.toFixed(2).padStart(6)} ms`,
      `frame latest     ${s.frameTimeMs.toFixed(2).padStart(6)} ms`,
      `enemies          ${String(s.activeEnemies).padStart(5)}`,
      `── Phases ──────────────────`,
      phaseLines,
      `── Renderer ────────────────`,
      `  draw calls     ${String(s.drawCalls).padStart(5)}`,
      `  triangles      ${String(s.triangles).padStart(5)}`,
      `  geometries     ${String(s.geometries).padStart(5)}`,
      `  textures       ${String(s.textures).padStart(5)}`,
      memLine,
      `[P] toggle overlay`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Log a structured performance summary to the console.
   * Useful for headless profiling sessions or automated benchmarks.
   */
  logSnapshot(): void {
    console.info('[PerformanceMonitor]', JSON.stringify(this.getSnapshot(), null, 2));
  }
}
