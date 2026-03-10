import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

// ── Enemy type ───────────────────────────────────────────────────────────────
export enum EnemyType {
  SKELETON    = 'SKELETON',
  GHOUL       = 'GHOUL',
  BRUTE       = 'BRUTE',
  NECROMANCER = 'NECROMANCER',
}

// ── Shared skeleton materials — whiter bone with subtle emissive for visibility ─
const MAT_BONE = new THREE.MeshStandardMaterial({
  color: 0xf0ead8, // whiter bone — more visible and menacing
  roughness: 0.55,
  metalness: 0.05,
  emissive: new THREE.Color(0x151008),
  emissiveIntensity: 0.3, // faint warm glow for visibility
});
const MAT_JOINT = new THREE.MeshStandardMaterial({
  color: 0xd0c8b0, // lighter joint color
  roughness: 0.65,
  metalness: 0.05,
  emissive: new THREE.Color(0x100c04),
  emissiveIntensity: 0.2,
});
const MAT_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x6a5040, // rusty iron — aged and corroded
  roughness: 0.75,
  metalness: 0.4,
  emissive: new THREE.Color(0x1a0808),
  emissiveIntensity: 0.4,
});
const MAT_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0xff2200),
  emissiveIntensity: 6.0, // brighter eye glow
  roughness: 0.1,
});

// ── Ghoul materials — sickly green with ghostly emissive aura ─────────────────
const MAT_GHOUL_BODY = new THREE.MeshStandardMaterial({
  color: 0x445a44, // darker, more sickly green
  roughness: 0.85,
  metalness: 0.0,
  emissive: new THREE.Color(0x0a1a0a),
  emissiveIntensity: 0.5, // faint green aura
  transparent: true,
  opacity: 0.95, // slight ghostly translucency
});
const MAT_GHOUL_JOINT = new THREE.MeshStandardMaterial({
  color: 0x2e452e, // darker green joints
  roughness: 0.9,
  metalness: 0.0,
  emissive: new THREE.Color(0x061006),
  emissiveIntensity: 0.4,
});
const MAT_GHOUL_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x406040, // corroded green metal
  roughness: 0.85,
  metalness: 0.15,
  emissive: new THREE.Color(0x1a3018),
  emissiveIntensity: 1.0,
});
const MAT_GHOUL_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0x44ff22),
  emissiveIntensity: 6.0, // brighter sickly green glow
  roughness: 0.1,
});

// ── Brute materials — darker with heavy armor and red glowing eyes ─────────────
const MAT_BRUTE_BODY = new THREE.MeshPhysicalMaterial({
  color: 0x4a2020, // very dark, heavy armor
  roughness: 0.6,
  metalness: 0.3,
  clearcoat: 0.2,
  clearcoatRoughness: 0.7,
});
const MAT_BRUTE_JOINT = new THREE.MeshStandardMaterial({
  color: 0x3a1515, // deep dark maroon
  roughness: 0.7,
  metalness: 0.2,
});
const MAT_BRUTE_WEAPON = new THREE.MeshStandardMaterial({
  color: 0x504030, // dark heavy iron
  roughness: 0.55,
  metalness: 0.55,
  emissive: new THREE.Color(0x501808),
  emissiveIntensity: 0.8,
});
const MAT_BRUTE_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0xff3300),
  emissiveIntensity: 7.0, // intense red demonic eyes
  roughness: 0.1,
});

// ── Necromancer materials ─────────────────────────────────────────────────────
const MAT_NECRO_ROBE = new THREE.MeshStandardMaterial({
  color: 0x1a0a2e, // dark purple-black robe
  roughness: 0.85,
  metalness: 0.05,
  emissive: new THREE.Color(0x1a0040),
  emissiveIntensity: 0.8, // subtle purple glow from within the robe
});
const MAT_NECRO_SKULL = new THREE.MeshStandardMaterial({
  color: 0xc8b8a0, // pale skull
  roughness: 0.5,
  metalness: 0.1,
});
const MAT_NECRO_EYE = new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: new THREE.Color(0x00ff55),
  emissiveIntensity: 8.0, // intense green glow
  roughness: 0.1,
});
const MAT_NECRO_STAFF = new THREE.MeshStandardMaterial({
  color: 0x2a1a0a, // dark wood
  roughness: 0.8,
  metalness: 0.1,
});
const MAT_NECRO_ORB = new THREE.MeshPhysicalMaterial({
  color: 0x00ff55,
  emissive: new THREE.Color(0x00ff55),
  emissiveIntensity: 6.0, // pulsing orb
  roughness: 0.1,
  metalness: 0.1,
  clearcoat: 1.0,
  clearcoatRoughness: 0.0,
  transparent: true,
  opacity: 0.9,
});
const MAT_NECRO_PROJECTILE = new THREE.MeshStandardMaterial({
  color: 0x00ff55,
  emissive: new THREE.Color(0x00ff55),
  emissiveIntensity: 6.0,
  roughness: 0.2,
  metalness: 0.3,
  transparent: true,
  opacity: 0.85,
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
  // Necromancer-specific states
  RETREAT, // backing away from player
  CAST,    // charging a spell projectile
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
  [EnemyType.NECROMANCER]: {
    minHp: 38, hpRange: 4, speed: 3.0, damage: 15,
    windupTime: 0.8, knockbackResistance: 0.9, scale: 1.05,
    attackCooldownBase: 3.0,
  },
};

/**
 * Procedural enemy (skeleton / ghoul / brute).
 *
 * Built from Three.js primitives. Rapier capsule physics body with enemy
 * collision groups so enemies don't push each other into a pile.
 *
 * AI states: IDLE → WANDER → AGGRO → ATTACK_WINDUP → ATTACK_STRIKE → back
 */
export class Enemy {
  readonly body: RAPIER.RigidBody;
  readonly group: THREE.Group;

  hp: number;
  maxHp: number; // mutable for modifier scaling
  isDead = false;

  /** Enemy type — used by minimap and other UI systems. */
  readonly type: EnemyType;

  /** Damage dealt per swing to the player. */
  attackDamage: number; // mutable for ELITE modifier
  /** Knockback multiplier — higher = flies further on hit. */
  readonly knockbackResistance: number;
  /** Move speed used in AGGRO state. */
  private moveSpeed: number; // mutable for modifier
  /** Windup time before a strike. */
  private readonly windupTime: number;
  /** Attack cooldown base (seconds between swings). */
  private readonly attackCooldownBase: number;

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

  // Detached limb groups that fade out after dismemberment
  private readonly detachedLimbs: Array<{ group: THREE.Group; age: number }> = [];

  // ── Necromancer projectile system ─────────────────────────────────────────
  private readonly projectiles: Array<{
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    velocity: THREE.Vector3;
    age: number;
  }> = [];
  private castTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    physics: PhysicsWorld,
    spawnX: number,
    spawnZ: number,
    enemyType: EnemyType = EnemyType.SKELETON,
  ) {
    this.spawnX = spawnX;
    this.spawnZ = spawnZ;

    this.type = enemyType;

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
      case EnemyType.NECROMANCER:
        matBody = MAT_NECRO_ROBE; matJoint = MAT_NECRO_SKULL;
        matWeapon = MAT_NECRO_STAFF; matEye = MAT_NECRO_EYE;
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

    if (enemyType === EnemyType.NECROMANCER) {
      // ── Necromancer: tall dark robe body ──────────────────────────────
      // Long robe body
      const robe = this.mkMesh(new THREE.BoxGeometry(0.28, 1.1, 0.18), matBody);
      robe.position.set(0, -0.1, 0);
      this.torsoGroup.add(robe);

      // Robe bottom flare
      const robeFlair = this.mkMesh(new THREE.CylinderGeometry(0.2, 0.28, 0.3, 8), matBody);
      robeFlair.position.set(0, -0.65, 0);
      this.torsoGroup.add(robeFlair);

      // ── Head (floating skull) ─────────────────────────────────────────
      this.headGroup = new THREE.Group();
      this.headGroup.position.set(0, 0.72, 0);

      const skull2 = this.mkMesh(new THREE.SphereGeometry(0.14, 10, 8), matJoint);
      skull2.scale.set(1, 1.15, 0.88);
      this.headGroup.add(skull2);

      // Green glowing eyes
      const eL = this.mkMesh(new THREE.SphereGeometry(0.038, 6, 4), matEye);
      eL.position.set(-0.055, 0.02, 0.1);
      this.headGroup.add(eL);
      const eR = eL.clone();
      eR.position.set(0.055, 0.02, 0.1);
      this.headGroup.add(eR);

    } else {
      // ── Standard (Skeleton/Ghoul/Brute) torso ───────────────────────
      // Ribcage cylinder
      this.torsoGroup.add(this.mkMesh(
        new THREE.CylinderGeometry(0.13, 0.15, 0.46, 12), matBody,
      ));

      // Spine connecting ribcage to hips
      const spine = this.mkMesh(new THREE.CylinderGeometry(0.034, 0.038, 0.5, 8), matBody);
      spine.position.set(0, -0.28, 0);
      this.torsoGroup.add(spine);

      // Hip bone
      const hip = this.mkMesh(new THREE.BoxGeometry(0.3, 0.09, 0.14), matBody);
      hip.position.set(0, -0.51, 0);
      this.torsoGroup.add(hip);

      // ── Head ──────────────────────────────────────────────────────────
      this.headGroup = new THREE.Group();
      this.headGroup.position.set(0, 0.6, 0);

      const skull = this.mkMesh(new THREE.SphereGeometry(0.15, 10, 8), matBody);
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
    }

    // Dim head point light — makes the enemy glow in the dark
    const HEAD_LIGHT_COLORS: Record<EnemyType, number> = {
      [EnemyType.SKELETON]:    0xff0000,
      [EnemyType.GHOUL]:       0x00ff44,
      [EnemyType.BRUTE]:       0xff4400,
      [EnemyType.NECROMANCER]: 0x00ff55,
    };
    this.headLight = new THREE.PointLight(HEAD_LIGHT_COLORS[enemyType], 0.3, 4, 2);
    this.headLight.position.set(0, 0, 0);
    this.headGroup.add(this.headLight);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ──────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.19, 0.24, 0);

    const lUpper = this.mkMesh(
      new THREE.CylinderGeometry(0.035, 0.031, 0.36, 10),
      matBody,
    );
    lUpper.position.set(0, -0.18, 0);
    this.leftArmGroup.add(lUpper);

    if (enemyType !== EnemyType.NECROMANCER) {
      const lElbow = this.mkMesh(new THREE.SphereGeometry(0.042, 8, 6), matJoint);
      lElbow.position.set(0, -0.36, 0);
      this.leftArmGroup.add(lElbow);
    }

    const lLower = this.mkMesh(new THREE.CylinderGeometry(0.027, 0.023, 0.32, 10), matBody);
    lLower.position.set(0, -0.52, 0);
    this.leftArmGroup.add(lLower);

    // Skeletal hand for necromancer
    if (enemyType === EnemyType.NECROMANCER) {
      const lHand = this.mkMesh(new THREE.SphereGeometry(0.04, 6, 4), matJoint);
      lHand.position.set(0, -0.68, 0);
      this.leftArmGroup.add(lHand);
    }

    this.torsoGroup.add(this.leftArmGroup);

    // ── Right arm ─────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.19, 0.24, 0);

    const rUpper = this.mkMesh(new THREE.CylinderGeometry(0.035, 0.031, 0.36, 10), matBody);
    rUpper.position.set(0, -0.18, 0);
    this.rightArmGroup.add(rUpper);

    if (enemyType !== EnemyType.NECROMANCER) {
      const rElbow = this.mkMesh(new THREE.SphereGeometry(0.042, 8, 6), matJoint);
      rElbow.position.set(0, -0.36, 0);
      this.rightArmGroup.add(rElbow);
    }

    const rLower = this.mkMesh(new THREE.CylinderGeometry(0.027, 0.023, 0.32, 10), matBody);
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
      const clubHandle = this.mkMesh(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 8), matJoint);
      clubHandle.position.set(0, -0.01, 0);
      this.weaponGroup.add(clubHandle);
    } else if (enemyType === EnemyType.NECROMANCER) {
      // Necromancer staff — tall cylinder with glowing orb on top
      this.weaponGroup.position.set(0.04, -0.5, 0);
      this.weaponGroup.rotation.z = 0;
      const staffShaft = this.mkMesh(new THREE.CylinderGeometry(0.022, 0.025, 1.1, 8), matWeapon);
      staffShaft.position.set(0, 0.35, 0);
      this.weaponGroup.add(staffShaft);
      const staffOrb = this.mkMesh(new THREE.SphereGeometry(0.08, 10, 8), MAT_NECRO_ORB);
      staffOrb.position.set(0, 0.95, 0);
      this.weaponGroup.add(staffOrb);
      // Orb glow
      const orbLight = new THREE.PointLight(0x00ff55, 0.6, 3, 2);
      orbLight.position.set(0, 0.95, 0);
      this.weaponGroup.add(orbLight);
    } else {
      const clubHead = this.mkMesh(new THREE.BoxGeometry(0.068, 0.7, 0.057), matWeapon);
      clubHead.position.set(0, 0.35, 0);
      this.weaponGroup.add(clubHead);
      const clubHandle = this.mkMesh(new THREE.CylinderGeometry(0.024, 0.02, 0.28, 8), matJoint);
      clubHandle.position.set(0, -0.01, 0);
      this.weaponGroup.add(clubHandle);
    }
    this.rightArmGroup.add(this.weaponGroup);

    // ── Left leg ──────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.1, -0.2, 0);

    const ltThigh = this.mkMesh(new THREE.CylinderGeometry(0.046, 0.042, 0.38, 10), matBody);
    ltThigh.position.set(0, -0.19, 0);
    this.leftLegGroup.add(ltThigh);

    if (enemyType !== EnemyType.NECROMANCER) {
      const ltKnee = this.mkMesh(new THREE.SphereGeometry(0.054, 8, 6), matJoint);
      ltKnee.position.set(0, -0.38, 0);
      this.leftLegGroup.add(ltKnee);

      const ltShin = this.mkMesh(new THREE.CylinderGeometry(0.036, 0.032, 0.34, 10), matBody);
      ltShin.position.set(0, -0.55, 0);
      this.leftLegGroup.add(ltShin);
    }

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ─────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.1, -0.2, 0);

    const rtThigh = this.mkMesh(new THREE.CylinderGeometry(0.046, 0.042, 0.38, 10), matBody);
    rtThigh.position.set(0, -0.19, 0);
    this.rightLegGroup.add(rtThigh);

    if (enemyType !== EnemyType.NECROMANCER) {
      const rtKnee = this.mkMesh(new THREE.SphereGeometry(0.054, 8, 6), matJoint);
      rtKnee.position.set(0, -0.38, 0);
      this.rightLegGroup.add(rtKnee);

      const rtShin = this.mkMesh(new THREE.CylinderGeometry(0.036, 0.032, 0.34, 10), matBody);
      rtShin.position.set(0, -0.55, 0);
      this.rightLegGroup.add(rtShin);
    }

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

  /**
   * Apply a wave modifier to this enemy's stats.
   * @param speedMult   Multiplier for move speed.
   * @param hpMult      Multiplier for max HP (also heals to new max).
   * @param scaleMult   Optional visual scale multiplier.
   */
  applyModifier(speedMult: number, hpMult: number, scaleMult = 1.0): void {
    this.moveSpeed *= speedMult;
    this.maxHp = Math.round(this.maxHp * hpMult);
    this.hp = this.maxHp;
    if (scaleMult !== 1.0) {
      const cur = this.group.scale.x;
      this.group.scale.setScalar(cur * scaleMult);
    }
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

    // ── Necromancer special AI ────────────────────────────────────────────
    if (this.type === EnemyType.NECROMANCER) {
      switch (this.aiState) {
        case EnemyAIState.IDLE:
        case EnemyAIState.WANDER: {
          if (distToPlayer < 20) {
            this.aiState = EnemyAIState.AGGRO;
          }
          this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
          break;
        }

        case EnemyAIState.AGGRO: {
          // Transition to CAST when in range and cooldown ready
          if (distToPlayer <= 15 && this.attackCooldown <= 0) {
            this.aiState = EnemyAIState.CAST;
            this.stateTimer = 0;
            this.castTimer = 0;
            this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
            break;
          }
          // Retreat if player is too close
          if (distToPlayer < 8) {
            this.aiState = EnemyAIState.RETREAT;
            break;
          }
          // Move toward preferred range (8-15 units)
          if (distToPlayer > 15) {
            const spd = this.moveSpeed;
            if (distToPlayer > 0) {
              this.body.setLinvel(
                { x: (dx / distToPlayer) * spd, y: vel.y, z: (dz / distToPlayer) * spd },
                true,
              );
              this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
            }
          } else {
            // In preferred range — face player and wait
            if (distToPlayer > 0) {
              this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
            }
            this.body.setLinvel({ x: vel.x * 0.85, y: vel.y, z: vel.z * 0.85 }, true);
          }
          break;
        }

        case EnemyAIState.RETREAT: {
          // Back away from player at half speed
          if (distToPlayer >= 8) {
            this.aiState = EnemyAIState.AGGRO;
            break;
          }
          const spd = this.moveSpeed * 0.7;
          if (distToPlayer > 0) {
            this.body.setLinvel(
              { x: -(dx / distToPlayer) * spd, y: vel.y, z: -(dz / distToPlayer) * spd },
              true,
            );
            // Still face player while retreating
            this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
          }
          break;
        }

        case EnemyAIState.CAST:
        case EnemyAIState.HIT:
          this.body.setLinvel({ x: vel.x * 0.85, y: vel.y, z: vel.z * 0.85 }, true);
          if (distToPlayer > 0) {
            this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
          }
          break;

        case EnemyAIState.DEAD:
          this.body.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, true);
          break;

        default:
          this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      }
      return;
    }

    // ── Standard melee AI ─────────────────────────────────────────────────
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
        if (distToPlayer < 2.0 && this.attackCooldown <= 0) {
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
          this.body.setLinvel(
            { x: (dx / distToPlayer) * spd, y: vel.y, z: (dz / distToPlayer) * spd },
            true,
          );
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

      case EnemyAIState.ATTACK_STRIKE:
        // Brief lunge
        if (this.stateTimer < 0.12 && distToPlayer > 0) {
          this.body.setLinvel(
            { x: (dx / distToPlayer) * 5, y: vel.y, z: (dz / distToPlayer) * 5 },
            true,
          );
        } else {
          this.body.setLinvel({ x: vel.x * 0.5, y: vel.y, z: vel.z * 0.5 }, true);
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

      case EnemyAIState.ATTACK_STRIKE:
        if (this.stateTimer >= 0.4) {
          this.attackCooldown = this.attackCooldownBase;
          this.aiState = EnemyAIState.AGGRO;
          this.stateTimer = 0;
        }
        this.animAttackStrike(Math.min(this.stateTimer / 0.4, 1));
        break;

      case EnemyAIState.HIT:
        if (this.stateTimer >= 0.3) {
          this.aiState = EnemyAIState.AGGRO;
          this.stateTimer = 0;
        }
        this.animHit(Math.min(this.stateTimer / 0.3, 1));
        break;

      case EnemyAIState.DEAD:
        this.animDeath(Math.min(this.stateTimer / 1.2, 1));
        // Mark fully dead after death animation + brief linger (3 seconds total)
        if (this.stateTimer >= 3.0) {
          this.isDead = true;
        }
        break;

      // ── Necromancer-specific states ─────────────────────────────────────
      case EnemyAIState.RETREAT:
        this.animRun(0.5);
        break;

      case EnemyAIState.CAST: {
        this.castTimer += delta;
        // Charging animation — raise staff arm
        this.rightArmGroup.rotation.x = Math.min(-this.castTimer / this.windupTime * 1.2, -1.2);
        if (this.castTimer >= this.windupTime && this.projectiles.length === 0) {
          // Fire the projectile
          const myPosC = new THREE.Vector3(pos.x, pos.y, pos.z);
          const dir = new THREE.Vector3(
            playerPos.x - myPosC.x,
            0,
            playerPos.z - myPosC.z,
          ).normalize();

          const projGeo = new THREE.SphereGeometry(0.12, 8, 6);
          const projMat = MAT_NECRO_PROJECTILE.clone();
          const projMesh = new THREE.Mesh(projGeo, projMat);
          projMesh.position.set(
            myPosC.x + dir.x * 0.5,
            myPosC.y + 1.2,
            myPosC.z + dir.z * 0.5,
          );
          projMesh.castShadow = true;

          const projLight = new THREE.PointLight(0x00ff55, 1.2, 5, 2);
          projMesh.add(projLight);

          this.scene.add(projMesh);
          this.projectiles.push({
            mesh: projMesh,
            light: projLight,
            velocity: new THREE.Vector3(dir.x * 12, 0, dir.z * 12),
            age: 0,
          });

          this.attackCooldown = this.attackCooldownBase;
          this.aiState = EnemyAIState.AGGRO;
          this.stateTimer = 0;
          this.castTimer = 0;
          this.rightArmGroup.rotation.x = 0;
        }
        break;
      }
    }

    // ── Necromancer projectile updates ─────────────────────────────────────
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i]!;
      proj.age += delta;

      proj.mesh.position.addScaledVector(proj.velocity, delta);
      // Gentle bobbing
      proj.mesh.position.y = this.group.position.y + 1.2 + Math.sin(proj.age * 8) * 0.05;

      // Remove if too old
      if (proj.age >= 3.0) {
        this.scene.remove(proj.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Tick detached limb fade-out
    for (let i = this.detachedLimbs.length - 1; i >= 0; i--) {
      const limb = this.detachedLimbs[i]!;
      limb.age += delta;
      const t = Math.min(limb.age / 4.0, 1);
      limb.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.transparent = true;
          mat.opacity = 1 - t;
        }
      });
      if (limb.age >= 4.0) {
        this.scene.remove(limb.group);
        this.detachedLimbs.splice(i, 1);
      }
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
    // Clean up any still-fading detached limbs
    for (const limb of this.detachedLimbs) {
      this.scene.remove(limb.group);
    }
    // Clean up Necromancer projectiles
    for (const proj of this.projectiles) {
      this.scene.remove(proj.mesh);
    }
    this.projectiles.length = 0;
    physics.world.removeRigidBody(this.body);
  }

  /**
   * Check if any projectile from this Necromancer hits the target position.
   * Returns the damage dealt (attackDamage) if a hit occurs, 0 otherwise.
   * Consumed (removed) projectiles that land a hit.
   */
  checkProjectileHit(targetPos: THREE.Vector3, hitRadius = 1.0): number {
    if (this.type !== EnemyType.NECROMANCER) return 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i]!;
      const dist = proj.mesh.position.distanceTo(targetPos);
      if (dist <= hitRadius) {
        this.scene.remove(proj.mesh);
        this.projectiles.splice(i, 1);
        return this.attackDamage;
      }
    }
    return 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private enterDeadState(): void {
    this.aiState = EnemyAIState.DEAD;
    this.stateTimer = 0;
    const vel = this.body.linvel();
    this.body.setLinvel({ x: vel.x * 0.3, y: vel.y, z: vel.z * 0.3 }, true);
    this.dismember();
  }

  /**
   * Randomly detach 1–2 limb groups for a gore-y death effect.
   * The detached limbs are re-parented to the scene at world position
   * and fade out over ~4 seconds.
   */
  private dismember(): void {
    // Candidate limb groups: head has highest priority
    const candidates: Array<{ group: THREE.Group; parent: THREE.Group }> = [
      { group: this.headGroup,     parent: this.torsoGroup },
      { group: this.leftArmGroup,  parent: this.torsoGroup },
      { group: this.rightArmGroup, parent: this.torsoGroup },
      { group: this.leftLegGroup,  parent: this.torsoGroup },
      { group: this.rightLegGroup, parent: this.torsoGroup },
    ];

    // Always detach 1–2 limbs; bias toward head being first pick
    const detachCount = 1 + Math.floor(Math.random() * 2);
    for (let n = 0; n < detachCount && candidates.length > 0; n++) {
      // Index 0 (head) gets double the weight on first pick
      const idx = n === 0 && Math.random() < 0.5 ? 0 : Math.floor(Math.random() * candidates.length);
      const { group, parent } = candidates.splice(idx, 1)[0]!;

      // Convert local position to world space before re-parenting
      const worldPos = new THREE.Vector3();
      group.getWorldPosition(worldPos);
      const worldQuat = new THREE.Quaternion();
      group.getWorldQuaternion(worldQuat);

      parent.remove(group);

      group.position.copy(worldPos);
      group.quaternion.copy(worldQuat);
      this.scene.add(group);

      this.detachedLimbs.push({ group, age: 0 });
    }
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
   * Create a mesh with a CLONED material, add it to the flash-tracking list, and return it.
   * Cloning ensures each enemy has its own material instances so hit-flash on one enemy
   * doesn't corrupt materials for all enemies of the same type.
   */
  private mkMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const clonedMat = (mat as THREE.MeshStandardMaterial).clone();
    const m = new THREE.Mesh(geo, clonedMat);
    m.castShadow = true;
    this.flashMeshes.push(m);
    this.origEmissiveColors.push(clonedMat.emissive.clone());
    this.origEmissiveIntensities.push(clonedMat.emissiveIntensity);
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
