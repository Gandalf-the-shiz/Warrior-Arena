/**
 * ScreenEffects — DOM overlay providing screen-space post-processing effects:
 *
 *  - Low-health vignette (pulsing red border when HP < 30%)
 *  - Damage flash (red, 0.1 s)
 *  - Heal flash (green, 0.15 s)
 *  - Power-up aura (gold border while damage boost is active)
 *  - Speed lines (radial lines during dash attack)
 *  - Impact frame (white flash on heavy attack connect)
 *  - Blood moon tint (permanent red edge tint during Blood Moon weather)
 *
 * All effects share a single fixed overlay div for minimal DOM reflows.
 * GPU-accelerated properties (opacity, box-shadow) are used for performance.
 */

export class ScreenEffects {
  private readonly overlay: HTMLDivElement;
  private readonly speedLinesCanvas: HTMLCanvasElement;
  private readonly speedLinesCtx: CanvasRenderingContext2D;

  // ── Flash state ──────────────────────────────────────────────────────────
  private flashTimer    = 0;
  private flashDuration = 0;
  private flashColor    = 'rgba(192,57,43,0)';

  // ── Vignette pulse ───────────────────────────────────────────────────────
  private vignettePhase = 0;

  // ── Speed lines state ────────────────────────────────────────────────────
  private speedLinesTimer = 0;
  private readonly SPEED_LINES_DURATION = 0.35;

  // ── Impact frame ─────────────────────────────────────────────────────────
  private impactFrameTimer = 0;

  // ── Blood moon tint ──────────────────────────────────────────────────────
  private bloodMoonActive = false;
  private readonly bloodMoonOverlay: HTMLDivElement;

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

    // ── Speed lines canvas ───────────────────────────────────────────────
    this.speedLinesCanvas = document.createElement('canvas');
    Object.assign(this.speedLinesCanvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '61',
      opacity: '0',
    });
    this.speedLinesCanvas.width = 800;
    this.speedLinesCanvas.height = 800;
    document.body.appendChild(this.speedLinesCanvas);
    this.speedLinesCtx = this.speedLinesCanvas.getContext('2d')!;

    // ── Blood moon permanent edge tint overlay ───────────────────────────
    this.bloodMoonOverlay = document.createElement('div');
    Object.assign(this.bloodMoonOverlay.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '59',
      boxShadow: 'inset 0 0 120px rgba(180,20,10,0.35)',
      opacity: '0',
      transition: 'opacity 2s ease',
    });
    document.body.appendChild(this.bloodMoonOverlay);
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

  /** Trigger radial speed-lines effect (use during dash attack). */
  triggerSpeedLines(): void {
    this.speedLinesTimer = this.SPEED_LINES_DURATION;
    this.drawSpeedLines();
  }

  /** Trigger a single-frame white impact flash (use on heavy attack connect). */
  triggerImpactFrame(): void {
    this.impactFrameTimer = 0.06; // one or two frames at 60fps
  }

  /** Activate or deactivate the blood moon permanent red edge tint. */
  setBloodMoon(active: boolean): void {
    if (this.bloodMoonActive === active) return;
    this.bloodMoonActive = active;
    this.bloodMoonOverlay.style.opacity = active ? '1' : '0';
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
    if (this.impactFrameTimer > 0) {
      // Impact frame: bright white overlay takes priority
      this.impactFrameTimer = Math.max(0, this.impactFrameTimer - delta);
      const alpha = (this.impactFrameTimer / 0.06) * 0.80;
      this.overlay.style.backgroundColor = `rgba(255,255,255,${alpha.toFixed(3)})`;
    } else if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - delta);
      const alpha = (this.flashTimer / this.flashDuration) * 0.55;
      this.overlay.style.backgroundColor = `${this.flashColor}${alpha.toFixed(3)})`;
    } else {
      this.overlay.style.backgroundColor = 'transparent';
    }

    // ── Speed lines ───────────────────────────────────────────────────────────
    if (this.speedLinesTimer > 0) {
      this.speedLinesTimer = Math.max(0, this.speedLinesTimer - delta);
      const alpha = (this.speedLinesTimer / this.SPEED_LINES_DURATION) * 0.75;
      this.speedLinesCanvas.style.opacity = alpha.toFixed(3);
    } else {
      this.speedLinesCanvas.style.opacity = '0';
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private drawSpeedLines(): void {
    const ctx = this.speedLinesCtx;
    const w = this.speedLinesCanvas.width;
    const h = this.speedLinesCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    const lineCount = 32;
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2;
      const innerR = 40 + Math.random() * 30;
      const outerR = 180 + Math.random() * 80;
      const lineWidth = 1 + Math.random() * 2.5;

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + Math.random() * 0.5})`;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }
}
