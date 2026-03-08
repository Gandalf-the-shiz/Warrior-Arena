import * as THREE from 'three';
import { AnimState } from '@/game/AnimationStateMachine';
import { PlayerController } from '@/game/PlayerController';
import { Enemy } from '@/game/Enemy';
import { VFXManager } from '@/game/VFXManager';
import { StyleMeter } from '@/game/StyleMeter';

// How far in front of the player the sword hitbox centre sits (world units)
const HIT_RANGE_FORWARD = 2.0;

// ENEMY → PLAYER base reach
const ENEMY_ATTACK_REACH = 2.5;
// Minimum dot-product of (enemy forward) · (dir to player) for a hit to land.
// cos(100°) ≈ −0.17 — a wide frontal cone; attacks strictly from behind miss.
const ENEMY_FACING_MIN_DOT = -0.17;

// Impact parameters by attack weight
const HEAVY_DAMAGE_THRESHOLD = 40;
const HEAVY_SHAKE_INTENSITY = 0.18;
const HEAVY_SHAKE_DURATION = 0.18;
const LIGHT_SHAKE_INTENSITY = 0.09;
const LIGHT_SHAKE_DURATION = 0.12;
const HEAVY_HITSTOP = 0.05; // seconds
const LIGHT_HITSTOP = 0.03; // seconds

/**
 * Detects melee contacts and applies damage, knockback, hitstop, and VFX.
 *
 * Player → Enemy:
 *   During the active window of each attack animation a sphere in front of
 *   the player is tested against every living enemy.  Each enemy can be hit
 *   at most once per swing.
 *
 * Enemy → Player:
 *   When an enemy enters its ATTACK_STRIKE window and the player is within
 *   reach, 10 damage is applied (respects the player's invincibility window).
 */
export class CombatSystem {
  // Enemies hit during the current player swing
  private readonly hitEnemiesThisSwing = new Set<Enemy>();
  private prevPlayerAttacking = false;
  // Scratch vector — reused in processEnemyAttacks to avoid per-enemy allocations.
  private readonly _toPlayer = new THREE.Vector3();

  /**
   * Run every visual frame (after physics step).
   * @param onHitstop  Callback that pauses the game loop for `duration` seconds.
   * @param styleMeter Optional style meter to notify on hits.
   */
  update(
    player: PlayerController,
    enemies: readonly Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
  ): void {
    if (player.isDead) return;

    this.processPlayerAttacks(player, enemies, vfx, onHitstop, styleMeter);
    this.processEnemyAttacks(player, enemies, vfx, styleMeter);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private processPlayerAttacks(
    player: PlayerController,
    enemies: readonly Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
  ): void {
    const hitInfo = player.getAttackHitInfo();
    const playerAttacking = hitInfo !== null;

    // Reset per-swing hit set when a new attack swing begins
    const stateIsAttack = [
      AnimState.ATTACK_LIGHT_1,
      AnimState.ATTACK_LIGHT_2,
      AnimState.ATTACK_LIGHT_3,
      AnimState.ATTACK_HEAVY,
    ].includes(player.anim.currentState);

    if (!this.prevPlayerAttacking && playerAttacking) {
      this.hitEnemiesThisSwing.clear();
    }
    if (!stateIsAttack) {
      this.hitEnemiesThisSwing.clear();
    }
    this.prevPlayerAttacking = playerAttacking;

    if (!hitInfo) return;

    const playerPos = player.getPosition();
    const hitCenter = playerPos.clone().addScaledVector(hitInfo.forward, HIT_RANGE_FORWARD);

    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      if (this.hitEnemiesThisSwing.has(enemy)) continue;

      const dist = enemy.getPosition().distanceTo(hitCenter);
      if (dist > hitInfo.hitRadius) continue;

      // ── Register hit ──────────────────────────────────────────────────
      this.hitEnemiesThisSwing.add(enemy);

      const knockbackDir = enemy.getPosition().clone().sub(playerPos).normalize();
      // Make sure knockback has some outward component even when on top
      if (knockbackDir.lengthSq() < 0.01) {
        knockbackDir.set(hitInfo.forward.x, 0, hitInfo.forward.z).normalize();
      }

      enemy.takeDamage(hitInfo.damage, knockbackDir);
      styleMeter?.registerHit();

      // VFX
      const hitPos = enemy.getPosition().clone().add(new THREE.Vector3(0, 0.5, 0));
      vfx.spawnBlood(hitPos, knockbackDir);

      // Camera shake — heavy hit shakes more
      const isHeavy = hitInfo.damage >= HEAVY_DAMAGE_THRESHOLD;
      vfx.shakeCamera(
        isHeavy ? HEAVY_SHAKE_INTENSITY : LIGHT_SHAKE_INTENSITY,
        isHeavy ? HEAVY_SHAKE_DURATION  : LIGHT_SHAKE_DURATION,
      );

      // Hitstop — 50 ms for heavy, 30 ms for light
      onHitstop(isHeavy ? HEAVY_HITSTOP : LIGHT_HITSTOP);
    }
  }

  private processEnemyAttacks(
    player: PlayerController,
    enemies: readonly Enemy[],
    vfx: VFXManager,
    styleMeter?: StyleMeter,
  ): void {
    const playerPos = player.getPosition();

    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      if (!enemy.isInStrikeWindow()) continue;

      const dist = enemy.getPosition().distanceTo(playerPos);
      if (dist > ENEMY_ATTACK_REACH) continue;

      // Only land the hit when the player is within the enemy's frontal strike cone.
      const toPlayer = this._toPlayer.copy(playerPos).sub(enemy.getPosition()).normalize();
      if (toPlayer.dot(enemy.getForward()) < ENEMY_FACING_MIN_DOT) continue;

      enemy.markDamageDealt();
      // Pass the direction from enemy to player as the recoil direction.
      player.takeDamage(enemy.attackDamage, toPlayer);

      if (!player.isDead) {
        styleMeter?.onPlayerDamage();
        // Stronger shake when the player is hit
        vfx.shakeCamera(0.18, 0.25);
      }
    }
  }
}
