import * as THREE from 'three';
import type { ArmorMaterialSet } from '@/game/ArmorDegradation';

// ── Non-degradable shared materials ──────────────────────────────────────────
const MAT_SKIN = new THREE.MeshStandardMaterial({
  color: 0xc49a6c, // warm tan skin
  roughness: 0.7,
});
const MAT_VISOR = new THREE.MeshStandardMaterial({
  color: 0xcc2200,
  emissive: new THREE.Color(0xcc2200),
  emissiveIntensity: 4.0, // brighter visor glow
});
const MAT_BOOT = new THREE.MeshStandardMaterial({
  color: 0x888070,  // lighter leather/sabaton
  roughness: 0.6,
});
const MAT_CAPE = new THREE.MeshStandardMaterial({
  color: 0xcc1010, // deeper, richer crimson
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.90,
});
const MAT_BLADE = new THREE.MeshPhysicalMaterial({
  color: 0x9aabbb,
  metalness: 0.95,
  roughness: 0.08,
  clearcoat: 0.5,
  clearcoatRoughness: 0.2,
  emissive: new THREE.Color(0x4466ff),
  emissiveIntensity: 2.0, // enchanted sword glow — blue/white pulse
});
const MAT_GROOVE = new THREE.MeshStandardMaterial({
  color: 0x445566,
  metalness: 0.9,
  roughness: 0.15,
});
const MAT_CROSSGUARD = new THREE.MeshStandardMaterial({
  color: 0x5a4a3a, // bronze
  metalness: 0.7,
  roughness: 0.4,
});
const MAT_GRIP = new THREE.MeshStandardMaterial({
  color: 0x4a3828, // leather
  roughness: 0.8,
});


function mkMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = castShadow;
  return m;
}

/**
 * Procedural warrior character built entirely from Three.js primitives.
 * Angular, aggressive knight silhouette — Skyrim-inspired.
 *
 * The model root sits at the centre of the physics capsule (y = 0).
 * Feet are at y ≈ −1.0, top of helmet at y ≈ +1.0, total height ≈ 2.0 units.
 *
 * Sub-groups exposed for AnimationStateMachine:
 *   torsoGroup, headGroup, leftArmGroup, rightArmGroup,
 *   leftLegGroup, rightLegGroup, swordGroup, capeGroup
 */
export class WarriorModel {
  readonly group: THREE.Group;

  // Animation-accessible sub-groups
  readonly torsoGroup: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly leftArmGroup: THREE.Group;
  readonly rightArmGroup: THREE.Group;
  readonly leftLegGroup: THREE.Group;
  readonly rightLegGroup: THREE.Group;
  readonly swordGroup: THREE.Group;
  readonly capeGroup: THREE.Group;

  /** Shield mesh — visible only during BLOCK/SHIELD_BASH states. */
  readonly shieldGroup: THREE.Group;

  /**
   * Armor materials exposed for ArmorDegradation system.
   * These are instance-level (not shared) so degradation only affects this warrior.
   */
  readonly armorMaterials: ArmorMaterialSet;

  // Cape geometry reference for vertex-wave animation
  private readonly capeGeo: THREE.BufferGeometry;
  private readonly capeBasePositions: Float32Array;

  constructor() {
    this.group = new THREE.Group();

    // ── Instance armor materials (degradable) ───────────────────────────
    const MAT_IRON = new THREE.MeshPhysicalMaterial({
      color: 0xa0b0d0,
      metalness: 0.90,
      roughness: 0.15,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      emissive: new THREE.Color(0x101020),
      emissiveIntensity: 0.2,
    });
    const MAT_HELMET = new THREE.MeshPhysicalMaterial({
      color: 0x909ab0,
      metalness: 0.85,
      roughness: 0.20,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      emissive: new THREE.Color(0x080818),
      emissiveIntensity: 0.15,
    });
    const MAT_PAULDRON = new THREE.MeshPhysicalMaterial({
      color: 0x8090b0,
      metalness: 0.85,
      roughness: 0.25,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
    });
    const MAT_GAUNTLET = new THREE.MeshPhysicalMaterial({
      color: 0x7888a8,
      metalness: 0.90,
      roughness: 0.15,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
    });

    this.armorMaterials = { iron: MAT_IRON, helmet: MAT_HELMET, pauldron: MAT_PAULDRON, gauntlet: MAT_GAUNTLET };

    // ── Torso ──────────────────────────────────────────────────────────────
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.05, 0);

    // Cuirass — large box chest plate, wider at shoulders
    const cuirass = mkMesh(new THREE.BoxGeometry(0.56, 0.52, 0.26), MAT_IRON);
    cuirass.position.set(0, 0.08, 0);
    this.torsoGroup.add(cuirass);

    // Center ridge down the chest
    const chestRidge = mkMesh(new THREE.BoxGeometry(0.04, 0.44, 0.07), MAT_IRON);
    chestRidge.position.set(0, 0.1, 0.13);
    this.torsoGroup.add(chestRidge);

    // Gorget — neck guard cylinder connecting helm to chest
    const gorget = mkMesh(new THREE.CylinderGeometry(0.13, 0.16, 0.12, 10), MAT_HELMET);
    gorget.position.set(0, 0.42, 0);
    this.torsoGroup.add(gorget);

    // Belt / waist piece
    const belt = mkMesh(new THREE.BoxGeometry(0.52, 0.08, 0.24), MAT_GAUNTLET);
    belt.position.set(0, -0.22, 0);
    this.torsoGroup.add(belt);

    // Faulds — three overlapping plate segments hanging below belt (like a plate skirt)
    for (let i = 0; i < 3; i++) {
      const fauld = mkMesh(new THREE.BoxGeometry(0.50 - i * 0.04, 0.10, 0.18 - i * 0.01), MAT_IRON);
      fauld.position.set(0, -0.32 - i * 0.09, 0);
      fauld.rotation.x = 0.06 * i; // slight outward angle on lower segments
      this.torsoGroup.add(fauld);
    }

    // Angular pauldrons — layered box plates instead of half-spheres
    const mkPauldron = (side: number): void => {
      const x = side * 0.46;
      // Main plate — angled upward at the outer edge
      const main = mkMesh(new THREE.BoxGeometry(0.22, 0.14, 0.26), MAT_PAULDRON);
      main.position.set(x, 0.40, 0);
      main.rotation.z = side * -0.18; // tilt outward/upward
      this.torsoGroup.add(main);

      // Edge ridge — blade-like strip along outer edge
      const ridge = mkMesh(new THREE.BoxGeometry(0.04, 0.08, 0.28), MAT_PAULDRON);
      ridge.position.set(x + side * 0.12, 0.44, 0);
      ridge.rotation.z = side * -0.35;
      this.torsoGroup.add(ridge);

      // Lower pauldron plate
      const lower = mkMesh(new THREE.BoxGeometry(0.20, 0.10, 0.22), MAT_PAULDRON);
      lower.position.set(x + side * 0.04, 0.28, 0);
      lower.rotation.z = side * -0.1;
      this.torsoGroup.add(lower);
    };
    mkPauldron(-1); // left
    mkPauldron(1);  // right

    // ── Head ───────────────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.74, 0);

    // Base head (mostly hidden by helmet)
    const head = mkMesh(new THREE.SphereGeometry(0.17, 10, 8), MAT_SKIN);
    this.headGroup.add(head);

    // Bascinet — tapered cylinder helm (wider at ears, narrower at crown)
    const helmetShell = mkMesh(
      new THREE.CylinderGeometry(0.17, 0.21, 0.32, 12),
      MAT_HELMET,
    );
    helmetShell.position.set(0, 0.10, 0);
    this.headGroup.add(helmetShell);

    // Pointed crown — cone on top
    const crownCone = mkMesh(new THREE.ConeGeometry(0.12, 0.22, 8), MAT_HELMET);
    crownCone.position.set(0, 0.34, 0);
    this.headGroup.add(crownCone);

    // Cheek plates — angled box pieces flanking the face
    for (const side of [-1, 1]) {
      const cheek = mkMesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), MAT_HELMET);
      cheek.position.set(side * 0.18, 0.02, 0.08);
      cheek.rotation.y = side * 0.25;
      this.headGroup.add(cheek);
    }

    // Face guard — slab covering front with visor slit
    const faceGuard = mkMesh(new THREE.BoxGeometry(0.28, 0.22, 0.05), MAT_HELMET);
    faceGuard.position.set(0, 0.02, 0.19);
    this.headGroup.add(faceGuard);

    // Visor slit — bright red/orange emissive (glowing eyes behind the helm)
    const visorSlit = mkMesh(new THREE.BoxGeometry(0.18, 0.036, 0.06), MAT_VISOR);
    visorSlit.position.set(0, 0.06, 0.215);
    this.headGroup.add(visorSlit);

    // Chin guard
    const chinGuard = mkMesh(new THREE.BoxGeometry(0.22, 0.10, 0.10), MAT_HELMET);
    chinGuard.position.set(0, -0.10, 0.15);
    this.headGroup.add(chinGuard);

    // Neck guard ring
    const neckGuard = mkMesh(new THREE.CylinderGeometry(0.175, 0.195, 0.10, 12, 1, true), MAT_HELMET);
    neckGuard.position.set(0, -0.195, 0);
    this.headGroup.add(neckGuard);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ──────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.44, 0.28, 0);

    // Shoulder joint sphere — closes the visual gap between pauldron and upper arm
    const leftShoulder = mkMesh(new THREE.SphereGeometry(0.09, 8, 6), MAT_PAULDRON);
    leftShoulder.position.set(0, 0, 0);
    this.leftArmGroup.add(leftShoulder);

    const leftUpper = mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.56, 10), MAT_IRON);
    leftUpper.position.set(0, -0.28, 0);
    this.leftArmGroup.add(leftUpper);

    // Elbow cop — angular pointed guard
    const leftElbow = mkMesh(new THREE.BoxGeometry(0.13, 0.09, 0.13), MAT_GAUNTLET);
    leftElbow.position.set(0, -0.52, 0.03);
    this.leftArmGroup.add(leftElbow);

    // Forearm vambrace — box profile
    const leftForearm = mkMesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), MAT_IRON);
    leftForearm.position.set(0, -0.62, 0);
    this.leftArmGroup.add(leftForearm);

    // Gauntlet — wider cuff
    const leftGauntlet = mkMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), MAT_GAUNTLET);
    leftGauntlet.position.set(0, -0.77, 0);
    this.leftArmGroup.add(leftGauntlet);

    this.torsoGroup.add(this.leftArmGroup);

    // ── Shield (kite shield on left forearm) ──────────────────────────────
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a,
      metalness: 0.8,
      roughness: 0.3,
    });
    const shieldEmblemMat = new THREE.MeshStandardMaterial({
      color: 0xaa2200,
      emissive: new THREE.Color(0x660000),
      emissiveIntensity: 1.0,
      metalness: 0.6,
      roughness: 0.4,
    });
    this.shieldGroup = new THREE.Group();
    // Kite shield body
    const shieldBody = mkMesh(new THREE.BoxGeometry(0.28, 0.42, 0.05), shieldMat);
    this.shieldGroup.add(shieldBody);
    // Red emblem inset
    const shieldEmblem = mkMesh(new THREE.BoxGeometry(0.10, 0.16, 0.03), shieldEmblemMat);
    shieldEmblem.position.set(0, 0.04, 0.03);
    this.shieldGroup.add(shieldEmblem);
    // Position shield on left forearm
    this.shieldGroup.position.set(0, -0.68, 0.08);
    this.shieldGroup.visible = false; // hidden until BLOCK state
    this.leftArmGroup.add(this.shieldGroup);

    // ── Right arm ─────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.44, 0.28, 0);

    // Shoulder joint sphere — closes the visual gap between pauldron and upper arm
    const rightShoulder = mkMesh(new THREE.SphereGeometry(0.09, 8, 6), MAT_PAULDRON);
    rightShoulder.position.set(0, 0, 0);
    this.rightArmGroup.add(rightShoulder);

    const rightUpper = mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.56, 10), MAT_IRON);
    rightUpper.position.set(0, -0.28, 0);
    this.rightArmGroup.add(rightUpper);

    const rightElbow = mkMesh(new THREE.BoxGeometry(0.13, 0.09, 0.13), MAT_GAUNTLET);
    rightElbow.position.set(0, -0.52, 0.03);
    this.rightArmGroup.add(rightElbow);

    const rightForearm = mkMesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), MAT_IRON);
    rightForearm.position.set(0, -0.62, 0);
    this.rightArmGroup.add(rightForearm);

    const rightGauntlet = mkMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), MAT_GAUNTLET);
    rightGauntlet.position.set(0, -0.77, 0);
    this.rightArmGroup.add(rightGauntlet);

    this.torsoGroup.add(this.rightArmGroup);

    // ── Left leg ──────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.15, -0.22, 0);

    const leftThigh = mkMesh(new THREE.CylinderGeometry(0.11, 0.10, 0.50, 10), MAT_IRON);
    leftThigh.position.set(0, -0.25, 0);
    this.leftLegGroup.add(leftThigh);

    // Cuisse — thigh armor overlay
    const leftCuisse = mkMesh(new THREE.BoxGeometry(0.16, 0.38, 0.16), MAT_IRON);
    leftCuisse.position.set(0, -0.22, 0.02);
    this.leftLegGroup.add(leftCuisse);

    // Knee poleyn — pointed angular guard
    const leftKnee = mkMesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), MAT_GAUNTLET);
    leftKnee.position.set(0, -0.52, 0.03);
    this.leftLegGroup.add(leftKnee);

    const leftShin = mkMesh(new THREE.CylinderGeometry(0.09, 0.08, 0.40, 10), MAT_IRON);
    leftShin.position.set(0, -0.72, 0);
    this.leftLegGroup.add(leftShin);

    // Greave — box-shaped shin armor
    const leftGreave = mkMesh(new THREE.BoxGeometry(0.14, 0.32, 0.12), MAT_IRON);
    leftGreave.position.set(0, -0.70, 0.02);
    this.leftLegGroup.add(leftGreave);

    // Sabaton — angular armored boot with pointed toe
    const leftBoot = mkMesh(new THREE.BoxGeometry(0.14, 0.10, 0.22), MAT_BOOT);
    leftBoot.position.set(0, -0.96, 0.02);
    this.leftLegGroup.add(leftBoot);

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ─────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.15, -0.22, 0);

    const rightThigh = mkMesh(new THREE.CylinderGeometry(0.11, 0.10, 0.50, 10), MAT_IRON);
    rightThigh.position.set(0, -0.25, 0);
    this.rightLegGroup.add(rightThigh);

    const rightCuisse = mkMesh(new THREE.BoxGeometry(0.16, 0.38, 0.16), MAT_IRON);
    rightCuisse.position.set(0, -0.22, 0.02);
    this.rightLegGroup.add(rightCuisse);

    const rightKnee = mkMesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), MAT_GAUNTLET);
    rightKnee.position.set(0, -0.52, 0.03);
    this.rightLegGroup.add(rightKnee);

    const rightShin = mkMesh(new THREE.CylinderGeometry(0.09, 0.08, 0.40, 10), MAT_IRON);
    rightShin.position.set(0, -0.72, 0);
    this.rightLegGroup.add(rightShin);

    const rightGreave = mkMesh(new THREE.BoxGeometry(0.14, 0.32, 0.12), MAT_IRON);
    rightGreave.position.set(0, -0.70, 0.02);
    this.rightLegGroup.add(rightGreave);

    const rightBoot = mkMesh(new THREE.BoxGeometry(0.14, 0.10, 0.22), MAT_BOOT);
    rightBoot.position.set(0, -0.96, 0.02);
    this.rightLegGroup.add(rightBoot);

    this.torsoGroup.add(this.rightLegGroup);

    // ── Cape ──────────────────────────────────────────────────────────────
    this.capeGroup = new THREE.Group();
    this.capeGroup.position.set(0, 0.32, -0.3);

    // Wider (0.7) and longer (1.4) with 8×16 segments for smooth deformation
    this.capeGeo = new THREE.PlaneGeometry(0.7, 1.4, 8, 16);
    const capeMesh = mkMesh(this.capeGeo, MAT_CAPE, false);
    // Tilt more steeply so cape drapes naturally behind the warrior
    capeMesh.rotation.x = 0.35;
    this.capeGroup.add(capeMesh);

    // Store a copy of the initial positions for animation reference
    const basePosAttr = this.capeGeo.attributes.position as THREE.BufferAttribute;
    this.capeBasePositions = new Float32Array(basePosAttr.array as Float32Array);

    this.torsoGroup.add(this.capeGroup);

    // ── Greatsword ────────────────────────────────────────────────────────
    this.swordGroup = new THREE.Group();
    // Position grip at hand (gauntlet) level, slightly forward from arm; flip so blade points DOWN
    this.swordGroup.position.set(0, -0.81, 0.15);
    this.swordGroup.rotation.set(Math.PI, 0, 0); // blade points down in idle stance

    // Blade — longer, wider at base tapering to point
    const blade = mkMesh(new THREE.BoxGeometry(0.07, 1.4, 0.013), MAT_BLADE);
    blade.position.set(0, 0.62, 0);
    this.swordGroup.add(blade);

    // Blade taper — narrower top section for pointed appearance
    const bladeTip = mkMesh(new THREE.BoxGeometry(0.04, 0.28, 0.013), MAT_BLADE);
    bladeTip.position.set(0, 1.24, 0);
    this.swordGroup.add(bladeTip);

    // Blood groove (runs along centre of blade)
    const groove = mkMesh(new THREE.BoxGeometry(0.018, 1.15, 0.015), MAT_GROOVE);
    groove.position.set(0, 0.62, 0.007);
    this.swordGroup.add(groove);

    // Crossguard — longer with slight thickness for authority
    const crossguard = mkMesh(new THREE.BoxGeometry(0.50, 0.07, 0.06), MAT_CROSSGUARD);
    crossguard.position.set(0, 0, 0);
    this.swordGroup.add(crossguard);

    // Crossguard end caps — angled tips
    for (const side of [-1, 1]) {
      const tip = mkMesh(new THREE.BoxGeometry(0.05, 0.07, 0.05), MAT_CROSSGUARD);
      tip.position.set(side * 0.275, 0, 0);
      tip.rotation.z = side * 0.3;
      this.swordGroup.add(tip);
    }

    // Grip
    const grip = mkMesh(new THREE.CylinderGeometry(0.035, 0.03, 0.32, 10), MAT_GRIP);
    grip.position.set(0, -0.16, 0);
    this.swordGroup.add(grip);

    // Pommel — angular octagonal disc instead of sphere
    const pommel = mkMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 8), MAT_CROSSGUARD);
    pommel.position.set(0, -0.335, 0);
    this.swordGroup.add(pommel);

    this.rightArmGroup.add(this.swordGroup);

    // ── Assemble ──────────────────────────────────────────────────────────
    this.group.add(this.torsoGroup);
  }

  /**
   * Animate the cape with multi-frequency vertex deformation.
   * @param time   Elapsed time in seconds.
   * @param speed  Player movement speed scalar (0–1). Higher = more billowing.
   */
  updateCape(time: number, speed = 0): void {
    const posAttr = this.capeGeo.attributes.position as THREE.BufferAttribute;
    const base = this.capeBasePositions;
    const count = posAttr.count;

    // Cape height spans from top (tNorm=0) to bottom (tNorm=1)
    // Use 1.4 for the new cape height
    const capeHeight = 1.4;
    const capeMidY = -capeHeight / 2; // pivot is at top edge

    for (let i = 0; i < count; i++) {
      const bx = base[i * 3]!;
      const by = base[i * 3 + 1]!;
      const bz = base[i * 3 + 2]!;

      // Progressive amplitude: bottom edge swings more than top
      const tNorm = 1 - (by - capeMidY) / (-capeMidY * 2); // 0 at top, 1 at bottom
      const tClamped = Math.max(0, Math.min(1, tNorm));

      // Speed-responsive billowing: cape streams behind when running
      const billow = 0.08 + speed * 0.22;

      // Primary slow Z-axis billow (cloth flowing outward behind warrior)
      const primaryZ = Math.sin(time * 1.8 + by * 2.5) * billow * tClamped;

      // Secondary faster X ripple (side-to-side cloth wave)
      const secondaryX = Math.sin(time * 3.5 + by * 4.0 + bx * 2.0) * 0.05 * tClamped;

      // Tertiary fast flutter near bottom edge
      const flutterX = Math.sin(time * 6.0 + bx * 3.5) * 0.03 * (tClamped * tClamped);

      posAttr.setXYZ(i, bx + secondaryX + flutterX, by, bz + primaryZ);
    }
    posAttr.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
  }

  /**
   * Toggle dodge i-frame transparency on all warrior meshes.
   * Cape retains its original partial transparency when restoring.
   */
  setDodgeTransparency(active: boolean): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (active) {
          mat.transparent = true;
          mat.opacity = 0.5;
        } else {
          const isCape = mat === MAT_CAPE;
          mat.transparent = isCape;
          mat.opacity = isCape ? 0.88 : 1.0;
        }
      }
    });
  }

  /** Show or hide the shield mesh (call from PlayerController on block enter/exit). */
  setShieldVisible(visible: boolean): void {
    this.shieldGroup.visible = visible;
  }
}
