import { StyleRank } from '@/game/StyleMeter';

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

const RANK_ORDER: StyleRank[] = ['D', 'C', 'B', 'A', 'S'];

function rankIndex(r: StyleRank): number {
  return RANK_ORDER.indexOf(r);
}

/**
 * GameOverScreen — full-screen overlay displayed after the player dies.
 *
 * Shows "YOU HAVE FALLEN", final stats (waves survived, total kills, best
 * style rank), and a "FIGHT AGAIN" button that reloads the page.
 *
 * Call `updateBestRank()` every frame to track the highest rank achieved,
 * then call `show()` once (with a delay) when the player dies.
 */
export class GameOverScreen {
  private readonly overlay: HTMLDivElement;
  private shown = false;
  private bestRank: StyleRank = 'D';

  constructor() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(5, 5, 10, 0.88)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '150',
      fontFamily: FONT_FAMILY,
      opacity: '0',
      transition: 'opacity 0.5s ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.overlay);
  }

  /** Track the highest style rank achieved — call every frame. */
  updateBestRank(rank: StyleRank): void {
    if (rankIndex(rank) > rankIndex(this.bestRank)) {
      this.bestRank = rank;
    }
  }

  /**
   * Build and fade in the game-over UI.
   * @param wavesSurvived  Value of `waves.currentWave` at death.
   * @param totalKills     Value of `waves.totalKills` at death.
   */
  show(wavesSurvived: number, totalKills: number): void {
    if (this.shown) return;
    this.shown = true;

    // ── "YOU HAVE FALLEN" title ──────────────────────────────────────────────
    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: 'clamp(30px, 6.5vw, 80px)',
      fontWeight: 'bold',
      letterSpacing: '0.18em',
      color: '#c0392b',
      textShadow: '0 0 30px rgba(192,57,43,0.9), 0 0 60px rgba(232,213,160,0.25), 0 3px 8px rgba(0,0,0,1)',
      marginBottom: '44px',
    });
    title.textContent = 'YOU HAVE FALLEN';

    // ── Stats block ──────────────────────────────────────────────────────────
    const stats = document.createElement('div');
    Object.assign(stats.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '14px',
      marginBottom: '52px',
      fontSize: 'clamp(13px, 2.2vw, 22px)',
      letterSpacing: '0.14em',
    });

    const makeRow = (label: string, value: string): HTMLDivElement => {
      const row = document.createElement('div');
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:#8a7a5a;margin-right:18px;';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.style.cssText = 'color:#e8d5a0;font-weight:bold;';
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    };

    stats.appendChild(makeRow('WAVES SURVIVED', String(wavesSurvived)));
    stats.appendChild(makeRow('TOTAL KILLS', String(totalKills)));
    stats.appendChild(makeRow('BEST STYLE RANK', this.bestRank));

    // ── Restart button ───────────────────────────────────────────────────────
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      padding: '14px 48px',
      fontSize: 'clamp(13px, 1.9vw, 20px)',
      letterSpacing: '0.3em',
      fontFamily: FONT_FAMILY,
      textTransform: 'uppercase',
      background: 'rgba(192,57,43,0.18)',
      border: '2px solid rgba(192,57,43,0.65)',
      color: '#e8d5a0',
      cursor: 'pointer',
      borderRadius: '3px',
      transition: 'background 0.2s ease, border-color 0.2s ease',
    });
    btn.textContent = 'FIGHT AGAIN';

    btn.addEventListener('pointerenter', () => {
      btn.style.background = 'rgba(192,57,43,0.48)';
      btn.style.borderColor = '#e8d5a0';
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.background = 'rgba(192,57,43,0.18)';
      btn.style.borderColor = 'rgba(192,57,43,0.65)';
    });
    btn.addEventListener('click', () => {
      window.location.reload();
    });

    // ── Assemble ─────────────────────────────────────────────────────────────
    this.overlay.appendChild(title);
    this.overlay.appendChild(stats);
    this.overlay.appendChild(btn);
    this.overlay.style.pointerEvents = 'auto';

    // Double rAF ensures the transition fires after the element is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.overlay.style.opacity = '1';
      });
    });
  }
}
