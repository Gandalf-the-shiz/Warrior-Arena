import * as THREE from 'three';
import { AudioManager } from '@/engine/AudioManager';
import { PlayerController } from '@/game/PlayerController';

// ── Drop probabilities ────────────────────────────────────────────────────────
const CHANCE_DAMAGE  = 0.10; // 10 %  damage boost
const CHANCE_STAMINA = 0.20; // 20 %  stamina crystal  (evaluated after damage check)
const CHANCE_HEALTH  = 0.30; // 30 %  health orb       (evaluated after stamina check)

const PICKUP_RADIUS  = 1.5;  // world units — auto-collect distance
const DESPAWN_TIME   = 15.0; // seconds before a drop disappears
const FADE_START     = 13.0; // begin fading at this age
const BOB_SPEED      = 2.2;  // radians/second
const BOB_AMP        = 0.18; // metres
const ROTATE_SPEED   = 1.4;  // radians/second

// ── Emissive colours ──────────────────────────────────────────────────────────
const COLOR_HEALTH  = 0xee2244;
const COLOR_STAMINA = 0x22cc88;
const COLOR_DAMAGE  = 0xffcc00;

export type LootType = 'health' | 'stamina' | 'damage';

interface LootDrop {
  type: LootType;
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  baseY: number;
  bobSeed: number;
  age: number;
  collected: boolean;
}

/**
 * LootSystem — enemy drops with pick-up effects.
 *
 * Drop table (independent rolls):
 *   • Health Orb     (30 %): +20 HP         — red glowing sphere
 *   • Stamina Crystal(20 %): +50 stamina    — green glowing octahedron
 *   • Damage Boost   (10 %): ×1.5 dmg 10 s — gold glowing icosahedron
 *
 * Call `spawnDrop(position)` when an enemy is killed, and `update()` every
 * visual frame so drops can bob, rotate, and be collected.
 */
export class LootSystem {
  private readonly drops: LootDrop[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly audio: AudioManager,
  ) {}

  /** Attempt to spawn a random drop at the given world position. */
  spawnDrop(position: THREE.Vector3): void {
    const roll = Math.random();
    let type: LootType | null = null;

    if (roll < CHANCE_DAMAGE) {
      type = 'damage';
    } else if (roll < CHANCE_DAMAGE + CHANCE_STAMINA) {
      type = 'stamina';
    } else if (roll < CHANCE_DAMAGE + CHANCE_STAMINA + CHANCE_HEALTH) {
      type = 'health';
    }

    if (type === null) return;

    const color = type === 'health' ? COLOR_HEALTH
                : type === 'stamina' ? COLOR_STAMINA
                : COLOR_DAMAGE;

    // Geometry per type
    const geo: THREE.BufferGeometry =
      type === 'health'  ? new THREE.SphereGeometry(0.25, 8, 8)   :
      type === 'stamina' ? new THREE.OctahedronGeometry(0.28)       :
                           new THREE.IcosahedronGeometry(0.28);

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.5,
    });

    const mesh = new THREE.Mesh(geo, mat);
    // Scatter slightly so stacked drops don't overlap
    const spawnPos = new THREE.Vector3(
      position.x + (Math.random() - 0.5) * 0.6,
      position.y + 0.6,
      position.z + (Math.random() - 0.5) * 0.6,
    );
    mesh.position.copy(spawnPos);
    mesh.castShadow = false;
    this.scene.add(mesh);

    const light = new THREE.PointLight(color, 2.0, 4.0);
    light.position.copy(spawnPos);
    this.scene.add(light);

    this.drops.push({
      type,
      mesh,
      light,
      baseY:    spawnPos.y,
      bobSeed:  Math.random() * Math.PI * 2,
      age:      0,
      collected: false,
    });
  }

  /**
   * Update all active drops: bob, rotate, proximity check, and despawn.
   * @param delta  Seconds since last frame.
   * @param player Reference to the player controller.
   */
  update(delta: number, player: PlayerController): void {
    if (player.isDead) return;

    const playerPos = player.getPosition();

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i]!;

      if (drop.collected) {
        this.removeDrop(i);
        continue;
      }

      drop.age += delta;

      if (drop.age >= DESPAWN_TIME) {
        this.removeDrop(i);
        continue;
      }

      // Bob
      const bobY = drop.baseY + Math.sin(drop.age * BOB_SPEED + drop.bobSeed) * BOB_AMP;
      drop.mesh.position.y = bobY;
      drop.light.position.y = bobY;

      // Rotate
      drop.mesh.rotation.y += ROTATE_SPEED * delta;

      // Fade out near despawn time
      if (drop.age >= FADE_START) {
        const alpha = 1 - (drop.age - FADE_START) / (DESPAWN_TIME - FADE_START);
        const mat = drop.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = alpha;
        mat.transparent = true;
        drop.light.intensity = 2.0 * alpha;
      }

      // Proximity pick-up
      const dist = drop.mesh.position.distanceTo(playerPos);
      if (dist < PICKUP_RADIUS) {
        this.applyPickup(drop, player);
        drop.collected = true;
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private applyPickup(drop: LootDrop, player: PlayerController): void {
    switch (drop.type) {
      case 'health':
        player.hp = Math.min(player.maxHp, player.hp + 20);
        this.audio.playPickup();
        break;
      case 'stamina':
        player.stamina = Math.min(player.maxStamina, player.stamina + 50);
        this.audio.playPickup();
        break;
      case 'damage':
        player.addDamageBoost(1.5, 10);
        this.audio.playPowerUp();
        break;
    }
  }

  private removeDrop(index: number): void {
    const drop = this.drops[index]!;
    this.scene.remove(drop.mesh);
    drop.mesh.geometry.dispose();
    (drop.mesh.material as THREE.MeshStandardMaterial).dispose();
    this.scene.remove(drop.light);
    this.drops.splice(index, 1);
  }
}
