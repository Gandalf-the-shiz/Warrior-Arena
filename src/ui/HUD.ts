/**
 * Pure HTML/CSS HUD — no canvas drawing.
 * Manages health bar, stamina bar, wave counter, kill counter and style meter.
 */
export class HUD {
  private readonly healthFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly waveNum: HTMLElement;
  private readonly killCount: HTMLElement;
  private readonly styleMeterEl: HTMLElement;
  private readonly comboCountEl: HTMLElement;
  private readonly styleMultEl: HTMLElement;
  private readonly scoreValueEl: HTMLElement;

  constructor() {
    this.healthFill = this.getEl('health-fill');
    this.staminaFill = this.getEl('stamina-fill');
    this.waveNum = this.getEl('wave-num');
    this.killCount = this.getEl('kill-count');
    this.styleMeterEl = this.getEl('style-rank');
    this.comboCountEl = this.getEl('combo-count');
    this.styleMultEl = this.getEl('style-multiplier');
    this.scoreValueEl = this.getEl('score-value');
  }

  /** Update the health bar (0 – max). */
  updateHealth(current: number, max: number): void {
    const pct = Math.max(0, Math.min(1, current / max)) * 100;
    this.healthFill.style.width = `${pct}%`;
  }

  /** Update the stamina bar (0 – max). */
  updateStamina(current: number, max: number): void {
    const pct = Math.max(0, Math.min(1, current / max)) * 100;
    this.staminaFill.style.width = `${pct}%`;
  }

  /** Update the wave counter label. */
  updateWave(num: number): void {
    this.waveNum.textContent = String(num);
  }

  /** Update the kill counter label. */
  updateKills(num: number): void {
    this.killCount.textContent = String(num);
  }

  /** Update the score display. */
  updateScore(score: number): void {
    this.scoreValueEl.textContent = String(score);
  }

  /** Update the combo hit counter and multiplier badge. */
  updateCombo(combo: number, multiplier: number): void {
    this.comboCountEl.textContent = combo > 0 ? `${combo} HIT${combo === 1 ? '' : 'S'}` : '';
    const multLabel = multiplier > 1 ? `×${multiplier % 1 === 0 ? multiplier : multiplier.toFixed(1)}` : '';
    this.styleMultEl.textContent = multLabel;
  }

  /** Update the style rank display. */
  updateStyleRank(rank: string): void {
    this.styleMeterEl.textContent = rank;
    // Colour by rank
    const colors: Record<string, string> = {
      D: '#888',
      C: '#ddd',
      B: '#ffdd44',
      A: '#ff8800',
      S: '#ff2200',
    };
    const glows: Record<string, string> = {
      D: 'none',
      C: '0 0 8px rgba(255,255,255,0.6)',
      B: '0 0 14px rgba(255,220,40,0.9)',
      A: '0 0 18px rgba(255,130,0,0.9)',
      S: '0 0 24px rgba(255,20,0,1), 0 0 48px rgba(255,20,0,0.6)',
    };
    this.styleMeterEl.style.color = colors[rank] ?? '#888';
    this.styleMeterEl.style.textShadow = glows[rank] ?? 'none';
  }

  /**
   * Trigger a brief scale-pulse animation on the style rank letter.
   * Called whenever the rank changes to give tactile feedback.
   */
  pulseRank(): void {
    this.styleMeterEl.classList.remove('rank-pulse');
    // Force reflow to restart animation
    void this.styleMeterEl.offsetWidth;
    this.styleMeterEl.classList.add('rank-pulse');
  }

  private getEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`HUD element #${id} not found`);
    return el;
  }
}
