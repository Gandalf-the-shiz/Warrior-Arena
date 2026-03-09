/**
 * WaveAnnouncer — full-screen dramatic wave announcement overlay.
 *
 * Shows "WAVE N" in massive text with a blood-red → gold gradient,
 * scales in from 1.5× to 1.0× while fading in over 0.5 s, holds for 1.5 s,
 * then fades out over 0.5 s.
 *
 * Boss waves (every 5th) get special gold styling + "ELITE WAVE" prefix.
 */

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

export class WaveAnnouncer {
  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;

  // Timings (seconds)
  private readonly FADE_IN  = 0.5;
  private readonly HOLD     = 1.5;
  private readonly FADE_OUT = 0.5;
  private readonly TOTAL    = this.FADE_IN + this.HOLD + this.FADE_OUT;

  private timer = 0;
  private active = false;

  constructor() {
    // ── Inject keyframe CSS ──────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      @keyframes waveScaleIn {
        from { transform: translate(-50%, -50%) scale(1.5); }
        to   { transform: translate(-50%, -50%) scale(1.0); }
      }
    `;
    document.head.appendChild(style);

    // ── Container overlay ────────────────────────────────────────────────────
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: '80',
      opacity: '0',
    });
    document.body.appendChild(this.overlay);

    // ── Title ────────────────────────────────────────────────────────────────
    this.titleEl = document.createElement('div');
    Object.assign(this.titleEl.style, {
      fontFamily: FONT_FAMILY,
      fontSize: 'clamp(48px, 8vw, 96px)',
      fontWeight: 'bold',
      letterSpacing: '0.25em',
      textTransform: 'uppercase',
      textAlign: 'center',
      lineHeight: '1',
      background: 'linear-gradient(to bottom, #e8d5a0 0%, #c0392b 60%, #7a1a0a 100%)',
      webkitBackgroundClip: 'text',
      webkitTextFillColor: 'transparent',
      backgroundClip: 'text',
      textShadow: 'none',
      filter: 'drop-shadow(0 0 20px rgba(192,57,43,0.8)) drop-shadow(0 0 40px rgba(255,100,30,0.4))',
      marginBottom: '16px',
    });
    this.overlay.appendChild(this.titleEl);

    // ── Subtitle ─────────────────────────────────────────────────────────────
    this.subtitleEl = document.createElement('div');
    Object.assign(this.subtitleEl.style, {
      fontFamily: FONT_FAMILY,
      fontSize: 'clamp(14px, 2.5vw, 26px)',
      letterSpacing: '0.3em',
      textTransform: 'uppercase',
      color: '#8a7a5a',
      textAlign: 'center',
    });
    this.overlay.appendChild(this.subtitleEl);
  }

  /**
   * Trigger the wave announcement.
   * @param wave        Wave number to display.
   * @param composition Human-readable enemy composition string (e.g. "3 Skeletons + 1 Brute").
   */
  announce(wave: number, composition: string): void {
    const isBoss = wave % 5 === 0;

    // ── Set text ──────────────────────────────────────────────────────────────
    this.titleEl.textContent = isBoss ? `ELITE WAVE ${wave}` : `WAVE ${wave}`;
    this.subtitleEl.textContent = composition;

    // ── Boss vs normal styling ───────────────────────────────────────────────
    if (isBoss) {
      this.titleEl.style.background =
        'linear-gradient(to bottom, #fffde0 0%, #e8d5a0 40%, #c8a93a 100%)';
      this.titleEl.style.webkitBackgroundClip = 'text';
      this.titleEl.style.webkitTextFillColor  = 'transparent';
      this.titleEl.style.backgroundClip       = 'text';
      this.titleEl.style.filter =
        'drop-shadow(0 0 30px rgba(232,213,160,1)) drop-shadow(0 0 60px rgba(200,169,58,0.6))';
      this.subtitleEl.style.color = '#e8d5a0';
    } else {
      this.titleEl.style.background =
        'linear-gradient(to bottom, #e8d5a0 0%, #c0392b 60%, #7a1a0a 100%)';
      this.titleEl.style.webkitBackgroundClip = 'text';
      this.titleEl.style.webkitTextFillColor  = 'transparent';
      this.titleEl.style.backgroundClip       = 'text';
      this.titleEl.style.filter =
        'drop-shadow(0 0 20px rgba(192,57,43,0.8)) drop-shadow(0 0 40px rgba(255,100,30,0.4))';
      this.subtitleEl.style.color = '#8a7a5a';
    }

    // ── Reset timer and start ─────────────────────────────────────────────────
    this.timer  = 0;
    this.active = true;
    this.overlay.style.opacity = '0';

    // Trigger scale-in animation
    this.overlay.style.animation = 'none';
    // Force reflow so the animation restart is respected
    void this.overlay.offsetWidth;
    this.overlay.style.animation = `waveScaleIn ${this.FADE_IN}s ease-out forwards`;
  }

  /** Call once per visual frame with `delta` (seconds). */
  update(delta: number): void {
    if (!this.active) return;

    this.timer += delta;
    const t = this.timer;

    if (t < this.FADE_IN) {
      // Fade in
      this.overlay.style.opacity = String(t / this.FADE_IN);
    } else if (t < this.FADE_IN + this.HOLD) {
      // Hold
      this.overlay.style.opacity = '1';
    } else if (t < this.TOTAL) {
      // Fade out
      const fadeT = (t - this.FADE_IN - this.HOLD) / this.FADE_OUT;
      this.overlay.style.opacity = String(Math.max(0, 1 - fadeT));
    } else {
      // Done
      this.overlay.style.opacity = '0';
      this.overlay.style.animation = 'none';
      this.active = false;
    }
  }
}
