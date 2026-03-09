/**
 * ScreenEffects — DOM overlay providing screen-space post-processing effects:
 *
 *  - Low-health vignette (pulsing red border when HP < 30%)
 *  - Damage flash (red, 0.1 s)
 *  - Heal flash (green, 0.15 s)
 *  - Power-up aura (gold border while damage boost is active)
 *
 * All effects share a single fixed overlay div for minimal DOM reflows.
 * GPU-accelerated properties (opacity, box-shadow) are used for performance.
 */

export class ScreenEffects {
  private readonly overlay: HTMLDivElement;

  // ── Flash state ──────────────────────────────────────────────────────────
  private flashTimer    = 0;
  private flashDuration = 0;
  private flashColor    = 'rgba(192,57,43,0)';

  // ── Vignette pulse ───────────────────────────────────────────────────────
  private vignettePhase = 0;

  constructor() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '60',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(this.overlay);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Trigger a red damage flash. */
  flashDamage(): void {
    this.flashTimer    = 0.1;
    this.flashDuration = 0.1;
    this.flashColor    = 'rgba(192,57,43,';
  }

  /** Trigger a green heal flash. */
  flashHeal(): void {
    this.flashTimer    = 0.15;
    this.flashDuration = 0.15;
    this.flashColor    = 'rgba(26,188,156,';
  }

  /**
   * Update all effects each frame.
   *
   * @param delta          Frame delta in seconds.
   * @param hp             Current player HP.
   * @param maxHp          Maximum player HP.
   * @param damageMultiplier Current damage multiplier (> 1 = boost active).
   */
  update(delta: number, hp: number, maxHp: number, damageMultiplier: number): void {
    this.vignettePhase += delta * 2.5; // pulse frequency

    const hpRatio  = maxHp > 0 ? hp / maxHp : 1;
    const isLowHp  = hpRatio < 0.3;
    const hasBoost = damageMultiplier > 1.0;

    // ── Build box-shadow layers ───────────────────────────────────────────────
    const shadows: string[] = [];

    // 1. Low-HP vignette
    if (isLowHp) {
      const severity = 1 - hpRatio / 0.3; // 0→1 as HP drops from 30% to 0
      const pulse    = 0.5 + 0.5 * Math.sin(this.vignettePhase);
      const alpha    = (0.35 + severity * 0.45) * (0.6 + 0.4 * pulse);
      const spread   = 60 + severity * 80;
      shadows.push(`inset 0 0 ${spread}px rgba(192,57,43,${alpha.toFixed(3)})`);
    }

    // 2. Damage-boost gold aura
    if (hasBoost) {
      shadows.push('inset 0 0 60px rgba(232,213,160,0.18)');
    }

    this.overlay.style.boxShadow = shadows.length > 0 ? shadows.join(', ') : 'none';

    // ── Flash ─────────────────────────────────────────────────────────────────
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - delta);
      const alpha = (this.flashTimer / this.flashDuration) * 0.55;
      this.overlay.style.backgroundColor = `${this.flashColor}${alpha.toFixed(3)})`;
    } else {
      this.overlay.style.backgroundColor = 'transparent';
    }
  }
}
