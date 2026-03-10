/**
 * LevelHUD — a small XP bar below the health/stamina bars.
 * Shows "LV N" label. Flashes gold on level-up.
 */
export class LevelHUD {
  private readonly container: HTMLElement;
  private readonly label: HTMLElement;
  private readonly barFill: HTMLElement;
  private flashTimer = 0;

  constructor() {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '140px',
      left: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none',
      zIndex: '20',
    });

    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      color: '#e8d5a0',
      fontFamily: "'Palatino Linotype', Georgia, serif",
      fontSize: '13px',
      fontWeight: 'bold',
      letterSpacing: '0.05em',
      minWidth: '36px',
      textShadow: '0 0 6px rgba(0,0,0,0.9)',
    });
    this.label.textContent = 'LV 1';

    const barTrack = document.createElement('div');
    Object.assign(barTrack.style, {
      width: '160px',
      height: '8px',
      background: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(200,170,80,0.4)',
      borderRadius: '4px',
      overflow: 'hidden',
    });

    this.barFill = document.createElement('div');
    Object.assign(this.barFill.style, {
      height: '100%',
      width: '0%',
      background: 'linear-gradient(90deg, #c8a030, #ffe060)',
      borderRadius: '4px',
      transition: 'width 0.3s ease',
    });

    barTrack.appendChild(this.barFill);
    this.container.appendChild(this.label);
    this.container.appendChild(barTrack);
    document.body.appendChild(this.container);
  }

  /**
   * Call every frame.
   * @param level       Current level (1–10).
   * @param xpFraction  0–1 fill of current level bar.
   * @param delta       Frame delta in seconds.
   */
  update(level: number, xpFraction: number, delta: number): void {
    this.label.textContent = `LV ${level}`;
    this.barFill.style.width = `${Math.round(xpFraction * 100)}%`;

    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      const t = Math.max(0, this.flashTimer / 0.6);
      this.barFill.style.background = `linear-gradient(90deg, #ffe060 ${Math.round(t * 100)}%, #c8a030)`;
      this.barFill.style.boxShadow = `0 0 ${Math.round(t * 12)}px rgba(255,220,60,0.8)`;
    } else {
      this.barFill.style.background = 'linear-gradient(90deg, #c8a030, #ffe060)';
      this.barFill.style.boxShadow = 'none';
    }
  }

  /** Call when a level-up occurs — flashes the bar gold. */
  onLevelUp(): void {
    this.flashTimer = 0.6;
  }
}
