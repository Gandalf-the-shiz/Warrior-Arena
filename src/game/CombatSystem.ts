import * as THREE from 'three';
import { AnimState } from '@/game/AnimationStateMachine';
import { PlayerController } from '@/game/PlayerController';
import { Enemy } from '@/game/Enemy';
import { VFXManager } from '@/game/VFXManager';

// How far in front of the player the sword hitbox centre sits (world units)
const HIT_RANGE_FORWARD = 2.0;
// Radius of the spherical hitbox
const HIT_RADIUS = 1.6;

// ENEMY → PLAYER damage per swing
const ENEMY_ATTACK_DAMAGE = 10;

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

  /**
   * Run every visual frame (after physics step).
   * @param onHitstop  Callback that pauses the game loop for `duration` seconds.
   */
  update(
    player: PlayerController,
    enemies: Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
  ): void {
    if (player.isDead) return;

    this.processPlayerAttacks(player, enemies, vfx, onHitstop);
    this.processEnemyAttacks(player, enemies, vfx);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private processPlayerAttacks(
    player: PlayerController,
    enemies: Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
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
      if (dist > HIT_RADIUS) continue;

      // ── Register hit ──────────────────────────────────────────────────
      this.hitEnemiesThisSwing.add(enemy);

      const knockbackDir = enemy.getPosition().clone().sub(playerPos).normalize();
      // Make sure knockback has some outward component even when on top
      if (knockbackDir.lengthSq() < 0.01) {
        knockbackDir.set(hitInfo.forward.x, 0, hitInfo.forward.z).normalize();
      }

      enemy.takeDamage(hitInfo.damage, knockbackDir);

      // VFX
      const hitPos = enemy.getPosition().clone().add(new THREE.Vector3(0, 0.5, 0));
      vfx.spawnBlood(hitPos, knockbackDir);

      // Camera shake — heavy hit shakes more
      const shakeIntensity = hitInfo.damage >= 40 ? 0.18 : 0.09;
      vfx.shakeCamera(shakeIntensity, hitInfo.damage >= 40 ? 0.18 : 0.12);

      // Hitstop — 50 ms for heavy, 30 ms for light
      onHitstop(hitInfo.damage >= 40 ? 0.05 : 0.03);
    }
  }

  private processEnemyAttacks(
    player: PlayerController,
    enemies: Enemy[],
    vfx: VFXManager,
  ): void {
    const playerPos = player.getPosition();

    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      if (!enemy.isInStrikeWindow()) continue;

      const dist = enemy.getPosition().distanceTo(playerPos);
      if (dist > 2.5) continue;

      enemy.markDamageDealt();
      player.takeDamage(ENEMY_ATTACK_DAMAGE);

      if (!player.isDead) {
        // Small shake when player is hit
        vfx.shakeCamera(0.12, 0.2);
      }
    }
  }
}
