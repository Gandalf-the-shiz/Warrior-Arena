import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { Enemy } from '@/game/Enemy';
import { HUD } from '@/ui/HUD';

// Radius at which enemies spawn around the arena edge
const SPAWN_RADIUS = 20;

/**
 * Manages enemy waves: spawning, tracking kills, wave-banner display, and
 * wiring kill/wave counts to the HUD.
 *
 * Wave formula: `count = Math.min(2 + wave * 2, 15)`.
 * A 3-second inter-wave pause is shown with a large "WAVE X" banner.
 */
export class WaveManager {
  private readonly activeEnemies: Enemy[] = [];

  private _currentWave = 0;
  private _totalKills = 0;

  // Inter-wave countdown (-ve means wave is active)
  private waveCountdown = 0;
  private waveStarted = false;

  // DOM banner element
  private readonly bannerEl: HTMLElement;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly hud: HUD,
  ) {
    // Create the wave-announcement banner
    this.bannerEl = document.createElement('div');
    Object.assign(this.bannerEl.style, {
      position: 'fixed',
      top: '45%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      fontSize: '72px',
      fontWeight: 'bold',
      letterSpacing: '0.3em',
      textTransform: 'uppercase',
      color: '#e8d5a0',
      textShadow: '0 0 40px rgba(255,100,30,0.95), 0 4px 8px rgba(0,0,0,1)',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '30',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(this.bannerEl);

    // Kick off the first wave after a short delay
    this.beginInterWave();
  }

  get currentWave(): number { return this._currentWave; }
  get totalKills(): number { return this._totalKills; }

  /** Return a read-only view of active enemies (used by CombatSystem). */
  get enemies(): readonly Enemy[] { return this.activeEnemies; }

  /**
   * Called every fixed-rate physics step.
   * Advances enemy physics.
   */
  fixedUpdate(playerPos: THREE.Vector3): void {
    for (const enemy of this.activeEnemies) {
      enemy.fixedUpdate(playerPos);
    }
  }

  /**
   * Called every visual frame.
   * Handles inter-wave countdown, enemy updates, and kill detection.
   */
  update(delta: number, playerPos: THREE.Vector3): void {
    // ── Inter-wave countdown ──────────────────────────────────────────────
    if (!this.waveStarted) {
      this.waveCountdown -= delta;
      if (this.waveCountdown <= 0) {
        this.startWave();
      }
      return;
    }

    // ── Update living enemies ─────────────────────────────────────────────
    for (const enemy of this.activeEnemies) {
      enemy.update(delta, playerPos);
    }

    // ── Collect freshly-dead enemies ──────────────────────────────────────
    let killedThisFrame = 0;
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const enemy = this.activeEnemies[i]!;
      if (enemy.isDead) {
        enemy.dispose(this.physics);
        this.activeEnemies.splice(i, 1);
        killedThisFrame++;
      }
    }

    if (killedThisFrame > 0) {
      this._totalKills += killedThisFrame;
      this.hud.updateKills(this._totalKills);
    }

    // ── Check wave completion ─────────────────────────────────────────────
    if (this.waveStarted && this.activeEnemies.length === 0) {
      this.beginInterWave();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private beginInterWave(): void {
    this.waveStarted = false;
    this.waveCountdown = 3.0;

    const nextWave = this._currentWave + 1;
    this.showBanner(`Wave  ${nextWave}`, 2.4);
  }

  private startWave(): void {
    this.waveStarted = true;
    this._currentWave++;
    this.hud.updateWave(this._currentWave);
    this.hideBanner();
    this.spawnEnemies();
  }

  private spawnEnemies(): void {
    const count = Math.min(2 + this._currentWave * 2, 15);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
      const sx = Math.cos(angle) * r;
      const sz = Math.sin(angle) * r;

      const enemy = new Enemy(this.scene, this.physics, sx, sz);
      this.activeEnemies.push(enemy);
    }
  }

  private showBanner(text: string, duration: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = 'block';
    this.bannerEl.style.opacity = '1';

    // Fade out near the end of the inter-wave period
    const fadeStart = duration * 0.6 * 1000;
    const totalMs = duration * 1000;
    const start = performance.now();

    const tick = (): void => {
      const elapsed = performance.now() - start;
      if (elapsed >= totalMs) {
        this.bannerEl.style.opacity = '0';
        return;
      }
      if (elapsed > fadeStart) {
        const t = (elapsed - fadeStart) / (totalMs - fadeStart);
        this.bannerEl.style.opacity = String(Math.max(0, 1 - t));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private hideBanner(): void {
    this.bannerEl.style.display = 'none';
  }
}
