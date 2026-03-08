/**
 * Lightweight run-state overlays: Title screen and Game-Over screen.
 * DOM-only, no canvas drawing.
 */
export class MetaUI {
  private readonly titleEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;

  constructor(
    private readonly onStart: () => void,
    private readonly onRestart: () => void,
  ) {
    this.titleEl   = this.buildTitleScreen();
    this.gameOverEl = this.buildGameOverScreen();
  }

  /** Show the title / start screen. */
  showTitle(): void {
    this.titleEl.style.display   = 'flex';
    this.gameOverEl.style.display = 'none';
  }

  /** Show the game-over screen with final stats. */
  showGameOver(kills: number, wave: number): void {
    this.titleEl.style.display   = 'none';
    this.gameOverEl.style.display = 'flex';
    const statsEl = this.gameOverEl.querySelector<HTMLElement>('.go-stats');
    if (statsEl) {
      statsEl.textContent = `Wave ${wave}  ·  ${kills} kills`;
    }
  }

  /** Hide all overlays (enter playing state). */
  hide(): void {
    this.titleEl.style.display   = 'none';
    this.gameOverEl.style.display = 'none';
  }

  // ── Private builders ─────────────────────────────────────────────────────

  private buildTitleScreen(): HTMLElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position:       'fixed',
      inset:          '0',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'rgba(0,0,0,0.84)',
      zIndex:         '50',
      fontFamily:     "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      color:          '#e8d5a0',
      pointerEvents:  'auto',
    });

    el.innerHTML = `
      <div style="font-size:clamp(36px,8vw,80px);font-weight:bold;letter-spacing:0.3em;text-transform:uppercase;text-shadow:0 0 40px rgba(255,100,30,0.9),0 4px 8px rgba(0,0,0,1);">Warrior Arena</div>
      <div style="font-size:clamp(12px,2.2vw,18px);letter-spacing:0.22em;color:#a88a60;margin-top:12px;text-transform:uppercase;">Survive the endless horde</div>
      <div style="margin-top:44px;display:flex;flex-direction:column;align-items:center;gap:7px;font-size:clamp(10px,1.6vw,13px);letter-spacing:0.14em;color:#666;text-transform:uppercase;">
        <span>WASD / Left Stick — Move</span>
        <span>Mouse Drag / Right Stick — Camera</span>
        <span>Left Click / ⚔️ — Attack &nbsp;|&nbsp; Hold — Heavy Attack</span>
        <span>Space / Shift — Dodge</span>
      </div>
      <button id="meta-start-btn" style="margin-top:52px;padding:14px 44px;font-family:inherit;font-size:clamp(13px,1.9vw,17px);letter-spacing:0.25em;text-transform:uppercase;background:rgba(180,80,20,0.22);border:1px solid rgba(230,180,80,0.45);color:#e8d5a0;cursor:pointer;border-radius:2px;touch-action:manipulation;outline:none;">Enter Arena</button>
    `;

    document.body.appendChild(el);

    const btn = el.querySelector<HTMLButtonElement>('#meta-start-btn');
    if (!btn) throw new Error('MetaUI: #meta-start-btn not found in title screen');
    btn.addEventListener('click', () => { this.onStart(); });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); this.onStart(); });

    return el;
  }

  private buildGameOverScreen(): HTMLElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position:       'fixed',
      inset:          '0',
      display:        'none',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'rgba(0,0,0,0.80)',
      zIndex:         '50',
      fontFamily:     "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      color:          '#e8d5a0',
      pointerEvents:  'auto',
    });

    el.innerHTML = `
      <div style="font-size:clamp(40px,8vw,80px);font-weight:bold;letter-spacing:0.3em;text-transform:uppercase;color:#c0392b;text-shadow:0 0 40px rgba(192,57,43,0.9),0 4px 8px rgba(0,0,0,1);">Fallen</div>
      <div class="go-stats" style="font-size:clamp(13px,1.9vw,17px);letter-spacing:0.2em;color:#a88a60;margin-top:14px;text-transform:uppercase;"></div>
      <button id="meta-restart-btn" style="margin-top:52px;padding:14px 44px;font-family:inherit;font-size:clamp(13px,1.9vw,17px);letter-spacing:0.25em;text-transform:uppercase;background:rgba(180,80,20,0.22);border:1px solid rgba(230,180,80,0.45);color:#e8d5a0;cursor:pointer;border-radius:2px;touch-action:manipulation;outline:none;">Rise Again</button>
    `;

    document.body.appendChild(el);

    const btn = el.querySelector<HTMLButtonElement>('#meta-restart-btn');
    if (!btn) throw new Error('MetaUI: #meta-restart-btn not found in game-over screen');
    btn.addEventListener('click', () => { this.onRestart(); });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); this.onRestart(); });

    return el;
  }
}
