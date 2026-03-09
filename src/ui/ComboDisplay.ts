/**
 * ComboDisplay — right-side combo counter and style rank display.
 *
 * Shows the current hit count and rank letter during combat.
 * The number "pops" on each hit. Fades out after 4 seconds of no activity.
 */

import { StyleRank } from '@/game/StyleMeter';

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

const RANK_COLORS: Record<StyleRank, string> = {
  D: '#8a7a5a',
  C: '#b0c0d0',
  B: '#5ab05a',
  A: '#e8d5a0',
  S: '#c0392b',
};

const RANK_GLOW: Record<StyleRank, string> = {
  D: 'none',
  C: '0 0 8px rgba(176,192,208,0.6)',
  B: '0 0 12px rgba(90,176,90,0.7)',
  A: '0 0 20px rgba(232,213,160,0.9)',
  S: '0 0 30px rgba(192,57,43,1), 0 0 60px rgba(255,80,20,0.5)',
};

export class ComboDisplay {
  private readonly container: HTMLDivElement;
  private readonly numberEl: HTMLDivElement;
  private readonly rankEl: HTMLDivElement;

  private fadeTimer = 0;
  private readonly FADE_DELAY = 4.0;
  private readonly FADE_DURATION = 0.5;

  private visible = false;

  constructor() {
    // ── Inject CSS ────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      @keyframes comboPop {
        0%   { transform: scale(1.6); }
        100% { transform: scale(1.0); }
      }
      @keyframes rankFlash {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.4; }
      }
    `;
    document.head.appendChild(style);

    // ── Container ─────────────────────────────────────────────────────────────
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      right: '40px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      pointerEvents: 'none',
      zIndex: '40',
      opacity: '0',
      transition: `opacity ${this.FADE_DURATION}s ease`,
      userSelect: 'none',
    });

    // ── Hit count ─────────────────────────────────────────────────────────────
    this.numberEl = document.createElement('div');
    Object.assign(this.numberEl.style, {
      fontFamily: FONT_FAMILY,
      fontSize: 'clamp(48px, 6vw, 80px)',
      fontWeight: 'bold',
      lineHeight: '1',
      color: '#e8d5a0',
      textShadow: '0 0 20px rgba(232,213,160,0.6), 0 2px 8px rgba(0,0,0,1)',
      letterSpacing: '0.05em',
    });
    this.numberEl.textContent = '0';

    // ── Rank letter ───────────────────────────────────────────────────────────
    this.rankEl = document.createElement('div');
    Object.assign(this.rankEl.style, {
      fontFamily: FONT_FAMILY,
      fontSize: 'clamp(28px, 4vw, 52px)',
      fontWeight: 'bold',
      letterSpacing: '0.1em',
      marginTop: '6px',
    });
    this.rankEl.textContent = 'D';

    this.container.appendChild(this.numberEl);
    this.container.appendChild(this.rankEl);
    document.body.appendChild(this.container);
  }

  /** Call when the player lands a hit. */
  onHit(comboCount: number, rank: StyleRank): void {
    this.numberEl.textContent = String(comboCount);
    this.applyRank(rank);

    // Show
    this.visible = true;
    this.container.style.opacity = '1';
    this.fadeTimer = this.FADE_DELAY;

    // Pop animation
    this.numberEl.style.animation = 'none';
    void this.numberEl.offsetWidth; // reflow
    this.numberEl.style.animation = `comboPop 0.18s ease-out forwards`;

    // Flash rank for A/S
    if (rank === 'A' || rank === 'S') {
      this.rankEl.style.animation = 'none';
      void this.rankEl.offsetWidth;
      this.rankEl.style.animation = 'rankFlash 0.3s ease-in-out 3';
    } else {
      this.rankEl.style.animation = 'none';
    }
  }

  /** Call every visual frame. */
  update(delta: number, currentRank: StyleRank): void {
    if (!this.visible) return;

    // Keep rank display current even without hits
    this.applyRank(currentRank);

    this.fadeTimer -= delta;
    if (this.fadeTimer <= 0) {
      this.container.style.opacity = '0';
      this.visible = false;
    }
  }

  private applyRank(rank: StyleRank): void {
    this.rankEl.textContent  = rank;
    this.rankEl.style.color  = RANK_COLORS[rank];
    this.rankEl.style.textShadow = RANK_GLOW[rank];
  }
}
