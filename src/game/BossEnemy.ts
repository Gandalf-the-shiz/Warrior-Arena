import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

// Boss AI phases
export enum BossPhase {
  PHASE_1 = 1, // 100%–50% HP
  PHASE_2 = 2, // 50%–25% HP
  PHASE_3 = 3, // <25% HP (enraged)
}

// Boss AI states
enum BossAIState {
  IDLE,
  CHASE,
  ATTACK_WINDUP,
  ATTACK_STRIKE,
  SLAM_LEAP,
  SLAM_IMPACT,
  HIT,
  DEAD,
}

// Collision groups: membership = bit 2 (enemy group), filter = everything except bit 2
const BOSS_COLLISION_GROUPS = (2 << 16) | 0xFFFD;

/**
 * The Dark Champion — a powerful boss that spawns every 5th wave.
 * Three AI phases with increasing aggression. Ground slam attack in phase 2+.
 * 3× normal enemy scale with heavy plate armour aesthetic.
 */
export class BossEnemy {
  readonly body: RAPIER.RigidBody;
  readonly group: THREE.Group;

  hp: number;
  readonly maxHp: number;
  isDead = false;
  phase: BossPhase = BossPhase.PHASE_1;

  /** Damage per hit */
  readonly attackDamage = 25;
  /** Knockback resistance (lower = flies further) */
  readonly knockbackResistance = 0.25;

  // Ground slam shockwave rings for VFX
  private readonly shockwaveRings: Array<{
    mesh: THREE.Mesh; age: number; maxAge: number;
  }> = [];

  private slamPosition = new THREE.Vector3();

  private aiState: BossAIState = BossAIState.IDLE;
  private stateTimer = 0;
  private attackCooldown = 0;
  private hasDealtDamageThisStrike = false;
  private hasDealtSlamDamage = false;

  private moveSpeed = 3.0;
  private windupTime = 1.5; // phase 1 windup (long, telegraphed)
  private attackCooldownBase = 2.5;

  private animTime = 0;
  private readonly targetRotation = new THREE.Quaternion();

  // Visual sub-groups
  private readonly torsoGroup: THREE.Group;
  private readonly headGroup: THREE.Group;
  private readonly leftArmGroup: THREE.Group;
  private readonly rightArmGroup: THREE.Group;
  private readonly leftLegGroup: THREE.Group;
  private readonly rightLegGroup: THREE.Group;
  private readonly swordGroup: THREE.Group;

  // Visor glow material (changes color in phase 3)
  private readonly visorMat: THREE.MeshStandardMaterial;

  // Hit flash tracking
  private hitFlashTimer = 0;
  private readonly flashMeshes: THREE.Mesh[] = [];
  private readonly origEmissiveColors: THREE.Color[] = [];
  private readonly origEmissiveIntensities: number[] = [];

  // Detached limbs on death
  private readonly detachedLimbs: Array<{ group: THREE.Group; age: number }> = [];

  constructor(
    private readonly scene: THREE.Scene,
    physics: PhysicsWorld,
    spawnX: number,
    spawnZ: number,
    bossWaveNumber: number, // wave 5 = 1, wave 10 = 2, etc.
  ) {
    this.maxHp = 200 + bossWaveNumber * 50;
    this.hp = this.maxHp;

    // ── Physics body ─────────────────────────────────────────────────────
    this.body = physics.createDynamicBody(spawnX, 3, spawnZ, true);
    this.body.setLinearDamping(6);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.55)
      .setFriction(0.5)
      .setRestitution(0.0)
      .setCollisionGroups(BOSS_COLLISION_GROUPS);
    physics.world.createCollider(colliderDesc, this.body);

    // ── Materials ─────────────────────────────────────────────────────────
    const matArmor = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, // dark iron
      roughness: 0.4,
      metalness: 0.8,
      emissive: new THREE.Color(0x0a0808),
      emissiveIntensity: 0.3,
    });
    const matArmorDark = new THREE.MeshStandardMaterial({
      color: 0x0d0d0d,
      roughness: 0.5,
      metalness: 0.7,
    });
    const matSpike = new THREE.MeshStandardMaterial({
      color: 0x2a1a0a,
      roughness: 0.6,
      metalness: 0.5,
    });
    const matCape = new THREE.MeshStandardMaterial({
      color: 0x1a0505, // very dark red
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const matSword = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.3,
      metalness: 0.9,
      emissive: new THREE.Color(0x200808),
      emissiveIntensity: 0.5,
    });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0xff0000),
      emissiveIntensity: 3.0,
      roughness: 0.2,
    });

    // ── Build model (3× scale) ────────────────────────────────────────────
    this.group = new THREE.Group();

    // Torso — heavy plate torso
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.2, 0);

    const chestArmor = this.mkMesh(new THREE.BoxGeometry(0.55, 0.65, 0.32), matArmor);
    chestArmor.position.set(0, 0.05, 0);
    this.torsoGroup.add(chestArmor);

    // Chest detail — center plate
    const centerPlate = this.mkMesh(new THREE.BoxGeometry(0.25, 0.4, 0.04), matArmorDark);
    centerPlate.position.set(0, 0.05, 0.17);
    this.torsoGroup.add(centerPlate);

    // Hip armor
    const hipArmor = this.mkMesh(new THREE.BoxGeometry(0.5, 0.2, 0.28), matArmor);
    hipArmor.position.set(0, -0.4, 0);
    this.torsoGroup.add(hipArmor);

    // ── Shoulder spikes ────────────────────────────────────────────────────
    const addShoulder = (sign: number): void => {
      const shoulder = this.mkMesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 8), matArmor);
      shoulder.position.set(sign * 0.36, 0.26, 0);
      this.torsoGroup.add(shoulder);
      // Three spikes
      for (let si = 0; si < 3; si++) {
        const spike = this.mkMesh(new THREE.ConeGeometry(0.04, 0.22, 6), matSpike);
        spike.position.set(
          sign * (0.36 + Math.cos(si * Math.PI * 2 / 3) * 0.09),
          0.44 + si * 0.02,
          Math.sin(si * Math.PI * 2 / 3) * 0.09,
        );
        this.torsoGroup.add(spike);
      }
    };
    addShoulder(-1);
    addShoulder(1);

    // Cape
    const capeGeo = new THREE.PlaneGeometry(0.8, 1.0, 4, 6);
    const cape = this.mkMesh(capeGeo, matCape);
    cape.position.set(0, -0.1, -0.17);
    cape.rotation.x = 0.15;
    this.torsoGroup.add(cape);

    // ── Head (helmet) ──────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.76, 0);

    const helmet = this.mkMesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), matArmor);
    this.headGroup.add(helmet);

    // Visor (glowing red)
    const visor = this.mkMesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), this.visorMat);
    visor.position.set(0, 0.0, 0.17);
    this.headGroup.add(visor);

    // Helmet crest
    const crest = this.mkMesh(new THREE.BoxGeometry(0.06, 0.18, 0.3), matSpike);
    crest.position.set(0, 0.24, 0);
    this.headGroup.add(crest);

    // Head glow
    const headLight = new THREE.PointLight(0xff2200, 1.0, 6, 2);
    headLight.position.set(0, 0, 0.2);
    this.headGroup.add(headLight);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ───────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.38, 0.24, 0);

    const lUpperArm = this.mkMesh(new THREE.CylinderGeometry(0.095, 0.085, 0.44, 10), matArmor);
    lUpperArm.position.set(0, -0.22, 0);
    this.leftArmGroup.add(lUpperArm);

    const lElbow = this.mkMesh(new THREE.SphereGeometry(0.1, 8, 6), matArmorDark);
    lElbow.position.set(0, -0.44, 0);
    this.leftArmGroup.add(lElbow);

    const lForearm = this.mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.38, 10), matArmor);
    lForearm.position.set(0, -0.63, 0);
    this.leftArmGroup.add(lForearm);

    this.torsoGroup.add(this.leftArmGroup);

    // ── Right arm ──────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.38, 0.24, 0);

    const rUpperArm = this.mkMesh(new THREE.CylinderGeometry(0.095, 0.085, 0.44, 10), matArmor);
    rUpperArm.position.set(0, -0.22, 0);
    this.rightArmGroup.add(rUpperArm);

    const rElbow = this.mkMesh(new THREE.SphereGeometry(0.1, 8, 6), matArmorDark);
    rElbow.position.set(0, -0.44, 0);
    this.rightArmGroup.add(rElbow);

    const rForearm = this.mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.38, 10), matArmor);
    rForearm.position.set(0, -0.63, 0);
    this.rightArmGroup.add(rForearm);

    this.torsoGroup.add(this.rightArmGroup);

    // ── Greatsword ─────────────────────────────────────────────────────────
    this.swordGroup = new THREE.Group();
    this.swordGroup.position.set(0.06, -0.82, 0);

    const swordBlade = this.mkMesh(new THREE.BoxGeometry(0.09, 1.5, 0.03), matSword);
    swordBlade.position.set(0, 0.75, 0);
    this.swordGroup.add(swordBlade);

    const swordGuard = this.mkMesh(new THREE.BoxGeometry(0.45, 0.07, 0.07), matArmorDark);
    swordGuard.position.set(0, 0.12, 0);
    this.swordGroup.add(swordGuard);

    const swordHandle = this.mkMesh(new THREE.CylinderGeometry(0.04, 0.035, 0.35, 8), matArmorDark);
    swordHandle.position.set(0, -0.1, 0);
    this.swordGroup.add(swordHandle);

    const swordPommel = this.mkMesh(new THREE.SphereGeometry(0.06, 6, 5), matSpike);
    swordPommel.position.set(0, -0.3, 0);
    this.swordGroup.add(swordPommel);

    this.rightArmGroup.add(this.swordGroup);

    // ── Left leg ───────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.2, -0.35, 0);

    const ltThigh = this.mkMesh(new THREE.CylinderGeometry(0.12, 0.1, 0.5, 10), matArmor);
    ltThigh.position.set(0, -0.25, 0);
    this.leftLegGroup.add(ltThigh);

    const ltKnee = this.mkMesh(new THREE.SphereGeometry(0.12, 8, 6), matArmorDark);
    ltKnee.position.set(0, -0.5, 0);
    this.leftLegGroup.add(ltKnee);

    const ltShin = this.mkMesh(new THREE.CylinderGeometry(0.1, 0.085, 0.44, 10), matArmor);
    ltShin.position.set(0, -0.72, 0);
    this.leftLegGroup.add(ltShin);

    const ltFoot = this.mkMesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), matArmor);
    ltFoot.position.set(0, -0.97, 0.05);
    this.leftLegGroup.add(ltFoot);

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ──────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.2, -0.35, 0);

    const rtThigh = this.mkMesh(new THREE.CylinderGeometry(0.12, 0.1, 0.5, 10), matArmor);
    rtThigh.position.set(0, -0.25, 0);
    this.rightLegGroup.add(rtThigh);

    const rtKnee = this.mkMesh(new THREE.SphereGeometry(0.12, 8, 6), matArmorDark);
    rtKnee.position.set(0, -0.5, 0);
    this.rightLegGroup.add(rtKnee);

    const rtShin = this.mkMesh(new THREE.CylinderGeometry(0.1, 0.085, 0.44, 10), matArmor);
    rtShin.position.set(0, -0.72, 0);
    this.rightLegGroup.add(rtShin);

    const rtFoot = this.mkMesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), matArmor);
    rtFoot.position.set(0, -0.97, 0.05);
    this.rightLegGroup.add(rtFoot);

    this.torsoGroup.add(this.rightLegGroup);

    this.group.add(this.torsoGroup);

    // Boss is 3× the scale of a normal enemy
    this.group.scale.set(3, 3, 3);
    this.group.castShadow = true;

    this.scene.add(this.group);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getPosition(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /**
   * Returns true when this enemy's strike window should deal damage.
   */
  isInStrikeWindow(): boolean {
    return (
      (this.aiState === BossAIState.ATTACK_STRIKE ||
       this.aiState === BossAIState.SLAM_IMPACT) &&
      !this.hasDealtDamageThisStrike &&
      this.stateTimer >= 0.05
    );
  }

  markDamageDealt(): void {
    this.hasDealtDamageThisStrike = true;
  }

  /**
   * Returns true during slam impact window and whether slam damage has been dealt.
   * Slam hits everything in a 5-unit radius.
   */
  isSlamActive(): boolean {
    return this.aiState === BossAIState.SLAM_IMPACT && !this.hasDealtSlamDamage;
  }

  markSlamDealt(): void {
    this.hasDealtSlamDamage = true;
  }

  getSlamPosition(): THREE.Vector3 {
    return this.slamPosition.clone();
  }

  /**
   * Take damage from the player.
   */
  takeDamage(damage: number, knockbackDir: THREE.Vector3): void {
    if (this.isDead) return;

    this.hp -= damage;
    const force = (3 + damage * 0.08) * this.knockbackResistance;
    this.body.applyImpulse(
      { x: knockbackDir.x * force, y: 0.8, z: knockbackDir.z * force },
      true,
    );

    this.hitFlashTimer = 0.1;
    this.flashWhite();

    if (this.hp <= 0) {
      this.hp = 0;
      this.enterDeadState();
    } else {
      this.updatePhase();
      if (this.aiState !== BossAIState.ATTACK_WINDUP &&
          this.aiState !== BossAIState.ATTACK_STRIKE &&
          this.aiState !== BossAIState.SLAM_LEAP &&
          this.aiState !== BossAIState.SLAM_IMPACT) {
        this.aiState = BossAIState.HIT;
        this.stateTimer = 0;
      }
    }
  }

  /**
   * Fixed-rate (60 Hz) physics update.
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
      case BossAIState.IDLE:
        if (distToPlayer < 25) this.aiState = BossAIState.CHASE;
        this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
        break;

      case BossAIState.CHASE: {
        if (distToPlayer < 2.8 && this.attackCooldown <= 0) {
          // Phase 2+ can slam if health is low enough
          if (this.phase >= BossPhase.PHASE_2 && Math.random() < 0.35) {
            this.aiState = BossAIState.SLAM_LEAP;
            this.stateTimer = 0;
            this.hasDealtSlamDamage = false;
          } else {
            this.aiState = BossAIState.ATTACK_WINDUP;
            this.stateTimer = 0;
          }
          this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
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

      case BossAIState.ATTACK_WINDUP:
      case BossAIState.HIT:
        this.body.setLinvel({ x: vel.x * 0.7, y: vel.y, z: vel.z * 0.7 }, true);
        if (distToPlayer > 0) {
          this.targetRotation.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0));
        }
        break;

      case BossAIState.ATTACK_STRIKE:
        if (this.stateTimer < 0.2 && distToPlayer > 0) {
          this.body.setLinvel(
            { x: (dx / distToPlayer) * 6, y: vel.y, z: (dz / distToPlayer) * 6 },
            true,
          );
        } else {
          this.body.setLinvel({ x: vel.x * 0.5, y: vel.y, z: vel.z * 0.5 }, true);
        }
        break;

      case BossAIState.SLAM_LEAP:
        // Brief upward leap toward player
        if (this.stateTimer < 0.4 && distToPlayer > 0) {
          this.body.setLinvel(
            { x: (dx / distToPlayer) * 8, y: 6, z: (dz / distToPlayer) * 8 },
            true,
          );
        } else {
          this.body.setLinvel({ x: vel.x * 0.3, y: vel.y, z: vel.z * 0.3 }, true);
        }
        break;

      case BossAIState.SLAM_IMPACT:
        this.body.setLinvel({ x: vel.x * 0.2, y: vel.y, z: vel.z * 0.2 }, true);
        break;

      case BossAIState.DEAD:
        this.body.setLinvel({ x: vel.x * 0.85, y: vel.y, z: vel.z * 0.85 }, true);
        break;
    }
  }

  /**
   * Variable-rate update — mesh sync, AI state transitions, animations.
   * @returns shockwave data if a slam was triggered this frame
   */
  update(delta: number, playerPos: THREE.Vector3): {
    slamTriggered: boolean;
    slamPos: THREE.Vector3;
  } {
    let slamTriggered = false;
    const slamPos = new THREE.Vector3();

    if (this.isDead) {
      // Update shockwave rings even after death starts
      this.updateShockwaveRings(delta);
      return { slamTriggered, slamPos };
    }

    this.stateTimer += delta;
    this.animTime += delta;

    const pos = this.body.translation();
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.slerp(this.targetRotation, 0.08);

    const myPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const distToPlayer = myPos.distanceTo(playerPos);

    switch (this.aiState) {
      case BossAIState.IDLE:
        this.animIdle();
        break;

      case BossAIState.CHASE:
        this.animRun();
        break;

      case BossAIState.ATTACK_WINDUP:
        if (this.stateTimer >= this.windupTime) {
          this.aiState = BossAIState.ATTACK_STRIKE;
          this.stateTimer = 0;
          this.hasDealtDamageThisStrike = false;
        }
        this.animAttackWindup(Math.min(this.stateTimer / this.windupTime, 1));
        break;

      case BossAIState.ATTACK_STRIKE:
        if (this.stateTimer >= 0.5) {
          this.attackCooldown = this.attackCooldownBase;
          this.aiState = BossAIState.CHASE;
          this.stateTimer = 0;
        }
        this.animAttackStrike(Math.min(this.stateTimer / 0.5, 1));
        break;

      case BossAIState.SLAM_LEAP:
        if (this.stateTimer >= 0.8) {
          // Slam down
          this.aiState = BossAIState.SLAM_IMPACT;
          this.stateTimer = 0;
          slamTriggered = true;
          slamPos.copy(myPos);
          this.slamPosition.copy(myPos);
          this.spawnShockwave(myPos);
        }
        this.animSlamLeap(Math.min(this.stateTimer / 0.8, 1));
        break;

      case BossAIState.SLAM_IMPACT:
        if (this.stateTimer >= 0.6) {
          this.attackCooldown = this.attackCooldownBase + 1.0;
          this.aiState = BossAIState.CHASE;
          this.stateTimer = 0;
        }
        this.animSlamImpact(Math.min(this.stateTimer / 0.6, 1));
        break;

      case BossAIState.HIT:
        if (this.stateTimer >= 0.25) {
          this.aiState = BossAIState.CHASE;
          this.stateTimer = 0;
        }
        this.animHit(Math.min(this.stateTimer / 0.25, 1));
        break;

      case BossAIState.DEAD:
        this.animDeath(Math.min(this.stateTimer / 2.0, 1));
        if (this.stateTimer >= 4.0) {
          this.isDead = true;
        }
        break;
    }

    // Update shockwave rings
    this.updateShockwaveRings(delta);

    // Decay hit flash
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= delta;
      if (this.hitFlashTimer <= 0) {
        this.restoreEmissive();
      }
    }

    // Update phase visor glow in phase 3
    if (this.phase === BossPhase.PHASE_3) {
      const pulse = 3.0 + Math.sin(this.animTime * 6) * 1.5;
      this.visorMat.emissiveIntensity = pulse;
    }

    void distToPlayer;
    return { slamTriggered, slamPos };
  }

  /** Remove from scene and physics world. */
  dispose(physics: PhysicsWorld): void {
    this.scene.remove(this.group);
    for (const limb of this.detachedLimbs) {
      this.scene.remove(limb.group);
    }
    for (const ring of this.shockwaveRings) {
      this.scene.remove(ring.mesh);
    }
    physics.world.removeRigidBody(this.body);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private updatePhase(): void {
    const hpPct = this.hp / this.maxHp;
    if (hpPct > 0.5) {
      this.phase = BossPhase.PHASE_1;
      this.moveSpeed = 3.0;
      this.windupTime = 1.5;
      this.attackCooldownBase = 2.5;
    } else if (hpPct > 0.25) {
      this.phase = BossPhase.PHASE_2;
      this.moveSpeed = 3.5;
      this.windupTime = 1.2;
      this.attackCooldownBase = 2.0;
    } else {
      this.phase = BossPhase.PHASE_3;
      this.moveSpeed = 4.5;
      this.windupTime = 0.9;
      this.attackCooldownBase = 1.5;
    }
  }

  private enterDeadState(): void {
    this.aiState = BossAIState.DEAD;
    this.stateTimer = 0;
    const vel = this.body.linvel();
    this.body.setLinvel({ x: vel.x * 0.2, y: vel.y, z: vel.z * 0.2 }, true);
    this.dismember();
    this.isDead = false; // will be set true after anim
  }

  private dismember(): void {
    const candidates: Array<{ group: THREE.Group; parent: THREE.Group }> = [
      { group: this.headGroup,     parent: this.torsoGroup },
      { group: this.leftArmGroup,  parent: this.torsoGroup },
      { group: this.rightArmGroup, parent: this.torsoGroup },
    ];

    const detachCount = 1 + Math.floor(Math.random() * 2);
    for (let n = 0; n < detachCount && candidates.length > 0; n++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const { group, parent } = candidates.splice(idx, 1)[0]!;

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

  private spawnShockwave(center: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.12, 8, 24),
        new THREE.MeshStandardMaterial({
          color: 0xff4400,
          emissive: new THREE.Color(0xff2200),
          emissiveIntensity: 3.0,
          transparent: true,
          opacity: 0.9,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(center);
      ring.position.y = 0.1;
      this.scene.add(ring);
      this.shockwaveRings.push({
        mesh: ring,
        age: i * 0.15,
        maxAge: 0.8,
      });
    }
  }

  private updateShockwaveRings(delta: number): void {
    for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
      const ring = this.shockwaveRings[i]!;
      ring.age += delta;
      const t = ring.age / ring.maxAge;
      const s = 1 + t * 10; // expand from 1 to 11 units radius
      ring.mesh.scale.set(s, s, s);
      (ring.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - t);
      if (ring.age >= ring.maxAge) {
        this.scene.remove(ring.mesh);
        this.shockwaveRings.splice(i, 1);
      }
    }
  }

  private mkMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const clonedMat = (mat as THREE.MeshStandardMaterial).clone();
    const m = new THREE.Mesh(geo, clonedMat);
    m.castShadow = true;
    m.receiveShadow = true;
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

  // ── Animations ─────────────────────────────────────────────────────────────

  private animIdle(): void {
    const t = this.animTime;
    this.torsoGroup.position.y = 0.2 + Math.sin(t * 1.5) * 0.015;
    this.leftArmGroup.rotation.x = Math.sin(t * 0.8) * 0.06;
    this.rightArmGroup.rotation.x = -this.leftArmGroup.rotation.x;
  }

  private animRun(): void {
    const t = this.animTime;
    const phase = t * 6;
    this.leftLegGroup.rotation.x = Math.sin(phase) * 0.45;
    this.rightLegGroup.rotation.x = -Math.sin(phase) * 0.45;
    this.leftArmGroup.rotation.x = -Math.sin(phase) * 0.3;
    this.rightArmGroup.rotation.x = Math.sin(phase) * 0.3;
    this.torsoGroup.position.y = 0.2 + Math.abs(Math.sin(phase * 2)) * 0.03;
    this.torsoGroup.rotation.x = 0.06;
  }

  private animAttackWindup(p: number): void {
    // Raise sword high overhead
    this.rightArmGroup.rotation.x = -p * 2.0;
    this.swordGroup.rotation.x = -p * 1.0;
    this.torsoGroup.rotation.x = p * 0.2;
    this.leftArmGroup.rotation.z = -p * 0.3;
  }

  private animAttackStrike(p: number): void {
    this.rightArmGroup.rotation.x = -2.0 + p * 2.8;
    this.swordGroup.rotation.x = -1.0 + p * 1.4;
    this.torsoGroup.rotation.x = 0.2 - p * 0.25;
  }

  private animSlamLeap(p: number): void {
    // Jump up
    this.torsoGroup.position.y = 0.2 + Math.sin(p * Math.PI) * 1.5;
    this.rightArmGroup.rotation.x = -p * 1.8;
    this.leftArmGroup.rotation.x = -p * 1.8;
    this.leftLegGroup.rotation.x = -p * 0.5;
    this.rightLegGroup.rotation.x = -p * 0.5;
  }

  private animSlamImpact(p: number): void {
    // Slam down
    this.torsoGroup.position.y = 0.2 - p * 0.35;
    this.rightArmGroup.rotation.x = -1.8 + p * 2.2;
    this.leftArmGroup.rotation.x = -1.8 + p * 2.2;
    this.torsoGroup.rotation.x = p * 0.4;
  }

  private animHit(p: number): void {
    this.torsoGroup.rotation.x = Math.sin(p * Math.PI) * -0.25;
  }

  private animDeath(p: number): void {
    if (p < 0.4) {
      const pp = p / 0.4;
      this.torsoGroup.rotation.z = pp * 1.8;
      this.torsoGroup.position.y = 0.2 - pp * 0.3;
    } else {
      const pp = (p - 0.4) / 0.6;
      this.torsoGroup.rotation.z = 1.8;
      this.torsoGroup.position.y = 0.2 - 0.3 - pp * 0.5;
    }
    this.leftLegGroup.rotation.x = p * 0.5;
    this.rightLegGroup.rotation.x = p * 0.5;
  }
}
