/**
 * PauseMenu — pause overlay triggered by the Escape key.
 *
 * Displays over the game scene (rendering continues) and shows:
 *   - "PAUSED" title
 *   - Resume button (or press Escape again)
 *   - Audio volume slider
 *   - Controls reference panel
 *
 * Requires references to AudioManager and GameLoop so it can adjust
 * volume and pause/unpause the update loop.
 */

import { AudioManager } from '@/engine/AudioManager';
import { GameLoop } from '@/engine/GameLoop';
import { InputManager } from '@/engine/InputManager';

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

const CONTROLS: Array<[string, string]> = [
  ['WASD',      'Move'],
  ['Mouse',     'Look'],
  ['LMB',       'Light Attack'],
  ['RMB / E',   'Heavy Attack'],
  ['Shift',     'Dodge'],
  ['Space',     'Jump'],
  ['Esc',       'Pause'],
];

export class PauseMenu {
  private readonly overlay: HTMLDivElement;
  private paused = false;
  private loop: GameLoop | null = null;

  constructor(
    private readonly audio: AudioManager,
    private readonly input: InputManager,
  ) {
    // ── Inject slider CSS ─────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      .pause-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 180px;
        height: 4px;
        background: rgba(232,213,160,0.3);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        accent-color: #e8d5a0;
      }
      .pause-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #e8d5a0;
        cursor: pointer;
      }
      .pause-btn {
        padding: 12px 40px;
        font-family: ${FONT_FAMILY};
        font-size: clamp(12px, 1.8vw, 18px);
        letter-spacing: 0.3em;
        text-transform: uppercase;
        background: rgba(232,213,160,0.10);
        border: 2px solid rgba(232,213,160,0.45);
        color: #e8d5a0;
        cursor: pointer;
        border-radius: 3px;
        transition: background 0.2s ease, border-color 0.2s ease;
        pointer-events: auto;
      }
      .pause-btn:hover {
        background: rgba(232,213,160,0.28);
        border-color: #e8d5a0;
      }
    `;
    document.head.appendChild(style);

    // ── Overlay ───────────────────────────────────────────────────────────────
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(5,5,10,0.78)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '120',
      fontFamily: FONT_FAMILY,
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease',
    });

    // ── Title ─────────────────────────────────────────────────────────────────
    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: 'clamp(36px, 6vw, 72px)',
      fontWeight: 'bold',
      letterSpacing: '0.35em',
      color: '#e8d5a0',
      textShadow: '0 0 30px rgba(232,213,160,0.7), 0 2px 8px rgba(0,0,0,1)',
      marginBottom: '40px',
    });
    title.textContent = 'PAUSED';
    this.overlay.appendChild(title);

    // ── Volume row ────────────────────────────────────────────────────────────
    const volumeRow = document.createElement('div');
    Object.assign(volumeRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      marginBottom: '36px',
    });

    const volLabel = document.createElement('div');
    Object.assign(volLabel.style, {
      fontSize: 'clamp(11px, 1.6vw, 14px)',
      letterSpacing: '0.25em',
      color: '#8a7a5a',
      textTransform: 'uppercase',
    });
    volLabel.textContent = 'Volume';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '0';
    slider.max   = '100';
    slider.value = '70'; // matches AudioManager default gain 0.7
    slider.className = 'pause-slider';
    slider.style.pointerEvents = 'auto';

    const volValue = document.createElement('div');
    Object.assign(volValue.style, {
      fontSize: 'clamp(11px, 1.6vw, 14px)',
      letterSpacing: '0.1em',
      color: '#e8d5a0',
      minWidth: '36px',
    });
    volValue.textContent = '70%';

    slider.addEventListener('input', () => {
      const vol = Number(slider.value) / 100;
      this.audio.setMasterVolume(vol);
      volValue.textContent = `${slider.value}%`;
    });

    volumeRow.appendChild(volLabel);
    volumeRow.appendChild(slider);
    volumeRow.appendChild(volValue);
    this.overlay.appendChild(volumeRow);

    // ── Controls panel ────────────────────────────────────────────────────────
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'grid',
      gridTemplateColumns: 'auto auto',
      columnGap: '28px',
      rowGap: '8px',
      marginBottom: '44px',
      fontSize: 'clamp(11px, 1.6vw, 14px)',
      letterSpacing: '0.15em',
    });

    for (const [key, desc] of CONTROLS) {
      const keyEl = document.createElement('div');
      Object.assign(keyEl.style, {
        color: '#e8d5a0',
        fontWeight: 'bold',
        textAlign: 'right',
      });
      keyEl.textContent = key;

      const descEl = document.createElement('div');
      descEl.style.color = '#8a7a5a';
      descEl.textContent = desc;

      controls.appendChild(keyEl);
      controls.appendChild(descEl);
    }
    this.overlay.appendChild(controls);

    // ── Resume button ─────────────────────────────────────────────────────────
    const btn = document.createElement('button');
    btn.className = 'pause-btn';
    btn.textContent = 'RESUME';
    btn.addEventListener('click', () => { this.unpause(); });
    this.overlay.appendChild(btn);

    document.body.appendChild(this.overlay);
  }

  /** Must be called with the GameLoop instance after it is created. */
  setGameLoop(loop: GameLoop): void {
    this.loop = loop;
  }

  /** Returns true if the game is currently paused. */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Check for Escape press and toggle pause state.
   * Call once per visual frame from main.ts.
   */
  checkInput(): void {
    if (this.input.isPausePressed()) {
      if (this.paused) {
        this.unpause();
      } else {
        this.pause();
      }
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.audio.playPause();
    if (this.loop) this.loop.pause();
    this.overlay.style.opacity       = '1';
    this.overlay.style.pointerEvents = 'auto';
  }

  unpause(): void {
    if (!this.paused) return;
    this.paused = false;
    this.audio.playUnpause();
    if (this.loop) this.loop.unpause();
    this.overlay.style.opacity       = '0';
    this.overlay.style.pointerEvents = 'none';
  }
}
