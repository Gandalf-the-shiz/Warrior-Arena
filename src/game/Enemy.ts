import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

// ── Enemy type ───────────────────────────────────────────────────────────────
export enum EnemyType {
  SKELETON = 'SKELETON',
  GHOUL    = 'GHOUL',
  BRUTE    = 'BRUTE',
}

// ── Shared skeleton materials (brightened for visibility) ────────────────────
const MAT_BONE = new THREE.MeshStandardMaterial({
  color: 0xd8c070,
  roughness: 0.75,
  metalness: 0.05,
});
const MAT_JOINT = new THREE.MeshStandardMaterial({
  color: 0xaa8a40,
  roughness: 0.85,
  metalness: 0.05,
});
const MAT_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x886030,
  roughness: 0.9,
  metalness: 0.2,
  emissive: new THREE.Color(0x200800),
  emissiveIntensity: 0.5,
});
const MAT_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0xff2200),
  emissiveIntensity: 4.0,
  roughness: 0.3,
});

// ── Ghoul materials ──────────────────────────────────────────────────────────
const MAT_GHOUL_BODY = new THREE.MeshStandardMaterial({
  color: 0x88b088,   // lifted mid-green — clearly readable against stone floor
  roughness: 0.8,
  metalness: 0.0,
});
const MAT_GHOUL_JOINT = new THREE.MeshStandardMaterial({
  color: 0x5a8a5a,   // darker accent joint — still visible
  roughness: 0.85,
  metalness: 0.0,
});
const MAT_GHOUL_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x4a7a4a,   // lifted weapon color
  roughness: 0.9,
  metalness: 0.1,
});
const MAT_GHOUL_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0x44ff00),
  emissiveIntensity: 3.0,
  roughness: 0.3,
});

// ── Brute materials ──────────────────────────────────────────────────────────
const MAT_BRUTE_BODY = new THREE.MeshStandardMaterial({
  color: 0xb06040,   // bright reddish-brown — menacing and clearly visible
  roughness: 0.7,
  metalness: 0.15,
});
const MAT_BRUTE_JOINT = new THREE.MeshStandardMaterial({
  color: 0x884828,   // darker accent — contrast against body
  roughness: 0.8,
  metalness: 0.1,
});
const MAT_BRUTE_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x744040,   // readable against the floor
  roughness: 0.6,
  metalness: 0.5,
  emissive: new THREE.Color(0x400a00),
  emissiveIntensity: 0.8,
});
const MAT_BRUTE_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0xff6600),
  emissiveIntensity: 4.0,
  roughness: 0.3,
});

// ── Internal AI state ───────────────────────────────────────────────────────
enum EnemyAIState {
  IDLE,
  WANDER,
  AGGRO,
  ATTACK_WINDUP,
  ATTACK_STRIKE,
  HIT,
  DEAD,
  /** Ghoul-exclusive: brief hop-back/disengage before re-engaging. */
  GHOUL_RESET,
}

// Collision groups: membership = bit 2 (enemy group), filter = everything except bit 2.
// Prevents enemy–enemy physics collisions while preserving player / static collisions.
const ENEMY_COLLISION_GROUPS = (2 << 16) | 0xFFFD;

// Per-type stat overrides
const TYPE_STATS: Record<EnemyType, {
  minHp: number; hpRange: number; speed: number; damage: number;
  windupTime: number; knockbackResistance: number; scale: number;
  attackCooldownBase: number;
}> = {
  [EnemyType.SKELETON]: {
    minHp: 30, hpRange: 21, speed: 3.5, damage: 10,
    windupTime: 0.5, knockbackResistance: 1.0, scale: 1.0,
    attackCooldownBase: 1.5,
  },
  [EnemyType.GHOUL]: {
    minHp: 18, hpRange: 5, speed: 5.5, damage: 6,
    windupTime: 0.3, knockbackResistance: 1.5, scale: 0.7,
    attackCooldownBase: 1.0,
  },
  [EnemyType.BRUTE]: {
    minHp: 75, hpRange: 11, speed: 2.0, damage: 20,
    windupTime: 0.8, knockbackResistance: 0.4, scale: 1.4,
    attackCooldownBase: 2.0,
  },
};

/**
 * Per-type behavioural tuning — controls AI decision distances, movement
 * feel, and combat rhythm without touching raw stat numbers.
 *
 * SKELETON — disciplined baseline pressure. Straightforward approach,
 *            readable windup, moderate hit-stun.
 * GHOUL    — fast skirmisher. Lateral drift while aggroing, darts in from
 *            short range, hops back after striking, fast hit-recovery.
 * BRUTE    — slow terror. Commits from further away, heavy lunge, long
 *            strike window, poise (low hit-stun).
 */
const TYPE_BEHAVIOR: Record<EnemyType, {
  attackRange: number;           // distance at which ATTACK_WINDUP triggers
  lungeSpeed: number;            // velocity impulse during strike lunge
  lungeDuration: number;         // how many seconds the lunge impulse lasts
  strikeWindowTime: number;      // total duration of ATTACK_STRIKE state
  hitStunTime: number;           // duration of HIT state (poise = shorter)
  lateralDrift: boolean;         // sinusoidal lateral drift while approaching
  lateralFreq: number;           // oscillation frequency (rad/s) for drift
  lateralAmp: number;            // amplitude multiplier for lateral drift
  disengageAfterStrike: boolean; // briefly hop back after striking
  disengageChance: number;       // probability [0–1] of choosing GHOUL_RESET
  disengageRetreatMult: number;  // retreat speed as a multiple of moveSpeed
  disengageTime: number;         // max seconds in GHOUL_RESET before re-aggro
  disengageRange: number;        // re-engage immediately once beyond this dist
}> = {
  // Skeleton: standard spacing, clean read, moderate recovery
  [EnemyType.SKELETON]: {
    attackRange: 2.0, lungeSpeed: 5, lungeDuration: 0.12,
    strikeWindowTime: 0.4, hitStunTime: 0.30,
    lateralDrift: false, lateralFreq: 0, lateralAmp: 0,
    disengageAfterStrike: false, disengageChance: 0,
    disengageRetreatMult: 0, disengageTime: 0, disengageRange: 0,
  },
  // Ghoul: darts in close, lateral weave, quick recovery, hop-back reset
  [EnemyType.GHOUL]: {
    attackRange: 1.8, lungeSpeed: 6, lungeDuration: 0.10,
    strikeWindowTime: 0.28, hitStunTime: 0.16,
    lateralDrift: true, lateralFreq: 3.5, lateralAmp: 0.7,
    disengageAfterStrike: true, disengageChance: 0.6,
    disengageRetreatMult: 1.1, disengageTime: 0.45, disengageRange: 5,
  },
  // Brute: commits from longer range, powerful lunge, high poise
  [EnemyType.BRUTE]: {
    attackRange: 2.8, lungeSpeed: 9, lungeDuration: 0.20,
    strikeWindowTime: 0.55, hitStunTime: 0.12,
    lateralDrift: false, lateralFreq: 0, lateralAmp: 0,
    disengageAfterStrike: false, disengageChance: 0,
    disengageRetreatMult: 0, disengageTime: 0, disengageRange: 0,
  },
};

/**
 * Procedural enemy (skeleton / ghoul / brute).
 *
 * Built from Three.js primitives. Rapier capsule physics body with enemy
 * collision groups so enemies don't push each other into a pile.
 *
 * AI states: IDLE → WANDER → AGGRO → ATTACK_WINDUP → ATTACK_STRIKE → back
 *            Ghoul additionally uses GHOUL_RESET for its disengage loop.
 */
export class Enemy {
  readonly body: RAPIER.RigidBody;
  readonly group: THREE.Group;

  hp: number;
  readonly maxHp: number;
  isDead = false;

  /** Damage dealt per swing to the player. */
  readonly attackDamage: number;
  /** Knockback multiplier — higher = flies further on hit. */
  readonly knockbackResistance: number;
  /** Move speed used in AGGRO state. */
  private readonly moveSpeed: number;
  /** Windup time before a strike. */
  private readonly windupTime: number;
  /** Attack cooldown base (seconds between swings). */
  private readonly attackCooldownBase: number;
  /** Archetype — drives per-type behavioral branching. */
  private readonly enemyType: EnemyType;

  private aiState: EnemyAIState = EnemyAIState.IDLE;
  private stateTimer = 0;
  private attackCooldown = 0;
  private hasDealtDamageThisStrike = false;

  private wanderX: number;
  private wanderZ: number;

  // ── Visual sub-groups ─────────────────────────────────────────────────────
  private readonly torsoGroup: THREE.Group;
  private readonly headGroup: THREE.Group;
  private readonly leftArmGroup: THREE.Group;
  private readonly rightArmGroup: THREE.Group;
  private readonly leftLegGroup: THREE.Group;
  private readonly rightLegGroup: THREE.Group;
  private readonly weaponGroup: THREE.Group;

  // Head point light for visibility in the dark
  private readonly headLight: THREE.PointLight;

  private readonly targetRotation = new THREE.Quaternion();
  private readonly spawnX: number;
  private readonly spawnZ: number;

  private animTime = 0;

  // Hit flash tracking (per-instance material clones)
  private hitFlashTimer = 0;
  private readonly flashMeshes: THREE.Mesh[] = [];
  private readonly origEmissiveColors: THREE.Color[] = [];
  private readonly origEmissiveIntensities: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    physics: PhysicsWorld,
    spawnX: number,
    spawnZ: number,
    enemyType: EnemyType = EnemyType.SKELETON,
  ) {
    this.spawnX = spawnX;
    this.spawnZ = spawnZ;
    this.enemyType = enemyType;

    const stats = TYPE_STATS[enemyType];
    this.attackDamage       = stats.damage;
    this.knockbackResistance = stats.knockbackResistance;
    this.moveSpeed          = stats.speed;
    this.windupTime         = stats.windupTime;
    this.attackCooldownBase = stats.attackCooldownBase;
    this.wanderX = spawnX;
    this.wanderZ = spawnZ;

    this.maxHp = stats.minHp + Math.floor(Math.random() * stats.hpRange);
    this.hp = this.maxHp;

    // ── Physics body ─────────────────────────────────────────────────────
    this.body = physics.createDynamicBody(spawnX, 2, spawnZ, true);
    this.body.setLinearDamping(5);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.32)
      .setFriction(0.5)
      .setRestitution(0.0)
      .setCollisionGroups(ENEMY_COLLISION_GROUPS);
    physics.world.createCollider(colliderDesc, this.body);

    // ── Select materials by enemy type ───────────────────────────────────
    let matBody: THREE.MeshStandardMaterial;
    let matJoint: THREE.MeshStandardMaterial;
    let matWeapon: THREE.MeshStandardMaterial;
    let matEye: THREE.MeshStandardMaterial;
    switch (enemyType) {
      case EnemyType.GHOUL:
        matBody = MAT_GHOUL_BODY; matJoint = MAT_GHOUL_JOINT;
        matWeapon = MAT_GHOUL_WEAPON; matEye = MAT_GHOUL_EYE;
        break;
      case EnemyType.BRUTE:
        matBody = MAT_BRUTE_BODY; matJoint = MAT_BRUTE_JOINT;
        matWeapon = MAT_BRUTE_WEAPON; matEye = MAT_BRUTE_EYE;
        break;
      default:
        matBody = MAT_BONE; matJoint = MAT_JOINT;
        matWeapon = MAT_WEAPON; matEye = MAT_EYE;
    }

    // ── Build skeleton model ──────────────────────────────────────────────
    this.group = new THREE.Group();

    // Torso group (ribcage area)
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.1, 0);

    // Ribcage cylinder
    this.torsoGroup.add(this.mkMesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.46, 7), matBody,
    ));

    // Spine connecting ribcage to hips
    const spine = this.mkMesh(new THREE.CylinderGeometry(0.034, 0.038, 0.5, 5), matBody);
    spine.position.set(0, -0.28, 0);
    this.torsoGroup.add(spine);

    // Hip bone
    const hip = this.mkMesh(new THREE.BoxGeometry(0.3, 0.09, 0.14), matBody);
    hip.position.set(0, -0.51, 0);
    this.torsoGroup.add(hip);

    // ── Head ──────────────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.6, 0);

    const skull = this.mkMesh(new THREE.SphereGeometry(0.15, 8, 6), matBody);
    skull.scale.set(1, 1.08, 0.92);
    this.headGroup.add(skull);

    const jaw = this.mkMesh(new THREE.BoxGeometry(0.12, 0.06, 0.09), matBody);
    jaw.position.set(0, -0.12, 0.05);
    this.headGroup.add(jaw);

    // Glowing eye sockets
    const eyeL = this.mkMesh(new THREE.SphereGeometry(0.036, 5, 4), matEye);
    eyeL.position.set(-0.058, 0.022, 0.11);
    this.headGroup.add(eyeL);

    const eyeR = this.mkMesh(new THREE.SphereGeometry(0.036, 5, 4), matEye);
    eyeR.position.set(0.058, 0.022, 0.11);
    this.headGroup.add(eyeR);

    // Dim head point light — makes the enemy glow in the dark
    const HEAD_LIGHT_COLORS: Record<EnemyType, number> = {
      [EnemyType.SKELETON]: 0xff0000,
      [EnemyType.GHOUL]:    0x00ff44,
      [EnemyType.BRUTE]:    0xff4400,
    };
    this.headLight = new THREE.PointLight(HEAD_LIGHT_COLORS[enemyType], 0.3, 4, 2);
    this.headLight.position.set(0, 0, 0);
    this.headGroup.add(this.headLight);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ──────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.19, 0.24, 0);

    const lUpper = this.mkMesh(new THREE.CylinderGeometry(0.035, 0.031, 0.36, 5), matBody);
    lUpper.position.set(0, -0.18, 0);
    this.leftArmGroup.add(lUpper);

    const lElbow = this.mkMesh(new THREE.SphereGeometry(0.042, 5, 4), matJoint);
    lElbow.position.set(0, -0.36, 0);
    this.leftArmGroup.add(lElbow);

    const lLower = this.mkMesh(new THREE.CylinderGeometry(0.027, 0.023, 0.32, 5), matBody);
    lLower.position.set(0, -0.52, 0);
    this.leftArmGroup.add(lLower);

    this.torsoGroup.add(this.leftArmGroup);

    // ── Right arm ─────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.19, 0.24, 0);

    const rUpper = this.mkMesh(new THREE.CylinderGeometry(0.035, 0.031, 0.36, 5), matBody);
    rUpper.position.set(0, -0.18, 0);
    this.rightArmGroup.add(rUpper);

    const rElbow = this.mkMesh(new THREE.SphereGeometry(0.042, 5, 4), matJoint);
    rElbow.position.set(0, -0.36, 0);
    this.rightArmGroup.add(rElbow);

    const rLower = this.mkMesh(new THREE.CylinderGeometry(0.027, 0.023, 0.32, 5), matBody);
    rLower.position.set(0, -0.52, 0);
    this.rightArmGroup.add(rLower);

    this.torsoGroup.add(this.rightArmGroup);

    // ── Weapon ────────────────────────────────────────────────────────────
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.position.set(0.04, -0.68, 0);
    this.weaponGroup.rotation.z = 0.12;

    if (enemyType === EnemyType.BRUTE) {
      // Brute has a bigger, heavier weapon
      const clubHead = this.mkMesh(new THREE.BoxGeometry(0.11, 0.9, 0.09), matWeapon);
      clubHead.position.set(0, 0.45, 0);
      this.weaponGroup.add(clubHead);
      const clubHandle = this.mkMesh(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 5), matJoint);
      clubHandle.position.set(0, -0.01, 0);
      this.weaponGroup.add(clubHandle);
    } else {
      const clubHead = this.mkMesh(new THREE.BoxGeometry(0.068, 0.7, 0.057), matWeapon);
      clubHead.position.set(0, 0.35, 0);
      this.weaponGroup.add(clubHead);
      const clubHandle = this.mkMesh(new THREE.CylinderGeometry(0.024, 0.02, 0.28, 5), matJoint);
      clubHandle.position.set(0, -0.01, 0);
      this.weaponGroup.add(clubHandle);
    }
    this.rightArmGroup.add(this.weaponGroup);

    // ── Left leg ──────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.1, -0.2, 0);

    const ltThigh = this.mkMesh(new THREE.CylinderGeometry(0.046, 0.042, 0.38, 5), matBody);
    ltThigh.position.set(0, -0.19, 0);
    this.leftLegGroup.add(ltThigh);

    const ltKnee = this.mkMesh(new THREE.SphereGeometry(0.054, 5, 4), matJoint);
    ltKnee.position.set(0, -0.38, 0);
    this.leftLegGroup.add(ltKnee);

    const ltShin = this.mkMesh(new THREE.CylinderGeometry(0.036, 0.032, 0.34, 5), matBody);
    ltShin.position.set(0, -0.55, 0);
    this.leftLegGroup.add(ltShin);

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ─────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.1, -0.2, 0);

    const rtThigh = this.mkMesh(new THREE.CylinderGeometry(0.046, 0.042, 0.38, 5), matBody);
    rtThigh.position.set(0, -0.19, 0);
    this.rightLegGroup.add(rtThigh);

    const rtKnee = this.mkMesh(new THREE.SphereGeometry(0.054, 5, 4), matJoint);
    rtKnee.position.set(0, -0.38, 0);
    this.rightLegGroup.add(rtKnee);

    const rtShin = this.mkMesh(new THREE.CylinderGeometry(0.036, 0.032, 0.34, 5), matBody);
    rtShin.position.set(0, -0.55, 0);
    this.rightLegGroup.add(rtShin);

    this.torsoGroup.add(this.rightLegGroup);

    this.group.add(this.torsoGroup);

    // Apply type-specific scale to the whole model
    this.group.scale.set(stats.scale, stats.scale, stats.scale);

    this.scene.add(this.group);

    this.pickWanderTarget();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getPosition(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** World-space forward direction this enemy is currently facing. */
  getForward(): THREE.Vector3 {
    const fwd = new THREE.Vector3(0, 0, 1);
    fwd.applyQuaternion(this.group.quaternion);
    return fwd;
  }

  /**
   * Receive damage from a player attack.
   * Applies knockback impulse and starts the hit-flash / hit-stun.
   */
  takeDamage(damage: number, knockbackDir: THREE.Vector3): void {
    if (this.isDead) return;

    this.hp -= damage;

    const force = (5 + damage * 0.14) * this.knockbackResistance;
    this.body.applyImpulse(
      { x: knockbackDir.x * force, y: 1.5, z: knockbackDir.z * force },
      true,
    );

    this.hitFlashTimer = 0.1;
    this.flashWhite();

    if (this.hp <= 0) {
      this.hp = 0;
      this.enterDeadState();
    } else {
      this.aiState = EnemyAIState.HIT;
      this.stateTimer = 0;
    }
  }

  /**
   * Returns true when this enemy's strike should deal damage to the player.
   * Handles the "once per swing" logic internally — call markDamageDealt()
   * to consume the window.
   */
  isInStrikeWindow(): boolean {
    return (
      this.aiState === EnemyAIState.ATTACK_STRIKE &&
      !this.hasDealtDamageThisStrike &&
      this.stateTimer >= 0.05
    );
  }

  markDamageDealt(): void {
    this.hasDealtDamageThisStrike = true;
  }

  /**
   * Fixed-rate (60 Hz) physics update — apply velocity based on AI state.
   */
  fixedUpdate(playerPos: THREE.Vector3): void {
    if (this.isDead) return;

    const pos = this.body.translation();
    const vel = this.body.linvel();
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    if (this.attackCooldown > 0) {
      this.attackCooldown -= 1 / 60;
    }

    switch (this.aiState) {
      case EnemyAIState.IDLE:
      case EnemyAIState.WANDER: {
        if (distToPlayer < 15) {
          this.aiState = EnemyAIState.AGGRO;
          break;
        }
        const wx = this.wanderX - pos.x;
        const wz = this.wanderZ - pos.z;
        const wd = Math.sqrt(wx * wx + wz * wz);
        if (wd > 0.5) {
          const spd = 1.5;
          this.body.setLinvel({ x: (wx / wd) * spd, y: vel.y, z: (wz / wd) * spd }, true);
          this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(wx, wz), 0));
        } else {
          this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
        }
        break;
      }

      case EnemyAIState.AGGRO: {
        const beh = TYPE_BEHAVIOR[this.enemyType];
        if (distToPlayer < beh.attackRange && this.attackCooldown <= 0) {
          this.aiState = EnemyAIState.ATTACK_WINDUP;
          this.stateTimer = 0;
          this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
          break;
        }
        if (distToPlayer > 20) {
          this.aiState = EnemyAIState.WANDER;
          this.pickWanderTarget();
          break;
        }
        const spd = this.moveSpeed;
        if (distToPlayer > 0) {
          if (beh.lateralDrift) {
            // Ghoul: sinusoidal lateral weave — perpendicular to the approach vector
            const perpX = -dz / distToPlayer;
            const perpZ =  dx / distToPlayer;
            const drift = Math.sin(this.animTime * beh.lateralFreq) * beh.lateralAmp;
            this.body.setLinvel({
              x: (dx / distToPlayer) * spd + perpX * drift * spd,
              y: vel.y,
              z: (dz / distToPlayer) * spd + perpZ * drift * spd,
            }, true);
          } else {
            this.body.setLinvel(
              { x: (dx / distToPlayer) * spd, y: vel.y, z: (dz / distToPlayer) * spd },
              true,
            );
          }
          this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
        }
        break;
      }

      case EnemyAIState.ATTACK_WINDUP:
      case EnemyAIState.HIT:
        this.body.setLinvel({ x: vel.x * 0.7, y: vel.y, z: vel.z * 0.7 }, true);
        if (distToPlayer > 0) {
          this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
        }
        break;

      case EnemyAIState.ATTACK_STRIKE: {
        // Per-type lunge: brute surges harder and longer, ghoul darts in quick
        const beh = TYPE_BEHAVIOR[this.enemyType];
        if (this.stateTimer < beh.lungeDuration && distToPlayer > 0) {
          this.body.setLinvel(
            { x: (dx / distToPlayer) * beh.lungeSpeed, y: vel.y, z: (dz / distToPlayer) * beh.lungeSpeed },
            true,
          );
        } else {
          this.body.setLinvel({ x: vel.x * 0.5, y: vel.y, z: vel.z * 0.5 }, true);
        }
        break;
      }

      case EnemyAIState.GHOUL_RESET:
        // Hop directly away from the player at moderate speed
        if (distToPlayer > 0) {
          const retreatSpd = this.moveSpeed * TYPE_BEHAVIOR[this.enemyType].disengageRetreatMult;
          this.body.setLinvel({
            x: -(dx / distToPlayer) * retreatSpd,
            y: vel.y,
            z: -(dz / distToPlayer) * retreatSpd,
          }, true);
        }
        break;

      case EnemyAIState.DEAD:
        this.body.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, true);
        break;
    }
  }

  /**
   * Variable-rate update — sync mesh, drive AI state transitions and animations.
   */
  update(delta: number, playerPos: THREE.Vector3): void {
    if (this.isDead) return;

    this.stateTimer += delta;
    this.animTime += delta;

    // Sync mesh to physics
    const pos = this.body.translation();
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.slerp(this.targetRotation, 0.1);

    const myPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const distToPlayer = myPos.distanceTo(playerPos);

    // ── AI state transitions & animations ────────────────────────────────
    switch (this.aiState) {
      case EnemyAIState.IDLE:
        if (this.stateTimer > 2.0) {
          this.aiState = EnemyAIState.WANDER;
          this.stateTimer = 0;
          this.pickWanderTarget();
        }
        this.animIdle();
        break;

      case EnemyAIState.WANDER:
        if (this.stateTimer > 4.5) {
          this.aiState = EnemyAIState.IDLE;
          this.stateTimer = 0;
        }
        this.animRun(0.4);
        break;

      case EnemyAIState.AGGRO:
        this.animRun(Math.min(distToPlayer / 6.0, 1.0));
        break;

      case EnemyAIState.ATTACK_WINDUP:
        if (this.stateTimer >= this.windupTime) {
          this.aiState = EnemyAIState.ATTACK_STRIKE;
          this.stateTimer = 0;
          this.hasDealtDamageThisStrike = false;
        }
        this.animAttackWindup(Math.min(this.stateTimer / this.windupTime, 1));
        break;

      case EnemyAIState.ATTACK_STRIKE: {
        const beh = TYPE_BEHAVIOR[this.enemyType];
        if (this.stateTimer >= beh.strikeWindowTime) {
          this.attackCooldown = this.attackCooldownBase;
          // Ghoul hops back after striking before re-engaging (~60 % of the time)
          if (beh.disengageAfterStrike && Math.random() < beh.disengageChance) {
            this.aiState = EnemyAIState.GHOUL_RESET;
          } else {
            this.aiState = EnemyAIState.AGGRO;
          }
          this.stateTimer = 0;
        }
        this.animAttackStrike(Math.min(this.stateTimer / beh.strikeWindowTime, 1));
        break;
      }

      case EnemyAIState.HIT: {
        const hitStunTime = TYPE_BEHAVIOR[this.enemyType].hitStunTime;
        if (this.stateTimer >= hitStunTime) {
          this.aiState = EnemyAIState.AGGRO;
          this.stateTimer = 0;
        }
        this.animHit(Math.min(this.stateTimer / hitStunTime, 1));
        break;
      }

      case EnemyAIState.GHOUL_RESET: {
        // Briefly disengage; re-engage once far enough or timer expires
        const beh = TYPE_BEHAVIOR[this.enemyType];
        if (this.stateTimer >= beh.disengageTime || distToPlayer > beh.disengageRange) {
          this.aiState = EnemyAIState.AGGRO;
          this.stateTimer = 0;
        }
        // Play the run animation in reverse-ish (lean back) by passing a negative speed hint
        this.animRun(0.6);
        break;
      }

      case EnemyAIState.DEAD:
        this.animDeath(Math.min(this.stateTimer / 1.2, 1));
        // Mark fully dead after death animation + brief linger (3 seconds total)
        if (this.stateTimer >= 3.0) {
          this.isDead = true;
        }
        break;
    }

    // Hit-flash decay
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= delta;
      if (this.hitFlashTimer <= 0) {
        this.restoreEmissive();
      }
    }
  }

  /** Remove physics body and Three.js group from the world. */
  dispose(physics: PhysicsWorld): void {
    this.headGroup.remove(this.headLight);
    this.scene.remove(this.group);
    physics.world.removeRigidBody(this.body);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private enterDeadState(): void {
    this.aiState = EnemyAIState.DEAD;
    this.stateTimer = 0;
    const vel = this.body.linvel();
    this.body.setLinvel({ x: vel.x * 0.3, y: vel.y, z: vel.z * 0.3 }, true);
  }

  private pickWanderTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2 + Math.random() * 4;
    this.wanderX = this.spawnX + Math.cos(angle) * radius;
    this.wanderZ = this.spawnZ + Math.sin(angle) * radius;
    // Clamp to arena (radius 24)
    const d = Math.sqrt(this.wanderX * this.wanderX + this.wanderZ * this.wanderZ);
    if (d > 24) {
      this.wanderX = (this.wanderX / d) * 24;
      this.wanderZ = (this.wanderZ / d) * 24;
    }
  }

  /**
   * Create a mesh, add it to the flash-tracking list, and return it.
   * All meshes created this way participate in the hit-white-flash effect.
   */
  private mkMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    const stdMat = mat as THREE.MeshStandardMaterial;
    this.flashMeshes.push(m);
    this.origEmissiveColors.push(stdMat.emissive.clone());
    this.origEmissiveIntensities.push(stdMat.emissiveIntensity);
    return m;
  }

  private flashWhite(): void {
    for (const mesh of this.flashMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 3;
    }
  }

  private restoreEmissive(): void {
    for (let i = 0; i < this.flashMeshes.length; i++) {
      const mat = this.flashMeshes[i]!.material as THREE.MeshStandardMaterial;
      mat.emissive.copy(this.origEmissiveColors[i]!);
      mat.emissiveIntensity = this.origEmissiveIntensities[i]!;
    }
  }

  // ── Animations ────────────────────────────────────────────────────────────

  private animIdle(): void {
    const t = this.animTime;
    this.torsoGroup.position.y = 0.1 + Math.sin(t * Math.PI) * 0.018;
    this.headGroup.rotation.z = Math.sin(t * 0.7) * 0.06;
    this.leftArmGroup.rotation.x = Math.sin(t * 0.8) * 0.07;
    this.rightArmGroup.rotation.x = -this.leftArmGroup.rotation.x;
    this.leftLegGroup.rotation.x = 0;
    this.rightLegGroup.rotation.x = 0;
    this.torsoGroup.rotation.x = 0;
    this.torsoGroup.rotation.z = 0;
    this.torsoGroup.scale.set(1, 1, 1);
  }

  private animRun(speed: number): void {
    const t = this.animTime;
    const phase = t * 8 * Math.max(speed, 0.2);
    this.leftLegGroup.rotation.x = Math.sin(phase) * 0.5 * speed;
    this.rightLegGroup.rotation.x = -Math.sin(phase) * 0.5 * speed;
    this.leftArmGroup.rotation.x = -Math.sin(phase) * 0.35 * speed;
    this.rightArmGroup.rotation.x = Math.sin(phase) * 0.35 * speed;
    this.torsoGroup.position.y = 0.1 + Math.abs(Math.sin(phase * 2)) * 0.04;
    this.torsoGroup.rotation.x = 0.08 * speed;
    this.torsoGroup.rotation.z = 0;
    this.torsoGroup.scale.set(1, 1, 1);
  }

  private animAttackWindup(p: number): void {
    // Raise weapon overhead menacingly
    this.rightArmGroup.rotation.x = -p * 1.5;
    this.weaponGroup.rotation.x = -p * 0.9;
    this.torsoGroup.rotation.x = p * 0.18;
    this.torsoGroup.scale.set(1, 1, 1);
  }

  private animAttackStrike(p: number): void {
    // Slam down
    this.rightArmGroup.rotation.x = -1.5 + p * 2.2;
    this.weaponGroup.rotation.x = -0.9 + p * 1.4;
    this.torsoGroup.rotation.x = 0.18 - p * 0.22;
  }

  private animHit(p: number): void {
    this.torsoGroup.rotation.x = Math.sin(p * Math.PI) * (-0.3);
    this.torsoGroup.scale.set(1, 1, 1);
  }

  private animDeath(p: number): void {
    const clamped = Math.min(p, 1);
    if (clamped < 0.4) {
      const pp = clamped / 0.4;
      this.torsoGroup.rotation.z = pp * 1.4;
      this.torsoGroup.position.y = 0.1 - pp * 0.25;
    } else {
      const pp = (clamped - 0.4) / 0.6;
      this.torsoGroup.rotation.z = 1.4;
      this.torsoGroup.position.y = 0.1 - 0.25 - pp * 0.35;
    }
    this.leftLegGroup.rotation.x = clamped * 0.55;
    this.rightLegGroup.rotation.x = clamped * 0.55;
    this.torsoGroup.scale.set(1, 1, 1);
  }
}
