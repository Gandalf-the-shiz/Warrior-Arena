/**
 * Pure HTML/CSS HUD — no canvas drawing.
 * Manages health bar, stamina bar, wave counter and kill counter.
 */
export class HUD {
  private readonly healthFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly waveNum: HTMLElement;
  private readonly killCount: HTMLElement;

  constructor() {
    this.healthFill = this.getEl('health-fill');
    this.staminaFill = this.getEl('stamina-fill');
    this.waveNum = this.getEl('wave-num');
    this.killCount = this.getEl('kill-count');
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

  private getEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`HUD element #${id} not found`);
    return el;
  }
}
