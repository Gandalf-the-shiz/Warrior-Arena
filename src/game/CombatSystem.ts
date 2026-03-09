import * as THREE from 'three';
import { AnimState } from '@/game/AnimationStateMachine';
import { PlayerController } from '@/game/PlayerController';
import { Enemy } from '@/game/Enemy';
import { BossEnemy } from '@/game/BossEnemy';
import { EnemyCommander } from '@/game/EnemyCommander';
import { VFXManager } from '@/game/VFXManager';
import { StyleMeter } from '@/game/StyleMeter';

// How far in front of the player the sword hitbox centre sits (world units)
const HIT_RANGE_FORWARD = 2.0;

// ENEMY → PLAYER base reach
const ENEMY_ATTACK_REACH = 2.5;

// Impact parameters by attack weight
const HEAVY_DAMAGE_THRESHOLD = 40;
const HEAVY_SHAKE_INTENSITY = 0.12;
const HEAVY_SHAKE_DURATION = 0.15;
const LIGHT_SHAKE_INTENSITY = 0.05;
const LIGHT_SHAKE_DURATION = 0.08;
const KILL_SHAKE_INTENSITY = 0.08;
const KILL_SHAKE_DURATION = 0.12;
const HEAVY_HITSTOP = 0.10; // seconds (100ms)
const LIGHT_HITSTOP = 0.05; // seconds (50ms)
const FINISHER_HITSTOP = 0.15; // seconds (150ms)

/** Cosine threshold for "frontal" arc — cos(120°) = -0.5, covers 120° arc in front. */
const FRONTAL_BLOCK_DOT_THRESHOLD = -0.5;

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
   * @param styleMeter Optional style meter to notify on hits.
   * @param onEnemyHit Optional callback fired whenever the player lands a hit.
   * @param onHitVFX   Optional callback for spawning damage numbers at hit position.
   * @param onEnemyKilled Optional callback fired with position when a kill lands.
   * @param boss Optional boss enemy for the current wave.
   */
  update(
    player: PlayerController,
    enemies: readonly Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
    onEnemyHit?: () => void,
    onHitVFX?: (pos: THREE.Vector3, damage: number, isHeavy: boolean, isFinisher: boolean) => void,
    onEnemyKilled?: (position: THREE.Vector3) => void,
    boss?: BossEnemy | null,
    commanders?: readonly EnemyCommander[],
  ): void {
    if (player.isDead) return;

    this.processPlayerAttacks(player, enemies, vfx, onHitstop, styleMeter, onEnemyHit, onHitVFX, onEnemyKilled);
    this.processEnemyAttacks(player, enemies, vfx, styleMeter);
    this.processNecromancerProjectiles(player, enemies);

    // Boss combat
    if (boss && !boss.isDead) {
      this.processBossPlayerAttacks(player, boss, vfx, onHitstop, styleMeter, onEnemyHit, onHitVFX, onEnemyKilled);
      this.processBossAttack(player, boss, vfx, styleMeter);
    }

    // Commander combat
    if (commanders && commanders.length > 0) {
      this.processCommanderCombat(player, commanders, vfx, onHitstop, styleMeter, onEnemyHit, onHitVFX, onEnemyKilled);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private processPlayerAttacks(
    player: PlayerController,
    enemies: readonly Enemy[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
    onEnemyHit?: () => void,
    onHitVFX?: (pos: THREE.Vector3, damage: number, isHeavy: boolean, isFinisher: boolean) => void,
    onEnemyKilled?: (position: THREE.Vector3) => void,
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

      const actualDamage = Math.round(hitInfo.damage * player.getEffectiveDamageMultiplier());
      const enemyPosBefore = enemy.getPosition().clone();

      enemy.takeDamage(actualDamage, knockbackDir);
      styleMeter?.registerHit();
      onEnemyHit?.();

      if (enemy.isDead) {
        onEnemyKilled?.(enemyPosBefore);
      }

      // VFX
      const hitPos = enemy.getPosition().clone().add(new THREE.Vector3(0, 0.5, 0));
      vfx.spawnBlood(hitPos, knockbackDir);

      // Hit flash — enemy turns white for one frame
      vfx.spawnHitFlash(enemy.group);

      // Hit sparks
      vfx.spawnHitSparks(hitPos, knockbackDir);

      // Camera shake — heavy hit / kill shakes more
      const isHeavy = actualDamage >= HEAVY_DAMAGE_THRESHOLD;
      const isFinisher = player.anim.currentState === AnimState.ATTACK_LIGHT_3;

      if (enemy.isDead) {
        vfx.shakeCamera(KILL_SHAKE_INTENSITY, KILL_SHAKE_DURATION);
      } else {
        vfx.shakeCamera(
          isHeavy ? HEAVY_SHAKE_INTENSITY : LIGHT_SHAKE_INTENSITY,
          isHeavy ? HEAVY_SHAKE_DURATION  : LIGHT_SHAKE_DURATION,
        );
      }

      // Ground slam ring for heavy attack
      if (isHeavy) {
        vfx.spawnGroundSlam(playerPos.clone());
      }

      // Damage number VFX
      const damagePos = enemyPosBefore.clone().add(new THREE.Vector3(0, 1.5, 0));
      onHitVFX?.(damagePos, actualDamage, isHeavy, isFinisher);

      // Hitstop — 150ms finisher, 100ms heavy, 50ms light
      const hitstopDur = isFinisher ? FINISHER_HITSTOP : isHeavy ? HEAVY_HITSTOP : LIGHT_HITSTOP;
      onHitstop(hitstopDur);
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

      enemy.markDamageDealt();

      let damage = enemy.attackDamage;

      // ── Block / parry check ──────────────────────────────────────────────
      if (player.isBlocking) {
        // Check if hit is frontal (within 120° arc of player facing)
        const toEnemy = enemy.getPosition().clone().sub(playerPos).normalize();
        const forward = player.getForward();
        const dot = forward.dot(toEnemy);
        if (dot > FRONTAL_BLOCK_DOT_THRESHOLD) {
          // Frontal: 70% damage reduction
          damage = Math.round(damage * 0.3);
          vfx.shakeCamera(0.04, 0.06);
        }
        // Blocked hit doesn't break blocking state or trigger HIT animation
        player.hp = Math.max(0, player.hp - Math.max(1, damage));
        if (player.hp <= 0) { player.isDead = true; }
        continue;
      }

      player.takeDamage(damage);

      if (!player.isDead) {
        styleMeter?.onPlayerDamage();
        // Small shake when player is hit
        vfx.shakeCamera(0.12, 0.2);
        // Heavy-hit screen-edge blood flash
        if (enemy.attackDamage >= 15) {
          vfx.spawnBloodFlash();
        }
      }
    }
  }

  /** Check Necromancer projectile hits against the player. */
  private processNecromancerProjectiles(
    player: PlayerController,
    enemies: readonly Enemy[],
  ): void {
    const playerPos = player.getPosition();
    playerPos.y += 1.0; // check at torso height

    for (const enemy of enemies) {
      if (enemy.isDead) continue;
      const dmg = enemy.checkProjectileHit(playerPos, 1.0);
      if (dmg > 0) {
        player.takeDamage(dmg);
      }
    }
  }

  /** Process player melee hits on the boss enemy. */
  private processBossPlayerAttacks(
    player: PlayerController,
    boss: BossEnemy,
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
    onEnemyHit?: () => void,
    onHitVFX?: (pos: THREE.Vector3, damage: number, isHeavy: boolean, isFinisher: boolean) => void,
    onEnemyKilled?: (position: THREE.Vector3) => void,
  ): void {
    const hitInfo = player.getAttackHitInfo();
    if (!hitInfo) return;

    const playerPos = player.getPosition();
    const hitCenter = playerPos.clone().addScaledVector(hitInfo.forward, HIT_RANGE_FORWARD);

    // Boss is large — use bigger hit radius
    const dist = boss.getPosition().distanceTo(hitCenter);
    if (dist > hitInfo.hitRadius * 2.5) return;

    if (this.hitEnemiesThisSwing.has(boss as unknown as Enemy)) return;
    this.hitEnemiesThisSwing.add(boss as unknown as Enemy);

    const knockbackDir = boss.getPosition().clone().sub(playerPos).normalize();
    const actualDamage = Math.round(hitInfo.damage * player.getEffectiveDamageMultiplier());
    const bossPosBefore = boss.getPosition().clone();

    boss.takeDamage(actualDamage, knockbackDir);
    styleMeter?.registerHit();
    onEnemyHit?.();

    if (boss.isDead) {
      onEnemyKilled?.(bossPosBefore);
    }

    const hitPos = boss.getPosition().clone().add(new THREE.Vector3(0, 1.0, 0));
    vfx.spawnBlood(hitPos, knockbackDir);

    const isHeavy = actualDamage >= HEAVY_DAMAGE_THRESHOLD;
    vfx.shakeCamera(
      isHeavy ? HEAVY_SHAKE_INTENSITY * 1.5 : LIGHT_SHAKE_INTENSITY,
      isHeavy ? HEAVY_SHAKE_DURATION * 1.5 : LIGHT_SHAKE_DURATION,
    );

    const damagePos = bossPosBefore.clone().add(new THREE.Vector3(0, 2.5, 0));
    onHitVFX?.(damagePos, actualDamage, isHeavy, false);

    onHitstop(isHeavy ? HEAVY_HITSTOP * 1.5 : LIGHT_HITSTOP);
  }

  /** Process boss melee attack on the player. */
  private processBossAttack(
    player: PlayerController,
    boss: BossEnemy,
    vfx: VFXManager,
    styleMeter?: StyleMeter,
  ): void {
    const playerPos = player.getPosition();

    if (boss.isInStrikeWindow()) {
      const dist = boss.getPosition().distanceTo(playerPos);
      if (dist <= ENEMY_ATTACK_REACH * 1.8) {
        boss.markDamageDealt();
        player.takeDamage(boss.attackDamage);
        if (!player.isDead) {
          styleMeter?.onPlayerDamage();
          vfx.shakeCamera(0.22, 0.35);
          vfx.spawnBloodFlash();
        }
      }
    }

    // Boss slam shockwave damages anything in 5-unit radius
    if (boss.isSlamActive()) {
      const slamPos = boss.getSlamPosition();
      if (player.getPosition().distanceTo(slamPos) <= 5.0) {
        boss.markSlamDealt();
        player.takeDamage(boss.attackDamage);
        if (!player.isDead) {
          vfx.shakeCamera(0.3, 0.5);
          vfx.spawnBloodFlash();
        }
      }
    }
  }

  /** Process player attacks on commanders and commander melee attacks on player. */
  private processCommanderCombat(
    player: PlayerController,
    commanders: readonly EnemyCommander[],
    vfx: VFXManager,
    onHitstop: (duration: number) => void,
    styleMeter?: StyleMeter,
    onEnemyHit?: () => void,
    onHitVFX?: (pos: THREE.Vector3, damage: number, isHeavy: boolean, isFinisher: boolean) => void,
    onEnemyKilled?: (position: THREE.Vector3) => void,
  ): void {
    const hitInfo = player.getAttackHitInfo();
    const playerPos = player.getPosition();

    for (const commander of commanders) {
      if (commander.isDead) continue;

      // Player → Commander
      if (hitInfo) {
        const hitCenter = playerPos.clone().addScaledVector(hitInfo.forward, HIT_RANGE_FORWARD);
        const dist = commander.getPosition().distanceTo(hitCenter);
        if (dist <= hitInfo.hitRadius * 1.5 && !this.hitEnemiesThisSwing.has(commander as unknown as Enemy)) {
          this.hitEnemiesThisSwing.add(commander as unknown as Enemy);
          const knockbackDir = commander.getPosition().clone().sub(playerPos).normalize();
          const actualDamage = Math.round(hitInfo.damage * player.getEffectiveDamageMultiplier());
          const posBefore = commander.getPosition().clone();
          commander.takeDamage(actualDamage, knockbackDir);
          styleMeter?.registerHit();
          onEnemyHit?.();
          if (commander.isDead) {
            onEnemyKilled?.(posBefore);
          }
          const hitPos = commander.getPosition().clone().add(new THREE.Vector3(0, 0.8, 0));
          vfx.spawnBlood(hitPos, knockbackDir);
          vfx.spawnHitFlash(commander.group);
          vfx.spawnHitSparks(hitPos, knockbackDir);
          const isHeavy = actualDamage >= HEAVY_DAMAGE_THRESHOLD;
          const isFinisher = player.anim.currentState === AnimState.ATTACK_LIGHT_3;
          vfx.shakeCamera(isHeavy ? HEAVY_SHAKE_INTENSITY : LIGHT_SHAKE_INTENSITY, isHeavy ? HEAVY_SHAKE_DURATION : LIGHT_SHAKE_DURATION);
          onHitVFX?.(posBefore.clone().add(new THREE.Vector3(0, 1.8, 0)), actualDamage, isHeavy, isFinisher);
          onHitstop(isHeavy ? HEAVY_HITSTOP : LIGHT_HITSTOP);
        }
      }

      // Commander → Player
      if (commander.isInStrikeWindow()) {
        const dist = commander.getPosition().distanceTo(playerPos);
        if (dist <= ENEMY_ATTACK_REACH * 1.5) {
          commander.markDamageDealt();
          player.takeDamage(commander.attackDamage);
          if (!player.isDead) {
            styleMeter?.onPlayerDamage();
            vfx.shakeCamera(0.14, 0.22);
            vfx.spawnBloodFlash();
          }
        }
      }
    }
  }
}
