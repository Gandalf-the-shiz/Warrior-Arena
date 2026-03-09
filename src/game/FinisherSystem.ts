import * as THREE from 'three';
import type { Enemy } from '@/game/Enemy';
import type { PlayerController } from '@/game/PlayerController';
import type { InputManager } from '@/engine/InputManager';
import type { AudioManager } from '@/engine/AudioManager';
import type { VFXManager } from '@/game/VFXManager';
import type { CameraController } from '@/game/CameraController';
import type { StyleMeter } from '@/game/StyleMeter';

// Threshold HP percentage to allow finisher
const FINISHER_HP_THRESHOLD = 0.2;
// Range from player to eligible enemy
const FINISHER_RANGE = 2.0;
// Slow-mo duration (seconds)
const FINISHER_SLOWMO_DURATION = 0.8;
// Cooldown between finisher uses
const FINISHER_COOLDOWN = 8.0;
// Finisher prompt label
const PROMPT_HEIGHT_OFFSET = 2.2;

interface FinisherPrompt {
  el: HTMLElement;
  enemy: Enemy;
}

/**
 * Execution / finisher system.
 *
 * When the player is near a low-HP enemy and presses F, triggers:
 * 1. Brief slow-motion (50% game speed for 0.8s)
 * 2. Camera subtle zoom toward target
 * 3. Player lunges + heavy overhead swing animation
 * 4. 9999 damage to enemy (guaranteed kill)
 * 5. Extra-large blood burst + camera shake
 * 6. +3 style meter hits
 * 7. Audio: playFinisher()
 */
export class FinisherSystem {
  private cooldown = 0;
  private activeTimer = 0;
  private _isExecuting = false;

  /** Whether a finisher animation is currently playing. */
  get isExecuting(): boolean { return this._isExecuting; }

  // DOM prompt elements for eligible enemies
  private readonly prompts = new Map<Enemy, FinisherPrompt>();
  private readonly promptContainer: HTMLElement;

  constructor(
    private readonly audio: AudioManager,
    private readonly vfx: VFXManager,
    private readonly camera: CameraController,
  ) {
    // Container for finisher prompts (DOM projected)
    this.promptContainer = document.createElement('div');
    Object.assign(this.promptContainer.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '25',
    });
    document.body.appendChild(this.promptContainer);
  }

  /**
   * Call every visual frame.
   * @returns slowmo scale (1.0 = normal, 0.5 = half-speed) for gameDelta calculation
   */
  update(
    delta: number,
    player: PlayerController,
    enemies: readonly Enemy[],
    input: InputManager,
    camera3d: THREE.PerspectiveCamera,
    styleMeter?: StyleMeter,
    onEnemyKilled?: (pos: THREE.Vector3) => void,
  ): number {
    // Advance cooldown
    if (this.cooldown > 0) this.cooldown -= delta;

    // Advance active finisher timer
    if (this.isExecuting) {
      this.activeTimer -= delta;
      if (this.activeTimer <= 0) {
        this._isExecuting = false;
        this.camera.setFinisherZoom(0); // reset zoom
      }
      return 0.5; // slow-mo while executing
    }

    // Update eligibility prompts
    this.updatePrompts(enemies, player, camera3d);

    // Check for finisher input
    if (this.cooldown <= 0 && !player.isDead && input.isFinisherReady()) {
      const target = this.findTarget(player, enemies);
      if (target) {
        this.executeFinisher(target, player, styleMeter, onEnemyKilled);
      }
    }

    return 1.0; // normal speed
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private findTarget(player: PlayerController, enemies: readonly Enemy[]): Enemy | null {
    const playerPos = player.getPosition();
    let closest: Enemy | null = null;
    let closestDist = FINISHER_RANGE;

    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      if (enemy.hp / enemy.maxHp > FINISHER_HP_THRESHOLD) continue;

      const dist = enemy.getPosition().distanceTo(playerPos);
      if (dist < closestDist) {
        closestDist = dist;
        closest = enemy;
      }
    }
    return closest;
  }

  private executeFinisher(
    target: Enemy,
    player: PlayerController,
    styleMeter?: StyleMeter,
    onEnemyKilled?: (pos: THREE.Vector3) => void,
  ): void {
    this._isExecuting = true;
    this.activeTimer = FINISHER_SLOWMO_DURATION;
    this.cooldown = FINISHER_COOLDOWN;

    // Lunge player toward enemy (teleport 1 unit closer)
    const playerPos = player.getPosition();
    const dir = target.getPosition().clone().sub(playerPos).normalize();
    const body = player.body;
    const cur = body.translation();
    body.setTranslation({ x: cur.x + dir.x, y: cur.y, z: cur.z + dir.z }, true);

    // 9999 damage = guaranteed kill
    const killPos = target.getPosition().clone();
    const knockback = dir.clone().negate();
    target.takeDamage(9999, knockback);

    // Extra-large blood burst (2x)
    const hitPos = killPos.clone().add(new THREE.Vector3(0, 0.8, 0));
    this.vfx.spawnBlood(hitPos, dir);
    this.vfx.spawnBlood(hitPos, dir.clone().applyEuler(new THREE.Euler(0, 0.8, 0)));

    // Camera shake (bigger than normal)
    this.vfx.shakeCamera(0.35, 0.4);

    // Camera finisher zoom
    this.camera.setFinisherZoom(1);

    // Style meter boost (+3 hits)
    styleMeter?.registerHit();
    styleMeter?.registerHit();
    styleMeter?.registerHit();

    // Audio
    this.audio.playFinisher();

    // Kill callback for loot drops
    if (target.isDead) {
      onEnemyKilled?.(killPos);
    }
  }

  private updatePrompts(
    enemies: readonly Enemy[],
    player: PlayerController,
    camera3d: THREE.PerspectiveCamera,
  ): void {
    const playerPos = player.getPosition();

    // Remove prompts for dead/ineligible enemies
    for (const [enemy, prompt] of this.prompts) {
      const eligible =
        !enemy.isDead &&
        enemy.hp / enemy.maxHp <= FINISHER_HP_THRESHOLD &&
        enemy.getPosition().distanceTo(playerPos) <= FINISHER_RANGE * 1.5;

      if (!eligible) {
        prompt.el.remove();
        this.prompts.delete(enemy);
      }
    }

    // Add/update prompts for eligible enemies
    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      if (enemy.hp / enemy.maxHp > FINISHER_HP_THRESHOLD) continue;
      if (enemy.getPosition().distanceTo(playerPos) > FINISHER_RANGE * 1.5) continue;

      if (!this.prompts.has(enemy)) {
        const el = document.createElement('div');
        Object.assign(el.style, {
          position: 'absolute',
          fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
          fontSize: '13px',
          fontWeight: 'bold',
          letterSpacing: '0.15em',
          color: '#ffdd44',
          textShadow: '0 0 8px rgba(255,200,0,0.9)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          transform: 'translate(-50%, -50%)',
        });
        el.textContent = '⚔ FINISH';
        this.promptContainer.appendChild(el);
        this.prompts.set(enemy, { el, enemy });
      }

      // Project world position to screen
      const prompt = this.prompts.get(enemy)!;
      const worldPos = enemy.getPosition().clone();
      worldPos.y += PROMPT_HEIGHT_OFFSET;

      const projected = worldPos.project(camera3d);
      if (projected.z > 1) {
        prompt.el.style.display = 'none';
        continue;
      }

      const x = ((projected.x + 1) / 2) * window.innerWidth;
      const y = ((-projected.y + 1) / 2) * window.innerHeight;
      prompt.el.style.display = 'block';
      prompt.el.style.left = `${x}px`;
      prompt.el.style.top = `${y}px`;

      // Pulse opacity
      const pulse = 0.7 + Math.sin(performance.now() * 0.005) * 0.3;
      prompt.el.style.opacity = String(pulse);
    }
  }
}
