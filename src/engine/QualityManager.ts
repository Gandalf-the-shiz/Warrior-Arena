/**
 * QualityManager — adaptive quality tier system.
 *
 * Manages four visual quality tiers (LOW / MEDIUM / HIGH / ULTRA) and
 * automatically scales them up or down based on sustained frame-time
 * performance.  The guiding principle: prefer stable frame pacing over
 * maximum visual fidelity.
 *
 * ## Tier effects
 * | Feature                    | LOW  | MEDIUM | HIGH | ULTRA |
 * |----------------------------|------|--------|------|-------|
 * | Pixel ratio                | 0.75 | 1.0    | 1.5  | DPR   |
 * | Shadows                    | off  | on     | on   | on    |
 * | Bloom                      | off  | on     | on   | on    |
 * | Chromatic aberration       | off  | off    | on   | on    |
 * | Film grain                 | off  | off    | on   | on    |
 * | Post-processing            | off  | on     | on   | on    |
 * | UI update frequency        | 4 Hz | 10 Hz  | 20Hz | 60Hz  |
 * | Enemy health bar update Hz | 4    | 10     | 20   | 60    |
 *
 * ## Adaptive rules
 * - If the rolling-average frame time exceeds `DEGRADE_THRESHOLD_MS` for
 *   `DEGRADE_HOLD_S` consecutive seconds → drop one tier.
 * - If the rolling-average frame time stays below `ESCALATE_THRESHOLD_MS`
 *   for `ESCALATE_HOLD_S` consecutive seconds → raise one tier.
 * - A minimum `CHANGE_COOLDOWN_S` prevents thrashing.
 */

export type QualityTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface QualitySettings {
  tier: QualityTier;
  /** Renderer pixel ratio (device-pixel-ratio multiplier). */
  pixelRatio: number;
  shadowsEnabled: boolean;
  /** Whether the EffectComposer post-processing chain should run. */
  postProcessingEnabled: boolean;
  bloomEnabled: boolean;
  chromaticAberrationEnabled: boolean;
  filmGrainEnabled: boolean;
  /** Minimum interval between expensive UI updates (seconds). */
  uiUpdateInterval: number;
  /** Minimum interval for enemy health bar updates (seconds). */
  healthBarUpdateInterval: number;
}

// ── Adaptive thresholds ────────────────────────────────────────────────────

/** Rolling-average ms above which we consider performance degraded. */
const DEGRADE_THRESHOLD_MS   = 22;  // ~45 fps sustained
/** Seconds above the threshold before dropping a tier. */
const DEGRADE_HOLD_S         = 3.0;
/** Rolling-average ms below which we consider performance good enough to escalate. */
const ESCALATE_THRESHOLD_MS  = 14;  // ~70 fps sustained
/** Seconds below the threshold before raising a tier. */
const ESCALATE_HOLD_S        = 8.0;
/** Minimum seconds between any tier change (prevents thrashing). */
const CHANGE_COOLDOWN_S      = 5.0;

// ── Tier definitions ───────────────────────────────────────────────────────

const TIER_SETTINGS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  LOW: {
    pixelRatio:                    0.75,
    shadowsEnabled:                false,
    postProcessingEnabled:         false,
    bloomEnabled:                  false,
    chromaticAberrationEnabled:    false,
    filmGrainEnabled:              false,
    uiUpdateInterval:              1 / 4,
    healthBarUpdateInterval:       1 / 4,
  },
  MEDIUM: {
    pixelRatio:                    1.0,
    shadowsEnabled:                true,
    postProcessingEnabled:         true,
    bloomEnabled:                  true,
    chromaticAberrationEnabled:    false,
    filmGrainEnabled:              false,
    uiUpdateInterval:              1 / 10,
    healthBarUpdateInterval:       1 / 10,
  },
  HIGH: {
    pixelRatio:                    1.5,
    shadowsEnabled:                true,
    postProcessingEnabled:         true,
    bloomEnabled:                  true,
    chromaticAberrationEnabled:    true,
    filmGrainEnabled:              true,
    uiUpdateInterval:              1 / 20,
    healthBarUpdateInterval:       1 / 20,
  },
  ULTRA: {
    // pixelRatio is resolved dynamically from devicePixelRatio at apply-time
    pixelRatio:                    2.0,
    shadowsEnabled:                true,
    postProcessingEnabled:         true,
    bloomEnabled:                  true,
    chromaticAberrationEnabled:    true,
    filmGrainEnabled:              true,
    uiUpdateInterval:              0,    // every frame
    healthBarUpdateInterval:       0,
  },
};

// ── Tier ordering ──────────────────────────────────────────────────────────
const TIER_ORDER: QualityTier[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

// ── Device detection helpers ──────────────────────────────────────────────

/** Guess a sensible default tier from device characteristics. */
function detectInitialTier(): QualityTier {
  if (typeof window === 'undefined') return 'MEDIUM';
  const dpr   = window.devicePixelRatio ?? 1;
  const cores = navigator.hardwareConcurrency ?? 4;

  // Mobile or low-DPI, low-core: start at MEDIUM for safety
  if (dpr < 1.5 && cores <= 4) return 'MEDIUM';
  // High-end desktop: start at HIGH
  if (dpr >= 2 || cores >= 8)  return 'HIGH';
  return 'MEDIUM';
}

export class QualityManager {
  private _tier: QualityTier;
  private degradeAccum  = 0;
  private escalateAccum = 0;
  private changeCooldown = 0;
  /** Whether automatic tier adaptation is enabled. */
  adaptiveEnabled = true;

  /** Fired whenever the tier changes.  Consumers should apply changes. */
  onTierChange?: (settings: QualitySettings) => void;

  constructor(initialTier?: QualityTier) {
    this._tier = initialTier ?? detectInitialTier();
  }

  get tier(): QualityTier { return this._tier; }

  getSettings(): QualitySettings {
    const base = TIER_SETTINGS[this._tier];
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
    const pixelRatio = this._tier === 'ULTRA'
      ? Math.min(dpr, 2)
      : base.pixelRatio;
    return { ...base, pixelRatio, tier: this._tier };
  }

  /** Force a specific tier immediately, disabling adaptive scaling. */
  setTier(tier: QualityTier): void {
    if (this._tier === tier) return;
    this._tier = tier;
    this.degradeAccum  = 0;
    this.escalateAccum = 0;
    this.changeCooldown = CHANGE_COOLDOWN_S;
    this.onTierChange?.(this.getSettings());
  }

  /**
   * Call once per frame with the current rolling-average frame time (ms).
   * Drives automatic tier adjustment.
   * @param delta          Frame delta in seconds (real time, not game time).
   * @param frameTimeAvgMs Rolling-average frame time in ms.
   */
  update(delta: number, frameTimeAvgMs: number): void {
    if (!this.adaptiveEnabled) return;

    if (this.changeCooldown > 0) {
      this.changeCooldown -= delta;
      return;
    }

    const tierIdx = TIER_ORDER.indexOf(this._tier);

    if (frameTimeAvgMs > DEGRADE_THRESHOLD_MS) {
      this.escalateAccum = 0;
      this.degradeAccum += delta;
      if (this.degradeAccum >= DEGRADE_HOLD_S && tierIdx > 0) {
        this._tier = TIER_ORDER[tierIdx - 1]!;
        this.degradeAccum  = 0;
        this.changeCooldown = CHANGE_COOLDOWN_S;
        console.info(`[QualityManager] Degraded to ${this._tier} (avg ${frameTimeAvgMs.toFixed(1)} ms)`);
        this.onTierChange?.(this.getSettings());
      }
    } else if (frameTimeAvgMs < ESCALATE_THRESHOLD_MS) {
      this.degradeAccum = 0;
      this.escalateAccum += delta;
      if (this.escalateAccum >= ESCALATE_HOLD_S && tierIdx < TIER_ORDER.length - 1) {
        this._tier = TIER_ORDER[tierIdx + 1]!;
        this.escalateAccum = 0;
        this.changeCooldown = CHANGE_COOLDOWN_S;
        console.info(`[QualityManager] Escalated to ${this._tier} (avg ${frameTimeAvgMs.toFixed(1)} ms)`);
        this.onTierChange?.(this.getSettings());
      }
    } else {
      // Within the comfortable band — decay both accumulators toward zero
      this.degradeAccum  = Math.max(0, this.degradeAccum  - delta);
      this.escalateAccum = Math.max(0, this.escalateAccum - delta);
    }
  }
}
