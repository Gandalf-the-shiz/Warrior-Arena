import type { BossEnemy, BossPhase } from '@/game/BossEnemy';

/**
 * Large health bar at the bottom-center of the screen for boss enemies.
 * Shows boss name, current phase, and health percentage.
 */
export class BossHealthBar {
  private readonly container: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barTrack: HTMLElement;
  private visible = false;

  constructor() {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '48px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '420px',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      pointerEvents: 'none',
      zIndex: '40',
      userSelect: 'none',
    });

    // Boss name
    this.nameEl = document.createElement('div');
    Object.assign(this.nameEl.style, {
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      fontSize: '20px',
      fontWeight: 'bold',
      letterSpacing: '0.25em',
      color: '#e8d5a0',
      textShadow: '0 0 18px rgba(200,60,60,0.9), 0 2px 4px rgba(0,0,0,1)',
      textTransform: 'uppercase',
    });
    this.nameEl.textContent = 'DARK CHAMPION';

    // Phase indicator
    this.phaseEl = document.createElement('div');
    Object.assign(this.phaseEl.style, {
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      fontSize: '12px',
      letterSpacing: '0.15em',
      color: '#c0392b',
      textShadow: '0 0 8px rgba(200,60,60,0.7)',
      textTransform: 'uppercase',
    });
    this.phaseEl.textContent = 'Phase I';

    // Health bar track
    this.barTrack = document.createElement('div');
    Object.assign(this.barTrack.style, {
      width: '100%',
      height: '16px',
      background: 'rgba(5,5,10,0.85)',
      border: '2px solid rgba(200,60,60,0.7)',
      borderRadius: '3px',
      overflow: 'hidden',
      boxShadow: '0 0 12px rgba(200,60,60,0.4)',
    });

    // Health fill
    this.barFill = document.createElement('div');
    Object.assign(this.barFill.style, {
      height: '100%',
      width: '100%',
      background: 'linear-gradient(90deg, #8b0000, #c0392b, #e74c3c)',
      transition: 'width 0.08s linear',
      borderRadius: '2px',
    });

    this.barTrack.appendChild(this.barFill);
    this.container.appendChild(this.nameEl);
    this.container.appendChild(this.phaseEl);
    this.container.appendChild(this.barTrack);
    document.body.appendChild(this.container);
  }

  /** Show the boss health bar. */
  show(): void {
    this.visible = true;
    this.container.style.display = 'flex';
  }

  /** Hide the boss health bar. */
  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  /** Update the bar display from the boss state. */
  update(boss: BossEnemy): void {
    if (!this.visible) return;

    const pct = Math.max(0, boss.hp / boss.maxHp);
    this.barFill.style.width = `${pct * 100}%`;

    // Phase labels
    const phaseLabels: Record<BossPhase, string> = {
      1: 'Phase I — The Dark Champion stirs',
      2: 'Phase II — The ground trembles',
      3: 'Phase III — ENRAGED',
    } as Record<BossPhase, string>;

    // Import BossPhase values inline
    const phase = boss.phase as number;
    this.phaseEl.textContent = phaseLabels[phase as BossPhase] ?? '';

    // Phase 3 — make the bar pulse red
    if (phase >= 3) {
      const pulse = 0.5 + Math.sin(performance.now() * 0.006) * 0.5;
      this.barFill.style.background =
        `linear-gradient(90deg, #8b0000, rgba(220,${Math.round(40 + pulse * 60)},${Math.round(40 + pulse * 20)},1), #ff4444)`;
    } else {
      this.barFill.style.background =
        'linear-gradient(90deg, #8b0000, #c0392b, #e74c3c)';
    }
  }
}
