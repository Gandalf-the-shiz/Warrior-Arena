import * as THREE from 'three';
import { Enemy, EnemyType } from '@/game/Enemy';

// Canvas / display constants
const SIZE         = 75;  // px – total canvas diameter (50% smaller)
const RADIUS       = SIZE / 2;
const ARENA_RADIUS = 30;  // world units (60-unit-diameter arena)
// Leave a 5 px border inside the circle so dots are never cut off
const SCALE        = (RADIUS - 5) / ARENA_RADIUS; // world units → pixels

// Dot colours per enemy type
const DOT_COLOR: Record<EnemyType, string> = {
  [EnemyType.SKELETON]:    '#dd4444',
  [EnemyType.GHOUL]:       '#44cc66',
  [EnemyType.BRUTE]:       '#ff8800',
  [EnemyType.NECROMANCER]: '#aa44ff',
};

/**
 * Minimap — a small radar-style canvas in the top-left corner.
 *
 * - Player is always centred, shown as a white arrow pointing "up"
 *   (the map rotates with the player so forward is always up).
 * - Enemies are coloured dots (red = skeleton, green = ghoul, orange = brute).
 * - The arena boundary is drawn as a faint ring.
 *
 * Call `update()` every visual frame.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    // ── Clipping container ───────────────────────────────────────────────────
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed',
      top: '60px',
      right: '16px',
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      borderRadius: '50%',
      overflow: 'hidden',
      border: '1px solid rgba(232,213,160,0.28)',
      zIndex: '10',
      pointerEvents: 'none',
    });

    // ── Canvas ───────────────────────────────────────────────────────────────
    this.canvas = document.createElement('canvas');
    this.canvas.width  = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%' });

    this.ctx = this.canvas.getContext('2d')!;

    container.appendChild(this.canvas);
    document.body.appendChild(container);
  }

  /**
   * Redraw the minimap.
   *
   * @param playerPos  Player world position (THREE.Vector3).
   * @param playerYaw  Player facing angle in radians (from `player.getFacingYaw()`).
   * @param enemies    Current live enemies from `waves.enemies`.
   */
  update(
    playerPos: THREE.Vector3,
    playerYaw: number,
    enemies: readonly Enemy[],
  ): void {
    const ctx = this.ctx;
    const cx  = RADIUS;
    const cy  = RADIUS;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // ── Background ────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 5, 10, 0.78)';
    ctx.fill();

    // ── Arena boundary ring ───────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS - 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,213,160,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Enemy dots ────────────────────────────────────────────────────────────
    const cosYaw = Math.cos(-playerYaw);
    const sinYaw = Math.sin(-playerYaw);
    const maxDot = RADIUS - 3;

    for (const enemy of enemies) {
      if (enemy.isDead) continue;

      const ep = enemy.getPosition();
      const dx = ep.x - playerPos.x;
      const dz = ep.z - playerPos.z;

      // Rotate relative offset by negative player yaw so forward = "up"
      const rx =  dx * cosYaw - dz * sinYaw;
      const rz =  dx * sinYaw + dz * cosYaw;

      // In Three.js -Z is forward; on the minimap "up" = -Z, so we negate rz
      let sx = cx + rx * SCALE;
      let sy = cy - rz * SCALE;

      // Clamp to minimap circle
      const dist = Math.hypot(sx - cx, sy - cy);
      if (dist > maxDot) {
        sx = cx + (sx - cx) * maxDot / dist;
        sy = cy + (sy - cy) * maxDot / dist;
      }

      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fillStyle = DOT_COLOR[enemy.type];
      ctx.fill();
    }

    // ── Player arrow (always at centre, pointing up) ──────────────────────────
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(-2.5, 3);
    ctx.lineTo(2.5, 3);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
}
