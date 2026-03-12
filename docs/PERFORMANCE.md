# Performance Architecture

> This document describes the performance, stability, and adaptive quality
> systems introduced in the performance/stability upgrade PR.

---

## Table of Contents

1. [Overview](#overview)
2. [Quality Tiers](#quality-tiers)
3. [Adaptive Scaling Rules](#adaptive-scaling-rules)
4. [Performance Instrumentation](#performance-instrumentation)
5. [GameLoop Resilience](#gameloop-resilience)
6. [Error Handling](#error-handling)
7. [PlayerController Optimizations](#playercontroller-optimizations)
8. [Profiling and Debugging](#profiling-and-debugging)
9. [Known Trade-offs and Limitations](#known-trade-offs-and-limitations)

---

## Overview

The game runs on a **fixed-timestep physics loop** at 60 Hz combined with a
**variable-rate render loop** driven by `requestAnimationFrame`.  Three.js
provides the WebGL renderer with a full post-processing pipeline.

This upgrade adds:

| Component | Purpose |
|---|---|
| `src/engine/PerformanceMonitor.ts` | FPS, per-phase frame timing, renderer stats, memory |
| `src/engine/QualityManager.ts` | Adaptive quality tiers (LOW→ULTRA) |
| `src/utils/ErrorHandler.ts` | Centralized graceful error handling |
| Updated `GameLoop.ts` | Fixed-step cap, timing instrumentation |
| Updated `Renderer.ts` | Quality-aware post-processing toggles |
| Updated `PlayerController.ts` | Hot-path allocation elimination |

---

## Quality Tiers

Four tiers are supported.  The active tier is printed to the console when it
changes.  You can force a tier at runtime via the browser console:

```js
// Inside the running game (exposed via QualityManager)
// Tier names: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'
```

| Feature | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| Pixel ratio | 0.75× | 1.0× | 1.5× | native DPR (≤2×) |
| Shadow maps | ❌ | ✅ | ✅ | ✅ |
| Post-processing | ❌ | ✅ | ✅ | ✅ |
| Bloom pass | ❌ | ✅ | ✅ | ✅ |
| Chromatic aberration | ❌ | ❌ | ✅ | ✅ |
| Film grain | ❌ | ❌ | ✅ | ✅ |
| UI update rate | 4 Hz | 10 Hz | 20 Hz | 60 Hz (every frame) |
| Enemy health bar rate | 4 Hz | 10 Hz | 20 Hz | 60 Hz |

**Default tier** is chosen automatically based on device characteristics:

- High-end (DPR ≥ 2 or ≥ 8 logical cores) → **HIGH**
- Low-end (DPR < 1.5 and ≤ 4 cores) → **MEDIUM**
- Everything else → **MEDIUM**

---

## Adaptive Scaling Rules

`QualityManager.update(delta, frameTimeAvgMs)` is called once per rendered
frame.  It uses a hysteresis window to avoid thrashing:

| Condition | Accumulator | Action |
|---|---|---|
| `frameTimeAvg > 22 ms` (~45 fps) sustained for **3 s** | `degradeAccum` | Drop one tier |
| `frameTimeAvg < 14 ms` (~70 fps) sustained for **8 s** | `escalateAccum` | Raise one tier |
| Within the comfortable band | Both decay | No change |
| After any change | 5 s cooldown | Prevents thrashing |

The rolling average fed to the quality manager uses a **60-sample window**
from `PerformanceMonitor.frameTimeAvgMs`.

To disable adaptive scaling:

```ts
quality.adaptiveEnabled = false;
quality.setTier('HIGH'); // fixed
```

---

## Performance Instrumentation

`PerformanceMonitor` is lightweight — all timing uses `performance.now()` and
the only DOM interaction is the debug overlay which is updated at most 10 Hz.

### Debug Overlay

Press **P** in-game to toggle the debug overlay (top-right corner).  It
displays:

```
FPS                 60
frame avg        16.67 ms
frame latest     16.43 ms
enemies              8
── Phases ──────────────────
  update          6.12 ms
  fixedUpdate     1.88 ms
  render          3.44 ms
── Renderer ────────────────
  draw calls        142
  triangles       48320
  geometries         34
  textures           22
  heap          120 / 4096 MB
[P] toggle overlay
```

### Programmatic Access

```ts
// Anywhere that has a reference to `perf`
const snap = perf.getSnapshot();
console.log(snap.fps, snap.phases['render']);

// Log full structured snapshot to console
perf.logSnapshot();
```

### Benchmark Hooks

The `GameLoop` now exposes raw phase timing:

```ts
loop.lastUpdateMs      // ms spent in the variable-timestep update last frame
loop.lastFixedUpdateMs // ms spent in all fixed-step physics iterations last frame
loop.lastRenderMs      // ms spent in the render call last frame
```

These are simple number properties, zero overhead when unused.

---

## GameLoop Resilience

### Fixed-step Cap

`MAX_FIXED_STEPS_PER_FRAME = 5` prevents the simulation from catching up
more than 5 physics steps in a single rendered frame.  At the cap, the
remaining accumulator is **drained** to prevent a subsequent burst.

This bounds the worst-case physics cost to `5 × ~2 ms ≈ 10 ms` even after
a long GC pause or tab-throttle event.

### Delta Clamping

`MAX_DELTA = 0.1 s` is applied before the accumulator, so a single frame
spike can inject at most `0.1 s / (1/60) = 6` physics steps — further
capped to 5 by the step limit above.

### Pause / Unpause Safety

`unpause()` now resets **both** `lastTime` and `accumulator` to zero.  This
prevents the accumulator from filling up during a pause menu session.

---

## Error Handling

`ErrorHandler` (installed early in `main()`) provides:

| API | Use case |
|---|---|
| `ErrorHandler.install()` | Registers global `error` + `unhandledrejection` handlers |
| `ErrorHandler.attempt(fn, label)` | Run optional feature; log and continue on failure |
| `ErrorHandler.attemptAsync(fn, label)` | Async variant |
| `ErrorHandler.localStorageGet/Set/Remove` | Safe localStorage with quota/Security error handling |

Non-critical errors are logged with `console.warn` and labelled; the game
continues running.  Only critical failures (Rapier WASM load, canvas creation)
show the user-visible error overlay.

---

## PlayerController Optimizations

The following hot-path allocations were eliminated:

| Before | After | Savings |
|---|---|---|
| `new THREE.Euler(0, angle, 0)` per fixed-step | Reuse `_cachedEuler` | 1 alloc / physics step |
| `new THREE.Vector3(p.x, p.y, p.z)` per `getPosition()` call | Reuse `_cachedPosition` | ~8 allocs / frame |
| `new THREE.Vector3(0, 0, 1)` per `getForward()` call | Reuse `_cachedForward` | ~4 allocs / frame |
| `new THREE.Euler().setFromQuaternion(...)` per `getFacingYaw()` | Reuse `_cachedEuler` | ~4 allocs / frame |
| `[...states].includes(current)` (Array alloc + iteration) | `static readonly Set.has()` | 0 alloc + O(1) |
| `Math.max(...Array.from(burst.ages))` in dust update | Manual loop over `Float32Array` | 0 alloc + no spread |

> **⚠ Important**: `getPosition()`, `getForward()`, and `getFacingYaw()` now
> return/write to **shared cached objects**.  Callers must consume the value
> immediately and must not store the returned reference across frames.  The
> pattern `const pos = player.getPosition(); doSomething(pos.x, pos.y, pos.z)`
> is safe; `storedRef = player.getPosition()` is not.

---

## Profiling and Debugging

### In-game overlay

Press **P** at any point during gameplay to see the live performance overlay.

### Browser DevTools

1. Open Chrome DevTools → **Performance** tab.
2. Record 5–10 seconds of gameplay.
3. Look for long tasks (red bars) in the main thread.
4. The `update`, `fixedUpdate`, and `render` labels map to the named
   function calls in `main.ts`.

### Heap profiling

Open DevTools → **Memory** tab → **Heap snapshot**.  Compare snapshots
between frames to check for GC pressure.  The overlay's `heap` line provides
a quick sanity check — it should be stable during normal gameplay.

### Quality tier forcing

Open the browser console and call:

```js
// (assuming quality manager is accessible; add window.debugQuality = quality in main.ts for easier access)
```

Or set `quality.adaptiveEnabled = false` and `quality.setTier('LOW')` to test
worst-case visual degradation.

---

## Known Trade-offs and Limitations

| Trade-off | Rationale |
|---|---|
| `getPosition()` returns a shared mutable `Vector3` | Eliminates the most common allocation in the hot path; callers must not cache the reference |
| Adaptive quality uses wall-clock frame time, not GPU time | GPU time requires WebGL timer queries which add their own overhead; wall-clock time is a reliable proxy for the user experience |
| UI updates are throttled globally by tier | Some UI elements (HUD health/stamina) remain at 60 Hz; only minimap and enemy health bars are throttled since they are the most expensive DOM writers |
| Film grain and chromatic aberration are disabled at MEDIUM and below | These passes add ~1–2 ms/frame on mid-range hardware with no gameplay impact |
| `MAX_FIXED_STEPS_PER_FRAME = 5` may cause visible physics jitter on very slow devices | The alternative (no cap) causes total main-thread stalls; 5 steps was chosen to balance recovery speed vs. single-frame cost |
