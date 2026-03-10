import * as THREE from 'three';
import type { Enemy } from '@/game/Enemy';
import type { SeveredPartManager } from '@/game/SeveredPartManager';
import type { VFXManager } from '@/game/VFXManager';
import type { AudioManager } from '@/engine/AudioManager';

// ── Public types ──────────────────────────────────────────────────────────────

/** Body part that can be severed from an enemy. */
export enum BodyPartType {
  HEAD        = 'HEAD',
  LEFT_ARM    = 'LEFT_ARM',
  RIGHT_ARM   = 'RIGHT_ARM',
  LEFT_LEG    = 'LEFT_LEG',
  RIGHT_LEG   = 'RIGHT_LEG',
  TORSO_UPPER = 'TORSO_UPPER',
}

/** Type of attack that caused the kill. */
export enum AttackType {
  LIGHT    = 'LIGHT',
  HEAVY    = 'HEAVY',
  FINISHER = 'FINISHER',
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Probability of dismemberment occurring on kill by attack type
const LIGHT_DISMEMBER_CHANCE   = 0.30;
const HEAVY_DISMEMBER_CHANCE   = 0.60;
// Finisher is always 100%, hardcoded in onFinisher()

// Upward impulse added to all severed parts
const SEVER_UP_IMPULSE_MIN = 2.5;
const SEVER_UP_IMPULSE_MAX = 5.0;

// Forward launch force applied to severed parts
const SEVER_FORWARD_FORCE_MIN = 5;
const SEVER_FORWARD_FORCE_MAX = 9;

// Stump cap material: dark red exposed flesh
const MAT_STUMP = new THREE.MeshStandardMaterial({
  color: 0x8b0000,
  roughness: 0.9,
  metalness: 0.0,
  emissive: new THREE.Color(0x330000),
  emissiveIntensity: 0.5,
});

/**
 * Orchestrates enemy dismemberment on kill.
 *
 * Works with SeveredPartManager to launch severed limbs as physics objects,
 * calls VFXManager for arterial spray / gore chunks / screen blood,
 * and AudioManager for dismemberment sounds.
 */
export class DismembermentSystem {
  constructor(
    private readonly severedPartManager: SeveredPartManager,
    private readonly vfx: VFXManager,
    private readonly audio: AudioManager,
  ) {}

  /**
   * Called when a player attack kills an enemy.
   * Rolls probability based on attack type and severs appropriate parts.
   *
   * @param enemy       The enemy that was killed.
   * @param attackDir   Normalised direction of the killing attack.
   * @param attackType  Light / Heavy / Finisher.
   */
  onEnemyKilled(
    enemy: Enemy,
    attackDir: THREE.Vector3,
    attackType: AttackType,
  ): void {
    switch (attackType) {
      case AttackType.FINISHER:
        // Finisher: always dismember, multiple parts
        this.onFinisher(enemy, attackDir);
        break;

      case AttackType.HEAVY:
        if (Math.random() < HEAVY_DISMEMBER_CHANCE) {
          this.performHeavyDismember(enemy, attackDir);
        } else {
          // Always at least trigger basic fallback for heavy kills
          enemy.fallbackDismember();
        }
        break;

      case AttackType.LIGHT:
      default:
        if (Math.random() < LIGHT_DISMEMBER_CHANCE) {
          this.performLightDismember(enemy, attackDir);
        } else {
          enemy.fallbackDismember();
        }
        break;
    }
  }

  /**
   * Called when the F-key finisher executes.
   * Always spectacular — severs 2–3 parts simultaneously.
   */
  onFinisher(enemy: Enemy, attackDir: THREE.Vector3): void {
    const bodyParts = enemy.getBodyParts();

    // Always sever head
    this.severPart(BodyPartType.HEAD, attackDir, bodyParts);

    // 60% chance for torso bisection, else sever an arm
    if (Math.random() < 0.6) {
      // Torso bisection: sever both legs as "lower half"
      this.severPart(BodyPartType.LEFT_LEG, attackDir, bodyParts);
      this.severPart(BodyPartType.RIGHT_LEG, attackDir, bodyParts);
    } else {
      this.severPart(BodyPartType.LEFT_ARM, attackDir, bodyParts);
      this.severPart(BodyPartType.RIGHT_ARM, attackDir, bodyParts);
    }

    // Maximum blood effects
    const enemyPos = enemy.getPosition().clone();
    enemyPos.y += 0.8;
    this.vfx.spawnArterialSpray(enemyPos, attackDir, 1.5);
    this.vfx.spawnBlood(enemyPos, attackDir);
    this.vfx.spawnBlood(enemyPos, attackDir.clone().applyEuler(new THREE.Euler(0, 1.0, 0)));
    this.vfx.spawnGoreChunks(enemyPos, 5);
    this.vfx.spawnScreenBlood(1.0);
    this.audio.playDismember();
    this.audio.playHeadSplit();
    enemy.dismembered = true;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private performHeavyDismember(enemy: Enemy, attackDir: THREE.Vector3): void {
    const bodyParts = enemy.getBodyParts();
    const roll = Math.random();

    if (roll < 0.35) {
      // Torso bisection (most dramatic) — sever both legs
      this.severPart(BodyPartType.LEFT_LEG, attackDir, bodyParts);
      this.severPart(BodyPartType.RIGHT_LEG, attackDir, bodyParts);
      // Also sever head 40% of the time for extreme effect
      if (Math.random() < 0.4) {
        this.severPart(BodyPartType.HEAD, attackDir, bodyParts);
        this.audio.playHeadSplit();
      }
    } else if (roll < 0.65) {
      // Head sever
      this.severPart(BodyPartType.HEAD, attackDir, bodyParts);
      this.audio.playHeadSplit();
    } else {
      // Sever one arm + 50% second arm
      this.severPart(BodyPartType.RIGHT_ARM, attackDir, bodyParts);
      if (Math.random() < 0.5) {
        this.severPart(BodyPartType.LEFT_ARM, attackDir, bodyParts);
      }
    }

    const enemyPos = enemy.getPosition().clone();
    enemyPos.y += 0.8;
    this.vfx.spawnArterialSpray(enemyPos, attackDir, 1.0);
    this.vfx.spawnGoreChunks(enemyPos, 3 + Math.floor(Math.random() * 2));
    this.vfx.spawnScreenBlood(0.6);
    this.audio.playDismember();
    enemy.dismembered = true;
  }

  private performLightDismember(enemy: Enemy, attackDir: THREE.Vector3): void {
    const bodyParts = enemy.getBodyParts();

    // Light attacks sever arms or head
    const options = [BodyPartType.LEFT_ARM, BodyPartType.RIGHT_ARM, BodyPartType.HEAD];
    const pick = options[Math.floor(Math.random() * options.length)]!;
    this.severPart(pick, attackDir, bodyParts);

    if (pick === BodyPartType.HEAD) this.audio.playHeadSplit();

    const enemyPos = enemy.getPosition().clone();
    enemyPos.y += 0.8;
    this.vfx.spawnArterialSpray(enemyPos, attackDir, 0.7);
    this.vfx.spawnGoreChunks(enemyPos, 2);
    this.vfx.spawnScreenBlood(0.35);
    this.audio.playDismember();
    enemy.dismembered = true;
  }

  /**
   * Core sever operation for a single body part.
   * - Removes the Three.js group from its parent
   * - Places a stump cap mesh at the sever point
   * - Computes launch impulse
   * - Hands the group to SeveredPartManager for physics / lifecycle
   */
  private severPart(
    partType: BodyPartType,
    attackDir: THREE.Vector3,
    bodyParts: ReturnType<Enemy['getBodyParts']>,
  ): void {
    const group = this.getGroupForPart(partType, bodyParts);
    if (!group || !group.parent) return;

    // Capture world transform before detaching
    const worldPos = new THREE.Vector3();
    group.getWorldPosition(worldPos);
    const worldQuat = new THREE.Quaternion();
    group.getWorldQuaternion(worldQuat);

    // Detach from parent
    group.parent.remove(group);

    // Add a stump cap on the enemy body at the detach point
    this.addStumpCap(group.parent, worldPos);

    // Build launch impulse: forward in attack direction + upward
    const forwardForce = SEVER_FORWARD_FORCE_MIN + Math.random() * (SEVER_FORWARD_FORCE_MAX - SEVER_FORWARD_FORCE_MIN);
    const upForce = SEVER_UP_IMPULSE_MIN + Math.random() * (SEVER_UP_IMPULSE_MAX - SEVER_UP_IMPULSE_MIN);
    const impulse = attackDir.clone().multiplyScalar(forwardForce);
    impulse.y += upForce;
    // Add slight random spread
    impulse.x += (Math.random() - 0.5) * 3;
    impulse.z += (Math.random() - 0.5) * 3;

    // Hand to SeveredPartManager for physics-driven lifecycle
    this.severedPartManager.addPart(group, worldPos, worldQuat, impulse);

    // Play arterial spray sound
    this.audio.playArterialSpray();
  }

  /** Returns the appropriate THREE.Group for the given part type. */
  private getGroupForPart(
    partType: BodyPartType,
    bodyParts: ReturnType<Enemy['getBodyParts']>,
  ): THREE.Group | null {
    switch (partType) {
      case BodyPartType.HEAD:        return bodyParts.head;
      case BodyPartType.LEFT_ARM:    return bodyParts.leftArm;
      case BodyPartType.RIGHT_ARM:   return bodyParts.rightArm;
      case BodyPartType.LEFT_LEG:    return bodyParts.leftLeg;
      case BodyPartType.RIGHT_LEG:   return bodyParts.rightLeg;
      case BodyPartType.TORSO_UPPER: return bodyParts.torso;
      default:                       return null;
    }
  }

  /**
   * Adds a flat circular "stump" mesh at the sever location to simulate
   * exposed flesh/bone at the cut point.
   * The geometry and material are disposed when the parent enemy group is
   * eventually disposed by the existing Enemy.dispose() lifecycle.
   */
  private addStumpCap(parent: THREE.Object3D, worldPos: THREE.Vector3): void {
    const geo = new THREE.CircleGeometry(0.14, 8);
    const mat = MAT_STUMP.clone();
    const cap = new THREE.Mesh(geo, mat);

    // Convert world position to local space of the parent
    const localPos = parent.worldToLocal(worldPos.clone());
    cap.position.copy(localPos);
    cap.rotation.x = -Math.PI / 2; // Face upward
    parent.add(cap);
  }
}
