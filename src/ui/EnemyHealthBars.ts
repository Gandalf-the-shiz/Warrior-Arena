import * as THREE from 'three';
import { Enemy } from '@/game/Enemy';

const BAR_WIDTH     = 60;  // px
const BAR_HEIGHT    = 6;   // px
const WORLD_OFFSET_Y = 2.0; // world units above the enemy's physics origin

/**
 * EnemyHealthBars — floating DOM health bars projected from 3D world space.
 *
 * A thin red-on-dark bar appears above each enemy whose HP has dropped below
 * their maximum. Full-health enemies (and dead enemies) are hidden to reduce
 * UI clutter. Bars are culled when the enemy is behind the camera.
 *
 * Call `update()` every visual frame (after physics/AI updates).
 */
export class EnemyHealthBars {
  private readonly container: HTMLDivElement;
  private readonly bars = new Map<Enemy, HTMLDivElement>();

  constructor(private readonly camera: THREE.Camera) {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '10',
      overflow: 'hidden',
    });
    document.body.appendChild(this.container);
  }

  /**
   * Reposition and resize all health bars to match the current enemy states.
   * Must be called after `renderer.render()` so camera matrices are up to date.
   */
  update(enemies: readonly Enemy[]): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const projected = new THREE.Vector3();

    // Hide / remove bars for enemies that left the active list
    for (const [enemy, bar] of this.bars) {
      if (!enemies.includes(enemy)) {
        bar.remove();
        this.bars.delete(enemy);
      }
    }

    for (const enemy of enemies) {
      // Hide for full-health or dead enemies
      if (enemy.isDead || enemy.hp >= enemy.maxHp) {
        const bar = this.bars.get(enemy);
        if (bar) bar.style.display = 'none';
        continue;
      }

      const bar = this.getOrCreate(enemy);
      const worldPos = enemy.getPosition();
      projected.set(worldPos.x, worldPos.y + WORLD_OFFSET_Y, worldPos.z);
      projected.project(this.camera);

      // Cull if behind camera
      if (projected.z > 1) {
        bar.style.display = 'none';
        continue;
      }

      const sx = (projected.x + 1) * 0.5 * w;
      const sy = (1 - projected.y) * 0.5 * h;

      bar.style.display = 'block';
      bar.style.left    = `${sx - BAR_WIDTH * 0.5}px`;
      bar.style.top     = `${sy}px`;

      // Update fill width
      const fill = bar.firstElementChild as HTMLDivElement;
      fill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getOrCreate(enemy: Enemy): HTMLDivElement {
    const existing = this.bars.get(enemy);
    if (existing) return existing;

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute',
      width:    `${BAR_WIDTH}px`,
      height:   `${BAR_HEIGHT}px`,
      background:   'rgba(0, 0, 0, 0.72)',
      border:       '1px solid rgba(255,255,255,0.16)',
      borderRadius: '2px',
      overflow:     'hidden',
      display:      'none',
    });

    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height:       '100%',
      width:        '100%',
      background:   'linear-gradient(90deg, #7b0000, #c0392b)',
      borderRadius: '2px',
      transition:   'width 0.08s linear',
    });

    bar.appendChild(fill);
    this.container.appendChild(bar);
    this.bars.set(enemy, bar);
    return bar;
  }
}
