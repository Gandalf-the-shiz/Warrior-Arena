import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

// Collision group: membership = bit 2 (enemy), filter = everything except bit 2
const COMMANDER_COLLISION_GROUPS = (2 << 16) | 0xFFFD;

/** Probability of blocking a hit when in block stance. */
const BLOCK_CHANCE = 0.30;

enum CommanderAIState {
  IDLE,
  CHASE,
  ATTACK_WINDUP,
  ATTACK_STRIKE,
  CHARGE_WINDUP,
  CHARGING,
  BLOCK_STANCE,
  RALLY,
  HIT,
  DEAD,
}

/**
 * Enemy Commander — elite enemy that appears from wave 8 onward.
 * Has 200 HP, deals 25 damage, and has three special behaviors:
 *  - Rally: Buffs nearby enemies with a red pulse every 10s
 *  - Charge: Winds up and charges at 3x speed
 *  - Block Stance: 30% chance to block player attacks
 */
export class EnemyCommander {
  readonly body: RAPIER.RigidBody;
  readonly group: THREE.Group;

  hp = 200;
  readonly maxHp = 200;
  isDead = false;
  readonly attackDamage = 25;
  readonly knockbackResistance = 0.3;

  // Rally effect: notify nearby enemies (set from outside)
  onRally: ((radius: number) => void) | null = null;

  private aiState: CommanderAIState = CommanderAIState.IDLE;
  private stateTimer = 0;
  private attackCooldown = 1.5;
  private rallyTimer = 10.0;
  private chargeSpeed = 0;
  private chargeDirection = new THREE.Vector3();
  private hasDealtDamageThisStrike = false;
  private isBlockingStance = false;
  private invincibilityTimer = 0;

  private readonly moveSpeed = 3.5;
  private readonly targetRotation = new THREE.Quaternion();
  private animTime = 0;

  // Visual sub-groups
  private readonly torsoGroup: THREE.Group;
  private readonly headGroup: THREE.Group;
  private readonly rightArmGroup: THREE.Group;
  private readonly leftLegGroup: THREE.Group;
  private readonly rightLegGroup: THREE.Group;

  // Charge trail sparks
  private readonly chargeTrail: THREE.Points;

  // Rally pulse ring
  private readonly rallyRing: THREE.Mesh;
  private rallyAge = 0;
  private rallyActive = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    startX: number,
    startZ: number,
  ) {
    // ── Physics ─────────────────────────────────────────────────────────
    this.body = this.physics.createDynamicBody(startX, 2, startZ, true);
    this.body.setLinearDamping(5);
    this.physics.createCapsuleCollider(this.body, 0.45, 0.7, 0.6, 0.0);
    try {
      (this.body.collider(0) as RAPIER.Collider).setCollisionGroups(COMMANDER_COLLISION_GROUPS);
    } catch (_e) { /* optional */ }

    // ── Visual model ─────────────────────────────────────────────────────
    this.group = new THREE.Group();
    this.group.scale.setScalar(1.4); // Commander is tall

    // Materials
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a, metalness: 0.9, roughness: 0.2,
      emissive: new THREE.Color(0x330000), emissiveIntensity: 0.8,
    });
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xaa1111, emissive: new THREE.Color(0x880000), emissiveIntensity: 1.5,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xaa8822, metalness: 0.8, roughness: 0.3,
    });
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0x990000, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
    });

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    };

    // Torso
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.y = 0.05;
    const cuirass = mk(new THREE.BoxGeometry(0.60, 0.58, 0.28), ironMat);
    cuirass.position.y = 0.08;
    this.torsoGroup.add(cuirass);

    // Chest red emblem
    const emblem = mk(new THREE.BoxGeometry(0.12, 0.22, 0.06), redMat);
    emblem.position.set(0, 0.10, 0.14);
    this.torsoGroup.add(emblem);

    // Pauldrons (horned)
    for (const side of [-1, 1]) {
      const pauldron = mk(new THREE.BoxGeometry(0.22, 0.18, 0.28), ironMat);
      pauldron.position.set(side * 0.44, 0.38, 0);
      this.torsoGroup.add(pauldron);
      // Horn
      const horn = mk(new THREE.ConeGeometry(0.04, 0.22, 6), goldMat);
      horn.position.set(side * 0.46, 0.58, 0);
      horn.rotation.z = side * 0.4;
      this.torsoGroup.add(horn);
    }

    // Belt
    const belt = mk(new THREE.BoxGeometry(0.56, 0.10, 0.26), goldMat);
    belt.position.y = -0.24;
    this.torsoGroup.add(belt);

    // Cape
    const capeGeo = new THREE.PlaneGeometry(0.7, 1.2, 1, 6);
    const cape = mk(capeGeo, capeMat);
    cape.position.set(0, 0.10, -0.16);
    this.torsoGroup.add(cape);

    // Head / helmet
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.65, 0);
    const helm = mk(new THREE.BoxGeometry(0.32, 0.34, 0.30), ironMat);
    this.headGroup.add(helm);
    // Horned helmet
    for (const side of [-1, 1]) {
      const helmHorn = mk(new THREE.ConeGeometry(0.05, 0.28, 6), goldMat);
      helmHorn.position.set(side * 0.16, 0.22, 0);
      helmHorn.rotation.z = side * 0.35;
      this.headGroup.add(helmHorn);
    }
    // Visor
    const visor = mk(new THREE.BoxGeometry(0.26, 0.08, 0.06), new THREE.MeshStandardMaterial({
      color: 0xdd1111, emissive: new THREE.Color(0xcc0000), emissiveIntensity: 4,
    }));
    visor.position.set(0, 0.02, 0.15);
    this.headGroup.add(visor);
    this.torsoGroup.add(this.headGroup);

    // Arms
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.48, 0.28, 0);
    const rArm = mk(new THREE.CylinderGeometry(0.09, 0.08, 0.60, 8), ironMat);
    rArm.position.y = -0.3;
    this.rightArmGroup.add(rArm);
    // Axe
    const axeHandle = mk(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.8 }));
    axeHandle.position.y = -0.85;
    this.rightArmGroup.add(axeHandle);
    const axeHead = mk(new THREE.BoxGeometry(0.5, 0.22, 0.06), ironMat);
    axeHead.position.set(0.14, -1.28, 0);
    axeHead.rotation.z = 0.25;
    this.rightArmGroup.add(axeHead);
    this.torsoGroup.add(this.rightArmGroup);

    // Legs
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.22, -0.52, 0);
    const lLeg = mk(new THREE.CylinderGeometry(0.11, 0.09, 0.6, 8), ironMat);
    lLeg.position.y = -0.3;
    this.leftLegGroup.add(lLeg);
    this.torsoGroup.add(this.leftLegGroup);

    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.22, -0.52, 0);
    const rLeg = mk(new THREE.CylinderGeometry(0.11, 0.09, 0.6, 8), ironMat);
    rLeg.position.y = -0.3;
    this.rightLegGroup.add(rLeg);
    this.torsoGroup.add(this.rightLegGroup);

    this.group.add(this.torsoGroup);
    this.scene.add(this.group);

    // ── Charge trail ──────────────────────────────────────────────────────
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
    this.chargeTrail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
      color: 0xff2200, size: 0.12, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.chargeTrail);

    // ── Rally ring ────────────────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.1, 0.5, 32);
    this.rallyRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xff2200, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.rallyRing.rotation.x = -Math.PI / 2;
    this.rallyRing.visible = false;
    this.scene.add(this.rallyRing);
  }

  getPosition(): THREE.Vector3 {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  isInStrikeWindow(): boolean {
    return this.aiState === CommanderAIState.ATTACK_STRIKE && !this.hasDealtDamageThisStrike;
  }

  markDamageDealt(): void {
    this.hasDealtDamageThisStrike = true;
  }

  takeDamage(damage: number, knockbackDir: THREE.Vector3): void {
    if (this.isDead || this.invincibilityTimer > 0) return;

    // 30% chance to block
    if (this.isBlockingStance && Math.random() < BLOCK_CHANCE) {
      damage = Math.round(damage * 0.5);
    }

    this.hp = Math.max(0, this.hp - damage);
    this.invincibilityTimer = 0.2;

    if (this.hp <= 0) {
      this.isDead = true;
      this.aiState = CommanderAIState.DEAD;
    } else {
      const vel = this.body.linvel();
      this.body.setLinvel({
        x: vel.x + knockbackDir.x * 3 * (1 - this.knockbackResistance),
        y: vel.y,
        z: vel.z + knockbackDir.z * 3 * (1 - this.knockbackResistance),
      }, true);
      if (this.aiState !== CommanderAIState.CHARGING) {
        this.aiState = CommanderAIState.HIT;
        this.stateTimer = 0.2;
      }
    }
  }

  fixedUpdate(playerPos: THREE.Vector3): void {
    if (this.isDead) return;

    const pos = this.body.translation();
    const dist = Math.sqrt(
      (pos.x - playerPos.x) ** 2 + (pos.z - playerPos.z) ** 2,
    );

    switch (this.aiState) {
      case CommanderAIState.CHASE: {
        const dx = playerPos.x - pos.x;
        const dz = playerPos.z - pos.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.01) {
          const vel = this.body.linvel();
          this.body.setLinvel({ x: (dx / len) * this.moveSpeed, y: vel.y, z: (dz / len) * this.moveSpeed }, true);
        }
        break;
      }
      case CommanderAIState.CHARGING: {
        const vel = this.body.linvel();
        this.body.setLinvel({
          x: this.chargeDirection.x * this.chargeSpeed,
          y: vel.y,
          z: this.chargeDirection.z * this.chargeSpeed,
        }, true);
        break;
      }
      default: {
        const vel = this.body.linvel();
        this.body.setLinvel({ x: vel.x * 0.6, y: vel.y, z: vel.z * 0.6 }, true);
        break;
      }
    }

    // Rotate toward player
    if (dist > 0.5 && this.aiState !== CommanderAIState.DEAD) {
      const angle = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z);
      this.targetRotation.setFromEuler(new THREE.Euler(0, angle, 0));
    }
  }

  update(delta: number, playerPos: THREE.Vector3): void {
    if (this.isDead) {
      this.animDeath(delta);
      return;
    }

    this.animTime += delta;

    if (this.invincibilityTimer > 0) this.invincibilityTimer -= delta;
    if (this.attackCooldown > 0) this.attackCooldown -= delta;
    this.rallyTimer -= delta;

    const pos = this.getPosition();
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.slerp(this.targetRotation, 0.1);

    const dist = pos.distanceTo(playerPos);

    // ── Rally pulse ────────────────────────────────────────────────────
    if (this.rallyTimer <= 0) {
      this.rallyTimer = 10.0;
      this.aiState = CommanderAIState.RALLY;
      this.stateTimer = 1.5;
      this.rallyActive = true;
      this.rallyAge = 0;
      this.rallyRing.visible = true;
      this.rallyRing.position.copy(pos);
      this.onRally?.(8.0);
    }

    // Rally ring animation
    if (this.rallyActive) {
      this.rallyAge += delta;
      const RALLY_DURATION = 1.5;
      if (this.rallyAge >= RALLY_DURATION) {
        this.rallyActive = false;
        this.rallyRing.visible = false;
      } else {
        const t = this.rallyAge / RALLY_DURATION;
        const scale = 1 + t * 14;
        this.rallyRing.scale.set(scale, scale, scale);
        (this.rallyRing.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
        this.rallyRing.position.copy(pos).setY(0.05);
      }
    }

    // ── State machine ──────────────────────────────────────────────────
    switch (this.aiState) {
      case CommanderAIState.IDLE:
      case CommanderAIState.CHASE:
        this.aiState = CommanderAIState.CHASE;
        // Transition to attack or charge when close
        if (dist < 2.2 && this.attackCooldown <= 0) {
          const roll = Math.random();
          if (roll < 0.35) {
            // Charge attack
            this.aiState = CommanderAIState.CHARGE_WINDUP;
            this.stateTimer = 1.0;
            const dx = playerPos.x - pos.x;
            const dz = playerPos.z - pos.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            this.chargeDirection.set(dx / len, 0, dz / len);
          } else {
            this.aiState = CommanderAIState.ATTACK_WINDUP;
            this.stateTimer = 0.7;
          }
        } else if (dist < 2.2 && Math.random() < 0.005) {
          // Occasional block stance
          this.isBlockingStance = true;
          this.aiState = CommanderAIState.BLOCK_STANCE;
          this.stateTimer = 1.2;
        }
        this.animRun(this.animTime, Math.min(1, dist / 3));
        break;

      case CommanderAIState.CHARGE_WINDUP:
        this.stateTimer -= delta;
        this.animWindup(this.stateTimer);
        if (this.stateTimer <= 0) {
          this.aiState = CommanderAIState.CHARGING;
          this.stateTimer = 0.6;
          this.chargeSpeed = this.moveSpeed * 3;
        }
        break;

      case CommanderAIState.CHARGING:
        this.stateTimer -= delta;
        this.animCharge(this.animTime);
        if (this.stateTimer <= 0) {
          this.aiState = CommanderAIState.CHASE;
          this.attackCooldown = 2.0;
          this.chargeSpeed = 0;
        }
        break;

      case CommanderAIState.ATTACK_WINDUP:
        this.stateTimer -= delta;
        this.animWindup(this.stateTimer);
        if (this.stateTimer <= 0) {
          this.aiState = CommanderAIState.ATTACK_STRIKE;
          this.stateTimer = 0.35;
          this.hasDealtDamageThisStrike = false;
        }
        break;

      case CommanderAIState.ATTACK_STRIKE:
        this.stateTimer -= delta;
        this.animStrike(1 - this.stateTimer / 0.35);
        if (this.stateTimer <= 0) {
          this.aiState = CommanderAIState.CHASE;
          this.attackCooldown = 1.8;
        }
        break;

      case CommanderAIState.BLOCK_STANCE:
        this.stateTimer -= delta;
        this.animBlock();
        if (this.stateTimer <= 0) {
          this.isBlockingStance = false;
          this.aiState = CommanderAIState.CHASE;
        }
        break;

      case CommanderAIState.RALLY:
        this.stateTimer -= delta;
        this.animRally(1 - this.stateTimer / 1.5);
        if (this.stateTimer <= 0) {
          this.aiState = CommanderAIState.CHASE;
        }
        break;

      case CommanderAIState.HIT:
        this.stateTimer -= delta;
        if (this.stateTimer <= 0) this.aiState = CommanderAIState.CHASE;
        break;

      default:
        break;
    }
  }

  dispose(physics: PhysicsWorld): void {
    physics.world.removeRigidBody(this.body);
    this.scene.remove(this.group);
    this.scene.remove(this.chargeTrail);
    this.scene.remove(this.rallyRing);
  }

  // ── Animations ────────────────────────────────────────────────────────

  private animRun(time: number, speed: number): void {
    const freq = 6 * speed;
    this.leftLegGroup.rotation.x  =  Math.sin(time * freq) * 0.5 * speed;
    this.rightLegGroup.rotation.x = -Math.sin(time * freq) * 0.5 * speed;
    this.rightArmGroup.rotation.x =  Math.sin(time * freq) * 0.3 * speed;
    this.torsoGroup.rotation.x = 0.06 * speed;
    this.torsoGroup.scale.set(1, 1, 1);
  }

  private animWindup(timeLeft: number): void {
    this.rightArmGroup.rotation.x = -Math.max(0, 1.0 - timeLeft * 1.5);
    this.torsoGroup.rotation.x = 0;
  }

  private animStrike(p: number): void {
    const swing = Math.sin(p * Math.PI);
    this.rightArmGroup.rotation.x = -1.0 + swing * 1.8;
    this.torsoGroup.rotation.y = -swing * 0.4;
  }

  private animCharge(time: number): void {
    this.torsoGroup.rotation.x = 0.3;
    this.leftLegGroup.rotation.x =  Math.sin(time * 14) * 0.7;
    this.rightLegGroup.rotation.x = -Math.sin(time * 14) * 0.7;
  }

  private animBlock(): void {
    this.rightArmGroup.rotation.x = -1.0;
    this.torsoGroup.rotation.x = 0.05;
  }

  private animRally(p: number): void {
    // Raise axe high and roar
    this.rightArmGroup.rotation.x = -1.5 * p;
    this.torsoGroup.rotation.x = -0.1 * p;
  }

  private animDeath(_delta: number): void {
    this.torsoGroup.rotation.x = Math.min(1.4, this.torsoGroup.rotation.x + _delta * 2);
    this.torsoGroup.position.y = Math.max(-0.8, this.torsoGroup.position.y - _delta * 1.2);
  }
}
