import * as THREE from 'three';
import type { ArmorMaterialSet } from '@/game/ArmorDegradation';

// ── Non-degradable shared materials ──────────────────────────────────────────
const MAT_SKIN = new THREE.MeshStandardMaterial({
  color: 0xc49a6c,
  roughness: 0.7,
});
const MAT_VISOR = new THREE.MeshStandardMaterial({
  color: 0xff3300,
  emissive: new THREE.Color(0xff2200),
  emissiveIntensity: 5.0,
});
const MAT_BOOT = new THREE.MeshStandardMaterial({
  color: 0x888070,
  roughness: 0.6,
});
// ── Weapon materials ─────────────────────────────────────────────────────────
const MAT_BLADE = new THREE.MeshPhysicalMaterial({
  color: 0xcc2222,          // deep crimson red steel
  metalness: 0.95,
  roughness: 0.08,
  clearcoat: 0.8,
  clearcoatRoughness: 0.1,
  emissive: new THREE.Color(0x880000),
  emissiveIntensity: 2.0,
});
const MAT_GROOVE = new THREE.MeshStandardMaterial({
  color: 0x440000,
  metalness: 0.9,
  roughness: 0.12,
  emissive: new THREE.Color(0x660000),
  emissiveIntensity: 1.5,
});
const MAT_CROSSGUARD = new THREE.MeshStandardMaterial({
  color: 0xc8a000,    // bright gold
  metalness: 0.85,
  roughness: 0.25,
  emissive: new THREE.Color(0x6a5000),
  emissiveIntensity: 0.3,
});
const MAT_GRIP = new THREE.MeshStandardMaterial({
  color: 0x3a2818,
  roughness: 0.85,
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

/** Add three raised knuckle strips to a gauntlet group at the given Y position. */
function addKnuckleStrips(armGroup: THREE.Group, yPos: number, mat: THREE.Material): void {
  for (let k = 0; k < 3; k++) {
    const knuckle = mkMesh(new THREE.BoxGeometry(0.045, 0.025, 0.145), mat);
    knuckle.position.set(-0.04 + k * 0.04, yPos, 0.075);
    armGroup.add(knuckle);
  }
}

/**
 * Rebuilt warrior character — procedurally built from Three.js primitives.
 * Heroic knight silhouette: broad-shouldered plate armour and a red
 * 2-handed broadsword held at a 45° angle.
 *
 * The model root sits at the centre of the physics capsule (y = 0).
 * Feet ≈ −1.0, crown ≈ +1.1, total height ≈ 2.1 units.
 *
 * Sub-groups exposed for AnimationStateMachine:
 *   torsoGroup, headGroup, leftArmGroup, rightArmGroup,
 *   leftLegGroup, rightLegGroup, swordGroup, capeGroup
 */
export class WarriorModel {
  readonly group: THREE.Group;

  readonly torsoGroup: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly leftArmGroup: THREE.Group;
  readonly rightArmGroup: THREE.Group;
  readonly leftLegGroup: THREE.Group;
  readonly rightLegGroup: THREE.Group;
  readonly swordGroup: THREE.Group;
  /** Cape group kept as an empty group for AnimationStateMachine compatibility. */
  readonly capeGroup: THREE.Group;

  /** Shield mesh — visible only during BLOCK/SHIELD_BASH states. */
  readonly shieldGroup: THREE.Group;

  /** Armor materials exposed for ArmorDegradation. */
  readonly armorMaterials: ArmorMaterialSet;

  constructor() {
    this.group = new THREE.Group();

    // ── Instance armor materials (degradable) ───────────────────────────
    const MAT_IRON = new THREE.MeshPhysicalMaterial({
      color: 0x9caac8,    // cool silver-blue plate
      metalness: 0.92,
      roughness: 0.12,
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
      emissive: new THREE.Color(0x08091a),
      emissiveIntensity: 0.25,
    });
    const MAT_HELMET = new THREE.MeshPhysicalMaterial({
      color: 0x8898b8,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 0.40,
      clearcoatRoughness: 0.35,
      emissive: new THREE.Color(0x050814),
      emissiveIntensity: 0.2,
    });
    const MAT_PAULDRON = new THREE.MeshPhysicalMaterial({
      color: 0x7888aa,
      metalness: 0.88,
      roughness: 0.22,
      clearcoat: 0.40,
      clearcoatRoughness: 0.28,
    });
    const MAT_GAUNTLET = new THREE.MeshPhysicalMaterial({
      color: 0x6878a0,
      metalness: 0.92,
      roughness: 0.14,
      clearcoat: 0.40,
      clearcoatRoughness: 0.35,
    });

    this.armorMaterials = { iron: MAT_IRON, helmet: MAT_HELMET, pauldron: MAT_PAULDRON, gauntlet: MAT_GAUNTLET };

    // ── Torso ──────────────────────────────────────────────────────────────
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.05, 0);

    // Main cuirass — wider, heroic chest plate
    const cuirass = mkMesh(new THREE.BoxGeometry(0.62, 0.55, 0.28), MAT_IRON);
    cuirass.position.set(0, 0.10, 0);
    this.torsoGroup.add(cuirass);

    // Chest ridge — central raised spine
    const chestRidge = mkMesh(new THREE.BoxGeometry(0.045, 0.46, 0.075), MAT_IRON);
    chestRidge.position.set(0, 0.12, 0.14);
    this.torsoGroup.add(chestRidge);

    // Pectoral plates — two angled plates flanking the ridge
    for (const side of [-1, 1]) {
      const pec = mkMesh(new THREE.BoxGeometry(0.22, 0.30, 0.05), MAT_IRON);
      pec.position.set(side * 0.18, 0.16, 0.14);
      pec.rotation.z = side * 0.06;
      this.torsoGroup.add(pec);
    }

    // Gorget — neck guard
    const gorget = mkMesh(new THREE.CylinderGeometry(0.14, 0.18, 0.14, 12), MAT_HELMET);
    gorget.position.set(0, 0.44, 0);
    this.torsoGroup.add(gorget);

    // Belt / waist articulation
    const belt = mkMesh(new THREE.BoxGeometry(0.56, 0.09, 0.26), MAT_GAUNTLET);
    belt.position.set(0, -0.21, 0);
    this.torsoGroup.add(belt);

    // Gold accent strip on belt
    const beltAccent = mkMesh(new THREE.BoxGeometry(0.52, 0.025, 0.27), MAT_CROSSGUARD);
    beltAccent.position.set(0, -0.18, 0);
    this.torsoGroup.add(beltAccent);

    // Faulds — 4 layered plate skirt segments for movement
    for (let i = 0; i < 4; i++) {
      const fauld = mkMesh(new THREE.BoxGeometry(0.52 - i * 0.04, 0.09, 0.19 - i * 0.01), MAT_IRON);
      fauld.position.set(0, -0.31 - i * 0.08, 0);
      fauld.rotation.x = 0.05 * i;
      this.torsoGroup.add(fauld);
    }

    // Back plate — slightly thinner, matches front
    const backPlate = mkMesh(new THREE.BoxGeometry(0.58, 0.50, 0.04), MAT_IRON);
    backPlate.position.set(0, 0.10, -0.14);
    this.torsoGroup.add(backPlate);

    // ── Pauldrons — broad layered shoulder guards ──────────────────────────
    const mkPauldron = (side: number): void => {
      const sx = side * 0.50;
      // Main plate — wide, heroic
      const main = mkMesh(new THREE.BoxGeometry(0.26, 0.16, 0.30), MAT_PAULDRON);
      main.position.set(sx, 0.42, 0);
      main.rotation.z = side * -0.20;
      this.torsoGroup.add(main);
      // Outer blade ridge
      const ridge = mkMesh(new THREE.BoxGeometry(0.05, 0.10, 0.32), MAT_PAULDRON);
      ridge.position.set(sx + side * 0.14, 0.47, 0);
      ridge.rotation.z = side * -0.38;
      this.torsoGroup.add(ridge);
      // Lower flare plate
      const lower = mkMesh(new THREE.BoxGeometry(0.22, 0.11, 0.24), MAT_PAULDRON);
      lower.position.set(sx + side * 0.05, 0.28, 0);
      lower.rotation.z = side * -0.12;
      this.torsoGroup.add(lower);
      // Pauldron overlap strip (laminar layering)
      const strip = mkMesh(new THREE.BoxGeometry(0.20, 0.04, 0.28), MAT_GAUNTLET);
      strip.position.set(sx + side * 0.02, 0.34, 0);
      this.torsoGroup.add(strip);
    };
    mkPauldron(-1);
    mkPauldron(1);

    // ── Head ───────────────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.76, 0);

    // Head (mostly hidden by helmet)
    const head = mkMesh(new THREE.SphereGeometry(0.18, 10, 8), MAT_SKIN);
    this.headGroup.add(head);

    // Bascinet — tall tapered cylinder helm
    const helmetShell = mkMesh(new THREE.CylinderGeometry(0.175, 0.225, 0.35, 14), MAT_HELMET);
    helmetShell.position.set(0, 0.11, 0);
    this.headGroup.add(helmetShell);

    // Pointed crown — elongated cone for an imposing silhouette
    const crownCone = mkMesh(new THREE.ConeGeometry(0.13, 0.28, 8), MAT_HELMET);
    crownCone.position.set(0, 0.37, 0);
    this.headGroup.add(crownCone);

    // Crown ridge — blade-like finial
    const crownFin = mkMesh(new THREE.BoxGeometry(0.03, 0.18, 0.14), MAT_HELMET);
    crownFin.position.set(0, 0.62, 0);
    this.headGroup.add(crownFin);

    // Cheek guards — angled plates flanking the face
    for (const side of [-1, 1]) {
      const cheek = mkMesh(new THREE.BoxGeometry(0.08, 0.20, 0.13), MAT_HELMET);
      cheek.position.set(side * 0.19, 0.02, 0.09);
      cheek.rotation.y = side * 0.28;
      this.headGroup.add(cheek);
    }

    // Face guard — slab with prominent ridges
    const faceGuard = mkMesh(new THREE.BoxGeometry(0.30, 0.24, 0.055), MAT_HELMET);
    faceGuard.position.set(0, 0.03, 0.20);
    this.headGroup.add(faceGuard);

    // Visor slit — glowing red emissive eyes (intimidating)
    const visorSlit = mkMesh(new THREE.BoxGeometry(0.20, 0.040, 0.065), MAT_VISOR);
    visorSlit.position.set(0, 0.07, 0.225);
    this.headGroup.add(visorSlit);

    // Secondary visor glow strip (adds depth)
    const visorGlow = mkMesh(new THREE.BoxGeometry(0.16, 0.016, 0.055), MAT_VISOR);
    visorGlow.position.set(0, 0.04, 0.23);
    this.headGroup.add(visorGlow);

    // Chin guard
    const chinGuard = mkMesh(new THREE.BoxGeometry(0.24, 0.11, 0.11), MAT_HELMET);
    chinGuard.position.set(0, -0.10, 0.16);
    this.headGroup.add(chinGuard);

    // Neck ring
    const neckGuard = mkMesh(new THREE.CylinderGeometry(0.18, 0.20, 0.11, 14, 1, true), MAT_HELMET);
    neckGuard.position.set(0, -0.20, 0);
    this.headGroup.add(neckGuard);

    // Helmet brow ridge — prominent horizontal plate
    const browRidge = mkMesh(new THREE.BoxGeometry(0.32, 0.035, 0.07), MAT_HELMET);
    browRidge.position.set(0, 0.00, 0.215);
    this.headGroup.add(browRidge);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ──────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.46, 0.28, 0);

    // Shoulder sphere
    const leftShoulder = mkMesh(new THREE.SphereGeometry(0.10, 8, 6), MAT_PAULDRON);
    this.leftArmGroup.add(leftShoulder);

    const leftUpper = mkMesh(new THREE.CylinderGeometry(0.085, 0.075, 0.58, 10), MAT_IRON);
    leftUpper.position.set(0, -0.29, 0);
    this.leftArmGroup.add(leftUpper);

    const leftElbow = mkMesh(new THREE.BoxGeometry(0.135, 0.10, 0.135), MAT_GAUNTLET);
    leftElbow.position.set(0, -0.54, 0.03);
    this.leftArmGroup.add(leftElbow);

    const leftForearm = mkMesh(new THREE.BoxGeometry(0.125, 0.28, 0.145), MAT_IRON);
    leftForearm.position.set(0, -0.64, 0);
    this.leftArmGroup.add(leftForearm);

    const leftGauntlet = mkMesh(new THREE.BoxGeometry(0.145, 0.145, 0.145), MAT_GAUNTLET);
    leftGauntlet.position.set(0, -0.79, 0);
    this.leftArmGroup.add(leftGauntlet);

    // Gauntlet knuckle strips
    addKnuckleStrips(this.leftArmGroup, -0.79, MAT_IRON);

    this.torsoGroup.add(this.leftArmGroup);

    // ── Shield (kite shield) ──────────────────────────────────────────────
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x1e1e2e,
      metalness: 0.82,
      roughness: 0.28,
    });
    const shieldEmblemMat = new THREE.MeshStandardMaterial({
      color: 0xcc2200,
      emissive: new THREE.Color(0x880000),
      emissiveIntensity: 1.2,
      metalness: 0.6,
      roughness: 0.4,
    });
    const shieldRimMat = new THREE.MeshStandardMaterial({
      color: 0xc8a000,
      metalness: 0.85,
      roughness: 0.25,
    });
    this.shieldGroup = new THREE.Group();
    const shieldBody = mkMesh(new THREE.BoxGeometry(0.30, 0.46, 0.055), shieldMat);
    this.shieldGroup.add(shieldBody);
    const shieldEmblem = mkMesh(new THREE.BoxGeometry(0.10, 0.18, 0.03), shieldEmblemMat);
    shieldEmblem.position.set(0, 0.04, 0.04);
    this.shieldGroup.add(shieldEmblem);
    // Gold border strips
    for (const side of [-1, 1]) {
      const rim = mkMesh(new THREE.BoxGeometry(0.018, 0.46, 0.04), shieldRimMat);
      rim.position.set(side * 0.15, 0, 0.01);
      this.shieldGroup.add(rim);
    }
    this.shieldGroup.position.set(0, -0.68, 0.09);
    this.shieldGroup.visible = false;
    this.leftArmGroup.add(this.shieldGroup);

    // ── Right arm ─────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.46, 0.28, 0);

    const rightShoulder = mkMesh(new THREE.SphereGeometry(0.10, 8, 6), MAT_PAULDRON);
    this.rightArmGroup.add(rightShoulder);

    const rightUpper = mkMesh(new THREE.CylinderGeometry(0.085, 0.075, 0.58, 10), MAT_IRON);
    rightUpper.position.set(0, -0.29, 0);
    this.rightArmGroup.add(rightUpper);

    const rightElbow = mkMesh(new THREE.BoxGeometry(0.135, 0.10, 0.135), MAT_GAUNTLET);
    rightElbow.position.set(0, -0.54, 0.03);
    this.rightArmGroup.add(rightElbow);

    const rightForearm = mkMesh(new THREE.BoxGeometry(0.125, 0.28, 0.145), MAT_IRON);
    rightForearm.position.set(0, -0.64, 0);
    this.rightArmGroup.add(rightForearm);

    const rightGauntlet = mkMesh(new THREE.BoxGeometry(0.145, 0.145, 0.145), MAT_GAUNTLET);
    rightGauntlet.position.set(0, -0.79, 0);
    this.rightArmGroup.add(rightGauntlet);

    addKnuckleStrips(this.rightArmGroup, -0.79, MAT_IRON);

    this.torsoGroup.add(this.rightArmGroup);

    // ── Left leg ──────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.16, -0.22, 0);

    const leftThigh = mkMesh(new THREE.CylinderGeometry(0.115, 0.105, 0.52, 10), MAT_IRON);
    leftThigh.position.set(0, -0.26, 0);
    this.leftLegGroup.add(leftThigh);

    const leftCuisse = mkMesh(new THREE.BoxGeometry(0.165, 0.40, 0.165), MAT_IRON);
    leftCuisse.position.set(0, -0.23, 0.02);
    this.leftLegGroup.add(leftCuisse);

    const leftKnee = mkMesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), MAT_GAUNTLET);
    leftKnee.position.set(0, -0.54, 0.03);
    this.leftLegGroup.add(leftKnee);

    // Knee spike
    const leftKneePike = mkMesh(new THREE.ConeGeometry(0.03, 0.09, 6), MAT_GAUNTLET);
    leftKneePike.position.set(0, -0.50, 0.10);
    leftKneePike.rotation.x = -Math.PI / 2;
    this.leftLegGroup.add(leftKneePike);

    const leftShin = mkMesh(new THREE.CylinderGeometry(0.095, 0.085, 0.42, 10), MAT_IRON);
    leftShin.position.set(0, -0.73, 0);
    this.leftLegGroup.add(leftShin);

    const leftGreave = mkMesh(new THREE.BoxGeometry(0.145, 0.34, 0.125), MAT_IRON);
    leftGreave.position.set(0, -0.72, 0.02);
    this.leftLegGroup.add(leftGreave);

    const leftBoot = mkMesh(new THREE.BoxGeometry(0.145, 0.11, 0.24), MAT_BOOT);
    leftBoot.position.set(0, -0.97, 0.02);
    this.leftLegGroup.add(leftBoot);

    // Boot toe spike — for the brutalist aesthetic
    const leftToe = mkMesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), MAT_BOOT);
    leftToe.position.set(0, -0.98, 0.14);
    this.leftLegGroup.add(leftToe);

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ─────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.16, -0.22, 0);

    const rightThigh = mkMesh(new THREE.CylinderGeometry(0.115, 0.105, 0.52, 10), MAT_IRON);
    rightThigh.position.set(0, -0.26, 0);
    this.rightLegGroup.add(rightThigh);

    const rightCuisse = mkMesh(new THREE.BoxGeometry(0.165, 0.40, 0.165), MAT_IRON);
    rightCuisse.position.set(0, -0.23, 0.02);
    this.rightLegGroup.add(rightCuisse);

    const rightKnee = mkMesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), MAT_GAUNTLET);
    rightKnee.position.set(0, -0.54, 0.03);
    this.rightLegGroup.add(rightKnee);

    const rightKneePike = mkMesh(new THREE.ConeGeometry(0.03, 0.09, 6), MAT_GAUNTLET);
    rightKneePike.position.set(0, -0.50, 0.10);
    rightKneePike.rotation.x = -Math.PI / 2;
    this.rightLegGroup.add(rightKneePike);

    const rightShin = mkMesh(new THREE.CylinderGeometry(0.095, 0.085, 0.42, 10), MAT_IRON);
    rightShin.position.set(0, -0.73, 0);
    this.rightLegGroup.add(rightShin);

    const rightGreave = mkMesh(new THREE.BoxGeometry(0.145, 0.34, 0.125), MAT_IRON);
    rightGreave.position.set(0, -0.72, 0.02);
    this.rightLegGroup.add(rightGreave);

    const rightBoot = mkMesh(new THREE.BoxGeometry(0.145, 0.11, 0.24), MAT_BOOT);
    rightBoot.position.set(0, -0.97, 0.02);
    this.rightLegGroup.add(rightBoot);

    const rightToe = mkMesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), MAT_BOOT);
    rightToe.position.set(0, -0.98, 0.14);
    this.rightLegGroup.add(rightToe);

    this.torsoGroup.add(this.rightLegGroup);

    // ── CAPE — removed; keep empty group for AnimationStateMachine compatibility ──
    this.capeGroup = new THREE.Group();
    this.torsoGroup.add(this.capeGroup);

    // ── Red 2-handed Broadsword ───────────────────────────────────────────────
    this.swordGroup = new THREE.Group();
    // Held centrally at 45° angle on the torso (2-handed grip)
    this.swordGroup.position.set(0.08, -0.10, 0.35);
    this.swordGroup.rotation.set(-Math.PI * 0.75, 0, Math.PI / 4);

    // Main blade — wide broadsword fuller
    const blade = mkMesh(new THREE.BoxGeometry(0.14, 1.70, 0.018), MAT_BLADE);
    blade.position.set(0, 0.68, 0);
    this.swordGroup.add(blade);

    // Secondary blade face (gives illusion of thickness)
    const blade2 = mkMesh(new THREE.BoxGeometry(0.14, 1.70, 0.018), MAT_BLADE);
    blade2.position.set(0, 0.68, 0.016);
    this.swordGroup.add(blade2);

    // Blade taper
    const bladeTip = mkMesh(new THREE.BoxGeometry(0.09, 0.35, 0.018), MAT_BLADE);
    bladeTip.position.set(0, 1.38, 0);
    this.swordGroup.add(bladeTip);

    // Blood groove — red rune channel
    const groove = mkMesh(new THREE.BoxGeometry(0.035, 1.40, 0.018), MAT_GROOVE);
    groove.position.set(0, 0.68, 0.010);
    this.swordGroup.add(groove);

    // Crossguard — dramatic gold guard, wider for broadsword
    const crossguard = mkMesh(new THREE.BoxGeometry(0.70, 0.085, 0.075), MAT_CROSSGUARD);
    crossguard.position.set(0, 0, 0);
    this.swordGroup.add(crossguard);

    // Crossguard downswept quillons
    for (const side of [-1, 1]) {
      const quilon = mkMesh(new THREE.BoxGeometry(0.06, 0.085, 0.055), MAT_CROSSGUARD);
      quilon.position.set(side * 0.38, 0, 0);
      quilon.rotation.z = side * 0.35;
      this.swordGroup.add(quilon);
      // Quillon tip
      const tip = mkMesh(new THREE.ConeGeometry(0.025, 0.07, 6), MAT_CROSSGUARD);
      tip.position.set(side * 0.43, 0, 0);
      tip.rotation.z = side * (Math.PI / 2);
      this.swordGroup.add(tip);
    }

    // Grip — longer 2-handed wrapped leather
    const grip = mkMesh(new THREE.CylinderGeometry(0.040, 0.036, 0.52, 10), MAT_GRIP);
    grip.position.set(0, -0.265, 0);
    this.swordGroup.add(grip);

    // Grip wrapping rings — 6 rings for the longer 2-handed handle
    for (let w = 0; w < 6; w++) {
      const wrap = mkMesh(new THREE.CylinderGeometry(0.046, 0.046, 0.018, 10), MAT_CROSSGUARD);
      wrap.position.set(0, -0.06 - w * 0.082, 0);
      this.swordGroup.add(wrap);
    }

    // Pommel — slightly larger cap with gem
    const pommel = mkMesh(new THREE.CylinderGeometry(0.072, 0.082, 0.060, 6), MAT_CROSSGUARD);
    pommel.position.set(0, -0.55, 0);
    this.swordGroup.add(pommel);
    const pommelGem = mkMesh(new THREE.SphereGeometry(0.030, 8, 6), MAT_GROOVE);
    pommelGem.position.set(0, -0.59, 0);
    this.swordGroup.add(pommelGem);

    // Attach sword to torsoGroup (2-handed, centered on body)
    this.torsoGroup.add(this.swordGroup);

    // Angle both arms inward/forward toward the sword grip for a 2-handed pose
    this.leftArmGroup.rotation.x  = 0.4;
    this.leftArmGroup.rotation.z  = 0.15;
    this.rightArmGroup.rotation.x = 0.4;
    this.rightArmGroup.rotation.z = -0.15;

    // ── Assemble ──────────────────────────────────────────────────────────
    this.group.add(this.torsoGroup);
  }

  /**
   * Cape animation stub — cape has been removed.
   * Kept for API compatibility with callers in PlayerController/main.ts.
   */
  updateCape(_time: number, _speed = 0): void { /* cape removed */ }

  /**
   * Toggle dodge i-frame transparency on all warrior meshes.
   */
  setDodgeTransparency(active: boolean): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (active) {
          mat.transparent = true;
          mat.opacity = 0.5;
        } else {
          mat.transparent = false;
          mat.opacity = 1.0;
        }
      }
    });
  }

  /** Show or hide the shield mesh. */
  setShieldVisible(visible: boolean): void {
    this.shieldGroup.visible = visible;
  }
}
