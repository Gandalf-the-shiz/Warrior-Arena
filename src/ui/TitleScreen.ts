/**
 * TitleScreen — full-screen overlay shown before the game starts.
 *
 * Features an animated ember-particle background, gold title text, subtitle,
 * and a pulsing "CLICK TO BEGIN" prompt. Resolves `waitForStart()` on the
 * first click or keypress, then fades out smoothly.
 */

const FONT_FAMILY = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

export class TitleScreen {
  private readonly overlay: HTMLDivElement;
  private readonly bgCanvas: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private animFrame: number | null = null;
  private readonly startTime: number;
  private readonly onResize: () => void;

  constructor() {
    this.startTime = performance.now();

    // ── Outer overlay ────────────────────────────────────────────────────────
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      background: '#05050a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '200',
      fontFamily: FONT_FAMILY,
      cursor: 'pointer',
      userSelect: 'none',
    });

    // ── Animated background canvas ───────────────────────────────────────────
    this.bgCanvas = document.createElement('canvas');
    Object.assign(this.bgCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    this.bgCtx = this.bgCanvas.getContext('2d')!;

    // ── Title text ───────────────────────────────────────────────────────────
    const title = document.createElement('div');
    Object.assign(title.style, {
      position: 'relative',
      zIndex: '1',
      fontSize: 'clamp(36px, 8vw, 96px)',
      fontWeight: 'bold',
      letterSpacing: '0.25em',
      color: '#e8d5a0',
      textShadow:
        '0 0 40px rgba(232,213,160,0.7), 0 0 80px rgba(255,150,50,0.3), 0 2px 8px rgba(0,0,0,1)',
      textTransform: 'uppercase',
      marginBottom: '12px',
    });
    title.textContent = 'WARRIOR ARENA';

    // ── Subtitle ─────────────────────────────────────────────────────────────
    const subtitle = document.createElement('div');
    Object.assign(subtitle.style, {
      position: 'relative',
      zIndex: '1',
      fontSize: 'clamp(11px, 2vw, 18px)',
      letterSpacing: '0.38em',
      color: '#8a7a5a',
      textTransform: 'uppercase',
      marginBottom: '72px',
    });
    subtitle.textContent = 'Dark Fantasy Endless Horde Combat';

    // ── Pulsing prompt ───────────────────────────────────────────────────────
    const prompt = document.createElement('div');
    Object.assign(prompt.style, {
      position: 'relative',
      zIndex: '1',
      fontSize: 'clamp(11px, 1.8vw, 16px)',
      letterSpacing: '0.42em',
      color: '#e8d5a0',
      textTransform: 'uppercase',
      animation: 'titlePulse 1.4s ease-in-out infinite',
    });
    prompt.textContent = 'CLICK TO BEGIN';

    // ── Keyframe animation ───────────────────────────────────────────────────
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes titlePulse {
        0%, 100% { opacity: 0.25; }
        50%       { opacity: 1; }
      }
    `;
    document.head.appendChild(styleEl);

    // ── Assemble ─────────────────────────────────────────────────────────────
    this.overlay.appendChild(this.bgCanvas);
    this.overlay.appendChild(title);
    this.overlay.appendChild(subtitle);
    this.overlay.appendChild(prompt);
    document.body.appendChild(this.overlay);

    this.resizeCanvas();
    this.onResize = () => this.resizeCanvas();
    window.addEventListener('resize', this.onResize);
    this.startAnimation();
  }

  /**
   * Returns a Promise that resolves when the user clicks or presses any key.
   * The overlay then fades out and is removed from the DOM.
   */
  waitForStart(): Promise<void> {
    return new Promise<void>((resolve) => {
      const onGesture = (): void => {
        this.overlay.removeEventListener('click', onGesture);
        window.removeEventListener('keydown', onGesture);
        this.dismiss(resolve);
      };
      this.overlay.addEventListener('click', onGesture);
      window.addEventListener('keydown', onGesture);
    });
  }

  /**
   * Display the player's persisted best scores below the subtitle.
   * Call after `new TitleScreen()` and before `waitForStart()`.
   */
  showBestScores(best: { bestWave: number; bestKills: number; bestRank: string }): void {
    if (best.bestWave === 0 && best.bestKills === 0) return; // nothing saved yet

    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'relative',
      zIndex: '1',
      fontSize: 'clamp(10px, 1.5vw, 14px)',
      letterSpacing: '0.25em',
      color: '#6a5a3a',
      textTransform: 'uppercase',
      marginTop: '-48px',
      marginBottom: '48px',
      textAlign: 'center',
    });
    el.textContent =
      `BEST  —  Wave ${best.bestWave}  |  ${best.bestKills} Kills  |  Rank ${best.bestRank}`;

    // Insert before the last child (the pulsing prompt)
    const children = Array.from(this.overlay.children);
    const prompt = children[children.length - 1];
    if (prompt) {
      this.overlay.insertBefore(el, prompt);
    } else {
      this.overlay.appendChild(el);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private resizeCanvas(): void {
    this.bgCanvas.width  = window.innerWidth;
    this.bgCanvas.height = window.innerHeight;
  }

  private dismiss(resolve: () => void): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    window.removeEventListener('resize', this.onResize);
    this.overlay.style.transition = 'opacity 0.8s ease';
    this.overlay.style.opacity = '0';
    setTimeout(() => {
      this.overlay.remove();
      resolve();
    }, 800);
  }

  private startAnimation(): void {
    interface Ember { x: number; y: number; vy: number; alpha: number; size: number; seed: number; }

    const COUNT = 80;
    const embers: Ember[] = Array.from({ length: COUNT }, () => ({
      x:     Math.random() * window.innerWidth,
      y:     Math.random() * window.innerHeight,
      vy:    -(0.3 + Math.random() * 0.5),
      alpha: Math.random(),
      size:  1 + Math.random() * 2,
      seed:  Math.random() * Math.PI * 2,
    }));

    const draw = (): void => {
      const ctx  = this.bgCtx;
      const w    = this.bgCanvas.width;
      const h    = this.bgCanvas.height;
      const t    = (performance.now() - this.startTime) / 1000;

      ctx.clearRect(0, 0, w, h);

      // Radial dark gradient
      const grad = ctx.createRadialGradient(
        w * 0.5, h * 0.5, 0,
        w * 0.5, h * 0.5, Math.max(w, h) * 0.75,
      );
      grad.addColorStop(0, 'rgba(18, 8, 4, 0.97)');
      grad.addColorStop(0.5, 'rgba(10, 5, 2, 0.99)');
      grad.addColorStop(1, 'rgba(5, 5, 10, 1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Ember particles
      for (const em of embers) {
        em.y += em.vy;
        em.alpha += Math.sin(t * 1.8 + em.seed) * 0.015;
        em.alpha = Math.max(0.04, Math.min(0.75, em.alpha));
        if (em.y < -8) {
          em.y = h + 8;
          em.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.arc(em.x, em.y, em.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 130, 35, ${em.alpha * 0.65})`;
        ctx.fill();
      }

      this.animFrame = requestAnimationFrame(draw);
    };

    this.animFrame = requestAnimationFrame(draw);
  }
}
